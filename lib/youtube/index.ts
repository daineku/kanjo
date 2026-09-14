import 'server-only'

import type { YouTubeFeed } from '@/lib/content/types'

import { readLatestVideo, readUploadsPlaylistId, youTubeHandle } from './channel'
import { fetchChannel, fetchUploads } from './client'
import { readYouTubeApiKey } from './config'

/**
 * The YouTube content source.
 *
 * One function, returning a value, never throwing — the same contract as
 * lib/patreon. Everything specific to the Data API is behind it, so the
 * homepage section knows about `YouTubeFeed` and nothing else.
 *
 * IT CANNOT THROW, AND THAT IS THE DESIGN. The landing page is statically
 * prerendered; an adapter that threw would turn a Google outage, an expired
 * key or a hit quota into a failed build and take the whole site down. Every
 * failure becomes a `status`, and the section renders its channel CTA.
 *
 * ── WHY THERE IS NO `videos.list` CALL ──────────────────────────────────────
 *
 * The brief allows verifying embeddability with `videos.list`. It is not done,
 * because it would be a third request on every refresh to guard against a case
 * the click-to-load facade already handles gracefully: the poster and the title
 * are ours, so a video that refuses to embed costs the visitor one click and
 * shows YouTube's own message inside a correctly-sized frame. `part=status` on
 * the playlist request already filters the common case — private and deleted
 * uploads — for no extra quota. Adding a request to pre-empt the rare case is
 * the "unnecessary requests" the brief rules out.
 */

export async function fetchLatestVideo(handleOrUrl: string): Promise<YouTubeFeed> {
  const handle = youTubeHandle(handleOrUrl)
  if (!handle) {
    // A configuration problem, not a runtime one: the section renders its CTA
    // and the server log says which value could not be read.
    return {
      status: 'unconfigured',
      detail: `"${handleOrUrl}" is not a YouTube handle or channel URL`,
    }
  }

  const apiKey = readYouTubeApiKey()
  if (!apiKey) {
    // The normal state of a fresh clone, and NOT an error. No request is made
    // and nothing is logged; the section shows WATCH ON YOUTUBE.
    return { status: 'unconfigured' }
  }

  try {
    const channel = await fetchChannel(handle, apiKey)
    const uploads = readUploadsPlaylistId(channel)
    if (!uploads) {
      throw new Error(`no uploads playlist for @${handle} — is the handle right?`)
    }

    const video = readLatestVideo(await fetchUploads(uploads, apiKey))
    if (!video) {
      // A real channel with nothing public on it yet. Not an error, and not
      // something to render an empty player for.
      return { status: 'empty' }
    }

    return { status: 'ok', video }
  } catch (cause) {
    const detail = (cause as Error).message
    // Server-side only. The message can name a quota or a key restriction;
    // neither belongs on a public page, and the key is never in it.
    console.warn(`[youtube] latest video unavailable — ${detail}`)
    return { status: 'error', detail }
  }
}

export { youTubeChannelUrl, youTubeHandle } from './channel'
