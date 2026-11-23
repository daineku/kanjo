import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Thrown by commerce code; the storefront controller maps it to an HTTP response. */
export class CommerceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'CommerceError';
  }
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Constant-time string equality that does not leak length through timing. */
export function safeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db);
}

// Crockford base32 without I, L, O, U: unambiguous when read over the phone.
const REF_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** An order reference such as `KJ-7F3K9Q2M`. 40 bits of randomness; uniqueness is also enforced by the database. */
export function newOrderReference(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i += 1) out += REF_ALPHABET[bytes[i]! % 32];
  return `KJ-${out}`;
}

export const newAccessToken = () => randomBytes(32).toString('base64url');

/**
 * A visitor's IP, hashed with a server secret before it is stored.
 *
 * Reviews and enquiries keep this so a flood from one address can be seen and
 * removed together. The raw address is never written to the database.
 */
export function hashIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  const salt = process.env.APP_KEYS || 'kanjo';
  return sha256(`${salt}:${ip}`).slice(0, 32);
}

export function cleanString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Strip control characters; collapse nothing else — the text is rendered as
  // text by the storefront, never as HTML.
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (cleaned === '') return undefined;
  return cleaned.slice(0, max);
}

const EMAIL = /^[^\s@<>()"',;:\\]+@[^\s@<>()"',;:\\]+\.[^\s@<>()"',;:\\]{2,}$/;

export function cleanEmail(value: unknown): string | undefined {
  const text = cleanString(value, 254);
  if (!text || !EMAIL.test(text)) return undefined;
  return text.toLowerCase();
}

/** ISO 3166-1 alpha-2. Format only; whether we ship there is the shipping module's question. */
export function cleanCountry(value: unknown): string | undefined {
  const text = cleanString(value, 2)?.toUpperCase();
  return text && /^[A-Z]{2}$/.test(text) ? text : undefined;
}

export function splitList(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

export function countryList(value: unknown): string[] {
  return splitList(value)
    .map((code) => code.toUpperCase())
    .filter((code) => /^[A-Z]{2}$/.test(code));
}
