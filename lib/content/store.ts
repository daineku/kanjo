import 'server-only'

import { isLocalAdminEnabled } from '@/lib/admin/auth'

import type { ContentStore } from './store.contract'

/**
 * Choosing a content store.
 *
 * The CONTRACT — the interface, the error, the draft shape — lives in
 * `./store.contract`, which imports nothing and is safe to load anywhere. This
 * file is the part that reads the environment and picks a backend, which is
 * what `server-only` is for.
 *
 * Everything from the contract is re-exported here, so
 * `import { ContentStore } from '@/lib/content/store'` keeps working.
 *
 * ── WHY THE ADAPTER SEAM MATTERS MORE HERE THAN ANYWHERE ELSE ───────────────
 *
 * The brief's requirement is that everything important is editable from an
 * admin, and the warning attached to it is not to let a convenient local
 * persistence choice turn into a bad production architecture. Writing JSON
 * files on disk is exactly such a choice: perfect for a single developer on a
 * laptop, and wrong the moment the site is deployed, because a serverless
 * filesystem is read-only and ephemeral.
 *
 * So the local file writer is ONE IMPLEMENTATION BEHIND THE INTERFACE, gated to
 * development, and the admin UI is written against the interface. The Supabase
 * implementation is a second one; the forms, the validation and the routes did
 * not change. See docs/BACKEND_DECISION.md.
 */

export {
  ContentStoreError,
  type ContentDraft,
  type ContentStore,
  type MediaSaver,
} from './store.contract'

/**
 * Whether the FILE-BACKED development admin is available.
 *
 * Two conditions, both required: a development deployment, and an explicit
 * opt-in. This particular admin has no accounts at all, so it must be
 * impossible to enable by accident — and the production half is not
 * overridable, because `deploymentMode()` reads `VERCEL_ENV`, which Vercel sets
 * itself rather than accepting from a build setting.
 *
 * Production uses Supabase Auth instead. See lib/admin/auth.ts; the two paths
 * meet at `requireAdminWrite()`, which every mutation calls.
 */
export function isAdminEnabled(): boolean {
  return isLocalAdminEnabled()
}

let cached: ContentStore | null = null

/**
 * Selects the content store, following `CONTENT_SOURCE`.
 *
 * It deliberately tracks the SOURCE rather than having a variable of its own:
 * an admin writing to local files while the site reads from Supabase would be
 * an editor whose saves appear to succeed and change nothing. One setting, one
 * backend, both directions.
 *
 * Caching the STORE INSTANCE is safe in a way that caching a loaded document
 * was not: the stores below hold no content, only a client provider and a
 * writable flag, and every save re-reads. See lib/content/remote/source.ts for
 * the bug that distinction exists to prevent.
 */
export async function resolveContentStore(): Promise<ContentStore> {
  if (cached) return cached

  const requested = (process.env.CONTENT_SOURCE ?? 'local').trim().toLowerCase()

  if (requested === 'supabase' || requested === 'remote') {
    // Built by the wiring module, which is the one place that reaches for the
    // service-role credential and the media store. The store class itself takes
    // both as arguments so it stays constructible — and testable — without them.
    const { createRemoteContentStore } = await import('./remote')
    cached = await createRemoteContentStore()
    return cached
  }

  const { LocalContentStore } = await import('./local/store')
  cached = new LocalContentStore()
  return cached
}
