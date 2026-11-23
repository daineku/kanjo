import type { Core } from '@strapi/strapi';

import { TikTokApiError, TikTokClient } from './client';
import { REGION_CURRENCY, readTikTokConfig } from './config';
import { decryptSecret, encryptSecret } from './crypto';
import type { FetchLike, TikTokConfig, TikTokTokenSet } from './types';

/**
 * The stored connection: one single-type row, tokens encrypted.
 *
 * `status` is only ever advanced by something that actually happened:
 *   not_configured          env variables missing
 *   awaiting_authorization  configured, the seller has not approved the app
 *   connected               a token exchange succeeded AND a shop was returned
 *   token_expired           refresh failed or the refresh token lapsed
 *   error                   the last call failed for another reason
 * Nothing here writes `connected` on any other path.
 */

const UID = 'api::tiktok-connection.tiktok-connection';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const docs = (strapi: Core.Strapi, uid: string): any => (strapi as any).documents(uid);

export type ConnectionRecord = {
  documentId: string;
  status: string;
  shopId?: string | null;
  shopName?: string | null;
  shopRegion?: string | null;
  sellerType?: string | null;
  shopCipher?: string | null;
  accessTokenEnc?: string | null;
  refreshTokenEnc?: string | null;
  accessTokenExpiresAt?: string | null;
  refreshTokenExpiresAt?: string | null;
  syncProducts?: boolean | null;
  syncInventory?: boolean | null;
  importOrders?: boolean | null;
  lastSyncAt?: string | null;
  lastError?: string | null;
};

let fetchOverride: FetchLike | undefined;

/** Test seam only: replaces the network. Never called by application code. */
export function setTikTokFetchForTests(impl: FetchLike | undefined): void {
  fetchOverride = impl;
}

export const tikTokFetch = (): FetchLike => fetchOverride ?? (globalThis.fetch as unknown as FetchLike);

export async function getConnection(strapi: Core.Strapi): Promise<ConnectionRecord> {
  const existing = await docs(strapi, UID).findFirst();
  if (existing) return existing as ConnectionRecord;
  return (await docs(strapi, UID).create({
    data: { status: readTikTokConfig() ? 'awaiting_authorization' : 'not_configured' },
  })) as ConnectionRecord;
}

export async function updateConnection(
  strapi: Core.Strapi,
  data: Partial<Omit<ConnectionRecord, 'documentId'>>,
): Promise<ConnectionRecord> {
  const current = await getConnection(strapi);
  return (await docs(strapi, UID).update({ documentId: current.documentId, data })) as ConnectionRecord;
}

/**
 * The connection as the ops screen may see it: no ciphertext, no cipher.
 * `effectiveStatus` reconciles the stored status with the environment, so a
 * deployment that lost its credentials does not keep claiming "connected".
 */
export async function describeConnection(strapi: Core.Strapi) {
  const record = await getConnection(strapi);
  const configured = Boolean(readTikTokConfig());
  const hasTokens = Boolean(record.accessTokenEnc && record.refreshTokenEnc);
  let effectiveStatus = record.status;
  if (!configured) effectiveStatus = 'not_configured';
  else if (record.status === 'not_configured') effectiveStatus = 'awaiting_authorization';
  else if (record.status === 'connected' && !hasTokens) effectiveStatus = 'awaiting_authorization';

  return {
    configured,
    status: effectiveStatus,
    shopId: record.shopId ?? null,
    shopName: record.shopName ?? null,
    shopRegion: record.shopRegion ?? null,
    sellerType: record.sellerType ?? null,
    shopCurrency: record.shopRegion ? (REGION_CURRENCY[record.shopRegion.toUpperCase()] ?? null) : null,
    accessTokenExpiresAt: record.accessTokenExpiresAt ?? null,
    refreshTokenExpiresAt: record.refreshTokenExpiresAt ?? null,
    syncProducts: Boolean(record.syncProducts),
    syncInventory: Boolean(record.syncInventory),
    importOrders: Boolean(record.importOrders),
    lastSyncAt: record.lastSyncAt ?? null,
    lastError: record.lastError ?? null,
  };
}

export function isLive(record: ConnectionRecord, config: TikTokConfig | null): config is TikTokConfig {
  return Boolean(config && record.status === 'connected' && record.accessTokenEnc && record.refreshTokenEnc);
}

