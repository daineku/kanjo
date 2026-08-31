import type {
  Article,
  ArticleSummary,
  LandingContent,
  SiteSettings,
} from './types'

/**
 * The one boundary between the site and its content storage.
 *
 * Every page and every section reads content through this interface. Nothing in
 * app/ or components/ imports a storage client, a filesystem path or a database
 * row type, so replacing the local source with a hosted backend is one new file
 * and one line in `resolveContentSource`.
 *
 * Two rules the implementations must honour, because the UI relies on them:
 *
 *  1. FILTERING AND ORDERING HAPPEN HERE. A source returns only published
 *     entries, already sorted. A component that has to remember to check
 *     `published` is a component that will eventually forget.
 *
 *  2. A MISSING ENTITY IS `null`, NOT A THROW. `getArticle` on an unknown slug
 *     returns null so the route can render a 404. A thrown error means the
 *     source itself is misconfigured, which is a different situation and should
 *     fail loudly.
 */
export interface ContentSource {
  /** A label for diagnostics, e.g. 'local'. */
  readonly kind: string

  getSiteSettings(): Promise<SiteSettings>

  /** Everything the landing page needs, in one call. */
  getLandingContent(): Promise<LandingContent>

  /** Published articles, newest first. */
  listArticles(): Promise<ArticleSummary[]>

  /** A single published article, or null if there is no such slug. */
  getArticle(slug: string): Promise<Article | null>

  /** Slugs for static generation and the sitemap. */
  listArticleSlugs(): Promise<string[]>
}

/**
 * Raised when a source cannot operate because of configuration rather than
 * content. The message is meant to be actionable at a terminal.
 */
export class ContentConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContentConfigurationError'
  }
}

let cached: ContentSource | null = null

/**
 * Selects the content source from the environment.
 *
 * `CONTENT_SOURCE` defaults to `local`, so a fresh clone runs with no
 * configuration at all — the brief's requirement that development must not
 * depend on production credentials. Naming an unimplemented source fails with a
 * message that says what to do, rather than rendering an empty site.
 */
export async function resolveContentSource(): Promise<ContentSource> {
  if (cached) return cached

  const requested = (process.env.CONTENT_SOURCE ?? 'local').trim().toLowerCase()

  if (requested === 'local') {
    const { LocalContentSource } = await import('./local')
    cached = new LocalContentSource()
    return cached
  }

  if (requested === 'remote') {
    const { createRemoteContentSource } = await import('./remote')
    cached = await createRemoteContentSource()
    return cached
  }

  throw new ContentConfigurationError(
    `Unknown CONTENT_SOURCE "${requested}". Valid values are "local" (default) and "remote". ` +
      `See docs/ARCHITECTURE.md.`,
  )
}
