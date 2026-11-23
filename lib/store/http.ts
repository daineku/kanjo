import 'server-only'

import { NextResponse } from 'next/server'

import { resolveContentSource } from '@/lib/content/source'
import { deploymentMode } from '@/lib/runtime/mode'
import { siteOrigin } from '@/lib/seo/metadata'

import { storePost } from './client'
import { storeEnabled } from './server'
import type { StoreErrorBody, StoreErrorCode } from './types'

/**
 * Shared plumbing for the /api/store/* route handlers.
 *
 * These handlers are the ONLY way a browser reaches the commerce backend, and
 * each is a public HTTP endpoint, so every one starts with the same four
 * questions, asked here once:
 *
 *   1. Is there a store at all?            → 503 `store_unavailable`
 *   2. Did this request come from our own pages?  (Origin check — CSRF)
 *   3. Is the body a bounded JSON object?  → 400 / 413
 *   4. Who is asking?                      (client IP, for the backend's limiter)
 *
 * What the handlers do NOT do is decide anything about money or stock. They
 * bound and forward; the backend recomputes every price and re-checks every
 * quantity from its own records.
 */

/** Vercel rejects request bodies over ~4.5 MB; refuse a little under that. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024

export function storeError(status: number, code: StoreErrorCode, message: string, fields?: Record<string, string>) {
  const body: StoreErrorBody = { error: { code, message, ...(fields ? { fields } : {}) } }
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

/**
 * The origin this deployment's own pages are served from.
 *
 * Used for two things that must NEVER come from the request's Host header,
 * which a caller chooses: the URLs a payment processor sends the customer back
 * to, and the allowlist for the Origin check below.
 *
 * In local development the request's own origin is used, because the content
 * document's `primaryDomain` is the production site and a developer's checkout
 * should come back to their own machine. On Vercel previews, the deployment's
 * own URL is used unless `NEXT_PUBLIC_SITE_URL` says otherwise.
 */
export async function storeSiteOrigin(request: Request): Promise<string> {
  const mode = deploymentMode()
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (!explicit) {
    if (mode === 'development') return new URL(request.url).origin
    const vercelUrl = process.env.VERCEL_URL?.trim()
    if (mode === 'preview' && vercelUrl) return `https://${vercelUrl}`
  }
  const source = await resolveContentSource()
  return siteOrigin(await source.getSiteSettings())
}

function twin(origin: string): string | undefined {
  try {
    const url = new URL(origin)
    url.hostname = url.hostname.startsWith('www.') ? url.hostname.slice(4) : `www.${url.hostname}`
    return url.origin
  } catch {
    return undefined
  }
}

/**
 * Whether a state-changing request came from this site's own pages.
 *
 * Browsers attach `Origin` to every cross-origin request and to every
 * same-origin POST, so a form on another site that posts here is identifiable
 * and refused. The apex and `www` are both accepted because production answers
 * on both. A request with no Origin at all is accepted only when the browser
 * itself vouches for it (`Sec-Fetch-Site: same-origin`).
 */
async function sameSite(request: Request): Promise<boolean> {
  const origin = request.headers.get('origin')
  if (!origin) return request.headers.get('sec-fetch-site') === 'same-origin'

  const site = await storeSiteOrigin(request)
  const allowed = new Set<string>([site])
  const other = twin(site)
  if (other) allowed.add(other)
  for (const name of ['VERCEL_URL', 'VERCEL_BRANCH_URL'] as const) {
    const value = process.env[name]?.trim()
    if (value) allowed.add(`https://${value}`)
  }
  return allowed.has(origin)
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown'
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : 'unknown'
}

type Prepared =
  | { ok: true; body: Record<string, unknown>; ip: string }
  | { ok: false; response: NextResponse }

