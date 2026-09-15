// A relative path with an explicit extension: Node runs this module directly
// from lib/infra.test.ts, and resolves neither the `@/` alias nor an
// extensionless specifier. `allowImportingTsExtensions` lets the bundler accept
// the same one.
import { readImageSize } from '../content/local/imageSize.ts'

/**
 * Upload validation: the rules, as pure functions of a filename and some bytes.
 *
 * ── WHY THIS IS SEPARATE FROM store.ts ──────────────────────────────────────
 *
 * `lib/media/store.ts` imports `server-only`, because it reads the environment
 * and constructs a store that talks to a filesystem or to R2. None of the rules
 * below need any of that: they are a string, a byte array, and a decision.
 *
 * They used to live behind `server-only` with everything else, which meant the
 * tests could not import them — so the path-traversal and content-type rules
 * were RE-STATED in the test file. A test that re-implements its subject can
 * pass while the real one is broken, and "can this filename escape its folder"
 * is not a question to answer twice.
 *
 * ── AND WHY BOTH STORES SHARE THEM ──────────────────────────────────────────
 *
 * `LocalMediaStore` and `R2MediaStore` call exactly this. A rule enforced in
 * only one of the two is a bug that appears after deployment: a file that
 * uploads locally and is rejected in production, or worse, the other way round.
 */

export class MediaStoreError extends Error {
  // Written out rather than as a parameter property: this module is reachable
  // from `node` tests, and Node's type stripping rejects those.
  constructor(message: string) {
    super(message)
    this.name = 'MediaStoreError'
  }
}

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

/**
 * The only types this site serves, and the `Content-Type` each one gets.
 *
 * The mapping matters in production: R2 stores whatever `Content-Type` it is
 * given, and serves it back forever.
 */
export const MEDIA_TYPES: Record<string, string> = {
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
  const contentType = MEDIA_TYPES[extension]

  if (!contentType) {
    throw new MediaStoreError(
      `"${file.name}" is not an image this site can use. Expected ${Object.keys(MEDIA_TYPES).join(', ')}.`,
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
