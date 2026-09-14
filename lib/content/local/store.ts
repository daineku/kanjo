import 'server-only'

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  ContentStoreError,
  isAdminEnabled,
  type ContentDraft,
  type ContentStore,
} from '../store'
import type { LoaderConfig, Section, SiteSettings } from '../types'
import { readImageSize } from './imageSize'

/**
 * The development content store: it writes the files in `content/`.
 *
 * ── THIS IS A DEVELOPMENT TOOL, AND IT SAYS SO IN THREE PLACES ──────────────
 *
 * `isAdminEnabled()` gates the route, this constructor refuses to be writable
 * without it, and every write re-checks. Writing JSON to disk is the right
 * persistence for one person editing on a laptop and the wrong one for a
 * deployment: a serverless filesystem is read-only and ephemeral, and two
 * editors would silently overwrite each other. Keeping it behind ContentStore
 * is what stops that convenience becoming the architecture — see
 * lib/content/store.ts.
 *
 * ── PRESERVING THE COMMENTS ─────────────────────────────────────────────────
 *
 * The content files carry `_comment` and `_README` keys that explain how to use
 * them, and they are worth more than most of the values. The admin round-trips
 * them: it reads the file, replaces the fields it owns, and writes the result —
 * so saving the loader's minimum display time does not silently delete the
 * paragraph explaining what it does.
 *
 * ── WRITES ARE ATOMIC ───────────────────────────────────────────────────────
 *
 * Write to a temporary file in the same directory, then rename over the target.
 * A rename within a filesystem is atomic, so a crash or a Ctrl-C mid-save leaves
 * either the old file or the new one — never a half-written one. The dev server
 * watches these files and reloads on the rename; a partial file would take the
 * site down until someone noticed.
 */

const CONTENT_DIR = path.join(process.cwd(), 'content')
const MEDIA_DIR = path.join(process.cwd(), 'public', 'media')

/** Keys the admin never writes and never strips. */
const DOC_KEYS = /^_/

/** Formats the way the existing files are formatted, so diffs stay readable. */
function stringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function readRaw<T>(name: string): Promise<T> {
  const raw = await readFile(path.join(CONTENT_DIR, name), 'utf8')
  return JSON.parse(raw.replace(/^﻿/, '')) as T
}

async function writeAtomic(name: string, value: unknown): Promise<void> {
  const target = path.join(CONTENT_DIR, name)
  // Same directory, so the rename cannot cross a filesystem boundary and
  // silently degrade into a copy.
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, stringify(value), 'utf8')
  await rename(temporary, target)
}

/**
 * Merges saved fields into the document on disk, keeping every `_`-prefixed
 * key. Documentation in a content file is content.
 */
function mergePreservingDocs<T extends object>(existing: unknown, next: T): T {
  if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) {
    return next
  }
  const preserved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(existing)) {
    if (DOC_KEYS.test(key)) preserved[key] = value
  }
  return { ...preserved, ...next } as T
}

/** Filenames the store will accept for an upload. */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'])
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024

/**
 * A filename that cannot escape its folder or collide by accident.
 *
 * The name comes from a browser file picker, so it is attacker-influenced in
 * the same sense any form field is: it can contain `..`, a drive letter, a null
 * byte, or 300 characters of Unicode. Only the basename's own word characters
 * survive, and a short timestamp suffix makes re-uploading a second `car.svg`
 * a new file rather than a silent overwrite of the first.
 */
function safeFilename(original: string): string {
  const base = path.basename(original.replace(/\\/g, '/'))
  const extension = path.extname(base).toLowerCase()
  const stem = path
    .basename(base, path.extname(base))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  const stamp = Date.now().toString(36)
  return `${stem || 'image'}-${stamp}${extension}`
}

/** A folder name, restricted to the ones the site's media layout defines. */
const FOLDERS = new Set(['loader', 'hero', 'screenshots', 'video', 'articles', 'og', 'social'])

export class LocalContentStore implements ContentStore {
  readonly kind = 'local-files'

