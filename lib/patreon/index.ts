import 'server-only'

import type { PatreonFeed } from '@/lib/content/types'

import { fetchCampaignPosts } from './client'
import { readPatreonCredentials } from './config'
import { toFeed } from './posts'

/**
 * The Patreon content source.
 *
 * This is the adapter the rest of the site sees: one function, returning a
 * value, never throwing. Everything specific to Patreon — the v2 endpoints, the
 * JSON:API shape, the field list, the public/locked gate — is behind it, so the
 * homepage section knows about `PatreonFeed` and nothing else. Swapping the
 * feed for an RSS reader or a webhook-fed table later is a change to this
 * directory and nowhere else.
 *
 * IT CANNOT THROW, AND THAT IS THE DESIGN. The landing page is statically
 * prerendered; a Patreon outage during a build would otherwise fail the build
 * and take the whole site down over a third party's bad afternoon. Every failure
 * becomes a `status`, and the section renders its configured fallback.
 */

/** How many posts to ask for. The section shows fewer; the gate may drop some. */
const FETCH_COUNT = 8

export async function fetchPatreonFeed(): Promise<PatreonFeed> {
  const credentials = readPatreonCredentials()

  if (!credentials) {
    // The normal state of a fresh clone, and NOT an error. No request is made,
    // nothing is logged, and the section shows its configured fallback.
    return { status: 'unconfigured', posts: [] }
  }

  try {
    const raw = await fetchCampaignPosts(credentials, FETCH_COUNT)
    return { status: 'ok', posts: toFeed(raw, FETCH_COUNT) }
  } catch (cause) {
    const detail = (cause as Error).message
    // Server-side only. The message can name an endpoint or a scope; neither
    // belongs on a public page, and the token is never in it.
    console.warn(`[patreon] feed unavailable — ${detail}`)
    return { status: 'error', posts: [], detail }
  }
}

export type { PatreonFeed }
