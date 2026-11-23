import type { Core } from '@strapi/strapi';

import { runAsSystem } from '../commerce/actor';
import { audit } from '../commerce/audit';
import { readTikTokConfig } from './config';
import { clearTokens, getConnection } from './connection';
import { enqueueTikTokJob } from './jobs';
import { listingsForProduct, updateListing } from './listings';
import { verifyWebhookSignature } from './sign';

/**
 * The TikTok Shop webhook receiver.
 *
 * Order of operations is the security property:
 *   1. No configuration → 404. An unconfigured deployment has no webhook.
 *   2. Verify the signature over the RAW body, constant-time. Fail → 401.
 *   3. Only then parse JSON.
 *   4. Check the event is for OUR authorized shop.
 *   5. Dedupe on `tts_notification_id` (delivery is at-least-once).
 *   6. Queue work and answer 200 immediately — TikTok expects an answer within
 *      a few seconds, so nothing slow happens in the request.
 *
 * The event is a NUDGE, not data: an order webhook queues an import of that
 * order id, and the job reads the order from the API. Nothing in a webhook
 * body is written into an order.
 */

const EVENT_UID = 'api::payment-event.payment-event';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const docs = (strapi: Core.Strapi, uid: string): any => (strapi as any).documents(uid);

// Event type numbers: from a secondary event catalogue; types 6 and 7 are
// confirmed by the official doc tree. Unknown types are acknowledged and ignored.
export const TIKTOK_EVENT = {
  ORDER_STATUS_CHANGE: 1,
  PACKAGE_UPDATE: 4,
  PRODUCT_STATUS_CHANGE: 5,
  SELLER_DEAUTHORIZATION: 6,
  UPCOMING_AUTHORIZATION_EXPIRATION: 7,
  CANCELLATION_STATUS_CHANGE: 11,
  RETURN_STATUS_CHANGE: 12,
  PRODUCT_AUDIT_STATUS_CHANGE: 37,
} as const;

export type WebhookResult = { status: number; body: Record<string, unknown> };

type WebhookEvent = {
  type?: number;
  tts_notification_id?: string;
  shop_id?: string;
  timestamp?: number;
  data?: Record<string, unknown>;
};

const text = (value: unknown): string => (value == null ? '' : String(value));

const PRODUCT_STATUS: Record<string, string> = {
  LIVE: 'live',
  ACTIVATE: 'live',
  ACTIVATED: 'live',
  PENDING: 'pending',
  AUDITING: 'pending',
  FAILED: 'rejected',
  AUDIT_FAILED: 'rejected',
  REJECTED: 'rejected',
  SELLER_DEACTIVATED: 'deactivated',
  PLATFORM_DEACTIVATED: 'deactivated',
  DEACTIVATED: 'deactivated',
  FREEZE: 'deactivated',
};