/** Runs the four checks and returns the parsed JSON object. */
export async function prepare(request: Request): Promise<Prepared> {
  if (!storeEnabled()) {
    return { ok: false, response: storeError(503, 'store_unavailable', 'The store is not available.') }
  }
  if (!(await sameSite(request))) {
    return { ok: false, response: storeError(403, 'unauthorized', 'This request did not come from this site.') }
  }

  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) {
    return { ok: false, response: storeError(413, 'validation_failed', 'The request is too large.') }
  }

  let text: string
  try {
    text = await request.text()
  } catch {
    return { ok: false, response: storeError(400, 'validation_failed', 'The request could not be read.') }
  }
  // Content-Length can be absent or wrong; measure what actually arrived.
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    return { ok: false, response: storeError(413, 'validation_failed', 'The request is too large.') }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, response: storeError(400, 'validation_failed', 'The request body is not valid JSON.') }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, response: storeError(400, 'validation_failed', 'The request body must be an object.') }
  }

  return { ok: true, body: parsed as Record<string, unknown>, ip: clientIp(request) }
}

/** Forwards to the backend and passes its answer — success or error — through. */
export async function forward(path: string, payload: unknown, ip: string): Promise<NextResponse> {
  const result = await storePost(path, payload, ip)
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

// ── Bounded readers for visitor input ───────────────────────────────────────

/** A shape check, not a deliverability check: the backend validates again. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : undefined
}

/** Spam fields pass through untouched in type but bounded in size. */
export function spamFields(body: Record<string, unknown>): { website?: string; elapsedMs?: number } {
  const elapsed = Number(body.elapsedMs)
  return {
    website: typeof body.website === 'string' ? body.website.slice(0, 200) : undefined,
    elapsedMs: Number.isFinite(elapsed) && elapsed >= 0 ? Math.min(Math.round(elapsed), 86_400_000) : undefined,
  }
}

const MAX_ITEMS = 50
const MAX_QUANTITY = 99

/**
 * Cart items as the backend will receive them: at most 50 lines, each a SKU
 * and a whole quantity from 1 to 99, duplicates merged. Returns null when the
 * value is not a list of items at all.
 */
export function cartItems(value: unknown): { sku: string; quantity: number }[] | null {
  if (!Array.isArray(value)) return null
  const merged = new Map<string, number>()
  for (const entry of value.slice(0, MAX_ITEMS * 2)) {
    if (!entry || typeof entry !== 'object') continue
    const sku = (entry as { sku?: unknown }).sku
    const quantity = Number((entry as { quantity?: unknown }).quantity)
    if (typeof sku !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(sku)) continue
    if (!Number.isFinite(quantity)) continue
    const clamped = Math.min(MAX_QUANTITY, Math.max(1, Math.floor(quantity)))
    merged.set(sku, Math.min(MAX_QUANTITY, (merged.get(sku) ?? 0) + clamped))
    if (merged.size >= MAX_ITEMS) break
  }
  return [...merged.entries()].map(([sku, quantity]) => ({ sku, quantity }))
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/**
 * Uploaded images, bounded here and VERIFIED by the backend (which reads the
 * bytes). This side only refuses what is obviously not an image upload, so a
 * malformed payload never costs the backend a request.
 */
export function uploadedImages(value: unknown, max: number): { filename: string; contentType: string; dataBase64: string }[] {
  if (!Array.isArray(value)) return []
  const images: { filename: string; contentType: string; dataBase64: string }[] = []
  for (const entry of value.slice(0, max)) {
    if (!entry || typeof entry !== 'object') continue
    const { filename, contentType, dataBase64 } = entry as Record<string, unknown>
    if (typeof contentType !== 'string' || !IMAGE_TYPES.has(contentType)) continue
    if (typeof dataBase64 !== 'string' || dataBase64.length === 0 || dataBase64.length > 2_000_000) continue
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) continue
    const name = typeof filename === 'string' ? filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) : 'photo'
    images.push({ filename: name || 'photo', contentType, dataBase64 })
  }
  return images
}
