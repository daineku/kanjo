/**
 * Country names for the destinations the store can plausibly be configured to
 * ship to.
 *
 * A static table rather than `Intl.DisplayNames`, because the names appear in
 * components that render on the server and then hydrate: two ICU versions can
 * disagree about a name, and that is a hydration mismatch on the checkout
 * form. A code that is not in the table is shown as the code — still correct,
 * never invented.
 */
const NAMES: Record<string, string> = {
  US: 'United States',
  CA: 'Canada',
  GB: 'United Kingdom',
  IE: 'Ireland',
  TH: 'Thailand',
  AT: 'Austria',
  BE: 'Belgium',
  BG: 'Bulgaria',
  HR: 'Croatia',
  CY: 'Cyprus',
  CZ: 'Czechia',
  DK: 'Denmark',
  EE: 'Estonia',
  FI: 'Finland',
  FR: 'France',
  DE: 'Germany',
  GR: 'Greece',
  HU: 'Hungary',
  IT: 'Italy',
  LV: 'Latvia',
  LT: 'Lithuania',
  LU: 'Luxembourg',
  MT: 'Malta',
  NL: 'Netherlands',
  PL: 'Poland',
  PT: 'Portugal',
  RO: 'Romania',
  SK: 'Slovakia',
  SI: 'Slovenia',
  ES: 'Spain',
  SE: 'Sweden',
  NO: 'Norway',
  CH: 'Switzerland',
  IS: 'Iceland',
  AU: 'Australia',
  NZ: 'New Zealand',
  JP: 'Japan',
  SG: 'Singapore',
  MY: 'Malaysia',
  HK: 'Hong Kong',
  TW: 'Taiwan',
  KR: 'South Korea',
  PH: 'Philippines',
  ID: 'Indonesia',
  VN: 'Vietnam',
  AE: 'United Arab Emirates',
  MX: 'Mexico',
  BR: 'Brazil',
  ZA: 'South Africa',
}

export function countryName(code: string): string {
  return NAMES[code.toUpperCase()] ?? code.toUpperCase()
}

/** Codes sorted by display name, de-duplicated, upper-cased. */
export function sortCountries(codes: readonly string[]): string[] {
  return [...new Set(codes.map((code) => code.toUpperCase()))].sort((a, b) =>
    countryName(a).localeCompare(countryName(b), 'en'),
  )
}

export function isCountryCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z]{2}$/.test(value)
}

/** Every country this table names, sorted — for enquiry forms, which are not limited to shipping zones. */
export function knownCountries(): string[] {
  return sortCountries(Object.keys(NAMES))
}
