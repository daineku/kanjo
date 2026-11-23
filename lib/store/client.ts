import 'server-only'

import { cache } from 'react'

import { storeConfig } from './server'
import type {
  Catalog,
  ProductDetail,
  ProductReviews,
  StoreErrorBody,
  StorePage,
  StoreRedirect,
} from './types'

/**
 * The commerce backend client. Server-only: it holds the storefront token.
 *
 * ── THE STORE MAY FAIL; THE SITE MAY NOT ────────────────────────────────────
 *
 * Every read here is bounded by a timeout and returns `null` (or a typed
 * "unavailable") instead of throwing. A store page then renders a calm
 * "catalogue temporarily unavailable" state, and the places where the store
 * merely appears on somebody else's page — the homepage promo, the sitemap —
 * simply omit it. A slow or broken CMS cannot take the game's site down, and
 * cannot hold a render open past the timeout.
 *
 * ── CACHING ─────────────────────────────────────────────────────────────────
 *
 * Reads go through Next's data cache, tagged `store-catalog` (and
 * `store-product-<slug>` for one product). The CMS calls /api/store/revalidate
 * when something is published, so the window below is a ceiling, not the
 * normal latency. A FAILED read is not cached: the next request tries again.
 *
 * Mutations are never cached and never retried here — a retried checkout is a
 * second order.
 */

const READ_TIMEOUT_MS = 4000
const WRITE_TIMEOUT_MS = 15000
const REVALIDATE_SECONDS = 300

export const CATALOG_TAG = 'store-catalog'
export const productTag = (slug: string) => `store-product-${slug}`

type ReadResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; body: unknown }

async function read<T>(path: string, tags: string[]): Promise<ReadResult<T>> {
  const config = storeConfig()
  if (!config.enabled) return { ok: false, status: 503, body: null }

  try {
    const response = await fetch(`${config.apiUrl}${path}`, {
      headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      next: { revalidate: REVALIDATE_SECONDS, tags },
    })
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) return { ok: false, status: response.status, body }
    return { ok: true, data: body as T }
  } catch (error) {
    // The reason goes to the server log, never to the page.
    console.error(`[store] GET ${path} failed:`, error instanceof Error ? error.message : error)
    return { ok: false, status: 0, body: null }
  }
}

/**
 * The whole published catalogue, or null when the store is off or unreachable.
 *
 * `cache()` de-duplicates within one render, so a page whose header, filters,
 * grid and structured data all ask for it costs one lookup.
 */
export const getCatalog = cache(async (): Promise<Catalog | null> => {
  const result = await read<Catalog>('/catalog', [CATALOG_TAG])
  if (!result.ok) return null
  const catalog = result.data
  // A shape check on the parts every page dereferences. A response that is not
  // a catalogue is treated as an outage rather than rendered half-way.
  if (!catalog || !Array.isArray(catalog.products) || !Array.isArray(catalog.categories) || !catalog.settings) {
    console.error('[store] /catalog returned an unexpected shape')
    return null
  }
  return {
    ...catalog,
    brands: Array.isArray(catalog.brands) ? catalog.brands : [],
    vehicles: Array.isArray(catalog.vehicles) ? catalog.vehicles : [],
  }
})

export type ProductLookup =
  | { state: 'found'; product: ProductDetail }
  | { state: 'missing'; redirectTo?: string }
  | { state: 'unavailable' }

export const getProduct = cache(async (slug: string): Promise<ProductLookup> => {
  const result = await read<{ product: ProductDetail }>(`/products/${encodeURIComponent(slug)}`, [
    CATALOG_TAG,
    productTag(slug),
  ])
  if (result.ok) {
    return result.data?.product ? { state: 'found', product: result.data.product } : { state: 'unavailable' }
  }
  if (result.status === 404) {
    const redirectTo = (result.body as { redirectTo?: unknown } | null)?.redirectTo
    return { state: 'missing', redirectTo: safeInternalPath(redirectTo) }
  }
  return { state: 'unavailable' }
})

export async function getProductReviews(slug: string): Promise<ProductReviews> {
  const result = await read<ProductReviews>(`/products/${encodeURIComponent(slug)}/reviews`, [
    CATALOG_TAG,
    productTag(slug),
  ])
  if (!result.ok || !Array.isArray(result.data?.reviews)) return { reviews: [] }
  return result.data
}

export const getStorePages = cache(async (): Promise<StorePage[] | null> => {
  const result = await read<{ pages: StorePage[] }>('/pages', [CATALOG_TAG])
  if (!result.ok || !Array.isArray(result.data?.pages)) return null
  return result.data.pages
})

export const getStoreRedirects = cache(async (): Promise<StoreRedirect[]> => {
  const result = await read<{ redirects: StoreRedirect[] }>('/redirects', [CATALOG_TAG])
  if (!result.ok || !Array.isArray(result.data?.redirects)) return []
  return result.data.redirects
})

/** The redirect target for a path that no longer resolves, if one is recorded. */
export async function findRedirect(pathname: string): Promise<StoreRedirect | undefined> {
  const redirects = await getStoreRedirects()
  const match = redirects.find((entry) => entry.fromPath === pathname)
  if (!match) return undefined
  const toPath = safeInternalPath(match.toPath)
  return toPath && toPath !== pathname ? { ...match, toPath } : undefined
}

/**
 * A redirect target is honoured only when it is a path on THIS site.
 *
 * The value is CMS content. Without this, a typo or a compromised editor
 * account turns every retired product URL into an open redirect.
 */
export function safeInternalPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return undefined
  if (/[\u0000-\u001f]/.test(value)) return undefined
  return value
}

// ── Mutations ───────────────────────────────────────────────────────────────

export type WriteResult = { status: number; body: unknown }

const UNAVAILABLE: StoreErrorBody = {
  error: { code: 'store_unavailable', message: 'The store is temporarily unavailable. Please try again shortly.' },
}

/**
 * POSTs to the backend on behalf of one visitor.
 *
 * The visitor's IP is forwarded so the backend — one long-running process,
 * which is where a rate limit can actually hold — can limit per visitor. The
 * header is trusted there only because the request is authenticated with the
 * storefront token.
 */
export async function storePost(path: string, payload: unknown, clientIp: string): Promise<WriteResult> {
  const config = storeConfig()
  if (!config.enabled) return { status: 503, body: UNAVAILABLE }

  try {
    const response = await fetch(`${config.apiUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-kanjo-client-ip': clientIp,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
      cache: 'no-store',
    })
    const body: unknown = await response.json().catch(() => null)
    if (body === null) {
      return response.ok ? { status: 502, body: UNAVAILABLE } : { status: response.status >= 500 ? 502 : response.status, body: UNAVAILABLE }
    }
    // A refusal of OUR token must never be reported to a visitor as their own
    // authentication failure. A refusal in the store's own error format (a
    // wrong order token, say) is the visitor's, and passes through.
    const isStoreError =
      typeof (body as { error?: { code?: unknown } }).error?.code === 'string' &&
      typeof (body as { error?: { message?: unknown } }).error?.message === 'string'
    if ((response.status === 401 || response.status === 403) && !isStoreError) {
      console.error(`[store] POST ${path} was refused by the backend (HTTP ${response.status}). Check STORE_CMS_TOKEN.`)
      return { status: 503, body: UNAVAILABLE }
    }
    return { status: response.status, body }
  } catch (error) {
    console.error(`[store] POST ${path} failed:`, error instanceof Error ? error.message : error)
    return { status: 503, body: UNAVAILABLE }
  }
}
