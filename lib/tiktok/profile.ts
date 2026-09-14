/**
 * TikTok profile identity.
 *
 * Pure string work, no network and no credentials — V1 needs none, because the
 * official Creator Profile Embed renders a selection of a public profile's
 * recent videos with no developer app, no Login Kit review and no
 * `video.list` authorisation.
 *
 * ── THIS FILE IS A SECURITY BOUNDARY ────────────────────────────────────────
 *
 * The TikTok embed is markup with a `data-unique-id` attribute in it, and that
 * attribute comes from ADMIN-EDITABLE CONTENT. So the handle is validated here,
 * against TikTok's own rule, and the embed markup is CONSTRUCTED from the
 * validated handle by our own component — it is never accepted as HTML from
 * the content layer, and it is never passed to `dangerouslySetInnerHTML`.
 *
 * The rule the rest of the codebase relies on: `tikTokHandle()` returns either
 * a string matching `^[A-Za-z0-9_.]{2,24}$` or null. Nothing else can reach the
 * embed.
 */

/**
 * TikTok usernames are 2–24 characters of letters, digits, underscore and
 * period. No hyphen, which is why this differs from the YouTube rule.
 */
const HANDLE = /^[A-Za-z0-9_.]{2,24}$/

const PROFILE_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com'])

/**
 * The handle for a profile, from a handle or any profile URL.
 *
 * Accepts `@the_kanjo`, `the_kanjo` and
 * `https://www.tiktok.com/@the_kanjo` with or without a trailing path or query.
 * Returns it WITHOUT the `@`.
 *
 * Returns null for a short link (`vm.tiktok.com/XXXX`) — that is a redirect to
 * an unknown destination, and resolving it would mean a network request whose
 * answer we would then have to trust.
 */
export function tikTokHandle(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null

  if (!raw.includes('/')) {
    const bare = raw.startsWith('@') ? raw.slice(1) : raw
    return HANDLE.test(bare) ? bare : null
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!PROFILE_HOSTS.has(url.hostname)) return null

  const first = url.pathname.split('/').filter(Boolean)[0]
  if (!first?.startsWith('@')) return null

  const handle = first.slice(1)
  return HANDLE.test(handle) ? handle : null
}

/** The canonical public URL for a handle. Never built from unvalidated input. */
export function tikTokProfileUrl(handle: string): string {
  return `https://www.tiktok.com/@${handle}`
}
