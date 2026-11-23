import type { Core } from '@strapi/strapi';

import { actorName, runAsSystem } from './actor';
import { audit } from './audit';
import { loadCatalogIndex, unitIndex } from './catalog';
import { addStock, getStock, sellUnreserved } from './inventory';
import { fromMinor, isCurrency, toMinor, type Currency } from './money';
import { cleanCountry, cleanEmail, cleanString, safeEqual, sha256, CommerceError, newOrderReference } from './util';

/**
 * Orders: the state machine, the history, and the customer's view.
 *
 * ── THE STATE MACHINE ───────────────────────────────────────────────────────
 *
 *   pending_payment → paid → processing ⇄ awaiting_supplier ⇄ manufacturing
 *                              ↘            ↓                  ↓
 *                                ready_to_ship → shipped → delivered
 *
 *   pending_payment → cancelled      (unpaid checkout expired or failed)
 *   any paid state  → refunded       (a FULL refund, set by the refund flow)
 *
 * Two transitions are never available to a person in the admin panel:
 * `→ paid` on a web order (only a verified payment event does that) and
 * `→ refunded` (only a refund that the processor confirmed does that). The
 * guard in ./guards.ts enforces both for edits made in the Content Manager.
 *
 * ── LINE ITEMS ARE A SNAPSHOT ───────────────────────────────────────────────
 *
 * An order line copies the name, SKU, price, weight and customs data at the
 * moment of sale. Renaming, repricing or deleting the product later changes
 * nothing about a past order. The guard strips `items` and the money fields
 * from any admin edit.
 */

export const ORDER_UID = 'api::order.order';
export const EVENT_UID = 'api::order-event.order-event';

export const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'processing',
  'awaiting_supplier',
  'manufacturing',
  'ready_to_ship',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const WORK: OrderStatus[] = ['processing', 'awaiting_supplier', 'manufacturing', 'ready_to_ship'];

export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['paid', 'cancelled'],
  paid: [...WORK, 'refunded'],
  processing: ['awaiting_supplier', 'manufacturing', 'ready_to_ship', 'refunded'],
  awaiting_supplier: ['processing', 'manufacturing', 'ready_to_ship', 'refunded'],
  manufacturing: ['processing', 'awaiting_supplier', 'ready_to_ship', 'refunded'],
  ready_to_ship: ['processing', 'shipped', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};

/** Transitions only the system may make. */
const SYSTEM_ONLY: OrderStatus[] = ['paid', 'refunded'];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || (TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Why a status change is refused, or undefined when it is allowed.
 * `order` is the record BEFORE the change, merged with the incoming fields.
 */
export function transitionProblem(
  from: OrderStatus,
  to: OrderStatus,
  order: { channel?: string; trackingNumber?: string | null; shippingCarrier?: string | null },
  bySystem: boolean,
): string | undefined {
  if (from === to) return undefined;
  if (!ORDER_STATUSES.includes(to)) return `"${to}" is not an order status.`;
  if (!canTransition(from, to)) {
    return `An order cannot go from "${from}" to "${to}". Allowed next: ${(TRANSITIONS[from] ?? []).join(', ') || 'none (final state)'}.`;
  }
  if (!bySystem && SYSTEM_ONLY.includes(to) && !(to === 'paid' && order.channel === 'manual')) {
    return to === 'paid'
      ? 'An order is marked paid by the payment processor, not by hand. (Only "manual" channel orders can be marked paid here.)'
      : 'An order becomes "refunded" when a full refund succeeds. Create a Refund entry instead.';
  }
  if (to === 'shipped' && !order.trackingNumber && order.shippingCarrier !== 'manual') {
    return 'Add a tracking number before marking the order shipped (or set the carrier to "manual" for an untracked hand-over).';
  }
  return undefined;
}

export async function addEvent(
  strapi: Core.Strapi,
  order: { documentId: string; reference: string },
  event: { kind: string; fromStatus?: string; toStatus?: string; message?: string; data?: Record<string, unknown>; actor?: string },
) {
  const actor = event.actor ?? actorName(strapi);
  await runAsSystem('order-event', () =>
    strapi.documents(EVENT_UID as any).create({
      data: {
        order: { connect: [order.documentId] },
        orderReference: order.reference,
        kind: event.kind,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        actor,
        message: event.message?.slice(0, 2000),
        data: event.data,
      } as any,
    }),
  );
}

export async function findOrderByReference(strapi: Core.Strapi, reference: string, populate: any = { items: true, shippingAddress: true }) {
  if (!/^[A-Z0-9-]{6,40}$/.test(reference)) return null;
  return (await strapi.documents(ORDER_UID as any).findFirst({ filters: { reference }, populate } as any)) as any;
}

export function ordersTable(strapi: Core.Strapi, trx?: any) {
  const query = (strapi.db as any).getConnection('orders');
  return trx ? query.transacting(trx) : query;
}

/** A unique order reference; retried on the (astronomically unlikely) collision. */
export async function allocateReference(strapi: Core.Strapi): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = newOrderReference();
    const taken = await strapi.documents(ORDER_UID as any).count({ filters: { reference } } as any);
    if (taken === 0) return reference;
  }
  throw new Error('Could not allocate an order reference.');
}

