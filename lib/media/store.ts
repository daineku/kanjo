import 'server-only'

import { MediaStoreError } from './validation'

/**
 * Where uploaded media goes.
 *
 * Separate from `ContentStore` because they answer different questions and
 * change independently: the content document holds a `src`, and whether those
 * bytes sit in `public/media/` or in an R2 bucket is a deployment decision. The
 * admin's image field calls `save()` and gets a URL back; it has never needed
 * to know which.
 *
 * The VALIDATION RULES live in `./validation`, as pure functions with no
 * `server-only` on them, so both implementations share one code path and the
 * tests exercise that path rather than a copy of it. Everything from there is
 * re-exported here, so existing importers are unaffected.
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

export {
  MAX_UPLOAD_BYTES,
  MEDIA_FOLDERS,
  MEDIA_TYPES,
  MediaStoreError,
  safeFilename,
  validateUpload,
  type ValidatedUpload,
} from './validation'

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
