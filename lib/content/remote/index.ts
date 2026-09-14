import 'server-only'

import { serverSupabase } from '@/lib/supabase/server'

import { parseSiteContentDocument, type SiteContentDocument } from '../document'
import { resolveExternalFeeds } from '../externals'
import { LocalContentSource } from '../local'
import { publishedInOrder } from '../local/parse'
import { ContentConfigurationError, type ContentSource } from '../source'
import type {
  Article,
  ArticleSummary,
  LandingContent,
  LoaderConfig,
  SiteSettings,
} from '../types'

/**
 * The Supabase-backed content source.
 *
 * ── ONE ROW, ONE QUERY ──────────────────────────────────────────────────────
 *
 * `public.thekanjo_site` holds a single row, `id = 'main'`, whose `content`
 * column is the entire site configuration. A landing render is therefore one
 * `select`, not one per section — which is the brief's requirement and the
 * reason the document is stored whole rather than normalised. See
 * lib/content/document.ts for why that shape is right for this site.
 *
 * ── ARTICLES STAY IN THE REPOSITORY, AND THAT IS DELIBERATE ─────────────────
 *
 * `listArticles` / `getArticle` / `listArticleSlugs` delegate to
 * LocalContentSource, which reads the Markdown in `content/updates/`. They are
 * long-form writing with images and code in them; they belong in version
 * control next to the site that renders them, they want a diff and a review,
 * and they are not something anybody should be editing in a textarea. The
 * admin's job is the site's CONFIGURATION — copy, ordering, visibility, media
 * — and that is what lives in the database.
 *
 * Both sources therefore return identical articles, which also means switching
 * `CONTENT_SOURCE` cannot change what `/updates` shows.
 *
 * ── CACHING ─────────────────────────────────────────────────────────────────
 *
 * Per-request memoisation only, deliberately. The landing page is statically
 * prerendered, so in production this runs at build time and at each
 * revalidation; caching it for longer would mean an admin save not showing up
 * until a process recycled. `revalidatePath` after a write is what publishes a
 * change, and that only works if the next render actually re-reads.
 */

const TABLE = 'thekanjo_site'
const ROW_ID = 'main'

export class RemoteContentSource implements ContentSource {
  readonly kind = 'supabase'

  /** Articles come from the filesystem. See the note above. */
  private readonly articles = new LocalContentSource()

  /**
   * Memoised for the life of THIS source instance, which `resolveContentSource`
   * makes one per process. Two `await`s in the same render share one query;
   * a later render after a revalidation gets a fresh one.
   */
  private document: Promise<SiteContentDocument> | null = null

  private load(): Promise<SiteContentDocument> {
    this.document ??= (async () => {
      const supabase = serverSupabase()
      const { data, error } = await supabase
        .from(TABLE)
        .select('content')
        .eq('id', ROW_ID)
        .maybeSingle()

      if (error) {
        // A misconfiguration or an outage, not a content problem. Failing loudly
        // is right: rendering an empty site because the database was unreachable
        // would publish a blank page over a working one.
        throw new ContentConfigurationError(
          `Could not read ${TABLE} (id='${ROW_ID}'): ${error.message}. ` +
            `Check SUPABASE_URL/SUPABASE_SECRET_KEY and that the migration in supabase/migrations has been applied.`,
        )
      }

      if (!data) {
        throw new ContentConfigurationError(
          `${TABLE} has no row with id='${ROW_ID}'. Seed it with \`npm run content:export\` ` +
            `and the insert in docs/PRODUCTION_SETUP.md — the site will not invent content to fill the gap.`,
        )
      }

      // The validation boundary. `content jsonb` is a column, not a type.
      return parseSiteContentDocument(
        (data as { content: unknown }).content,
        `${TABLE}.content (id='${ROW_ID}')`,
      )
    })()

    return this.document
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
    // source uses. Which channel to ask about is content, so this runs after
    // the document has been read.
    const { patreon, youtube } = await resolveExternalFeeds(sections)

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

/**
 * Builds the source, failing at startup rather than at render time.
 *
 * A half-configured deployment gets a message naming what is missing, instead
 * of a site that renders with no content in it.
 */
export async function createRemoteContentSource(): Promise<ContentSource> {
  const missing = (['SUPABASE_URL', 'SUPABASE_SECRET_KEY'] as const).filter(
    (name) => !process.env[name]?.trim(),
  )

  if (missing.length > 0) {
    throw new ContentConfigurationError(
      `CONTENT_SOURCE=supabase requires ${missing.join(' and ')}. ` +
        `Set them in .env.local, or unset CONTENT_SOURCE to use the local content in content/. ` +
        `See docs/PRODUCTION_SETUP.md.`,
    )
  }

  return new RemoteContentSource()
}
