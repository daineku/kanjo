import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';

import { actorName, isSystem } from './actor';
import { audit } from './audit';
import { invalidateCatalog, loadSettings } from './catalog';
import { ensureInventoryItems, getStock, recordAdjustment } from './inventory';
import { addEvent, ORDER_STATUSES, transitionProblem, type OrderStatus } from './orders';
import { requestRevalidation } from './revalidate';
import { processRefundRequest } from './refunds';
import { hasQualifyingOrder } from './reviews';
import { CommerceError } from './util';
import { productPublishProblems } from './validation';

/**
 * Document Service middlewares: the rules that hold no matter which screen,
 * script or API made the change.
 *
 * Strapi Community Edition's admin RBAC decides WHO may open an editor. These
 * guards decide WHAT a change may do, which RBAC cannot express:
 *
 *   ORDERS        status moves only along the state machine; `paid` and
 *                 `refunded` are set by verified payment events only; line
 *                 items, totals and payment identifiers are immutable from
 *                 the admin; every change is written to the order history.
 *   REFUNDS       creating one moves the money first (./refunds.ts); a refund
 *                 record cannot be edited into a different amount or deleted.
 *   INVENTORY     `reserved` is the system's counter and cannot be typed into;
 *                 an `onHand` edit is recorded as an adjustment in the ledger.
 *   PRODUCTS      publishing is refused until ./validation.ts passes.
 *   REVIEWS       "verified purchase" is re-derived from orders on every edit;
 *                 it cannot be ticked on by hand.
 *   LEDGERS       payment events, order events, inventory movements and the
 *                 audit log cannot be created, edited or deleted from the
 *                 Content Manager at all.
 *
 * "From the admin" means a request to the Content Manager; the commerce code's
 * own writes (checkout, webhooks, jobs) run inside `runAsSystem` and pass.
 */

const LEDGERS = new Set([
  'api::payment-event.payment-event',
  'api::order-event.order-event',
  'api::inventory-movement.inventory-movement',
  'api::audit-log.audit-log',
  'api::tiktok-sync-job.tiktok-sync-job',
]);

const CATALOG_UIDS = new Set([
  'api::product.product',
  'api::category.category',
  'api::brand.brand',
  'api::vehicle.vehicle',
  'api::vehicle-make.vehicle-make',
  'api::shipping-zone.shipping-zone',
  'api::shipping-rate.shipping-rate',
  'api::store-setting.store-setting',
  'api::review.review',
  'api::store-page.store-page',
  'api::redirect.redirect',
]);

/** Fields of an order nobody may change by hand. */
const ORDER_IMMUTABLE = [
  'reference',
  'channel',
  'items',
  'currency',
  'subtotal',
  'discountTotal',
  'shippingTotal',
  'total',
  'refundedTotal',
  'paymentStatus',
  'paymentProvider',
  'paymentSessionId',
  'paymentIntentId',
  'paymentFee',
  'paymentFeeCurrency',
  'paidAt',
  'placedAt',
  'reservationExpiresAt',
  'stockState',
  'externalOrderId',
  'accessTokenHash',
  'termsAcceptedAt',
  'isTest',
  'email',
];

function fromAdmin(strapi: Core.Strapi): boolean {
  if (isSystem()) return false;
  try {
    const url = String((strapi as any).requestContext?.get?.()?.request?.url ?? '');
    return url.startsWith('/content-manager/');
  } catch {
    return false;
  }
}

const refuse = (message: string) => {
  throw new errors.ApplicationError(message);
};

async function enqueue(strapi: Core.Strapi, kind: string, subject: string) {
  try {
    const { enqueueTikTokJob } = await import('../tiktok/jobs');
    await enqueueTikTokJob(strapi, { kind: kind as any, subject, requestedBy: actorName(strapi) });
  } catch (error) {
    strapi.log.warn(`[guards] could not enqueue TikTok ${kind} for ${subject}: ${(error as Error).message}`);
  }
}

