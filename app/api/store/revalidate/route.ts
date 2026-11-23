import { createHash, timingSafeEqual } from 'node:crypto'

import { revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'

import { revalidationTags } from '@/lib/store/config'
import { storeEnabled, storeRevalidateSecret } from '@/lib/store/server'

/**
 * POST /api/store/revalidate
 *
 * Called by the commerce backend when the catalogue changes, so a published
 * product appears without waiting out the cache window.
 *
 * Authenticated with a shared secret in the Authorization header, compared in
 * constant time over fixed-length digests (so neither the content nor the
 * length of the secret leaks through timing). With no secret configured the
 * endpoint refuses everyone — an unset variable must not become an open
 * cache-flush button. Only tags in the store's own namespace are honoured.
 */
export async function POST(request: Request) {
  const secret = storeRevalidateSecret()
  if (!storeEnabled() || !secret) {
    return NextResponse.json(
      { error: { code: 'store_unavailable', message: 'Not configured.' } },
      { status: 503 },
    )
  }

  const header = request.headers.get('authorization') ?? ''
  const presented = header.startsWith('Bearer ') ? header.slice(7) : ''
  const a = createHash('sha256').update(presented).digest()
  const b = createHash('sha256').update(secret).digest()
  if (!presented || !timingSafeEqual(a, b)) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Unauthorized.' } },
      { status: 401 },
    )
  }

  const raw = (await request.text().catch(() => '')).slice(0, 20_000)
  let payload: unknown
  try {
    payload = raw ? JSON.parse(raw) : undefined
  } catch {
    payload = undefined
  }

  const tags = revalidationTags(payload)
  for (const tag of tags) revalidateTag(tag)
  return NextResponse.json({ revalidated: tags }, { headers: { 'Cache-Control': 'no-store' } })
}
