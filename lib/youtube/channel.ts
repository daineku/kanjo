/**
 * YouTube channel identity and API-response normalisation.
 *
 * Pure string and object work — no network, no environment, no `server-only`.
 * That is deliberate: this is the part with all the parsing decisions in it, so
 * it is the part that has to be testable by calling a function. The HTTP client
 * is lib/youtube/client.ts and has almost no logic at all.
 */

import type { ImageRef } from '@/lib/content/types'

/**
 * A YouTube handle, without the `@`.
 *
 * YouTube's own rule is 3–30 characters of letters, digits, underscore, hyphen
 * and period. Validating it matters because the handle is interpolated into an
 * API query string — and because a handle that is not a handle should produce a
 * clean "not configured" state rather than a 400 from Google.
 */
const HANDLE = /^[A-Za-z0-9_.-]{3,30}$/

const CHANNEL_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
])

/**
 * The handle for a channel, from a handle or any channel URL.
 *
 * Accepts `@thekanjo`, `thekanjo`, `https://www.youtube.com/@thekanjo`, and the
 * same with a trailing path (`/videos`, `/streams`) or a query string, because
 * that is what ends up on somebody's clipboard. Returns it WITHOUT the `@`, so
 * callers never have to think about whether theirs has one.
 *
 * Returns null for a `/channel/UC…` or `/c/Name` URL: those are a different
 * identifier, and silently treating the last path segment as a handle would
 * produce a confident lookup for the wrong channel.
 */
export function youTubeHandle(value: string): string | null {
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
  if (!CHANNEL_HOSTS.has(url.hostname)) return null

  const segments = url.pathname.split('/').filter(Boolean)
  const first = segments[0]
  if (!first?.startsWith('@')) return null

  const handle = first.slice(1)
  return HANDLE.test(handle) ? handle : null
}

/** The canonical public URL for a handle. Never built from unvalidated input. */
export function youTubeChannelUrl(handle: string): string {
  return `https://www.youtube.com/@${handle}`
}

// ── API response shapes ──────────────────────────────────────────────────────
//
// Everything optional. These describe what we READ, not what Google promises,
// and a response missing a field must produce a clean failure rather than a
// crash inside a server render.

export type RawChannelListResponse = {
  items?: {
    id?: unknown
    snippet?: { title?: unknown }
    contentDetails?: { relatedPlaylists?: { uploads?: unknown } }
  }[]
}

export type RawPlaylistItemsResponse = {
  items?: {
    snippet?: {
      title?: unknown
      description?: unknown
      publishedAt?: unknown
      resourceId?: { videoId?: unknown }
      thumbnails?: Record<string, { url?: unknown; width?: unknown; height?: unknown }>
    }
    contentDetails?: { videoId?: unknown; videoPublishedAt?: unknown }
    status?: { privacyStatus?: unknown }
  }[]
}

export type LatestVideo = {
  /** The bare 11-character id. */
  id: string
  title: string
  description: string
  /** ISO 8601. */
  publishedAt: string
  /** The best thumbnail YouTube offered, as a normal ImageRef. */
  poster?: ImageRef
}

const VIDEO_ID = /^[\w-]{11}$/

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** The uploads playlist for a channel, from a `channels.list` response. */
export function readUploadsPlaylistId(response: RawChannelListResponse): string | null {
  const uploads = asString(response.items?.[0]?.contentDetails?.relatedPlaylists?.uploads).trim()
  // Every uploads playlist id is the channel id with its `UC` prefix swapped
  // for `UU`. Checking the shape keeps a malformed response from becoming a
  // second request that is guaranteed to fail.
  return /^UU[\w-]{10,}$/.test(uploads) ? uploads : null
}

/**
 * Thumbnails, best first.
 *
 * YouTube returns a map whose keys are names rather than sizes, and which keys
 * are present depends on the upload — `maxres` exists only for videos uploaded
 * above 720p, and asking for it unconditionally is how a facade ends up with a
 * 404 for its poster. Preference order, falling through to whatever exists.
 */
const THUMBNAIL_ORDER = ['maxres', 'standard', 'high', 'medium', 'default'] as const

function readPoster(
  thumbnails: Record<string, { url?: unknown; width?: unknown; height?: unknown }> | undefined,
): ImageRef | undefined {
  if (!thumbnails) return undefined
  for (const key of THUMBNAIL_ORDER) {
    const candidate = thumbnails[key]
    const src = asString(candidate?.url).trim()
    const width = Number(candidate?.width)
    const height = Number(candidate?.height)
    if (!src || !Number.isFinite(width) || !Number.isFinite(height)) continue
    if (width <= 0 || height <= 0) continue
    // `alt` is empty on purpose: the video's title is rendered as text beside
    // the poster, so describing it again in the alt is duplication a screen
    // reader has to sit through.
    return { src, alt: '', width, height }
  }
  return undefined
}

/**
 * The newest upload from a `playlistItems.list` response.
 *
 * PRIVATE AND DELETED UPLOADS ARE SKIPPED rather than rendered. An uploads
 * playlist keeps entries whose video has since been made private, and those
 * come back with no usable snippet — embedding one shows the visitor a
 * "Video unavailable" player on the homepage. Asking for a couple of items and
 * taking the first usable one costs the same single request.
 */
export function readLatestVideo(response: RawPlaylistItemsResponse): LatestVideo | null {
  for (const item of response.items ?? []) {
    const id = asString(
      item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId,
    ).trim()
    if (!VIDEO_ID.test(id)) continue

    const privacy = asString(item.status?.privacyStatus).trim().toLowerCase()
    if (privacy && privacy !== 'public') continue

    const title = asString(item.snippet?.title).trim()
    // YouTube's placeholder titles for entries whose video is gone.
    if (!title || title === 'Private video' || title === 'Deleted video') continue

    const publishedAt = asString(
      item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt,
    ).trim()
    if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) continue

    return {
      id,
      title,
      description: asString(item.snippet?.description).trim(),
      publishedAt,
      poster: readPoster(item.snippet?.thumbnails),
    }
  }
  return null
}