// ── the customer's view ─────────────────────────────────────────────────────

const STATUS_COPY: Record<OrderStatus, string> = {
  pending_payment: 'Awaiting payment',
  paid: 'Payment received',
  processing: 'Being prepared',
  awaiting_supplier: 'Awaiting the part from our supplier',
  manufacturing: 'Being manufactured',
  ready_to_ship: 'Packed and ready to ship',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

/**
 * The order as its customer may see it — built field by field. No email, no
 * street address (the customer already knows it; a leaked link should not
 * reveal it), no internal notes, no costs, no payment identifiers.
 */
export function publicOrder(order: any, events: any[]) {
  const currency = (isCurrency(order.currency) ? order.currency : 'USD') as Currency;
  const m = (value: unknown) => ({ amount: toMinor(value) ?? 0, currency });

  const timeline = events
    .filter((event) => ['created', 'status_changed', 'tracking'].includes(event.kind))
    .map((event) => ({
      at: event.createdAt,
      status: ORDER_STATUSES.includes(event.toStatus) ? event.toStatus : undefined,
      // Customer copy is generated here. The stored `message` is internal.
      message:
        event.kind === 'created'
          ? 'Order placed'
          : event.kind === 'tracking'
            ? 'Tracking details updated'
            : (STATUS_COPY[event.toStatus as OrderStatus] ?? 'Order updated'),
    }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));

  const address = order.shippingAddress ?? {};
  return {
    reference: order.reference,
    status: order.status,
    paymentStatus: order.paymentStatus,
    placedAt: order.placedAt ?? order.createdAt,
    currency,
    items: (order.items ?? []).map((item: any) => ({
      productName: item.productName,
      productSlug: item.productSlug || undefined,
      sku: item.sku,
      variantLabel: item.variantLabel || undefined,
      quantity: item.quantity,
      unitPrice: m(item.unitPrice),
      lineTotal: m(item.lineTotal),
    })),
    subtotal: m(order.subtotal),
    shippingTotal: m(order.shippingTotal),
    discountTotal: m(order.discountTotal),
    total: m(order.total),
    refundedTotal: m(order.refundedTotal),
    shipping: {
      name: address.name ?? order.customerName,
      city: address.city ?? '',
      region: address.region || undefined,
      postalCode: address.postalCode || undefined,
      country: address.country ?? '',
      carrier: order.shippingCarrier || undefined,
      service: order.shippingService || undefined,
      incoterm: order.incoterm || undefined,
      trackingNumber: order.trackingNumber || undefined,
      trackingUrl: safeTrackingUrl(order.trackingUrl),
      shippedAt: order.shippedAt || undefined,
      deliveredAt: order.deliveredAt || undefined,
    },
    timeline,
    isTest: order.isTest === true,
  };
}

function safeTrackingUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return /^https:\/\/[^\s]+$/.test(value) ? value : undefined;
}

