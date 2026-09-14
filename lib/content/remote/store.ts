import 'server-only'

import { serverSupabase } from '@/lib/supabase/server'

import {
  buildSiteContentDocument,
  parseSiteContentDocument,
  type SiteContentDocument,
} from '../document'
import { resolveMediaStore } from '@/lib/media/store'
import { ContentStoreError, type ContentDraft, type ContentStore } from '../store'
import type { LoaderConfig, Section, SiteSettings } from '../types'

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
 * ── THE CONCURRENCY STORY, STATED HONESTLY ──────────────────────────────────
 *
 * Two editors saving different panels within the same second can lose one of
 * the two changes: both read, both modify, the later write wins whole. This is
 * a single-owner site with one admin account, so that is an acceptable V1
 * trade — but it is a real limitation rather than an oversight, and the fix
 * when it is needed is an `updated_at` precondition on the write (the column
 * exists for it) turning the second save into a refusal rather than a silent
 * overwrite.
 *
 * ── VALIDATION HAPPENS ON THE WAY OUT, NOT ONLY ON THE WAY IN ───────────────
 *
 * The document is re-validated before it is written. The admin actions already
 * bound and check what they read from a form, but this store is also what a
 * seed script and any future migration would go through, and a row that fails
 * to parse takes the whole site down on the next render. Catching it here means
 * a failed save with a message naming the field, instead of a broken site.
 */

const TABLE = 'thekanjo_site'
const ROW_ID = 'main'

export class RemoteContentStore implements ContentStore {
  readonly kind = 'supabase'

  /**
   * Whether the DEPLOYMENT allows writes. Whether the PERSON does is a separate
   * question, answered in lib/admin/auth.ts — both must pass, and the actions
   * check both.
   */
  readonly writable: boolean
  readonly readOnlyReason?: string

  constructor(options: { writable: boolean; readOnlyReason?: string }) {
    this.writable = options.writable
    this.readOnlyReason = options.readOnlyReason
  }

  private assertWritable(): void {
    if (!this.writable) throw new ContentStoreError(this.readOnlyReason ?? 'Writes are disabled.')
  }

  private async read(): Promise<SiteContentDocument> {
    const supabase = serverSupabase()
    const { data, error } = await supabase
      .from(TABLE)
      .select('content')
      .eq('id', ROW_ID)
      .maybeSingle()

    if (error) {
      throw new ContentStoreError(`Could not read ${TABLE}: ${error.message}`)
    }
    if (!data) {
      throw new ContentStoreError(
        `${TABLE} has no row with id='${ROW_ID}'. Seed it before editing — see docs/PRODUCTION_SETUP.md.`,
      )
    }

    return parseSiteContentDocument((data as { content: unknown }).content, `${TABLE}.content`)
  }

  private async write(document: SiteContentDocument): Promise<void> {
    // Re-validated on the way out. See the header.
    const checked = parseSiteContentDocument(document, 'the document being saved')

    const supabase = serverSupabase()
    const { error } = await supabase
      .from(TABLE)
      .update({ content: checked, updated_at: new Date().toISOString() })
      .eq('id', ROW_ID)

    if (error) {
      throw new ContentStoreError(`Could not save to ${TABLE}: ${error.message}`)
    }
  }

  async loadDraft(): Promise<ContentDraft> {
    const document = await this.read()
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
    const document = await this.read()
    await this.write({ ...document, settings })
  }

  async saveLoaderConfig(loader: LoaderConfig): Promise<void> {
    this.assertWritable()
    const document = await this.read()
    await this.write({ ...document, loader })
  }

  async saveSections(sections: Section[]): Promise<void> {
    this.assertWritable()
    const document = await this.read()
    await this.write({ ...document, sections })
  }

  /**
   * Media goes to the media store, not into the database.
   *
   * The document holds a `src`, and where those bytes live is a separate
   * decision — R2 in production, `public/media/` locally. Delegating means the
   * admin's image field behaves the same either way, and it is why MediaStore
   * is its own interface rather than a method on this one.
   */
  async saveImage(file: {
    name: string
    bytes: Uint8Array
    folder: string
  }): Promise<{ src: string; width: number; height: number }> {
    this.assertWritable()
    const media = await resolveMediaStore()
    return media.save(file)
  }
}

/** Used by the seed path to build a document from local content files. */
export { buildSiteContentDocument }