export function registerGuards(strapi: Core.Strapi) {
  strapi.documents.use((async (context: any, next: () => Promise<any>) => {
    const { uid, action } = context;
    const params = context.params ?? {};
    const admin = fromAdmin(strapi);

    // ── ledgers: append-only, system-written ────────────────────────────────
    if (admin && LEDGERS.has(uid) && ['create', 'update', 'delete', 'publish', 'unpublish', 'discardDraft'].includes(action)) {
      refuse('This log is written by the system and cannot be edited.');
    }

    // ── orders ──────────────────────────────────────────────────────────────
    if (uid === 'api::order.order' && admin) {
      if (action === 'delete') {
        const current: any = await strapi.documents(uid).findOne({ documentId: params.documentId } as any);
        if (current && !(current.isTest || (current.status === 'cancelled' && !current.paidAt))) {
          refuse('Orders are financial records and cannot be deleted. Cancel or refund it instead. (Test orders and never-paid cancelled orders can be deleted.)');
        }
      }
      if (action === 'create') {
        const data = params.data ?? {};
        if (data.channel !== 'manual') refuse('Orders created by hand must use the "manual" channel. Web and marketplace orders are created by checkout and import.');
        if (data.status && data.status !== 'pending_payment') refuse('A manual order starts as "pending_payment".');
      }
      if (action === 'update') return guardOrderUpdate(strapi, context, next);
    }

    // ── refunds ─────────────────────────────────────────────────────────────
    if (uid === 'api::refund.refund' && admin) {
      if (action === 'create') {
        try {
          params.data = await processRefundRequest(strapi, params.data ?? {});
        } catch (error) {
          if (error instanceof CommerceError) refuse(error.message);
          throw error;
        }
      } else if (action === 'delete') {
        refuse('Refund records cannot be deleted.');
      } else if (action === 'update') {
        // Only the free-text note may change after the money moved.
        const { note } = params.data ?? {};
        params.data = note === undefined ? {} : { note };
      }
    }

    // ── inventory ───────────────────────────────────────────────────────────
    let stockBefore: number | undefined;
    let skuForStock: string | undefined;
    if (uid === 'api::inventory-item.inventory-item' && admin) {
      const data = params.data ?? {};
      if (action === 'create') {
        data.reserved = 0;
      } else if (action === 'update') {
        delete data.reserved;
        delete data.sku; // the key the ledger and orders refer to
        const current: any = await strapi.documents(uid).findOne({ documentId: params.documentId } as any);
        if (current && data.onHand !== undefined && Number(data.onHand) !== current.onHand) {
          const row = (await getStock(strapi, [current.sku])).get(current.sku);
          if (row && Number(data.onHand) < row.reserved) {
            refuse(`${row.reserved} unit(s) of ${current.sku} are held by open checkouts; on hand cannot go below that.`);
          }
          stockBefore = current.onHand;
          skuForStock = current.sku;
        }
      } else if (action === 'delete') {
        const current: any = await strapi.documents(uid).findOne({ documentId: params.documentId } as any);
        if (current && (current.onHand > 0 || current.reserved > 0)) refuse('Set on hand to 0 (and wait for open checkouts) before deleting a stock record.');
      }
    }

    // ── products: publication rules ─────────────────────────────────────────
    if (uid === 'api::product.product' && action === 'publish') {
      await validateProductPublish(strapi, params.documentId);
    }

    // ── reviews: verified purchase is a fact, not a checkbox ────────────────
    if (uid === 'api::review.review' && admin && action === 'update') {
      const data = params.data ?? {};
      const current: any = await strapi.documents(uid).findOne({ documentId: params.documentId } as any);
      if (current) {
        delete data.email;
        delete data.productDocumentId;
        delete data.ipHash;
        if (data.verifiedPurchase === true && !current.verifiedPurchase) {
          const ref = await hasQualifyingOrder(strapi, current.email, current.productDocumentId, data.orderReference ?? current.orderReference);
          if (!ref) refuse('"Verified purchase" can only be set when a shipped or delivered order for this product exists for the reviewer\'s email.');
          data.orderReference = ref;
        }
        if (data.adminReply !== undefined && data.adminReply !== current.adminReply) data.adminRepliedAt = new Date().toISOString();
      }
    }

    // ── shipping rates: "verified" carries who and when ─────────────────────
    if (uid === 'api::shipping-rate.shipping-rate' && admin && (action === 'create' || action === 'update')) {
      const data = params.data ?? {};
      if (data.verified === true) {
        if (!data.verifiedSource && action === 'create') refuse('Record where the rate was verified (carrier tariff, contract, quote reference).');
        data.verifiedAt = data.verifiedAt ?? new Date().toISOString();
      }
    }

    // ── policy pages: legal sign-off carries a name ─────────────────────────
    if (uid === 'api::store-page.store-page' && admin && (action === 'create' || action === 'update')) {
      const data = params.data ?? {};
      if (data.legalReviewed === true && !data.legalReviewedBy) {
        const current: any = action === 'update' ? await strapi.documents(uid).findOne({ documentId: params.documentId } as any) : undefined;
        if (!current?.legalReviewedBy) refuse('Record who signed off this policy ("Legal reviewed by") before marking it reviewed.');
      }
    }

    // ── categories: no orphans ──────────────────────────────────────────────
    if (uid === 'api::category.category' && action === 'delete') {
      const products = await strapi.documents('api::product.product').count({ filters: { category: { documentId: params.documentId } } } as any);
      const children = await strapi.documents(uid).count({ filters: { parent: { documentId: params.documentId } } } as any);
      if (products > 0 || children > 0) {
        refuse(`This category still has ${products} product(s) and ${children} sub-categor${children === 1 ? 'y' : 'ies'}. Move them first, or set "hidden" instead.`);
      }
    }

    const result = await next();

    // ── after the write ─────────────────────────────────────────────────────
    if (CATALOG_UIDS.has(uid) && action !== 'findOne' && action !== 'findMany' && action !== 'findFirst' && action !== 'count') {
      invalidateCatalog();
      requestRevalidation(strapi, ['store-catalog']);
    }

    if (uid === 'api::product.product' && ['publish', 'unpublish', 'delete'].includes(action) && params.documentId) {
      await afterProductLifecycle(strapi, action, params.documentId);
    }

    if (skuForStock !== undefined && stockBefore !== undefined) {
      const after = Number(params.data.onHand);
      await recordAdjustment(strapi, skuForStock, after - stockBefore, 'Edited in the admin');
      await audit(strapi, {
        action: 'inventory.adjust',
        subjectType: 'inventory-item',
        subjectId: skuForStock,
        summary: `${skuForStock}: on hand ${stockBefore} → ${after}`,
      });
      invalidateCatalog();
      requestRevalidation(strapi, ['store-catalog']);
      await enqueue(strapi, 'inventory_update', skuForStock);
    }

    return result;
  }) as any);
}

