import { cache } from 'react'

// Explicit `.ts` extensions: this module is executed directly by `node` from
// cache.test.ts, and Node's resolver needs the real filename.
// `allowImportingTsExtensions` in tsconfig.json is what lets the bundler accept
// the same specifiers.
import { parseSiteContentDocument, type SiteContentDocument } from '../document.ts'
import { publishedInOrder } from '../local/parse.ts'
import { ContentConfigurationError, type ContentSource } from '../source.ts'
import type {
  Article,
  ArticleSummary,
  LandingContent,
  LoaderConfig,
  PatreonFeed,
  Section,
  SiteSettings,
  YouTubeFeed,
} from '../types.ts'
import { CONTENT_ROW_ID, CONTENT_TABLE, type SupabaseLike, type SupabaseProvider } from './client.ts'

/**
 * The two server-side collaborators, injected rather than imported.
 *
 * `../externals` reaches the Patreon and YouTube adapters, and `../local`
 * reaches the filesystem — both sit behind `server-only`, which throws outside
 * a React Server Component. Importing them at the top of this file would make
 * the whole class unloadable in a `node` test, which is what previously forced
 * infrastructure tests to re-implement production logic instead of importing
 * it.
 *
 * So they are constructor arguments with LAZY defaults: `await import(...)`
 * inside the method, evaluated only when the method is actually called. The
 * wiring module passes nothing and gets the real ones; a test passes stubs and
 * the server-only modules are never reached.
 */
export type FeedResolver = (
  sections: Section[],
) => Promise<{ patreon: PatreonFeed; youtube: YouTubeFeed }>

export type ArticleReader = Pick<
  ContentSource,
  'listArticles' | 'getArticle' | 'listArticleSlugs'
>

const defaultFeeds: FeedResolver = async (sections) => {
  const { resolveExternalFeeds } = await import('../externals.ts')
  return resolveExternalFeeds(sections)
}

let localArticles: ArticleReader | null = null
const defaultArticles: ArticleReader = {
  async listArticles() {
    return (await loadLocalArticles()).listArticles()
  },
  async getArticle(slug: string) {
    return (await loadLocalArticles()).getArticle(slug)
  },
  async listArticleSlugs() {
    return (await loadLocalArticles()).listArticleSlugs()
  },
}

async function loadLocalArticles(): Promise<ArticleReader> {
  if (!localArticles) {
    const { LocalContentSource } = await import('../local/index.ts')
    localArticles = new LocalContentSource()
  }
  return localArticles
}

/**
 * The Supabase-backed content source.
 *
 * ── ONE ROW, ONE QUERY ──────────────────────────────────────────────────────
 *
 * `public.thekanjo_site` holds a single row, `id = 'main'`, whose `content`
 * column is the entire site configuration. A landing render is therefore one
 * `select`, not one per section. See lib/content/document.ts for why the
 * document is stored whole rather than normalised.
 *
 * ── THE CACHE, AND THE BUG THAT WAS HERE ────────────────────────────────────
 *
 * The first version memoised the document on the INSTANCE
 * (`private document: Promise<SiteContentDocument> | null`), and
 * `resolveContentSource()` caches one instance for the life of the process.
 * Together those meant the document was read once per PROCESS, not once per
 * request — so an admin save would land in Supabase, `revalidatePath` would
 * rebuild the page, and the rebuild would be handed the same stale promise.
 * The public site would serve old content until the serverless instance
 * recycled, which could be hours. A comment claimed the cache was per-request;
 * it was not, and the comment is why it went unnoticed.
 *
 * The fix is REQUEST-SCOPED MEMOISATION AND NOTHING ELSE — the brief's Option
 * B. `readDocument` below is wrapped in React's `cache()`, which is scoped to a
 * single server request:
 *
 *   - within one render, twelve sections asking for content produce ONE query
 *   - across requests, nothing is retained, so the next render after a write
 *     reads the new row
 *
 * There is deliberately no process-level or time-based layer on top. The
 * landing page is statically prerendered, so in production this runs at build
 * time and again on each `revalidatePath` — not once per visitor — and adding a
 * second cache would reintroduce exactly the staleness this replaced.
 *
 * NOTHING ON THIS CLASS HOLDS A DOCUMENT. That is the invariant, and
 * lib/content/remote/cache.test.ts is what keeps it true.
 *
 * ── ARTICLES STAY IN THE REPOSITORY, AND THAT IS DELIBERATE ─────────────────
 *
 * `listArticles` / `getArticle` / `listArticleSlugs` delegate to
 * LocalContentSource, which reads the Markdown in `content/updates/`. They are
 * long-form writing with images and code in them; they belong in version
 * control next to the site that renders them, they want a diff and a review,
 * and they are not something anybody should edit in a textarea. The admin's job
 * is the site's CONFIGURATION, and that is what lives in the database.
 *
 * Both sources therefore return identical articles, which also means switching
 * `CONTENT_SOURCE` cannot change what `/updates` shows.
 */

