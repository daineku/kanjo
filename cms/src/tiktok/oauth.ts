import { createHmac, randomBytes } from 'node:crypto';

import { safeEqual } from './sign';
import type { TikTokConfig } from './types';

/**
 * Seller authorization.
 *
 *   1. The owner opens the authorization link from the ops screen.
 *   2. They sign in to TikTok Shop Seller Center and approve the app.
 *   3. TikTok redirects to the app's registered redirect URL with `code` and
 *      the `state` we sent. The code is single-use and short-lived (~30 min,
 *      secondary source).
 *   4. The callback verifies `state`, exchanges the code, reads the authorized
 *      shops, and stores the tokens ENCRYPTED.
 *
 * `state` is a signed, expiring value rather than a random string held in
 * memory: the redirect arrives as a plain browser GET with no admin session
 * attached, and may land on a different process than the one that issued the
 * link. A forged or replayed callback fails the signature or the age check.
 */

const STATE_MAX_AGE_MS = 30 * 60_000;

function stateSignature(config: TikTokConfig, payload: string): string {
  return createHmac('sha256', config.appSecret).update(`kanjo-tiktok-state:${payload}`).digest('base64url');
}

export function createAuthState(config: TikTokConfig, now: number = Date.now()): string {
  const payload = `${now.toString(36)}.${randomBytes(12).toString('base64url')}`;
  return `${payload}.${stateSignature(config, payload)}`;
}

export function verifyAuthState(config: TikTokConfig, state: string | undefined, now: number = Date.now()): boolean {
  if (!state) return false;
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [issued, nonce, signature] = parts as [string, string, string];
  if (!safeEqual(signature, stateSignature(config, `${issued}.${nonce}`))) return false;
  const issuedAt = parseInt(issued, 36);
  if (!Number.isFinite(issuedAt)) return false;
  const age = now - issuedAt;
  return age >= 0 && age <= STATE_MAX_AGE_MS;
}

/**
 * The link the seller opens. Returns null when no service id is configured —
 * the ops screen then explains what is missing instead of producing a link
 * that leads to an error page.
 */
export function buildAuthorizeUrl(config: TikTokConfig, state: string): string | null {
  if (!config.serviceId) return null;
  const params = new URLSearchParams({ service_id: config.serviceId, state });
  return `${config.authorizeBaseUrl}/open/authorize?${params.toString()}`;
}
