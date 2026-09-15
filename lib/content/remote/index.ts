import 'server-only'

import { resolveMediaStore } from '@/lib/media/store'
import { serverSupabase } from '@/lib/supabase/server'
import { adminWriteBlockedReason, adminWritesAllowed } from '@/lib/runtime/mode'

import { ContentConfigurationError, type ContentSource } from '../source'
import type { ContentStore } from '../store'
import type { SupabaseLike } from './client'
import { RemoteContentSource } from './source'
import { RemoteContentStore } from './store'

/**
 * Where the Supabase adapters are wired to real credentials.
 *
 * ── THIS IS THE ONLY `server-only` FILE IN THE DIRECTORY, ON PURPOSE ────────
 *
 * `RemoteContentSource` and `RemoteContentStore` take a client PROVIDER rather
 * than importing one, so they contain no credential access and can be
 * constructed anywhere — including by `node` in a test, against an in-memory
 * double. That is what lets lib/content/remote/cache.test.ts exercise the real
 * production classes rather than a re-implementation of their logic.
 *
 * `server-only` therefore belongs here, around the factory that reaches for the
 * service-role key, and in lib/supabase/server.ts. It does not belong around
 * read-modify-write logic that happens to run on a server.
 */

const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY'] as const

function assertConfigured(setting: string): void {
  const missing = REQUIRED.filter((name) => !process.env[name]?.trim())
  if (missing.length > 0) {
    throw new ContentConfigurationError(
      `${setting} requires ${missing.join(' and ')}. ` +
        `Set them in .env.local, or unset CONTENT_SOURCE to use the local content in content/. ` +
        `See docs/PRODUCTION_SETUP.md.`,
    )
  }
}

/**
 * The provider handed to the adapters.
 *
 * Lazy: `serverSupabase()` memoises its own client, so this resolves to one
 * instance per process — which is also what makes the request-scoped cache in
 * source.ts key correctly, since React's `cache` keys on the argument.
 */
const provider = (): SupabaseLike => serverSupabase() as unknown as SupabaseLike

/**
 * Builds the source, failing at startup rather than at render time.
 *
 * A half-configured deployment gets a message naming what is missing, instead
 * of a site that renders with no content in it.
 */
export async function createRemoteContentSource(): Promise<ContentSource> {
  assertConfigured('CONTENT_SOURCE=supabase')
  return new RemoteContentSource(provider)
}

export async function createRemoteContentStore(): Promise<ContentStore> {
  assertConfigured('CONTENT_SOURCE=supabase')
  return new RemoteContentStore(provider, await resolveMediaStore(), {
    writable: adminWritesAllowed(),
    readOnlyReason: adminWriteBlockedReason(),
  })
}

export { RemoteContentSource } from './source'
export { RemoteContentStore } from './store'