/**
 * Looks an order up for its customer. Access needs the reference AND either
 * the bearer token issued at checkout or the order's email address. Every
 * failure is the same "not found", so the endpoint cannot be used to learn
 * whether a reference exists.
 */
export async function lookupOrder(strapi: Core.Strapi, input: { reference?: unknown; token?: unknown; email?: unknown }) {
  const reference = cleanString(input.reference, 40)?.toUpperCase();
  const notFound = new CommerceError('not_found', 'No order matches those details.', 404);
  if (!reference) throw notFound;

  const order = await findOrderByReference(strapi, reference, { items: true, shippingAddress: true });
  if (!order) throw notFound;

  const token = cleanString(input.token, 200);
  const email = cleanEmail(input.email);
  const byToken = Boolean(token && order.accessTokenHash && safeEqual(sha256(token), order.accessTokenHash));
  const byEmail = Boolean(email && order.email && safeEqual(email, String(order.email).toLowerCase()));
  if (!byToken && !byEmail) throw notFound;

  const events = await strapi.documents(EVENT_UID as any).findMany({
    filters: { orderReference: reference },
    sort: ['createdAt:asc'],
    limit: 200,
  } as any);
  return publicOrder(order, events);
}

// ── marketplace orders ──────────────────────────────────────────────────────

export type MarketplaceOrderInput = {
  channel: 'tiktok_shop';
  externalOrderId: string;
  status: 'paid' | 'cancelled';
  customerName: string;
  email?: string;
  address?: { name: string; line1: string; line2?: string; city: string; region?: string; postalCode?: string; country: string; phone?: string };
  currency: string;
  items: { sku: string; quantity: number; unitPriceMinor: number; productName: string; externalLineId?: string }[];
  shippingMinor: number;
  totalMinor: number;
  paidAt?: string;
};

/**
 * Records an order that was placed and PAID on a marketplace.
 *
 * Idempotent on (channel, externalOrderId): importing the same order twice
 * creates one order and takes stock once. The marketplace has already sold the
 * units, so stock is taken unconditionally — and when our record says there
 * were not enough, that is reported as a conflict (never hidden by letting the
 * counter go negative). A conflict means a person has to act: either the
 * marketplace buffer is too small or stock was miscounted.
 */
