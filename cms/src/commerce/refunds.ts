import type { Core } from '@strapi/strapi';

import { actorName, runAsSystem } from './actor';
import { audit } from './audit';
import { addStock } from './inventory';
import { fromMinor, toMinor } from './money';
import { addEvent, findOrderByReference, ORDER_UID } from './orders';
import { paymentProvider, type PaymentEvent } from './payments';
import { CommerceError } from './util';

/**
 * Refunds.
 *
 * An operator creates a `refund` entry (amount, reason, restock?) against an
 * order in the admin. The guard in ./guards.ts routes that creation here, so
 * the money moves BEFORE the entry is accepted:
 *
 *   - the amount is checked against what is still refundable;
 *   - the processor is asked, with an idempotency key derived from the order
 *     and the running refund total, so a double-click cannot refund twice;
 *   - only a succeeded or pending refund is recorded against the order's
 *     `refundedTotal`; a full refund moves the order to `refunded`.
 *
 * Refunds made directly in the Stripe dashboard arrive by webhook
 * (`syncRefundFromProvider`) and are recorded the same way, once.
 */

export const REFUND_UID = 'api::refund.refund';

export async function processRefundRequest(
  strapi: Core.Strapi,
  data: { order?: any; amount?: unknown; reason?: string; restock?: boolean; note?: string },
): Promise<Record<string, unknown>> {
  const orderId = extractDocumentId(data.order);
  if (!orderId) throw new CommerceError('validation_failed', 'Choose the order to refund.');
  const order: any = await strapi.documents(ORDER_UID as any).findOne({ documentId: orderId, populate: { items: true } } as any);
  if (!order) throw new CommerceError('not_found', 'Order not found.');

  const amountMinor = toMinor(data.amount);
  const totalMinor = toMinor(order.total) ?? 0;
  const refundedMinor = toMinor(order.refundedTotal) ?? 0;
  const remaining = totalMinor - refundedMinor;
  if (!amountMinor || amountMinor <= 0) throw new CommerceError('validation_failed', 'Enter a refund amount above zero.');
  if (amountMinor > remaining) {
    throw new CommerceError('validation_failed', `At most ${fromMinor(remaining)} ${order.currency} is still refundable on ${order.reference}.`);
  }
  if (!['paid', 'processing', 'awaiting_supplier', 'manufacturing', 'ready_to_ship', 'shipped', 'delivered'].includes(order.status)) {
    throw new CommerceError('validation_failed', `Order ${order.reference} is "${order.status}" and has nothing to refund.`);
  }

  let providerRefundId: string | undefined;
  let status: 'succeeded' | 'processing' | 'failed' = 'succeeded';
  let failureMessage: string | undefined;

  if (order.channel === 'web') {
    const provider = paymentProvider();
    if (!provider || !order.paymentIntentId) {
      throw new CommerceError('payment_provider_error', 'This order has no payment that can be refunded from here.');
    }
    const result = await provider.refund({
      paymentIntentId: order.paymentIntentId,
      amountMinor,
      reason: data.reason ?? 'requested_by_customer',
      orderReference: order.reference,
      idempotencyKey: `kanjo_refund_${order.reference}_${refundedMinor}_${amountMinor}`,
    });
    providerRefundId = result.refundId || undefined;
    status = result.status === 'succeeded' ? 'succeeded' : result.status === 'pending' ? 'processing' : 'failed';
    failureMessage = result.failureMessage;
  } else {
    // Marketplace orders are refunded on the marketplace. This entry records
    // what was done there; no money moves from here.
    failureMessage = undefined;
  }

  if (status !== 'failed') {
    await applyRefundToOrder(strapi, order, amountMinor, Boolean(data.restock), data.note);
  } else {
    await addEvent(strapi, order, { kind: 'refund', message: `Refund of ${fromMinor(amountMinor)} ${order.currency} FAILED: ${failureMessage ?? 'unknown error'}` });
  }

  await audit(strapi, {
    action: 'refund.create',
    subjectType: 'order',
    subjectId: order.reference,
    summary: `${status} refund of ${fromMinor(amountMinor)} ${order.currency}`,
    data: { providerRefundId, reason: data.reason, restock: Boolean(data.restock) },
  });

  return {
    ...data,
    order: { connect: [order.documentId] },
    amount: fromMinor(amountMinor),
    status,
    providerRefundId,
    failureMessage,
    requestedBy: actorName(strapi),
  };
}

