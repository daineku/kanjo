import 'server-only'

import { readYouTubeRevalidateSeconds } from './config'
import type { RawChannelListResponse, RawPlaylistItemsResponse } from './channel'

/**
 * The YouTube Data API v3 client.
 *
 * ── THE ALGORITHM, AND WHY IT IS THIS ONE ───────────────────────────────────
 *
 *   1. `channels.list?forHandle=@thekanjo&part=contentDetails,snippet`
 *   2. read `contentDetails.relatedPlaylists.uploads`
 *   3. `playlistItems.list?playlistId=<uploads>&part=snippet,contentDetails,status`
 *   4. take the newest usable item
 *
 * NOT `search.list`. It is the obvious-looking way to ask "what did this
 * channel upload most recently" and it is the wrong one on three counts: it
 * costs 100 quota units against playlistItems' 1, its ordering is the search
 * index's rather than the channel's so it can return a video that is not
 * actually the newest, and it is eventually consistent — a fresh upload can be
 * missing from it for hours. The uploads playlist is the channel's own ordered
 * list and it is authoritative.
 *
 * TOTAL COST: 2 quota units per refresh (1 + 1), once per revalidation window.
 *
 * ── WHY `status` IS REQUESTED ───────────────────────────────────────────────
 *
 * An uploads playlist keeps entries whose video has since gone private, and
 * they come back with a placeholder snippet. Embedding one puts "Video
 * unavailable" on the homepage. `part=status` costs no extra quota unit and
 * lets `readLatestVideo` skip them — which is also why a handful of items is
 * requested rather than exactly one.
 */

const API = 'https://www.googleapis.com/youtube/v3'

/** Enough to skip a run of private or deleted entries without a second call. */
const ITEMS_TO_SCAN = 5

export class YouTubeApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'YouTubeApiError'
    this.status = status
  }
}

async function getJson<T>(url: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      // Next's data cache. The answer is identical for every visitor and
      // changes when a video is published, so this is one upstream request per
      // revalidation window rather than one per render. `tags` lets a webhook
      // or an admin action invalidate it early without a redeploy.
      next: { revalidate: readYouTubeRevalidateSeconds(), tags: ['youtube'] },
    })
  } catch (cause) {
    throw new YouTubeApiError(`request failed: ${(cause as Error).message}`, 0)
  }

  if (!response.ok) {
    // Google's error body carries a useful `error.message` — a disabled API, a
    // referrer-restricted key, an exhausted quota. It goes to the server log,
    // never to a page.
    let detail = ''
    try {
      const body = (await response.json()) as { error?: { message?: unknown } }
      detail = typeof body.error?.message === 'string' ? body.error.message : ''
    } catch {
      /* a non-JSON error body tells us nothing; the status is the signal */
    }
    throw new YouTubeApiError(
      `HTTP ${response.status}${detail ? ` — ${detail}` : ''}`,
      response.status,
    )
  }

  return (await response.json()) as T
}

/**
 * The channel's uploads playlist, by handle.
 *
 * The key is a query parameter because that is the only thing the Data API
 * accepts for an API-key credential — it is never logged by this module, and
 * the error path above deliberately reports Google's message rather than the
 * request URL.
 */
export async function fetchChannel(
  handle: string,
  apiKey: string,
): Promise<RawChannelListResponse> {
  const params = new URLSearchParams({
    part: 'contentDetails,snippet',
    forHandle: `@${handle}`,
    key: apiKey,
  })
  return getJson<RawChannelListResponse>(`${API}/channels?${params.toString()}`)
}

export async function fetchUploads(
  playlistId: string,
  apiKey: string,
): Promise<RawPlaylistItemsResponse> {
  const params = new URLSearchParams({
    part: 'snippet,contentDetails,status',
    playlistId,
    maxResults: String(ITEMS_TO_SCAN),
    key: apiKey,
  })
  return getJson<RawPlaylistItemsResponse>(`${API}/playlistItems?${params.toString()}`)
}