export async function storeTokens(
  strapi: Core.Strapi,
  config: TikTokConfig,
  tokens: TikTokTokenSet,
  extra: Partial<Omit<ConnectionRecord, 'documentId'>> = {},
): Promise<ConnectionRecord> {
  return updateConnection(strapi, {
    accessTokenEnc: encryptSecret(tokens.accessToken, config.encryptionKey),
    refreshTokenEnc: encryptSecret(tokens.refreshToken, config.encryptionKey),
    accessTokenExpiresAt: tokens.accessTokenExpiresAt ?? null,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? null,
    ...extra,
  });
}

export async function clearTokens(strapi: Core.Strapi, status: string, lastError: string): Promise<void> {
  await updateConnection(strapi, {
    status,
    lastError,
    accessTokenEnc: null,
    refreshTokenEnc: null,
    shopCipher: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
  });
}

/** Refresh when the access token has less than this left. */
const REFRESH_MARGIN_MS = 24 * 60 * 60_000;

/**
 * An authorized client, refreshing the access token first when it is close to
 * expiry. Returns null when the integration is not live — callers treat that
 * as "do nothing", never as an error to paper over.
 */
export async function getAuthorizedClient(
  strapi: Core.Strapi,
  options: { forceRefresh?: boolean } = {},
): Promise<{ client: TikTokClient; connection: ConnectionRecord; config: TikTokConfig; shopCurrency: string | null } | null> {
  const config = readTikTokConfig();
  let connection = await getConnection(strapi);
  if (!isLive(connection, config)) return null;

  let accessToken: string;
  let refreshToken: string;
  try {
    accessToken = decryptSecret(connection.accessTokenEnc as string, config.encryptionKey);
    refreshToken = decryptSecret(connection.refreshTokenEnc as string, config.encryptionKey);
  } catch {
    // The key changed or the row was tampered with. The tokens are unusable.
    await clearTokens(strapi, 'error', 'Stored tokens could not be decrypted with the configured key. Re-authorize the shop.');
    return null;
  }

  const expiresAt = connection.accessTokenExpiresAt ? Date.parse(connection.accessTokenExpiresAt) : NaN;
  const needsRefresh = options.forceRefresh || !Number.isFinite(expiresAt) || expiresAt - Date.now() < REFRESH_MARGIN_MS;

  if (needsRefresh) {
    try {
      const fresh = await new TikTokClient({ config, fetch: tikTokFetch() }).refreshAccessToken(refreshToken);
      connection = await storeTokens(strapi, config, fresh, { lastError: null });
      accessToken = fresh.accessToken;
    } catch (error) {
      const retryable = error instanceof TikTokApiError && error.retryable;
      const stillValid = Number.isFinite(expiresAt) && expiresAt > Date.now();
      if (retryable && stillValid && !options.forceRefresh) {
        // A transient failure with a still-valid token: carry on with it.
      } else if (retryable) {
        throw error;
      } else {
        await updateConnection(strapi, {
          status: 'token_expired',
          lastError: `Token refresh was refused: ${(error as Error).message}. Re-authorize the shop.`,
        });
        return null;
      }
    }
  }

  return {
    client: new TikTokClient({
      config,
      fetch: tikTokFetch(),
      accessToken,
      shopCipher: connection.shopCipher ?? undefined,
    }),
    connection,
    config,
    shopCurrency: connection.shopRegion ? (REGION_CURRENCY[connection.shopRegion.toUpperCase()] ?? null) : null,
  };
}

/**
 * Complete an authorization: exchange the code, read the shop, store tokens.
 * `connected` is written here and only here, after both calls succeed.
 */
export async function completeAuthorization(strapi: Core.Strapi, authCode: string): Promise<ConnectionRecord> {
  const config = readTikTokConfig();
  if (!config) throw new Error('TikTok Shop is not configured');

  const tokens = await new TikTokClient({ config, fetch: tikTokFetch() }).exchangeAuthCode(authCode);
  const shops = await new TikTokClient({
    config,
    fetch: tikTokFetch(),
    accessToken: tokens.accessToken,
  }).getAuthorizedShops();

  const shop = shops[0];
  if (!shop) {
    await updateConnection(strapi, {
      status: 'error',
      lastError: 'Authorization succeeded but TikTok returned no authorized shop for this app.',
    });
    throw new Error('No authorized shop was returned');
  }

  return storeTokens(strapi, config, tokens, {
    status: 'connected',
    shopId: shop.id,
    shopName: shop.name,
    shopRegion: shop.region,
    sellerType: shop.sellerType,
    shopCipher: shop.cipher,
    lastError:
      shops.length > 1
        ? `The app is authorized for ${shops.length} shops; using "${shop.name}". A seller custom app is expected to bind to one shop.`
        : null,
  });
}
