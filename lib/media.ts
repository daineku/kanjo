/**
 * Media helpers shared by the hero and the video section.
 *
 * Pure string work — no filesystem, no Node built-ins — so this is safe in a
 * client component and testable by calling a function.
 */

/** Extensions the site will emit a `<source type>` for. */
const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
}

/**
 * MIME type for a local video path, derived from its extension.
 *
 * Deriving it means a content entry lists paths and nothing else — no `type`
 * field to keep in step with the filename. An unknown extension returns
 * undefined rather than a guess: `<source>` without a `type` makes the browser
 * sniff the file, which is the correct fallback, whereas a WRONG `type` makes it
 * skip a source it could have played.
 */
export function mimeFor(path: string): string | undefined {
  const clean = path.split('?')[0]?.split('#')[0] ?? ''
  const extension = clean.slice(clean.lastIndexOf('.') + 1).toLowerCase()
  return VIDEO_MIME[extension]
}

/**
 * A bare YouTube video id, from a bare id or from any YouTube URL.
 *
 * WHY NORMALISE RATHER THAN DEMAND AN ID. The homepage's video is set in the
 * admin, and what a person has on their clipboard is a watch URL with a
 * playlist, a start time and a `si=` share token on it. Demanding a bare id
 * means the field is wrong half the time; accepting the URL and throwing
 * everything except the id away means the embed the site builds carries nothing
 * but the id — no playlist to auto-continue into someone else's channel, no
 * tracking parameter, nothing a paste can smuggle through.
 *
 * Returns null for anything that is not recognisably a YouTube video, so the
 * section renders a clear "not configured" state rather than a broken iframe.
 */
const YOUTUBE_ID = /^[\w-]{11}$/
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
  'www.youtu.be',
])

export function youTubeId(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null
  if (YOUTUBE_ID.test(raw)) return raw

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!YOUTUBE_HOSTS.has(url.hostname)) return null

  // youtu.be/<id>, /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
  const segments = url.pathname.split('/').filter(Boolean)
  const last = segments[segments.length - 1]
  if (url.hostname.endsWith('youtu.be') && last && YOUTUBE_ID.test(last)) return last
  if (segments.length >= 2 && last && YOUTUBE_ID.test(last)) {
    const kind = segments[segments.length - 2]
    if (kind === 'embed' || kind === 'shorts' || kind === 'live' || kind === 'v') return last
  }

  const param = url.searchParams.get('v')
  return param && YOUTUBE_ID.test(param) ? param : null
}

/**
 * YouTube's own still for a video.
 *
 * Used only when no poster is configured. It is fetched through `next/image`,
 * which means THE SERVER fetches it and the browser never contacts a Google
 * host — so the default state of the page still makes no third-party request,
 * which is the whole point of the click-to-load facade.
 *
 * `hqdefault` rather than `maxresdefault`: maxres does not exist for every
 * upload and 404s silently when it does not, leaving a blank facade.
 */
export function youTubeThumbnail(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
}

/** True for a root-relative path under /public, i.e. an asset this repo owns. */
export function isLocalAsset(src: string): boolean {
  return src.startsWith('/') && !src.startsWith('//')
}

/**
 * Every media path a piece of content references, for validation.
 *
 * Kept here rather than in the validator so the shapes it walks live beside the
 * types they belong to, and so a new media field is one edit away from being
 * checked.
 */
export type MediaReference = {
  /** Where the path came from, e.g. `content/media.json → osaka-night-01`. */
  where: string
  /** The field, e.g. `image.src` or `poster.src`. */
  field: string
  path: string
  /** False for a draft/unpublished entry: missing files are expected there. */
  required: boolean
}
