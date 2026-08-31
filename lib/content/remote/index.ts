import { ContentConfigurationError, type ContentSource } from '../source'

/**
 * The seam a hosted backend plugs into.
 *
 * There is no implementation yet, and that is deliberate: the backend decision
 * for thekanjo.com is SEPARATE BACKEND (docs/BACKEND_DECISION.md), so a client
 * is written when a project exists to point it at — not now, against a schema
 * nobody has created.
 *
 * What this file guarantees today is that adding one costs nothing anywhere
 * else. Everything the site renders already comes through ContentSource, so an
 * implementation of this function is the whole of the integration:
 *
 *   1. create the client from the env vars checked below
 *   2. map rows to lib/content/types.ts — the mapping lives HERE, so no
 *      storage column name ever reaches a component
 *   3. filter unpublished rows and sort in the query, per the ContentSource
 *      contract
 *
 * The required-variable check runs before any request, so a half-configured
 * deployment fails at startup with a list of what is missing instead of
 * rendering a site with no content in it.
 */

const REQUIRED_ENV = [
  'CONTENT_API_URL',
  'CONTENT_API_KEY',
] as const

export async function createRemoteContentSource(): Promise<ContentSource> {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]?.trim())

  if (missing.length > 0) {
    throw new ContentConfigurationError(
      `CONTENT_SOURCE=remote requires ${missing.join(', ')}. ` +
        `Set them in .env.local, or unset CONTENT_SOURCE to use the local content in content/.`,
    )
  }

  throw new ContentConfigurationError(
    'CONTENT_SOURCE=remote is not implemented yet. The backend for thekanjo.com is ' +
      'intentionally separate from the Daineku one (docs/BACKEND_DECISION.md) and has not been ' +
      'provisioned. Implement createRemoteContentSource in lib/content/remote/index.ts, or run ' +
      'with the default local source.',
  )
}