async function validateProductPublish(strapi: Core.Strapi, documentId: string) {
  const draft: any = await strapi.documents('api::product.product').findOne({
    documentId,
    status: 'draft',
    populate: { category: true, brand: true, supplier: true, mainImage: true, gallery: true, variants: true, fitments: { populate: { vehicle: true } } },
  } as any);
  if (!draft) return;

  const settings = await loadSettings(strapi);
  const skus = [draft.sku, ...((draft.variants ?? []) as any[]).map((variant) => variant.sku)].filter(Boolean);
  const others: any[] = await strapi.documents('api::product.product').findMany({
    filters: { documentId: { $ne: documentId }, $or: [{ sku: { $in: skus } }, { variants: { sku: { $in: skus } } }] },
    populate: { variants: true },
    limit: 50,
  } as any);
  const inUse = new Set<string>();
  for (const other of others) {
    inUse.add(other.sku);
    for (const variant of other.variants ?? []) inUse.add(variant.sku);
  }

  const problems = productPublishProblems(draft, { storeCurrency: settings.currency, skusInUseElsewhere: inUse });
  if (problems.length > 0) {
    throw new errors.ApplicationError(`Cannot publish "${draft.name}":\n• ${problems.join('\n• ')}`, { problems });
  }
}

async function afterProductLifecycle(strapi: Core.Strapi, action: string, documentId: string) {
  if (action === 'publish') {
    const product: any = await strapi.documents('api::product.product').findOne({
      documentId,
      status: 'published',
      populate: { variants: true },
    } as any);
    if (product) {
      const variants: any[] = product.variants ?? [];
      await ensureInventoryItems(
        strapi,
        product,
        variants.length > 0 ? variants.map((variant) => ({ sku: variant.sku, label: variant.label })) : [{ sku: product.sku }],
      );
      requestRevalidation(strapi, ['store-catalog', `store-product-${product.slug}`]);
      await audit(strapi, { action: 'product.publish', subjectType: 'product', subjectId: documentId, summary: product.name });
      if (!product.isSample) await enqueue(strapi, 'product_upsert', documentId);
    }
  } else {
    await audit(strapi, { action: `product.${action}`, subjectType: 'product', subjectId: documentId });
    await enqueue(strapi, 'product_deactivate', documentId);
  }
}

