import type { PatreonPost } from '@/lib/content/types'

/**
 * Turning a Patreon API v2 post resource into something publishable.
 *
 * THIS FILE IS THE SECURITY BOUNDARY, and it is separate from the HTTP client
 * so it can be reasoned about — and tested — on its own.
 *
 * The situation it guards: the site authenticates with a CREATOR-level token,
 * which by design can read the full body of members-only posts. Patreon returns
 * that body in `content` for a paid post exactly as it does for a public one.
 * Rendering the API's `content` without asking whether the post is public would
 * publish paid material to an anonymous visitor on a public web page — the
 * single worst thing this integration could do.
 *
 * So the rule here is stated once and enforced in one place:
 *
 *   AN EXCERPT IS DERIVED FROM `content` ONLY WHEN `is_public` IS EXACTLY TRUE.
 *
 * Not "truthy", not "unless is_paid" — exactly `true`. A field Patreon omits, a
 * field that arrives null because the token lacked a scope, or a shape change in
 * a future API version all land on "not public", which fails closed.
 *
 * `teaser_text` is the one exception, and only because Patreon's own product
 * defines it as the public teaser shown on the locked post's page — it is
 * already public by construction. It is requested optionally (see client.ts) and
 * used only when present.
 */

/** A post resource as it arrives. Everything optional: v2 omits unrequested fields. */
export type RawPatreonPost = {
  id?: unknown
  type?: unknown
  attributes?: {
    title?: unknown
    content?: unknown
    teaser_text?: unknown
    is_public?: unknown
    is_paid?: unknown
    published_at?: unknown
    url?: unknown
  }
}

const EXCERPT_MAX = 180

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * HTML to plain text.
 *
 * Patreon returns post bodies as an HTML fragment. This does NOT sanitise HTML
 * for rendering — it removes it, because nothing here is rendered as markup.
 * The output goes into a React text node, so React escapes it again on the way
 * out and there is no path from a post body to executable markup.
 *
 * `<script>`/`<style>` bodies are dropped whole rather than having their tags
 * stripped, which would otherwise leave their source text in the excerpt.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d{1,6});/g, (_, code: string) => {
      const point = Number(code)
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ' '
    })
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Truncates on a word boundary, with an ellipsis only when something was cut.
 *
 * The half-length floor is what stops a word boundary from being honoured at
 * any cost: a 180-character excerpt whose only space is at index 4 would
 * otherwise become four characters and an ellipsis, which says less than a
 * hard cut mid-word does.
 */
export function truncate(text: string, max = EXCERPT_MAX): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/**
 * Whether the URL is a Patreon post page.
 *
 * `url` comes from the API rather than from an editor, so this is belt and
 * braces — but a link built from third-party data should still be checked
 * before it is put in an `href`, and it costs one regex.
 */
function safePostUrl(value: unknown): string | null {
  const raw = asString(value).trim()
  if (!raw) return null
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (parsed.hostname !== 'patreon.com' && !parsed.hostname.endsWith('.patreon.com')) {
    return null
  }
  return parsed.toString()
}

/**
 * Reduces one raw post to the publishable shape, or null if it cannot be shown.
 *
 * A post with no title, no valid URL or no publish date is dropped rather than
 * rendered as a half-row — the feed is a list of things a visitor can click.
 */
export function toPublishablePost(raw: RawPatreonPost): PatreonPost | null {
  const id = asString(raw.id).trim()
  const attributes = raw.attributes ?? {}

  const title = asString(attributes.title).trim()
  const url = safePostUrl(attributes.url)
  const publishedAt = asString(attributes.published_at).trim()

  if (!id || !title || !url || !publishedAt) return null
  if (Number.isNaN(Date.parse(publishedAt))) return null

  // === The gate. Read the comment at the top of this file before changing it. ===
  const isPublic = attributes.is_public === true
  const isPaid = attributes.is_paid === true

  // `teaser_text` is Patreon's own public teaser for a locked post, so it is
  // usable either way. `content` is usable ONLY when the post is public.
  const teaser = htmlToText(asString(attributes.teaser_text))
  const body = isPublic ? htmlToText(asString(attributes.content)) : ''
  const excerpt = truncate(teaser || body)

  return { id, title, url, publishedAt, excerpt, isPublic, isPaid }
}

/** Newest first, capped. Ordering is a source concern, not the UI's. */
export function toFeed(raws: RawPatreonPost[], limit: number): PatreonPost[] {
  return raws
    .map(toPublishablePost)
    .filter((post): post is PatreonPost => post !== null)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, Math.max(0, limit))
}
