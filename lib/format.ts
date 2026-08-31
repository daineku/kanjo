/**
 * Formatting helpers shared by server and client components.
 */

/**
 * Formats an ISO date for display.
 *
 * Fixed to `en-GB` and UTC on purpose. `toLocaleDateString` with no locale uses
 * the runtime's, which differs between the build machine and the browser — and
 * a date that renders one way in the server HTML and another after hydration is
 * a hydration mismatch. Forcing UTC also stops a date near midnight from
 * shifting a day for a visitor in another timezone.
 */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  if (!year || !month || !day) return iso

  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Joins non-empty parts with a separator. */
export function joinParts(parts: (string | undefined | null)[], separator = ' — '): string {
  return parts.filter((part): part is string => Boolean(part?.trim())).join(separator)
}