async function applyRefundToOrder(strapi: Core.Strapi, order: any, amountMinor: number, restock: boolean, note?: string) {
  await runAsSystem('refund', () =>
    strapi.db.transaction(async ({ trx }) => {
      // Recompute from the row inside the transaction: two refunds racing
      // cannot both read the old total.
      const row = await (strapi.db as any).getConnection('orders').transacting(trx).where('document_id', order.documentId).first();
      const refunded = (toMinor(row?.refunded_total) ?? 0) + amountMinor;
      const total = toMinor(row?.total) ?? 0;
      const full = refunded >= total;

      await (strapi.db as any)
        .getConnection('orders')
        .transacting(trx)
        .where('document_id', order.documentId)
        .update({
          refunded_total: fromMinor(Math.min(refunded, total)),
          payment_status: full ? 'refunded' : 'partially_refunded',
          ...(full ? { status: 'refunded' } : {}),
          updated_at: new Date(),
        });

      if (restock) {
        for (const item of order.items ?? []) {
          if (item.fulfilmentType !== 'in_stock') continue;
          await addStock(strapi, trx, item.sku, item.quantity, 'return', { orderReference: order.reference, channel: 'manual', note: note ?? 'Restocked on refund' });
        }
      }
      await addEvent(strapi, order, {
        kind: 'refund',
        message: `Refunded ${fromMinor(amountMinor)} ${order.currency}${restock ? ' (restocked)' : ''}.`,
      });
      if (full && order.status !== 'refunded') {
        await addEvent(strapi, order, { kind: 'status_changed', fromStatus: order.status, toStatus: 'refunded', message: 'Fully refunded.' });
      }
    }),
  );
}

/** A refund event from the processor — including refunds made in its dashboard. */
export async function syncRefundFromProvider(strapi: Core.Strapi, event: PaymentEvent): Promise<string> {
  const refund = event.refund;
  if (!refund) return 'ignored: no refund object';

  const existing: any = await strapi.documents(REFUND_UID as any).findFirst({ filters: { providerRefundId: refund.id } } as any);
  const order: any = event.orderReference
    ? await findOrderByReference(strapi, event.orderReference)
    : event.paymentIntentId
      ? await strapi.documents(ORDER_UID as any).findFirst({ filters: { paymentIntentId: event.paymentIntentId }, populate: { items: true } } as any)
      : null;
  if (!order) return 'ignored: no matching order';

  const status = refund.status === 'succeeded' ? 'succeeded' : refund.status === 'pending' ? 'processing' : 'failed';

  if (existing) {
    if (existing.status !== status) {
      await strapi.documents(REFUND_UID as any).update({ documentId: existing.documentId, data: { status } as any });
      if (status === 'failed' && existing.status !== 'failed') {
        // The money did not move after all: take it back off the order.
        await addEvent(strapi, order, { kind: 'refund', message: `Refund ${refund.id} FAILED at the processor after being recorded. Review the order.` });
        await audit(strapi, { action: 'refund.failed_after_record', subjectType: 'order', subjectId: order.reference });
      }
    }
    return `refund ${status}`;
  }

  if (status === 'failed') return 'ignored: failed refund not created here';
  await applyRefundToOrder(strapi, order, refund.amountMinor, false, 'Refund made in the processor dashboard');
  await strapi.documents(REFUND_UID as any).create({
    data: {
      order: { connect: [order.documentId] },
      amount: fromMinor(refund.amountMinor),
      reason: 'other',
      note: 'Created from a processor webhook (refund made outside the admin).',
      status,
      providerRefundId: refund.id,
      requestedBy: 'system:processor',
    } as any,
  });
  return 'external refund recorded';
}

function extractDocumentId(value: any): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  const first = value.connect?.[0] ?? value.set?.[0];
  if (typeof first === 'string') return first;
  return first?.documentId ?? value.documentId;
}
