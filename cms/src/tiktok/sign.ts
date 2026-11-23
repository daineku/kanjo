import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Request signing for the TikTok Shop Open API, version 202309.
 *
 * PROVENANCE: the official page (partner.tiktokshop.com/docv2/page/
 * sign-your-api-request) renders client-side and could not be read during
 * research. The algorithm below is the one implemented by the open-source
 * SDKs and two independent write-ups, which agree with each other. It is
 * unit-tested against an independently computed vector, but the FIRST real
 * call against a sandbox shop is the real confirmation — a wrong signature is
 * answered with an explicit signature error, never with wrong data.
 *
 *   1. Take every query parameter except `sign` and `access_token`.
 *   2. Sort by key; concatenate as key1value1key2value2…
 *   3. Prepend the request path (e.g. /product/202309/products).
 *   4. If the body is sent and the content type is not multipart/form-data,
 *      append the exact body string that goes on the wire.
 *   5. Wrap the whole string in the app secret: secret + string + secret.
 *   6. sign = lowercase hex of HMAC-SHA256(key = secret, message).
 */

export type SignInput = {
  path: string;
  query: Record<string, string | number | undefined>;
  /** The exact serialized body. Omit for GET and for multipart requests. */
  body?: string;
  appSecret: string;
};

const EXCLUDED = new Set(['sign', 'access_token']);

export function buildSignBase({ path, query, body }: Omit<SignInput, 'appSecret'>): string {
  const pairs = Object.keys(query)
    .filter((key) => !EXCLUDED.has(key) && query[key] !== undefined)
    .sort()
    .map((key) => `${key}${String(query[key])}`)
    .join('');
  return `${path}${pairs}${body ?? ''}`;
}

export function signRequest(input: SignInput): string {
  const message = `${input.appSecret}${buildSignBase(input)}${input.appSecret}`;
  return createHmac('sha256', input.appSecret).update(message).digest('hex');
}

/**
 * Webhook signature: the `Authorization` header (no "Bearer") is the lowercase
 * hex of HMAC-SHA256(key = app_secret, message = app_key + raw_body).
 *
 * Verified on the RAW bytes, before any JSON parsing, with a constant-time
 * comparison. A re-serialized body is not the body that was signed.
 */
export function computeWebhookSignature(appKey: string, appSecret: string, rawBody: string): string {
  return createHmac('sha256', appSecret).update(`${appKey}${rawBody}`).digest('hex');
}

export function verifyWebhookSignature(
  appKey: string,
  appSecret: string,
  rawBody: string,
  header: string | undefined | null,
): boolean {
  if (!header) return false;
  const expected = Buffer.from(computeWebhookSignature(appKey, appSecret, rawBody), 'utf8');
  const received = Buffer.from(header.trim().toLowerCase(), 'utf8');
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

/** Constant-time string equality for secrets of unknown length. */
export function safeEqual(a: string, b: string): boolean {
  const left = createHmac('sha256', 'kanjo-compare').update(a).digest();
  const right = createHmac('sha256', 'kanjo-compare').update(b).digest();
  return timingSafeEqual(left, right);
}
