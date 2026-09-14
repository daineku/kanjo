import 'server-only'

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { validateUpload, type MediaStore } from './store'

/**
 * The development media store: it writes files into `public/media/`.
 *
 * Right for one person on a laptop, and wrong for a deployment — a serverless
 * filesystem is read-only and ephemeral, so a file written during a request is
 * gone by the next one and was never served to anybody. That is not a bug to
 * work around; it is why `R2MediaStore` exists, and why both sit behind
 * `MediaStore` rather than the admin writing to disk directly.
 *
 * Validation is shared with the R2 implementation (see store.ts), so a file
 * that uploads locally will upload in production and one that is rejected here
 * is rejected there. A rule enforced in only one of the two is a bug that
 * appears after deployment.
 */

const MEDIA_DIR = path.join(process.cwd(), 'public', 'media')

export class LocalMediaStore implements MediaStore {
  readonly kind = 'local-files'

  async save(file: { name: string; bytes: Uint8Array; folder: string }) {
    const { filename, width, height } = validateUpload(file)

    const directory = path.join(MEDIA_DIR, file.folder)
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, filename), file.bytes)

    // A root-relative path under /public — `isLocalAsset` recognises it, and
    // `next/image` serves it through the optimizer with no remote pattern.
    return { src: `/media/${file.folder}/${filename}`, width, height }
  }
}
