import type { TikTokConfig } from './types';

/**
 * TikTok Shop configuration, read from the environment.
 *
 * THE MODULE IS INERT WITHOUT ALL THREE REQUIRED VARIABLES. No request is
 * signed, no job is queued and the ops screen reports `not_configured`. There
 * is deliberately no default app key, no sandbox fallback and no way to end up
 * "connected" without a real seller authorization.
 *
 * Hosts — provenance of each default:
 *  - open-api.tiktokglobalshop.com   API base. Secondary source (open-source
 *    SDK default). CONFIRM in Partner Center → API reference.
 *  - auth.tiktok-shops.com           token endpoints. Seen in official
 *    documentation search snippets.
 *  - services.tiktokshop.com         seller authorization page for NON-US
 *    markets (US apps use services.us.tiktokshop.com). A Thai seller uses the
 *    global Partner Center. Override with TIKTOK_SHOP_AUTHORIZE_BASE_URL.
 */

type Env = Record<string, string | undefined>;

const clean = (value: string | undefined) => (value ?? '').trim();

export function readTikTokConfig(env: Env = process.env): TikTokConfig | null {
  const appKey = clean(env.TIKTOK_SHOP_APP_KEY);
  const appSecret = clean(env.TIKTOK_SHOP_APP_SECRET);
  const rawKey = clean(env.TIKTOK_TOKEN_ENCRYPTION_KEY);
  if (!appKey || !appSecret || !rawKey) return null;

  const encryptionKey = Buffer.from(rawKey, 'base64');
  // A key of the wrong length is a misconfiguration, not "configured": refuse
  // rather than encrypt tokens under a weak or truncated key.
  if (encryptionKey.length !== 32) return null;

  return {
    appKey,
    appSecret,
    encryptionKey,
    serviceId: clean(env.TIKTOK_SHOP_SERVICE_ID) || undefined,
    apiBaseUrl: clean(env.TIKTOK_SHOP_API_BASE_URL) || 'https://open-api.tiktokglobalshop.com',
    authBaseUrl: clean(env.TIKTOK_SHOP_AUTH_BASE_URL) || 'https://auth.tiktok-shops.com',
    authorizeBaseUrl:
      clean(env.TIKTOK_SHOP_AUTHORIZE_BASE_URL) || 'https://services.tiktokshop.com',
  };
}

/** Why the module is not configured, for the ops screen. Never includes a value. */
export function tikTokConfigProblems(env: Env = process.env): string[] {
  const problems: string[] = [];
  if (!clean(env.TIKTOK_SHOP_APP_KEY)) problems.push('TIKTOK_SHOP_APP_KEY is not set');
  if (!clean(env.TIKTOK_SHOP_APP_SECRET)) problems.push('TIKTOK_SHOP_APP_SECRET is not set');
  const rawKey = clean(env.TIKTOK_TOKEN_ENCRYPTION_KEY);
  if (!rawKey) problems.push('TIKTOK_TOKEN_ENCRYPTION_KEY is not set');
  else if (Buffer.from(rawKey, 'base64').length !== 32) {
    problems.push('TIKTOK_TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  }
  if (!clean(env.TIKTOK_SHOP_SERVICE_ID)) {
    problems.push('TIKTOK_SHOP_SERVICE_ID is not set (needed only to build the authorization link)');
  }
  return problems;
}

/** ISO 4217 currency a shop region lists in. Only regions TikTok Shop operates in. */
export const REGION_CURRENCY: Record<string, string> = {
  TH: 'THB',
  US: 'USD',
  GB: 'GBP',
  IE: 'EUR',
  DE: 'EUR',
  FR: 'EUR',
  IT: 'EUR',
  ES: 'EUR',
  SG: 'SGD',
  MY: 'MYR',
  VN: 'VND',
  PH: 'PHP',
  ID: 'IDR',
  JP: 'JPY',
};

/**
 * Our carrier enum → TikTok `shipping_provider_id`, supplied as JSON in
 * TIKTOK_SHIPPING_PROVIDER_MAP, e.g. {"dhl":"7049...","thailand_post":"6841..."}.
 * Provider ids are per-market and must be read from the seller's own
 * "Get Shipping Providers" response — none is hardcoded here.
 */
export function readShippingProviderMap(env: Env = process.env): Record<string, string> {
  const raw = clean(env.TIKTOK_SHIPPING_PROVIDER_MAP);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) out[key] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}
