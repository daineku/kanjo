/**
 * TikTok Shop integration — shared types.
 *
 * This module talks to the TikTok Shop SELLER Open API (Partner Center,
 * partner.tiktokshop.com). It has nothing to do with the Content Posting API
 * or the Display API, which are a different product with different
 * credentials, and it uses no unofficial seller-account automation.
 */

/**
 * The marketplace order shape is OWNED by the commerce core; re-exported here
 * so the TikTok module cannot drift from it.
 */
export type { MarketplaceOrderInput } from '../commerce/orders';

export const TIKTOK_JOB_KINDS = [
  'product_upsert',
  'price_update',
  'inventory_update',
  'product_deactivate',
  'order_import',
  'fulfillment_update',
  'token_refresh',
] as const;
export type TikTokJobKind = (typeof TIKTOK_JOB_KINDS)[number];

export type EnqueueJobInput = {
  kind: TikTokJobKind;
  /** What the job is about: a product documentId, a SKU, an order id. */
  subject: string;
  payload?: Record<string, unknown>;
  requestedBy?: string;
};

export type TikTokConfig = {
  appKey: string;
  appSecret: string;
  /** 32 raw bytes, supplied base64-encoded. */
  encryptionKey: Buffer;
  /** Partner Center "service id" of the app, used in the authorize link. */
  serviceId?: string;
  apiBaseUrl: string;
  authBaseUrl: string;
  authorizeBaseUrl: string;
};

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    signal?: AbortSignal;
  },
) => Promise<{
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export type TikTokTokenSet = {
  accessToken: string;
  refreshToken: string;
  /** ISO timestamps. */
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  sellerName?: string;
};

export type TikTokShop = {
  id: string;
  name: string;
  region: string;
  sellerType: string;
  cipher: string;
};
