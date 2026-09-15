import type { LoaderConfig, Section, SiteSettings } from './types'

/**
 * The WRITE side of the content abstraction, as a pure contract.
 *
 * ── WHY THIS IS SEPARATE FROM store.ts ──────────────────────────────────────
 *
 * `lib/content/store.ts` imports `server-only`, because it reads the
 * environment and picks a backend. This file is the part of it that is just a
 * shape: an interface, an error class, and two type aliases. Nothing here
 * touches a credential, a cookie or a filesystem.
 *
 * Keeping them apart is what lets `RemoteContentStore` — and the tests that
 * exercise it — be loaded outside a React Server Component. `server-only`
 * belongs around credential access, not around a TypeScript interface, and
 * wrapping the two together is what previously forced the infrastructure tests
 * to re-implement production logic instead of importing it.
 *
 * `store.ts` re-exports everything here, so existing importers are unaffected.
 *
 * ── THE SHAPE OF A SAVE ─────────────────────────────────────────────────────
 *
 * Whole documents, not patches. The admin edits one logical document at a time
 * (the settings, the loader, the section list) and writes it back entire, which
 * means there is no merge semantics to get wrong and no partial-update path
 * that could half-apply. The documents are small; this is not a CMS.
 */

export type ContentDraft = {
  settings: SiteSettings
  loader: LoaderConfig
  /** Every section, published or not, in the order the file lists them. */
  sections: Section[]
}

/**
 * The one thing a content store needs from a media store.
 *
 * Declared structurally rather than importing `MediaStore` from
 * lib/media/store.ts — that module loads `server-only`. The concrete media
 * store satisfies this; it simply is not imported across the boundary.
 */
export type MediaSaver = {
  save(file: {
    name: string
    bytes: Uint8Array
    folder: string
  }): Promise<{ src: string; width: number; height: number }>
}

export interface ContentStore {
  /** A label for diagnostics, e.g. 'local-files'. */
  readonly kind: string

  /**
   * Whether writes are possible right now. False on a read-only filesystem, on
   * a preview deployment, or with the admin switched off — the UI renders
   * read-only rather than offering a save button that will fail.
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
   * Stores an uploaded image and returns the reference the content should
   * carry.
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
  // Written out rather than as a parameter property: this module is reachable
  // from `node` tests, and Node's type stripping rejects those.
  constructor(message: string) {
    super(message)
    this.name = 'ContentStoreError'
  }
}
