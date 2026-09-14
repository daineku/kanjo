import 'server-only'

import { readImageSize } from '@/lib/content/local/imageSize'

/**
 * Where uploaded media goes.
 *
 * Separate from `ContentStore` because they answer different questions and
 * change independently: the content document holds a `src`, and whether those
 * bytes sit in `public/media/` or in an R2 bucket is a deployment decision. The
 * admin's image field calls `save()` and gets a URL back; it has never needed
 * to know which.
 */
export interface MediaStore {
  /** A label for diagnostics, e.g. 'local-files' or 'r2'. */
  readonly kind: string

  /**
   * Stores the bytes and returns the reference the content should carry.
   *
   * Intrinsic dimensions are the store's job because they are a property of the
   * bytes rather than of the form, and because every `ImageRef` in this
   * codebase requires them — they are what stops the page shifting as images
   * decode.
   */
  save(file: {
    name: string
    bytes: Uint8Array
    /** A folder under the media root, e.g. 'loader' or 'hero'. */
    folder: string
  }): Promise<{ src: string; width: number; height: number }>
}

export class MediaStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaStoreError'
  }
}

// ── Shared validation ────────────────────────────────────────────────────────
//
// Every rule below is enforced identically by both implementations, because a
// file that is acceptable locally and rejected in production — or worse, the
// other way round — is a bug that only appears after deployment.

/** Folders the site's media layout defines. Anything else is a typo. */
export const MEDIA_FOLDERS = new Set([
  'loader',
  'hero',
  'screenshots',
  'video',
  'articles',
  'og',
  'social',
])

const EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
}

/**
 * 12MB.
 *
 * Images only, and deliberately so: the brief rules out arbitrary large-video
 * upload for V1, and a browser form post is the wrong transport for one anyway
 * — a 200MB capture wants a resumable, presigned, direct-to-bucket flow, which
 * is a feature rather than a bigger number here. Video is added by dropping the
 * file into `public/media/video/` and referencing it.
 */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024

export type ValidatedUpload = {
  filename: string
  contentType: string
  width: number
  height: number
}

/**
 * A filename that cannot escape its folder or collide by accident.
 *
 * The name comes from a browser file picker, so it is attacker-influenced in
 * the same sense any form field is: it can contain `..`, a drive letter, a null
 * byte, or 300 characters of Unicode. Only the basename's own word characters
 * survive, and a short timestamp suffix makes re-uploading a second `car.svg` a
 * new object rather than a silent overwrite of the first.
 *
 * Tested in lib/infra.test.ts, including the path-traversal cases.
 */
export function safeFilename(original: string): string {
  const base = original.replace(/\\/g, '/').split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  const extension = dot > 0 ? base.slice(dot).toLowerCase() : ''
  const stem = (dot > 0 ? base.slice(0, dot) : base)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return `${stem || 'image'}-${Date.now().toString(36)}${extension}`
}

/**
 * Validates an upload and reads its intrinsic size.
 *
 * THE DIMENSIONS COME FROM THE BYTES, and a file whose header cannot be parsed
 * is REJECTED rather than stored with guessed ones. That doubles as a
 * content-type check: a `.png` whose bytes are not a PNG fails here, so the
 * `Content-Type` this eventually sets on an R2 object is derived from something
 * that was actually verified rather than from a filename anybody can rename.
 */
export function validateUpload(file: {
  name: string
  bytes: Uint8Array
  folder: string
}): ValidatedUpload {
  if (!MEDIA_FOLDERS.has(file.folder)) {
    throw new MediaStoreError(
      `Unknown media folder "${file.folder}". Expected one of: ${[...MEDIA_FOLDERS].join(', ')}.`,
    )
  }
  if (file.bytes.byteLength === 0) {
    throw new MediaStoreError('The uploaded file is empty.')
  }
  if (file.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new MediaStoreError(
      `That file is ${(file.bytes.byteLength / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.`,
    )
  }

  const filename = safeFilename(file.name)
  const dot = filename.lastIndexOf('.')
  const extension = dot > 0 ? filename.slice(dot) : ''
  const contentType = EXTENSIONS[extension]

  if (!contentType) {
    throw new MediaStoreError(
      `"${file.name}" is not an image this site can use. Expected ${Object.keys(EXTENSIONS).join(', ')}.`,
    )
  }

  const size = readImageSize(file.bytes)
  if (!size) {
    throw new MediaStoreError(
      `Could not read the pixel dimensions of "${file.name}". Its contents do not look like a PNG, JPEG, GIF, WebP or SVG.`,
    )
  }

  return { filename, contentType, width: size.width, height: size.height }
}

// ── Resolution ───────────────────────────────────────────────────────────────

let cached: MediaStore | null = null

/**
 * Selects the media store from the environment.
 *
 * `MEDIA_STORE` defaults to `local`, so a fresh clone uploads to
 * `public/media/` with no configuration — the same principle as
 * `CONTENT_SOURCE`. Naming an unimplemented store fails with a message that
 * says what to do.
 */
export async function resolveMediaStore(): Promise<MediaStore> {
  if (cached) return cached

  const requested = (process.env.MEDIA_STORE ?? 'local').trim().toLowerCase()

  if (requested === 'local') {
    const { LocalMediaStore } = await import('./local')
    cached = new LocalMediaStore()
    return cached
  }

  if (requested === 'r2') {
    const { createR2MediaStore } = await import('./r2')
    cached = await createR2MediaStore()
    return cached
  }

  throw new MediaStoreError(
    `Unknown MEDIA_STORE "${requested}". Valid values are "local" (default) and "r2". See docs/PRODUCTION_SETUP.md.`,
  )
}
