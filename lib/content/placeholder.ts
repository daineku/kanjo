/**
 * Placeholder discipline.
 *
 * The content files legitimately carry entries that are not written yet, marked
 * `PLACEHOLDER` so an editor can find them. The first build then RENDERED those
 * markers: measured on the homepage, the word "PLACEHOLDER" appeared **nine
 * times** on the public page, including twice in the first screen —
 *
 *   "IN DEVELOPMENT — PLACEHOLDER — replace with the current stage the owner
 *    wants stated"
 *   "PLACEHOLDER — platforms not announced"
 *
 * — alongside two developer instructions ("ADD AN ENTRY TO
 * CONTENT/VIDEOS.JSON"). That is internal workflow leaking to visitors, and it
 * is worse than an empty section: an empty section reads as restraint, an
 * instruction to the site's own owner reads as a broken page.
 *
 * The rule this module enforces: A PLACEHOLDER IS ABSENT, NOT PRINTED. Every
 * component asks `isPlaceholder()` before rendering optional copy, and omits it
 * when true. Nothing is invented to fill the gap; the section simply says less.
 *
 * `docs/CONTENT_REQUIRED.md` is the inventory of what is still missing, which is
 * where that information belongs.
 */

/** Case-insensitive marker. Matching the whole word avoids false positives. */
const MARKER = /\bplaceholder\b/i

/**
 * True when a value is missing, blank, or a marked placeholder.
 *
 * Deliberately loose about *where* the marker sits: `"PLACEHOLDER — platforms
 * not announced"` and `"IN DEVELOPMENT — PLACEHOLDER — replace with…"` both need
 * to be suppressed, and both carry the marker mid-string.
 */
export function isPlaceholder(value: string | null | undefined): boolean {
  if (value == null) return true
  const trimmed = value.trim()
  if (trimmed === '') return true
  return MARKER.test(trimmed)
}

/** The value, or undefined when it is missing or a placeholder. */
export function real(value: string | null | undefined): string | undefined {
  if (isPlaceholder(value)) return undefined
  return (value as string).trim()
}

/**
 * Filters a list of label/value rows down to the ones that say something.
 *
 * Used by the status strip: a row whose value is "PLACEHOLDER" or which is
 * blank contributes nothing and is dropped, so the strip shrinks to what is
 * actually known rather than listing four rows of "not announced".
 */
export function realRows<T extends { value: string }>(rows: readonly T[]): T[] {
  return rows.filter((row) => !isPlaceholder(row.value))
}
