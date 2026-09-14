import 'server-only'

import { fetchPatreonFeed } from '@/lib/patreon'
import { fetchLatestVideo } from '@/lib/youtube'

import type { PatreonFeed, Section, YouTubeFeed } from './types'

/**
 * The external feeds the landing page needs, resolved once, on the server.
 *
 * Shared by every ContentSource rather than written into each, because WHICH
 * external services the homepage talks to is a property of the site, not of
 * where its text is stored. A Supabase-backed deployment and a local clone
 * fetch the same feeds in the same way; only the JSON around them differs.
 *
 * ── NO EXTERNAL PROVIDER MAY BREAK THE PAGE ─────────────────────────────────
 *
 * `getLandingContent` is awaited by a statically prerendered route. A rejected
 * promise here would fail the build — turning somebody else's outage into our
 * outage — so this function cannot reject.
 *
 * Two layers make that true:
 *
 *   1. Both adapters already return a `status` instead of throwing. That is
 *      their contract and it is tested.
 *   2. `settle()` below holds them to it anyway. An adapter that grows a bug —
 *      a throw before its own try block, an import that fails at runtime —
 *      degrades to the same fallback the visitor would have seen if the
 *      provider were simply down. The brief's rule, enforced rather than
 *      assumed: one rejected external promise must not fail the bundle.
 */

async function settle<T>(work: Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await work
  } catch (cause) {
    // Reaching here means an adapter broke its own contract. Worth a loud line
    // in the server log, and worth nothing at all on the page.
    console.error(`[content] ${label} adapter threw — falling back. ${(cause as Error).message}`)
    return fallback
  }
}

/**
 * The YouTube channel to resolve, taken from the configured section.
 *
 * Read from content rather than from the environment because the channel is an
 * editorial decision — the API KEY is the credential, and that stays in the
 * environment. An unpublished or absent section means no request is made at
 * all.
 */
function youTubeChannelFrom(sections: Section[]): string | null {
  for (const section of sections) {
    if (section.type !== 'youtube') continue
    if (!section.published) continue
    // 'pinned' mode names its own video, so there is nothing to look up and no
    // reason to spend a quota unit or wait on Google.
    if (section.config.mode !== 'latest') return null
    const channel = section.config.channelUrl.trim()
    return channel === '' ? null : channel
  }
  return null
}

export async function resolveExternalFeeds(
  sections: Section[],
): Promise<{ patreon: PatreonFeed; youtube: YouTubeFeed }> {
  const channel = youTubeChannelFrom(sections)

  const [patreon, youtube] = await Promise.all([
    settle(fetchPatreonFeed(), { status: 'error', posts: [] } as PatreonFeed, 'patreon'),
    channel
      ? settle(fetchLatestVideo(channel), { status: 'error' } as YouTubeFeed, 'youtube')
      : Promise.resolve<YouTubeFeed>({ status: 'unconfigured' }),
  ])

  return { patreon, youtube }
}