export async function handleTikTokWebhook(
  strapi: Core.Strapi,
  input: { rawBody: string | undefined; authorizationHeader: string | undefined | null },
): Promise<WebhookResult> {
  const config = readTikTokConfig();
  if (!config) return { status: 404, body: { error: 'not_found' } };

  if (typeof input.rawBody !== 'string' || input.rawBody.length === 0) {
    return { status: 400, body: { error: 'empty_body' } };
  }
  if (!verifyWebhookSignature(config.appKey, config.appSecret, input.rawBody, input.authorizationHeader)) {
    return { status: 401, body: { error: 'invalid_signature' } };
  }

  let event: WebhookEvent;
  try {
    event = JSON.parse(input.rawBody) as WebhookEvent;
  } catch {
    return { status: 400, body: { error: 'invalid_json' } };
  }

  const notificationId = text(event.tts_notification_id);
  if (!notificationId || typeof event.type !== 'number') {
    return { status: 400, body: { error: 'malformed_event' } };
  }

  const connection = await getConnection(strapi);
  if (connection.shopId && event.shop_id && text(event.shop_id) !== connection.shopId) {
    // Signed by our app but for a shop we are not connected to. Acknowledge so
    // TikTok stops retrying; do nothing.
    return { status: 200, body: { received: true, ignored: 'other_shop' } };
  }

  // Dedupe. The unique index on eventId is what makes this race-safe: two
  // simultaneous deliveries cannot both insert.
  const eventId = `tts:${notificationId}`;
  const seen = await docs(strapi, EVENT_UID).findFirst({ filters: { eventId: { $eq: eventId } } });
  if (seen) return { status: 200, body: { received: true, duplicate: true } };

  let logged: { documentId: string };
  try {
    logged = await docs(strapi, EVENT_UID).create({
      data: {
        provider: 'tiktok_shop',
        eventId,
        eventType: `tiktok.${event.type}`,
        outcome: 'processing',
        livemode: true,
      },
    });
  } catch {
    return { status: 200, body: { received: true, duplicate: true } };
  }

  let outcome: 'processed' | 'ignored' | 'failed' = 'processed';
  let message = '';
  let orderReference: string | undefined;

  try {
    const data = event.data ?? {};
    await runAsSystem('tiktok:webhook', async () => {
      switch (event.type) {
        case TIKTOK_EVENT.ORDER_STATUS_CHANGE:
        case TIKTOK_EVENT.CANCELLATION_STATUS_CHANGE: {
          const orderId = text(data.order_id);
          if (!orderId) {
            outcome = 'ignored';
            message = 'No order_id in the event';
            break;
          }
          orderReference = orderId;
          await enqueueTikTokJob(strapi, { kind: 'order_import', subject: orderId, requestedBy: 'tiktok-webhook' });
          message = `Queued import of order ${orderId}`;
          break;
        }
        case TIKTOK_EVENT.PRODUCT_STATUS_CHANGE:
        case TIKTOK_EVENT.PRODUCT_AUDIT_STATUS_CHANGE: {
          const productId = text(data.product_id);
          const status = PRODUCT_STATUS[text(data.status ?? data.audit_status).toUpperCase()];
          if (!productId || !status) {
            outcome = 'ignored';
            message = 'Product event without a recognised status';
            break;
          }
          const rows = (await docs(strapi, 'api::tiktok-listing.tiktok-listing').findMany({
            filters: { tiktokProductId: { $eq: productId } },
            limit: 100,
          })) as { documentId: string }[];
          const reason = text(data.suspended_reason ?? data.reason);
          for (const row of rows) {
            await updateListing(strapi, row.documentId, {
              listingStatus: status,
              ...(status === 'rejected' ? { lastError: reason || 'Rejected by TikTok Shop review' } : {}),
            });
          }
          message = `Listing ${productId} → ${status} (${rows.length} SKU rows)`;
          break;
        }
        case TIKTOK_EVENT.SELLER_DEAUTHORIZATION: {
          await clearTokens(
            strapi,
            'awaiting_authorization',
            'The seller removed this app’s authorization in TikTok Shop. Authorize again to resume.',
          );
          await audit(strapi, {
            action: 'tiktok.deauthorized',
            actor: 'tiktok-webhook',
            subjectType: 'tiktok-connection',
            summary: 'Seller deauthorization webhook received; stored tokens were erased',
          });
          message = 'Connection reset';
          break;
        }
        case TIKTOK_EVENT.UPCOMING_AUTHORIZATION_EXPIRATION: {
          await enqueueTikTokJob(strapi, { kind: 'token_refresh', subject: 'connection', requestedBy: 'tiktok-webhook' });
          message = 'Queued token refresh';
          break;
        }
        default:
          outcome = 'ignored';
          message = `Event type ${event.type} is not handled`;
      }
    });
  } catch (error) {
    outcome = 'failed';
    message = (error as Error).message.slice(0, 1000);
    strapi.log.error(`[tiktok] webhook ${eventId} failed: ${message}`);
  }

  await docs(strapi, EVENT_UID).update({
    documentId: logged.documentId,
    data: { outcome, message, ...(orderReference ? { orderReference } : {}) },
  });

  // Acknowledged either way: the event is logged, and the periodic poll is the
  // safety net for anything a failed handler missed.
  return { status: 200, body: { received: true } };
}

/** Re-exported for the product listing page: which rows belong to a product. */
export { listingsForProduct };