  get writable(): boolean {
    return isAdminEnabled()
  }

  get readOnlyReason(): string | undefined {
    if (this.writable) return undefined
    if (process.env.NODE_ENV === 'production') {
      return 'The file-backed admin is a development tool. A deployment needs a hosted content backend — see docs/BACKEND_DECISION.md.'
    }
    return 'Set ADMIN_ENABLED=true in .env.local to allow writes.'
  }

  private assertWritable(): void {
    if (!this.writable) throw new ContentStoreError(this.readOnlyReason ?? 'Writes are disabled.')
  }

  /**
   * Read for editing, straight off disk and unfiltered.
   *
   * No caching here, unlike `LocalContentSource` — the admin must show what is
   * on disk right now, including a change someone made in an editor while the
   * page was open.
   */
  async loadDraft(): Promise<ContentDraft> {
    const [settings, loader, sections] = await Promise.all([
      readRaw<SiteSettings>('site.json'),
      readRaw<LoaderConfig>('loader.json'),
      readRaw<Section[]>('sections.json'),
    ])
    return { settings, loader, sections: Array.isArray(sections) ? sections : [] }
  }

  async saveSiteSettings(settings: SiteSettings): Promise<void> {
    this.assertWritable()
    const existing = await readRaw<object>('site.json')
    await writeAtomic('site.json', mergePreservingDocs(existing, settings))
  }

  async saveLoaderConfig(loader: LoaderConfig): Promise<void> {
    this.assertWritable()
    const existing = await readRaw<object>('loader.json')
    await writeAtomic('loader.json', mergePreservingDocs(existing, loader))
  }

  async saveSections(sections: Section[]): Promise<void> {
    this.assertWritable()
    const existing = await readRaw<unknown[]>('sections.json')
    const byId = new Map(
      (Array.isArray(existing) ? existing : [])
        .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
        .map((entry) => [String(entry.id), entry]),
    )

    // Each section keeps its own documentation, including the `_README` inside
    // the hero's background — which is the longest and most useful block of
    // instructions in the whole content directory.
    const merged = sections.map((section) => {
      const previous = byId.get(section.id)
      const base = mergePreservingDocs(previous ?? {}, section)
      const previousConfig = (previous as { config?: unknown } | undefined)?.config
      return { ...base, config: mergePreservingDocs(previousConfig ?? {}, section.config) }
    })

    await writeAtomic('sections.json', merged)
  }

  async saveImage(file: {
    name: string
    bytes: Uint8Array
    folder: string
  }): Promise<{ src: string; width: number; height: number }> {
    this.assertWritable()

    if (!FOLDERS.has(file.folder)) {
      throw new ContentStoreError(
        `Unknown media folder "${file.folder}". Expected one of: ${[...FOLDERS].join(', ')}.`,
      )
    }
    if (file.bytes.byteLength === 0) {
      throw new ContentStoreError('The uploaded file is empty.')
    }
    if (file.bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw new ContentStoreError(
        `That file is ${(file.bytes.byteLength / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.`,
      )
    }

    const filename = safeFilename(file.name)
    if (!IMAGE_EXTENSIONS.has(path.extname(filename))) {
      throw new ContentStoreError(
        `"${file.name}" is not an image this site can use. Expected ${[...IMAGE_EXTENSIONS].join(', ')}.`,
      )
    }

    // THE DIMENSIONS ARE READ FROM THE BYTES, and a file whose header cannot be
    // parsed is REJECTED rather than stored with guessed ones. This doubles as
    // a content-type check: a .png whose bytes are not a PNG fails here.
    const size = readImageSize(file.bytes)
    if (!size) {
      throw new ContentStoreError(
        `Could not read the pixel dimensions of "${file.name}". Its contents do not look like a PNG, JPEG, GIF, WebP or SVG.`,
      )
    }

    const directory = path.join(MEDIA_DIR, file.folder)
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, filename), file.bytes)

    return { src: `/media/${file.folder}/${filename}`, width: size.width, height: size.height }
  }
}
