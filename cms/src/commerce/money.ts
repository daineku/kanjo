/**
 * Money.
 *
 * The admin edits prices as decimals because that is what a person types. Every
 * calculation, every comparison and every value that crosses the storefront API
 * is an INTEGER number of minor units. These two functions are the only
 * crossing points; nothing else in the commerce code multiplies by 100.
 *
 * Every currency the store supports (USD, EUR, GBP, THB, CAD) has two minor
 * digits. Adding a zero- or three-decimal currency means changing this file,
 * which is why the list is closed (see CURRENCIES).
 */

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'THB', 'CAD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);
}

/** Decimal (as stored by the admin: number or numeric string) → minor units. Null stays null. */
export function toMinor(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  // Round half away from zero on the cent, after neutralising float noise
  // (19.99 * 100 === 1998.9999999999998).
  return Math.round(Number((n * 100).toPrecision(15)));
}

/** Minor units → the decimal the admin stores. */
export function fromMinor(minor: number): number {
  return Math.round(minor) / 100;
}

export type Money = { amount: number; currency: Currency };

export function money(amount: number, currency: Currency): Money {
  return { amount, currency };
}
