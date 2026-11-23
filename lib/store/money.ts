import type { Money } from './types.ts'

/**
 * The one place an amount becomes a string.
 *
 * ── "USD 129.00", NOT "$129.00" ─────────────────────────────────────────────
 *
 * Two reasons. Iceland — the face every label on this site is set in — was
 * subset to Latin ranges, and a currency glyph outside it (the baht sign in
 * particular) would fall through to another typeface in the middle of a price.
 * And this store sells across currencies and borders, where a dollar sign is
 * ambiguous between four dollars: the ISO code is the unambiguous statement of
 * what the customer is being charged.
 *
 * The locale is pinned so the server HTML and the hydrated client agree.
 */
const FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatMoney(money: Money): string {
  return `${money.currency} ${FORMAT.format(money.amount / 100)}`
}

/** A major-unit string for structured data: "129.00". */
export function moneyDecimal(money: Money): string {
  return (money.amount / 100).toFixed(2)
}

/** Parses a visitor-typed major-unit amount ("120", "120.50") to minor units. */
export function parseMajorToMinor(input: string | undefined): number | undefined {
  if (!input) return undefined
  const trimmed = input.trim()
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(trimmed)) return undefined
  return Math.round(Number(trimmed) * 100)
}
