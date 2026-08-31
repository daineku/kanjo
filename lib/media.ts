/**
 * Media helpers shared by the hero and the video section.
 *
 * Pure string work — no filesystem, no Node built-ins — so this is safe in a
 * client component and testable by calling a function.
 */

/** Extensions the site will emit a `<source type>` for. */
const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
}

/**
 * MIME type for a local video path, derived from its extension.
 *
 * Deriving it means a content entry lists paths and nothing else — no `type`
 * field to keep in step with the filename. An unknown extension returns
 * undefined rather than a guess: `<source>` without a `type` makes the browser
 * sniff the file, which is the correct fallback, whereas a WRONG `type` makes it
 * skip a source it could have played.
 */
export function mimeFor(path: string): string | undefined {
  const clean = path.split('?')[0]?.split('#')[0] ?? ''
  const extension = clean.slice(clean.lastIndexOf('.') + 1).toLowerCase()
  return VIDEO_MIME[extension]
}

/** True for a root-relative path under /public, i.e. an asset this repo owns. */
export function isLocalAsset(src: string): boolean {
  return src.startsWith('/') && !src.startsWith('//')
}

/**
 * Every media path a piece of content references, for validation.
 *
 * Kept here rather than in the validator so the shapes it walks live beside the
 * types they belong to, and so a new media field is one edit away from being
 * checked.
 */
export type MediaReference = {
  /** Where the path came from, e.g. `content/media.json → osaka-night-01`. */
  where: string
  /** The field, e.g. `image.src` or `poster.src`. */
  field: string
  path: string
  /** False for a draft/unpublished entry: missing files are expected there. */
  required: boolean
}
