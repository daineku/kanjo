import 'server-only'

import { isLocalAdminEnabled } from '@/lib/admin/auth'
import { adminWriteBlockedReason, adminWritesAllowed } from '@/lib/runtime/mode'

import type { LoaderConfig, Section, SiteSettings } from './types'

/**
 * The WRITE side of the content abstraction.
 *
 * `ContentSource` reads; this writes. They are separate interfaces on purpose:
 * every page in the site needs the reader, and exactly one route needs the
 * writer, so putting `saveSiteSettings` on `ContentSource` would put a mutation
 * method on an object that the entire rendering path holds a reference to.
 *
 * ── WHY THE ADAPTER SEAM MATTERS MORE HERE THAN ANYWHERE ELSE ───────────────
 *
 * The brief's requirement is that everything important is editable from an
 * admin, and the warning attached to it is not to let a convenient local
 * persistence choice turn into a bad production architecture. Writing JSON files
 * on disk is exactly such a choice: it is perfect for a single developer on a
 * laptop and wrong the moment the site is deployed, because a serverless
 * filesystem is read-only and ephemeral, and two editors would overwrite each
 * other with no record.
 *
 * So the local file writer is ONE IMPLEMENTATION BEHIND THIS INTERFACE, gated to
 * development, and the admin UI is written against the interface. Moving to a
 * hosted backend is a second implementation of these five methods — the forms,
 * the validation and the routes do not change. See docs/BACKEND_DECISION.md.
 *
 * ── THE SHAPE OF A SAVE ─────────────────────────────────────────────────────
 *
 * Whole documents, not patches. The admin edits one logical document at a time
 * (the settings, the loader, the section list) and writes it back entire, which
 * means there is no merge semantics to get wrong and no partial-update path that
 * could half-apply. The documents are small; this is not a CMS.
 */
export type ContentDraft = {
  settings: SiteSettings
  loader: LoaderConfig
  /** Every section, published or not, in the order the file lists them. */
  sections: Section[]
}

export interface ContentStore {
  /** A label for diagnostics, e.g. 'local-files'. */
  readonly kind: string

  /**
   * Whether writes are possible right now. False on a read-only filesystem, in
   * production, or with the admin switched off — the UI renders read-only
   * rather than offering a save button that will fail.
   */
  readonly writable: boolean
  /** Why it is not writable. Shown in the admin; never on a public page. */
  readonly readOnlyReason?: string

  /**
   * The content as an EDITOR sees it: nothing filtered, nothing sorted.
   *
   * `ContentSource` deliberately drops unpublished entries and sorts what
   * remains, because that is what a page wants. An admin wants the opposite —
   * the unpublished sections are precisely the ones that need editing, and an
   * editor reordering a list needs to see the order they set rather than the
   * order it resolved to. Two different questions, two different methods.
   */
  loadDraft(): Promise<ContentDraft>

  saveSiteSettings(settings: SiteSettings): Promise<void>
  saveLoaderConfig(loader: LoaderConfig): Promise<void>
  saveSections(sections: Section[]): Promise<void>

  /**
   * Stores an uploaded image and returns the reference the content should carry.
   *
   * Intrinsic dimensions are the store's job because they are a property of the
   * bytes, not of the form — and because every ImageRef in this codebase
   * requires them. They are what stops the page shifting as images decode.
   */
  saveImage(file: {
    name: string
    bytes: Uint8Array
    /** A subdirectory under the media root, e.g. 'loader' or 'hero'. */
    folder: string
  }): Promise<{ src: string; width: number; height: number }>
}

export class ContentStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContentStoreError'
  }
}

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
 */
export async function resolveContentStore(): Promise<ContentStore> {
  if (cached) return cached

  const requested = (process.env.CONTENT_SOURCE ?? 'local').trim().toLowerCase()

  if (requested === 'supabase' || requested === 'remote') {
    const { RemoteContentStore } = await import('./remote/store')
    cached = new RemoteContentStore({
      writable: adminWritesAllowed(),
      readOnlyReason: adminWriteBlockedReason(),
    })
    return cached
  }

  const { LocalContentStore } = await import('./local/store')
  cached = new LocalContentStore()
  return cached
}