/**
 * The read, memoised per request.
 *
 * The client is passed as the argument rather than captured, because React's
 * `cache` keys on arguments: one client instance per process means one cache
 * entry per request, and a test passing a different double gets its own.
 *
 * Outside a server request — in a `node` test — React's `cache` passes straight
 * through and calls the function every time. That is exactly the behaviour the
 * invalidation test needs, and it is why the test can exercise this function
 * rather than a re-implementation of it.
 */
const readDocument = cache(
  async (client: SupabaseLike): Promise<SiteContentDocument> => {
    const { data, error } = await client
      .from(CONTENT_TABLE)
      .select('content')
      .eq('id', CONTENT_ROW_ID)
      .maybeSingle()

    if (error) {
      // A misconfiguration or an outage, not a content problem. Failing loudly
      // is right: rendering an empty site because the database was unreachable
      // would publish a blank page over a working one.
      throw new ContentConfigurationError(
        `Could not read ${CONTENT_TABLE} (id='${CONTENT_ROW_ID}'): ${error.message}. ` +
          `Check SUPABASE_URL/SUPABASE_SECRET_KEY and that the migration in supabase/migrations has been applied.`,
      )
    }

    if (!data) {
      throw new ContentConfigurationError(
        `${CONTENT_TABLE} has no row with id='${CONTENT_ROW_ID}'. Seed it once during ` +
          `provisioning — see docs/PRODUCTION_SETUP.md step B2. The site will not invent ` +
          `content to fill the gap.`,
      )
    }

    // The validation boundary. `content jsonb` is a column, not a type.
    return parseSiteContentDocument(
      data.content,
      `${CONTENT_TABLE}.content (id='${CONTENT_ROW_ID}')`,
    )
  },
)

export class RemoteContentSource implements ContentSource {
  readonly kind = 'supabase'

  private readonly getClient: SupabaseProvider
  private readonly feeds: FeedResolver
  /** Articles come from the filesystem. See the note above. */
  private readonly articles: ArticleReader

  // Written out rather than as TypeScript parameter properties: this module is
  // executed directly by `node` in cache.test.ts, and Node's type stripping
  // rejects them because erasing them would change runtime behaviour rather
  // than only removing types. Same reason as lib/content/local/parse.ts.
  constructor(
    getClient: SupabaseProvider,
    deps: { feeds?: FeedResolver; articles?: ArticleReader } = {},
  ) {
    this.getClient = getClient
    this.feeds = deps.feeds ?? defaultFeeds
    this.articles = deps.articles ?? defaultArticles
  }

  private load(): Promise<SiteContentDocument> {
    // Note what is NOT here: no field, no `??=`, no instance state of any kind.
    return readDocument(this.getClient())
  }

  async getSiteSettings(): Promise<SiteSettings> {
    const { settings } = await this.load()

    // Filtering and ordering happen in the SOURCE — the ContentSource contract,
    // and the same transformation LocalContentSource applies, so a component
    // cannot tell which one it is talking to.
    return {
      ...settings,
      nav: settings.nav.filter((item) => item.visible),
      social: publishedInOrder(settings.social),
      footer: {
        ...settings.footer,
        links: settings.footer.links.filter((item) => item.visible),
      },
    }
  }

  async getLoaderConfig(): Promise<LoaderConfig> {
    return (await this.load()).loader
  }

  async getLandingContent(): Promise<LandingContent> {
    const [document, settings, updates] = await Promise.all([
      this.load(),
      this.getSiteSettings(),
      this.listArticles(),
    ])

    const sections = publishedInOrder(document.sections)

    // Same external feeds, same never-throw contract, same module as the local
    // source uses. Which channel to ask YouTube about is content, so this runs
    // after the document has been read.
    const { patreon, youtube } = await this.feeds(sections)

    return {
      settings,
      loader: document.loader,
      patreon,
      youtube,
      sections,
      videos: publishedInOrder(document.videos),
      media: publishedInOrder(document.media),
      // Links are addressed by id from a section's config, so they are NOT
      // ordered here — a section states its own order. They are still filtered.
      links: document.links.filter((link) => link.published),
      updates,
    }
  }

  listArticles(): Promise<ArticleSummary[]> {
    return this.articles.listArticles()
  }

  getArticle(slug: string): Promise<Article | null> {
    return this.articles.getArticle(slug)
  }

  listArticleSlugs(): Promise<string[]> {
    return this.articles.listArticleSlugs()
  }
}
