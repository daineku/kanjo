import 'server-only'

/**
 * Patreon credentials, read from the server environment and nowhere else.
 *
 * THE FIRST LINE OF THIS FILE IS THE POINT. `server-only` makes it a BUILD
 * ERROR for any client component to import anything in this module graph, so a
 * creator access token cannot reach the browser by accident — not through a
 * careless `import`, not through a prop, not through a bundle that happened to
 * tree-shake badly. The brief's "never expose creator access tokens in the
 * browser" is enforced by the compiler here rather than by a convention.
 *
 * NOTHING HERE IS PREFIXED `NEXT_PUBLIC_`. That prefix inlines a value into the
 * client bundle, which for a credential means publishing it.
 */

export type PatreonCredentials = {
  accessToken: string
  /** Optional. Discovered from the API when absent. */
  campaignId?: string
}

/**
 * The credentials, or null when Patreon is not configured.
 *
 * NULL IS A NORMAL STATE, not an error. A fresh clone has no token, and the
 * site must render completely without one — so this returns null and the
 * section falls back rather than throwing and taking a build down.
 */
export function readPatreonCredentials(): PatreonCredentials | null {
  const accessToken = process.env.PATREON_ACCESS_TOKEN?.trim()

  // Temporary production diagnostic: record presence only. The token value is
  // never printed, returned, serialised or exposed to the browser.
  if (process.env.VERCEL_ENV === 'production') {
    console.warn(`[env-check] PATREON_ACCESS_TOKEN=${accessToken ? 'present' : 'missing'}`)
  }

  if (!accessToken) return null

  const campaignId = process.env.PATREON_CAMPAIGN_ID?.trim()
  return { accessToken, campaignId: campaignId || undefined }
}

/**
 * How long a fetched feed is reused before Patreon is asked again.
 *
 * Devlog posts appear a few times a month; asking on every render would be a
 * request per visitor for content that changes weekly, and Patreon rate-limits.
 * One hour by default, overridable for a site that posts more often.
 */
export function readRevalidateSeconds(): number {
  const raw = Number(process.env.PATREON_REVALIDATE_SECONDS)
  if (!Number.isFinite(raw) || raw < 60) return 3600
  return Math.floor(raw)
}
