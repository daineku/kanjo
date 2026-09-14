import 'server-only'

/**
 * YouTube Data API credentials, read from the server environment and nowhere
 * else.
 *
 * `server-only` makes it a BUILD ERROR for a client component to import
 * anything in this module graph. A Data API key is not a database
 * service-role key — it cannot write anything and it cannot read anything
 * private — but it IS a quota. A key in the client bundle is a key anyone can
 * lift and spend, and the first symptom is our own site getting 403
 * `quotaExceeded` from Google for the rest of the day.
 *
 * Nothing here is prefixed `NEXT_PUBLIC_`, which would inline it into the
 * bundle and publish it.
 */

export function readYouTubeApiKey(): string | null {
  const key = process.env.YOUTUBE_API_KEY?.trim()
  return key ? key : null
}

/**
 * How long a resolved latest-video is reused before Google is asked again.
 *
 * The brief's own framing is the right one: a new upload appearing fifteen
 * minutes later is acceptable. The Data API's default quota is 10,000 units a
 * day and this costs 2 units a refresh, so fifteen minutes is ~192 units — a
 * rounding error — while per-request fetching on a page that gets any traffic
 * at all would exhaust it.
 *
 * Clamped to a floor of 60s so a misconfiguration cannot turn into a request
 * per render.
 */
export function readYouTubeRevalidateSeconds(): number {
  const raw = Number(process.env.YOUTUBE_REVALIDATE_SECONDS)
  if (!Number.isFinite(raw) || raw < 60) return 900
  return Math.floor(raw)
}
