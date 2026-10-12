/**
 * TikTok's embed render signal, as the parent page is permitted to see it.
 *
 * ── WHAT CAN AND CANNOT BE KNOWN ABOUT A CROSS-ORIGIN IFRAME ────────────────
 *
 * The Creator Profile Embed is an iframe on `https://www.tiktok.com`. The
 * same-origin policy means this page can never read what is inside it: not
 * its text, not its HTTP status, not whether it is a profile or a one-line
 * provider error. Its `load` event fires either way — measured, TikTok's
 * ingress answers `503 overload-protect triggered` and the iframe still
 * "loads" — so `load` proves nothing.
 *
 * What the page IS permitted to observe is `window.postMessage`. TikTok's own
 * embed library (`embed_lib_v*.js`, pulled in by `embed.js`) sizes the iframe
 * from a message the embedded application posts once it has rendered:
 *
 *   origin  "https://www.tiktok.com"
 *   data    JSON string  { signalSource: "__tt_embed__<blockquote id>", height }
 *
 * The one-line error page has no application in it and posts nothing. So a
 * well-formed height message addressed to OUR blockquote is the closest thing
 * to "it rendered" that exists on the parent side.
 *
 * ── THIS IS A HEURISTIC, AND IT IS A SAFE ONE ───────────────────────────────
 *
 * The protocol is not in TikTok's public embed documentation; it is what their
 * library does today. The failure mode of it changing is the SAFE direction:
 * no signal arrives, the module keeps its own preview, and the visitor sees a
 * finished block with a working link rather than a provider error. Nothing
 * here claims the problem has been fixed at TikTok's end — it has not, and it
 * cannot be from this side.
 *
 * Pure functions, no DOM, so `npm run test:tiktok` covers the parsing.
 */

export const TIKTOK_EMBED_ORIGIN = 'https://www.tiktok.com'

/** The prefix TikTok's library puts in front of the blockquote id. */
export const TIKTOK_SIGNAL_PREFIX = '__tt_embed__'

export type TikTokRenderSignal = {
  /** The id TikTok's library assigned to the blockquote it rendered into. */
  id: string
  /** The height, in CSS px, the embedded application asked for. */
  height: number
}

/**
 * Reads a `message` event's origin and data as a TikTok render signal.
 *
 * Returns null for anything that is not one: another origin, a non-JSON
 * payload, a message without a height (TikTok also uses the channel for link
 * clicks), or an id that is not a plain token. The id is validated to a
 * character class because the caller compares it with a DOM id and nothing
 * else — it is never interpolated into a selector or into markup.
 */
export function readTikTokRenderSignal(origin: string, data: unknown): TikTokRenderSignal | null {
  if (origin !== TIKTOK_EMBED_ORIGIN) return null

  let payload: unknown = data
  if (typeof data === 'string') {
    try {
      payload = JSON.parse(data)
    } catch {
      return null
    }
  }
  if (!payload || typeof payload !== 'object') return null

  const { signalSource, height } = payload as { signalSource?: unknown; height?: unknown }
  if (typeof signalSource !== 'string' || !signalSource.startsWith(TIKTOK_SIGNAL_PREFIX)) {
    return null
  }

  const id = signalSource.slice(TIKTOK_SIGNAL_PREFIX.length)
  if (!/^\w+$/.test(id)) return null

  const px = typeof height === 'number' ? height : Number(height)
  if (!Number.isFinite(px) || px <= 0) return null

  return { id, height: px }
}
