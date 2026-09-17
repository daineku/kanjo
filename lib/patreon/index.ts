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

function postShape(raw: Awaited<ReturnType<typeof fetchCampaignPosts>>[number]) {
  const attributes = raw.attributes ?? {}
  const rawUrl = typeof attributes.url === 'string' ? attributes.url : ''
  let host = ''
  if (rawUrl) {
    try {
      host = new URL(rawUrl).hostname
    } catch {
      host = rawUrl.startsWith('/') ? 'relative-url' : 'invalid-url'
    }
  }

  const published = typeof attributes.published_at === 'string' ? attributes.published_at : ''

  return {
    id: typeof raw.id === 'string' && raw.id.length > 0,
    title: typeof attributes.title === 'string' && attributes.title.trim().length > 0,
    url: Boolean(rawUrl),
    host,
    published: Boolean(published),
    dateValid: Boolean(published) && !Number.isNaN(Date.parse(published)),
  }
}

export async function fetchPatreonFeed(): Promise<PatreonFeed> {
  const credentials = readPatreonCredentials()

  if (!credentials) {
    // The normal state of a fresh clone, and NOT an error. No request is made,
    // nothing is logged, and the section shows its configured fallback.
    return { status: 'unconfigured', posts: [] }
  }

  try {
    const raw = await fetchCampaignPosts(credentials, FETCH_COUNT)
    const posts = toFeed(raw, FETCH_COUNT)

    // Temporary production diagnostic. Only structural booleans and URL host
    // names are logged: never titles, post text, ids, full URLs or credentials.
    if (process.env.VERCEL_ENV === 'production') {
      console.warn(`[env-check] Patreon feed — raw=${raw.length}, publishable=${posts.length}`)
      console.warn(`[env-check] Patreon shapes — ${JSON.stringify(raw.map(postShape))}`)
    }

    return { status: 'ok', posts }
  } catch (cause) {
    const detail = (cause as Error).message
    // Server-side only. The message can name an endpoint or a scope; neither
    // belongs on a public page, and the token is never in it.
    console.warn(`[patreon] feed unavailable — ${detail}`)
    return { status: 'error', posts: [], detail }
  }
}

export type { PatreonFeed }
