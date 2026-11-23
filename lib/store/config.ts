/**
 * Whether THE KANJO PARTS exists on this deployment, and where its backend is.
 *
 * ── ONE SWITCH, AND IT IS THE PRESENCE OF TWO VARIABLES ─────────────────────
 *
 * The store is ENABLED only when both `STORE_CMS_URL` and `STORE_CMS_TOKEN`
 * are set. With either missing, every store route is a 404, PARTS is absent
 * from the navigation, the footer and the sitemap, the homepage promo renders
 * nothing, and /api/store/* answers 503. So merging the store's code into a
 * deployment that has no store backend changes nothing a visitor can see —
 * which is what makes shipping the code and switching the store on two
 * separate, independently reversible steps.
 *
 * ── WHY A PURE FUNCTION OF AN ENVIRONMENT OBJECT ────────────────────────────
 *
 * Same reason as lib/runtime/policy.ts: the rule is importable by `node` tests,
 * and the `server-only` wrapper that reads `process.env` (lib/store/server.ts)
 * holds no logic of its own.
 *
 * ── A MALFORMED VALUE DISABLES THE STORE, IT DOES NOT THROW ─────────────────
 *
 * This is the opposite choice from lib/media/remotePattern.ts, deliberately.
 * A broken media origin breaks the site's own images, so failing the build is
 * right. A broken store URL must never take the game's site down with it: the
 * store is the optional half. It switches itself off and says why.
 */

export type StoreEnv = {
  STORE_CMS_URL?: string
  STORE_CMS_TOKEN?: string
  STORE_MEDIA_URL?: string
  STORE_REVALIDATE_SECRET?: string
}

export type StoreConfig =
  | { enabled: false; reason: string }
  | {
      enabled: true
      /** The CMS origin (plus any path prefix), no trailing slash. */
      baseUrl: string
      /** `<baseUrl>/api/storefront` */
      apiUrl: string
      token: string
    }

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function storeConfigFromEnv(env: StoreEnv): StoreConfig {
  const rawUrl = env.STORE_CMS_URL?.trim()
  const token = env.STORE_CMS_TOKEN?.trim()

  if (!rawUrl && !token) return { enabled: false, reason: 'not configured' }
  if (!rawUrl) return { enabled: false, reason: 'STORE_CMS_TOKEN is set but STORE_CMS_URL is not' }
  if (!token) return { enabled: false, reason: 'STORE_CMS_URL is set but STORE_CMS_TOKEN is not' }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { enabled: false, reason: `STORE_CMS_URL is not a URL: "${rawUrl}"` }
  }

  const local = LOCAL_HOSTS.has(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    // The token travels in a header on every request. Plain http to anything
    // but this machine would publish it to the network path.
    return {
      enabled: false,
      reason: 'STORE_CMS_URL must be https (http is allowed for localhost only)',
    }
  }
  if (url.username || url.password) {
    return { enabled: false, reason: 'STORE_CMS_URL must not carry credentials' }
  }

  const baseUrl = `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  return { enabled: true, baseUrl, apiUrl: `${baseUrl}/api/storefront`, token }
}

export function storeEnabledFromEnv(env: StoreEnv): boolean {
  return storeConfigFromEnv(env).enabled
}

/**
 * The `next/image` remote pattern for product media, or null.
 *
 * Derived from `STORE_MEDIA_URL` (a CDN or bucket in front of the CMS uploads)
 * and otherwise from `STORE_CMS_URL` itself, pinned to Strapi's `/uploads/`
 * directory. Narrow on purpose, like every other entry in next.config.ts: the
 * optimizer is told about exactly one host and one path prefix.
 *
 * Unlike the R2 pattern this accepts `http://localhost` so a local CMS can be
 * developed against, and — for the reason at the top of this file — a bad value
 * yields null rather than a failed build.
 */
export type StoreImagePattern = {
  protocol: 'https' | 'http'
  hostname: string
  port?: string
  pathname: string
}

export function storeMediaPatternFromEnv(env: StoreEnv): StoreImagePattern | null {
  const explicit = env.STORE_MEDIA_URL?.trim()
  const raw = explicit || env.STORE_CMS_URL?.trim()
  if (!raw) return null

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  const local = LOCAL_HOSTS.has(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null
  if (!url.hostname || url.hostname.includes('*')) return null

  const prefix = url.pathname.replace(/\/+$/, '')
  return {
    protocol: url.protocol === 'https:' ? 'https' : 'http',
    hostname: url.hostname,
    ...(url.port ? { port: url.port } : {}),
    // A media URL is pinned to its own prefix; the CMS origin to its uploads.
    pathname: explicit ? `${prefix}/**` : `${prefix}/uploads/**`,
  }
}

/**
 * Which cache tags a revalidation request may clear.
 *
 * The CMS sends `{ tags: [...] }`. Only tags in the store's own namespace are
 * honoured, so the store's secret cannot be used to flush the rest of the
 * site's cache; an absent or empty list means "the catalogue".
 */
export function revalidationTags(input: unknown): string[] {
  const raw =
    input && typeof input === 'object' && Array.isArray((input as { tags?: unknown }).tags)
      ? ((input as { tags: unknown[] }).tags as unknown[])
      : []
  const tags = raw
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter((tag) => /^store-[a-z0-9-]{1,120}$/.test(tag))
  const unique = [...new Set(tags)].slice(0, 50)
  return unique.length > 0 ? unique : ['store-catalog']
}
