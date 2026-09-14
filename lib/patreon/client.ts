import 'server-only'

import { readRevalidateSeconds, type PatreonCredentials } from './config'
import type { RawPatreonPost } from './posts'

/**
 * A minimal Patreon API v2 client.
 *
 * API V1 IS DEPRECATED AND IS NOT IMPLEMENTED HERE. Every path below is under
 * `/api/oauth2/v2/`, which is the current documented surface; the scope this
 * needs is `campaigns.posts`, and the endpoint is
 * `GET /api/oauth2/v2/campaigns/{campaign_id}/posts`.
 *
 * NO SDK. The whole integration is two GETs against a JSON:API document, and a
 * dependency for that would be more code to audit than the code it replaces —
 * on the one path in this project that handles a credential.
 *
 * TWO THINGS ABOUT V2 THAT SHAPE THIS FILE:
 *
 *  1. V2 RETURNS NOTHING YOU DID NOT ASK FOR. A resource comes back as `type`
 *     and `id` alone unless its fields are named in `fields[<type>]`. So the
 *     field list is not an optimisation, it is the request.
 *
 *  2. NAMING A FIELD V2 DOES NOT KNOW IS A 400, NOT A SHRUG. That makes an
 *     optimistic field list a single point of failure the day Patreon renames
 *     something. So the request is made twice at most: once with the optional
 *     fields, and — only if that is rejected — once with the conservative set
 *     that Patreon's own WordPress plugin has shipped for years. A renamed
 *     optional field degrades the excerpt; it does not empty the section.
 */

const API = 'https://www.patreon.com/api/oauth2/v2'

/**
 * The fields the site can use.
 *
 * `title`, `url`, `published_at`, `is_public` and `is_paid` are load-bearing:
 * without `is_public` there is no gate, and a feed with no gate is not
 * renderable at all (see fetchCampaignPosts, which fails rather than guesses).
 */
const CORE_POST_FIELDS = [
  'title',
  'content',
  'is_paid',
  'is_public',
  'published_at',
  'url',
] as const

/** Requested when Patreon accepts it; the excerpt is better with it, fine without. */
const OPTIONAL_POST_FIELDS = ['teaser_text'] as const

export class PatreonApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'PatreonApiError'
    this.status = status
  }
}

type JsonApiDocument = {
  data?: unknown
  errors?: { detail?: unknown; title?: unknown }[]
}

async function getJson(url: string, token: string): Promise<JsonApiDocument> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        // Patreon's JSON:API surface. Stated explicitly so a proxy cannot
        // negotiate the response into something else.
        Accept: 'application/json',
      },
      // Next's data cache. The feed is shared by every visitor and changes a few
      // times a month, so this is one upstream request per revalidation window
      // rather than one per render.
      next: { revalidate: readRevalidateSeconds(), tags: ['patreon'] },
    })
  } catch (cause) {
    // A network failure is not an exceptional condition for a third party. It
    // becomes a feed status, and the section falls back.
    throw new PatreonApiError(`request failed: ${(cause as Error).message}`, 0)
  }

  if (!response.ok) {
    // The body may carry a useful `errors[].detail`, and it may also carry
    // nothing useful at all. Either way it goes to the server log, never to a
    // page — an API error message is not site copy.
    let detail = ''
    try {
      const body = (await response.json()) as JsonApiDocument
      const first = body.errors?.[0]
      detail = typeof first?.detail === 'string' ? first.detail : ''
    } catch {
      /* a non-JSON error body tells us nothing; the status is the signal */
    }
    throw new PatreonApiError(
      `HTTP ${response.status}${detail ? ` — ${detail}` : ''}`,
      response.status,
    )
  }

  return (await response.json()) as JsonApiDocument
}

/**
 * The campaign to read posts from.
 *
 * `PATREON_CAMPAIGN_ID` short-circuits this: a creator with one campaign never
 * needs it, but pinning the id saves a request per revalidation and removes any
 * ambiguity for a creator with two.
 */
export async function resolveCampaignId(
  credentials: PatreonCredentials,
): Promise<string> {
  if (credentials.campaignId) return credentials.campaignId

  const document = await getJson(`${API}/campaigns`, credentials.accessToken)
  const data = Array.isArray(document.data) ? document.data : []
  const first = data[0] as { id?: unknown } | undefined
  const id = typeof first?.id === 'string' ? first.id : ''

  if (!id) {
    throw new PatreonApiError(
      'the token authenticates a user with no campaigns — it must be a CREATOR token',
      0,
    )
  }
  return id
}

function postsUrl(campaignId: string, fields: readonly string[], count: number): string {
  const params = new URLSearchParams({
    'fields[post]': fields.join(','),
    // Patreon caps this; asking for a few more than the page shows leaves room
    // for posts the gate drops without a second round trip.
    'page[count]': String(Math.min(Math.max(count, 1), 20)),
    sort: '-published_at',
  })
  return `${API}/campaigns/${encodeURIComponent(campaignId)}/posts?${params.toString()}`
}

/**
 * The campaign's most recent posts, raw.
 *
 * Reducing them to what is publishable is deliberately NOT done here — that is
 * lib/patreon/posts.ts, which is the one place the public/locked gate lives.
 */
export async function fetchCampaignPosts(
  credentials: PatreonCredentials,
  count: number,
): Promise<RawPatreonPost[]> {
  const campaignId = await resolveCampaignId(credentials)
  const withOptional = [...CORE_POST_FIELDS, ...OPTIONAL_POST_FIELDS]

  let document: JsonApiDocument
  try {
    document = await getJson(postsUrl(campaignId, withOptional, count), credentials.accessToken)
  } catch (error) {
    // 400 is what v2 returns for a field it does not recognise. Anything else —
    // 401 for a bad token, 403 for a missing `campaigns.posts` scope, a network
    // failure — is a real problem and is not worth retrying.
    if (!(error instanceof PatreonApiError) || error.status !== 400) throw error
    document = await getJson(
      postsUrl(campaignId, CORE_POST_FIELDS, count),
      credentials.accessToken,
    )
  }

  const data = Array.isArray(document.data) ? document.data : []
  return data as RawPatreonPost[]
}