export async function importMarketplaceOrder(
  strapi: Core.Strapi,
  input: MarketplaceOrderInput,
): Promise<{ created: boolean; reference: string; conflicts: string[] }> {
  return runAsSystem(`marketplace:${input.channel}`, async () => {
    const existing: any = await strapi.documents(ORDER_UID as any).findFirst({
      filters: { channel: input.channel, externalOrderId: input.externalOrderId },
      populate: { items: true },
    } as any);

    if (existing) {
      if (input.status === 'cancelled' && !['cancelled', 'refunded', 'shipped', 'delivered'].includes(existing.status)) {
        await strapi.db.transaction(async ({ trx }) => {
          for (const item of existing.items ?? []) {
            if (item.fulfilmentType === 'in_stock') {
              await addStock(strapi, trx, item.sku, item.quantity, 'return', {
                orderReference: existing.reference,
                channel: input.channel,
                note: 'Marketplace order cancelled',
              });
            }
          }
          await strapi.documents(ORDER_UID as any).update({
            documentId: existing.documentId,
            data: { status: 'cancelled', stockState: 'released' } as any,
          });
          await addEvent(strapi, existing, {
            kind: 'status_changed',
            fromStatus: existing.status,
            toStatus: 'cancelled',
            message: 'Cancelled on the marketplace; stock returned.',
          });
        });
      }
      return { created: false, reference: existing.reference, conflicts: [] };
    }

    if (input.status === 'cancelled') {
      // Never seen and already cancelled: nothing to record, no stock to move.
      return { created: false, reference: '', conflicts: [] };
    }

    const index = await loadCatalogIndex(strapi);
    const units = unitIndex(index, await getStock(strapi, input.items.map((item) => item.sku)));
    const currency = isCurrency(input.currency) ? input.currency : index.settings.currency;
    const reference = await allocateReference(strapi);
    const conflicts: string[] = [];
    const subtotalMinor = input.items.reduce((sum, item) => sum + item.unitPriceMinor * item.quantity, 0);

    await strapi.db.transaction(async ({ trx }) => {
      for (const item of input.items) {
        const unit = units.get(item.sku);
        if (!unit) {
          conflicts.push(`${item.sku}: unknown SKU`);
          continue;
        }
        if (!unit.tracksStock) continue;
        const outcome = await sellUnreserved(strapi, trx, item.sku, item.quantity, 'marketplace_sale', {
          orderReference: reference,
          channel: input.channel,
        });
        if (outcome !== 'ok') conflicts.push(`${item.sku}: ${outcome}`);
      }

      const order: any = await strapi.documents(ORDER_UID as any).create({
        data: {
          reference,
          status: 'paid',
          channel: input.channel,
          email: cleanEmail(input.email),
          customerName: cleanString(input.customerName, 120) ?? 'Marketplace customer',
          shippingAddress: input.address
            ? { ...input.address, country: cleanCountry(input.address.country) ?? 'TH' }
            : undefined,
          items: input.items.map((item) => {
            const unit = units.get(item.sku);
            return {
              productDocumentId: unit?.productDocumentId,
              productSlug: unit?.productSlug,
              productName: unit?.productName ?? item.productName,
              sku: item.sku,
              variantLabel: unit?.variantLabel,
              categoryName: unit?.categoryName,
              quantity: item.quantity,
              unitPrice: fromMinor(item.unitPriceMinor),
              lineTotal: fromMinor(item.unitPriceMinor * item.quantity),
              unitCostEstimate: unit?.costPriceMinor !== undefined ? fromMinor(unit.costPriceMinor) : undefined,
              fulfilmentType: unit && !unit.tracksStock ? (unit.mode === 'made_to_order' ? 'made_to_order' : 'source_on_demand') : 'in_stock',
              weightGrams: unit?.weightGrams,
              hsCode: unit?.hsCode,
              countryOfOrigin: unit?.countryOfOrigin,
              externalLineId: item.externalLineId,
            };
          }),
          currency,
          subtotal: fromMinor(subtotalMinor),
          shippingTotal: fromMinor(input.shippingMinor),
          discountTotal: 0,
          total: fromMinor(input.totalMinor),
          refundedTotal: 0,
          paymentStatus: 'paid',
          paymentProvider: 'tiktok_shop',
          paidAt: input.paidAt ?? new Date().toISOString(),
          placedAt: input.paidAt ?? new Date().toISOString(),
          stockState: 'committed',
          externalOrderId: input.externalOrderId,
        } as any,
      });

      await addEvent(strapi, order, { kind: 'created', toStatus: 'paid', message: `Imported from ${input.channel} (${input.externalOrderId}).` });
      if (conflicts.length > 0) {
        await addEvent(strapi, order, {
          kind: 'stock',
          message: `STOCK CONFLICT on import: ${conflicts.join('; ')}. Check the count and the marketplace buffer.`,
          data: { conflicts },
        });
      }
    });

    if (conflicts.length > 0) {
      await audit(strapi, {
        action: 'inventory.marketplace_conflict',
        subjectType: 'order',
        subjectId: reference,
        summary: `Marketplace order ${input.externalOrderId} oversold: ${conflicts.join('; ')}`,
        data: { conflicts, channel: input.channel },
      });
    }
    return { created: true, reference, conflicts };
  });
}
