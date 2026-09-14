import 'server-only'

import { AwsClient } from 'aws4fetch'

import { MediaStoreError, validateUpload, type MediaStore } from './store'

/**
 * Cloudflare R2, via its S3-compatible API.
 *
 * ── WHY `aws4fetch` AND NOT `@aws-sdk/client-s3` ────────────────────────────
 *
 * The whole of this integration is one signed PUT. `@aws-sdk/client-s3` is
 * several megabytes of dependency and a measurable cold start on a serverless
 * function, to do request signing that `aws4fetch` does in about 5KB using the
 * platform's own WebCrypto. Hand-rolling SigV4 was the third option and was
 * rejected for the opposite reason: a signer that cannot be tested against real
 * R2 before the credentials exist is exactly the kind of thing that fails in
 * production for a subtle reason.
 *
 * ── CREDENTIALS ─────────────────────────────────────────────────────────────
 *
 * Server-only, never `NEXT_PUBLIC_`. `R2_SECRET_ACCESS_KEY` is a write
 * credential for the bucket; the token created for it should be scoped to
 * `thekanjo-media` alone and to Object Read & Write — see
 * docs/PRODUCTION_SETUP.md.
 *
 * ── PUBLIC URLS ─────────────────────────────────────────────────────────────
 *
 * `R2_PUBLIC_BASE_URL` is the read side and is a SEPARATE concern from the
 * credentials: it is whatever public hostname the bucket is exposed on (an
 * `r2.dev` domain or a custom one). Uploading does not make an object
 * readable — the bucket has to be published — so this is configured
 * independently rather than derived, and the returned `src` is built from it.
 */

const REQUIRED = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_BASE_URL',
] as const

export class R2MediaStore implements MediaStore {
  readonly kind = 'r2'

  private readonly client: AwsClient
  private readonly endpoint: string
  private readonly bucket: string
  private readonly publicBase: string

  constructor(config: {
    accountId: string
    accessKeyId: string
    secretAccessKey: string
    bucket: string
    publicBaseUrl: string
  }) {
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      // R2 is single-region and ignores this, but SigV4 requires a value and
      // an empty one produces a signature R2 rejects with a bare 401.
      region: 'auto',
      service: 's3',
    })
    this.endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`
    this.bucket = config.bucket
    this.publicBase = config.publicBaseUrl.replace(/\/+$/, '')
  }

  async save(file: { name: string; bytes: Uint8Array; folder: string }) {
    // The SAME validation the local store runs — folder, size, extension, and
    // the pixel dimensions read from the file's own header. See store.ts.
    const { filename, contentType, width, height } = validateUpload(file)

    const key = `${file.folder}/${filename}`
    const url = `${this.endpoint}/${this.bucket}/${key}`

    let response: Response
    try {
      response = await this.client.fetch(url, {
        method: 'PUT',
        body: file.bytes as unknown as BodyInit,
        headers: {
          // Derived from the VERIFIED bytes rather than from the filename, so a
          // renamed file cannot make R2 serve the wrong type. That matters for
          // SVG in particular: it is served as `image/svg+xml` only because the
          // header parser recognised an SVG.
          'Content-Type': contentType,
          // Media is immutable: every upload gets a fresh timestamped key, so an
          // object at a given key never changes and can be cached forever.
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    } catch (cause) {
      throw new MediaStoreError(
        `Could not reach R2: ${(cause as Error).message}. Check R2_ACCOUNT_ID and that the bucket exists.`,
      )
    }

    if (!response.ok) {
      // R2's error body is XML and can be long. The status is the actionable
      // part — 401/403 means the token, 404 means the bucket name.
      throw new MediaStoreError(
        `R2 refused the upload (HTTP ${response.status}). ` +
          `401/403 means the API token cannot write to "${this.bucket}"; 404 means the bucket name is wrong.`,
      )
    }

    return { src: `${this.publicBase}/${key}`, width, height }
  }
}

/**
 * Builds the store, failing at startup rather than at upload time.
 *
 * An editor discovering a missing environment variable by having a save fail —
 * after they have written a caption and chosen a file — is a worse experience
 * than the deployment refusing to start with a list of what is absent.
 */
export async function createR2MediaStore(): Promise<MediaStore> {
  const missing = REQUIRED.filter((name) => !process.env[name]?.trim())
  if (missing.length > 0) {
    throw new MediaStoreError(
      `MEDIA_STORE=r2 requires ${missing.join(', ')}. See docs/PRODUCTION_SETUP.md.`,
    )
  }

  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL!.trim()
  if (!/^https:\/\//i.test(publicBaseUrl)) {
    throw new MediaStoreError(
      `R2_PUBLIC_BASE_URL must be an https:// URL — it becomes the src of every uploaded image.`,
    )
  }

  return new R2MediaStore({
    accountId: process.env.R2_ACCOUNT_ID!.trim(),
    accessKeyId: process.env.R2_ACCESS_KEY_ID!.trim(),
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!.trim(),
    bucket: process.env.R2_BUCKET_NAME!.trim(),
    publicBaseUrl,
  })
}
