/**
 * The browser side of the cart and of order access — and nothing else.
 *
 * ── WHAT IS STORED ──────────────────────────────────────────────────────────
 *
 *   kanjo.cart.v1    [{ sku, quantity }]   — no price, no name, no total
 *   kanjo.orders.v1  { [reference]: token } — the bearer for /orders/[ref]
 *
 * The cart deliberately holds only what the visitor CHOSE. Every price, name,
 * stock level and total the cart page shows comes back from the backend on
 * each render (POST /api/store/cart/quote), so a stale tab or an edited
 * localStorage value can change what is asked for, never what is charged.
 *
 * Every access is wrapped: storage can be absent (private mode, blocked site
 * data) or throw, and the store must still render — it just forgets.
 */

import type { CartItemInput } from './types'

const CART_KEY = 'kanjo.cart.v1'
const ORDERS_KEY = 'kanjo.orders.v1'
export const CART_EVENT = 'kanjo:cart'

const MAX_LINES = 50
const MAX_QTY = 99

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage unavailable: the cart lives for this page only.
  }
}

function clean(value: unknown): CartItemInput[] {
  if (!Array.isArray(value)) return []
  const merged = new Map<string, number>()
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const sku = (entry as { sku?: unknown }).sku
    const quantity = Math.floor(Number((entry as { quantity?: unknown }).quantity))
    if (typeof sku !== 'string' || !sku || sku.length > 64) continue
    if (!Number.isFinite(quantity) || quantity < 1) continue
    merged.set(sku, Math.min(MAX_QTY, (merged.get(sku) ?? 0) + quantity))
  }
  return [...merged.entries()].slice(0, MAX_LINES).map(([sku, quantity]) => ({ sku, quantity }))
}

export function readCart(): CartItemInput[] {
  return clean(readJson(CART_KEY))
}

export function writeCart(items: CartItemInput[]) {
  writeJson(CART_KEY, clean(items))
  try {
    window.dispatchEvent(new Event(CART_EVENT))
  } catch {
    // no window
  }
}

export function addToCart(sku: string, quantity: number, max = MAX_QTY) {
  const items = readCart()
  const existing = items.find((item) => item.sku === sku)
  const limit = Math.min(MAX_QTY, Math.max(1, max))
  if (existing) existing.quantity = Math.min(limit, existing.quantity + quantity)
  else items.push({ sku, quantity: Math.min(limit, quantity) })
  writeCart(items)
}

export function setCartQuantity(sku: string, quantity: number) {
  const items = readCart()
    .map((item) => (item.sku === sku ? { ...item, quantity } : item))
    .filter((item) => item.quantity > 0)
  writeCart(items)
}

export function cartCount(items: CartItemInput[] = readCart()): number {
  return items.reduce((sum, item) => sum + item.quantity, 0)
}

// ── Order access tokens ─────────────────────────────────────────────────────

function readOrders(): Record<string, string> {
  const value = readJson(ORDERS_KEY)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, string> = {}
  for (const [reference, token] of Object.entries(value)) {
    if (typeof token === 'string' && /^[A-Za-z0-9-]{4,40}$/.test(reference)) result[reference] = token
  }
  return result
}

export function rememberOrderToken(reference: string, token: string) {
  const orders = readOrders()
  orders[reference.toUpperCase()] = token
  // Keep the newest twenty: this is a convenience, not an account.
  const entries = Object.entries(orders).slice(-20)
  writeJson(ORDERS_KEY, Object.fromEntries(entries))
}

export function orderToken(reference: string): string | undefined {
  return readOrders()[reference.toUpperCase()]
}

// ── Form timing (spam heuristic) ────────────────────────────────────────────

/** Milliseconds since `start`, for the `elapsedMs` spam field. */
export function elapsedSince(start: number): number {
  return Math.max(0, Math.round(performance.now() - start))
}

/** Posts JSON to this site's own store API and returns status + parsed body. */
export async function postStore<T>(path: string, body: unknown): Promise<{ status: number; data: T | null; error?: { code: string; message: string; fields?: Record<string, string> } }> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    })
    const parsed: unknown = await response.json().catch(() => null)
    if (response.ok) return { status: response.status, data: parsed as T }
    const error = (parsed as { error?: { code: string; message: string; fields?: Record<string, string> } } | null)?.error
    return {
      status: response.status,
      data: parsed as T,
      error: error ?? { code: 'store_unavailable', message: 'Something went wrong. Please try again.' },
    }
  } catch {
    return {
      status: 0,
      data: null,
      error: { code: 'store_unavailable', message: 'Could not reach the store. Check your connection and try again.' },
    }
  }
}

/**
 * Downscales an image to at most `maxEdge` pixels on its long edge and
 * re-encodes it as JPEG, in the browser.
 *
 * Two reasons: a phone photo is 4–12 MB and the upload path is bounded well
 * under that; and re-encoding through a canvas strips EXIF, including GPS
 * coordinates, before a customer's photo ever leaves their device.
 */
export async function downscaleImage(file: File, maxEdge = 1600): Promise<{ filename: string; contentType: string; dataBase64: string }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) || 'photo'
  return { filename: `${base}.jpg`, contentType: 'image/jpeg', dataBase64: dataUrl.slice(dataUrl.indexOf(',') + 1) }
}
