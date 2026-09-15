// Explicit `.ts` extensions, and `store.contract` rather than `store`: this
// module is executed directly by `node` from cache.test.ts, and `../store`
// imports `server-only`, which throws outside a React Server Component.
import { parseSiteContentDocument, type SiteContentDocument } from '../document.ts'
import {
  ContentStoreError,
  type ContentDraft,
  type ContentStore,
  type MediaSaver,
} from '../store.contract.ts'
import type { LoaderConfig, Section, SiteSettings } from '../types.ts'
import { CONTENT_ROW_ID, CONTENT_TABLE, type SupabaseProvider } from './client.ts'

/**
 * The Supabase-backed content store: the admin's write path in production.
 *
 * ── READ-MODIFY-WRITE ON ONE ROW ────────────────────────────────────────────
 *
 * Every save reads the current document, replaces the part it owns, and writes
 * the whole thing back. That is the same shape as the local store — whole
 * documents, no patches, no merge semantics to get wrong — and it is what lets
 * the admin's forms and actions be written once against `ContentStore` rather
 * than twice.
 *
 * ── LOST-UPDATE PROTECTION ──────────────────────────────────────────────────
 *
 * Read-modify-write has a race, and it is not theoretical: open the admin in
 * two tabs, save the loader in one and the channels in the other, and the
 * second write carries the first tab's stale copy of everything it did not
 * touch. The first save is silently undone.
 *
 * So every write is CONDITIONAL on the row not having changed since it was
 * read:
 *
 *   update ... where id = 'main' and updated_at = <value read a moment ago>
 *
 * Postgres reports how many rows matched. Zero means somebody else wrote in
 * between, and the save is REFUSED with a message telling the editor to
 * reload — rather than applied over the top of their colleague's work.
 *
 * The window is deliberately as small as it can be: the `updated_at` compared
 * against is the one read at the START OF THIS SAVE, not the one the browser
 * rendered its form from. That is the honest scope of what this protects. It
 * does not stop two editors who loaded the same form ten minutes apart from
 * overwriting each other's *fields* — preventing that needs per-field
 * versioning, which for a single-owner site is not worth the complexity. It
 * does stop the much likelier failure: two saves interleaving and one vanishing
 * whole.
 *
 * ── VALIDATION HAPPENS ON THE WAY OUT, NOT ONLY ON THE WAY IN ───────────────
 *
 * The document is re-validated before it is written. The admin actions already
 * bound and check what they read from a form, but this store is also what a
 * seed script and any future migration would go through, and a row that fails
 * to parse takes the whole site down on the next render. Catching it here means
 * a failed save with a message naming the field, instead of a broken site.
 */

/** A document plus the row version it was read at. */
type VersionedDocument = {
  document: SiteContentDocument
  /** `updated_at` as the database reported it. The write's precondition. */
  version: string | null
}

export class RemoteContentStore implements ContentStore {
  readonly kind = 'supabase'

  /**
   * Whether the DEPLOYMENT allows writes. Whether the PERSON does is a separate
   * question, answered in lib/admin/auth.ts — both must pass, and the actions
   * check both.
   */
  readonly writable: boolean
  readonly readOnlyReason?: string

  private readonly getClient: SupabaseProvider
  private readonly media: MediaSaver

  // Written out rather than as parameter properties: this module is executed
  // directly by `node` in cache.test.ts, and Node's type stripping rejects
  // them. Same reason as lib/content/local/parse.ts.
  constructor(
    getClient: SupabaseProvider,
    media: MediaSaver,
    options: { writable: boolean; readOnlyReason?: string },
  ) {
    this.getClient = getClient
    this.media = media
    this.writable = options.writable
    this.readOnlyReason = options.readOnlyReason
  }

  private assertWritable(): void {
    if (!this.writable) throw new ContentStoreError(this.readOnlyReason ?? 'Writes are disabled.')
  }

  private async read(): Promise<VersionedDocument> {
    const { data, error } = await this.getClient()
      .from(CONTENT_TABLE)
      .select('content, updated_at')
      .eq('id', CONTENT_ROW_ID)
      .maybeSingle()

    if (error) {
      throw new ContentStoreError(`Could not read ${CONTENT_TABLE}: ${error.message}`)
    }
    if (!data) {
      throw new ContentStoreError(
        `${CONTENT_TABLE} has no row with id='${CONTENT_ROW_ID}'. Seed it once during ` +
          `provisioning before editing — see docs/PRODUCTION_SETUP.md.`,
      )
    }

    const row = data as { content: unknown; updated_at?: unknown }
    return {
      document: parseSiteContentDocument(row.content, `${CONTENT_TABLE}.content`),
      version: typeof row.updated_at === 'string' ? row.updated_at : null,
    }
  }

  private async write(next: SiteContentDocument, version: string | null): Promise<void> {
    // Re-validated on the way out. See the header.
    const checked = parseSiteContentDocument(next, 'the document being saved')

    let query = this.getClient()
      .from(CONTENT_TABLE)
      .update({ content: checked, updated_at: new Date().toISOString() })
      .eq('id', CONTENT_ROW_ID)

    // THE PRECONDITION. Skipped only when the row carried no `updated_at` at
    // all, which the migration makes impossible — but guessing a value would be
    // worse than writing unconditionally and saying so.
    if (version !== null) {
      query = query.eq('updated_at', version)
    }

    // `.select()` is what makes the update RETURN the rows it changed, and it
    // is load-bearing rather than decorative: without it supabase-js resolves
    // `data: null` even on success, so a precondition that matched nothing
    // would be indistinguishable from one that matched — and the guard below
    // would reject every save.
    const { data, error } = await query.select('id')

    if (error) {
      throw new ContentStoreError(`Could not save to ${CONTENT_TABLE}: ${error.message}`)
    }

    const changed = Array.isArray(data) ? data.length : 0
    if (version !== null && changed === 0) {
      throw new ContentStoreError(
        'Somebody else saved while this page was open, so nothing was written — ' +
          'applying this would have silently undone their change. Reload the admin and redo your edit.',
      )
    }
  }

  async loadDraft(): Promise<ContentDraft> {
    const { document } = await this.read()
    // UNFILTERED and UNSORTED, which is the whole difference between this and
    // the source: the unpublished sections are precisely the ones that need
    // editing, and an editor reordering a list must see the order they set.
    return {
      settings: document.settings,
      loader: document.loader,
      sections: document.sections,
    }
  }

  async saveSiteSettings(settings: SiteSettings): Promise<void> {
    this.assertWritable()
    const { document, version } = await this.read()
    await this.write({ ...document, settings }, version)
  }

  async saveLoaderConfig(loader: LoaderConfig): Promise<void> {
    this.assertWritable()
    const { document, version } = await this.read()
    await this.write({ ...document, loader }, version)
  }

  async saveSections(sections: Section[]): Promise<void> {
    this.assertWritable()
    const { document, version } = await this.read()
    await this.write({ ...document, sections }, version)
  }

  /**
   * Media goes to the media store, not into the database.
   *
   * The document holds a `src`, and where those bytes live is a separate
   * decision — R2 in production, `public/media/` locally. Injected rather than
   * imported so this class stays constructible without `server-only`, which is
   * what lets the concurrency and cache tests exercise it directly.
   */
  async saveImage(file: {
    name: string
    bytes: Uint8Array
    folder: string
  }): Promise<{ src: string; width: number; height: number }> {
    this.assertWritable()
    return this.media.save(file)
  }
}