async function guardOrderUpdate(strapi: Core.Strapi, context: any, next: () => Promise<unknown>) {
  const params = context.params;
  const data = params.data ?? {};
  const current: any = await strapi.documents('api::order.order').findOne({ documentId: params.documentId } as any);
  if (!current) return next();

  // The admin form resubmits every field, with its own formatting of decimals
  // and dates, so the financial fields are DROPPED from the edit rather than
  // compared: whatever the form sent, the stored record stands.
  for (const field of ORDER_IMMUTABLE) delete data[field];

  const from = current.status as OrderStatus;
  const to = (data.status ?? from) as OrderStatus;
  const merged = { ...current, ...data };
  if (!ORDER_STATUSES.includes(to)) refuse(`"${to}" is not an order status.`);
  const problem = transitionProblem(from, to, merged, false);
  if (problem) refuse(problem);

  if (to === 'shipped' && from !== 'shipped') data.shippedAt = data.shippedAt ?? new Date().toISOString();
  if (to === 'delivered' && from !== 'delivered') data.deliveredAt = data.deliveredAt ?? new Date().toISOString();
  if (to === 'paid' && from !== 'paid') data.paymentStatus = 'paid'; // manual channel only (checked above)

  const result = await next();

  const actor = actorName(strapi);
  if (to !== from) {
    await addEvent(strapi, current, { kind: 'status_changed', fromStatus: from, toStatus: to, actor, message: `Status changed by ${actor}.` });
  }
  if ((data.trackingNumber ?? current.trackingNumber) !== current.trackingNumber || (data.trackingUrl ?? current.trackingUrl) !== current.trackingUrl) {
    await addEvent(strapi, current, { kind: 'tracking', actor, message: `Tracking: ${data.trackingNumber ?? current.trackingNumber ?? '—'}` });
  }
  if (data.internalNotes !== undefined && data.internalNotes !== current.internalNotes) {
    await addEvent(strapi, current, { kind: 'note', actor, message: 'Internal notes updated.' });
  }
  if (data.shippingCostActual !== undefined && String(data.shippingCostActual) !== String(current.shippingCostActual)) {
    await audit(strapi, { action: 'order.shipping_cost', subjectType: 'order', subjectId: current.reference, summary: `Actual shipping cost set to ${data.shippingCostActual}` });
  }
  if (to === 'shipped' && from !== 'shipped' && current.channel === 'tiktok_shop') {
    await enqueue(strapi, 'fulfillment_update', current.reference);
  }
  return result;
}
