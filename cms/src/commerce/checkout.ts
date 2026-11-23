import type { Core } from '@strapi/strapi';

import { runAsSystem } from './actor';
import { audit } from './audit';
import { quoteCart } from './cart';
import { commitReserved, release, reserve, sellUnreserved } from './inventory';
import { fromMinor } from './money';
import { addEvent, allocateReference, findOrderByReference, ORDER_UID } from './orders';
import { paymentProvider, type PaymentEvent } from './payments';
import { cleanCountry, cleanEmail, cleanString, CommerceError, newAccessToken, sha256 } from './util';

/**
 * Checkout and payment confirmation.
 *
 * ── ONE PASS, IN THIS ORDER ─────────────────────────────────────────────────
 *
 *   1. Re-quote the cart from the database (./cart.ts). If anything the
 *      customer was shown has moved — a price, a stock level, a shipping rate
 *      — refuse with `cart_changed` and the fresh quote. Never charge a
 *      number the customer did not see.
 *   2. In ONE transaction: reserve every tracked unit (a conditional UPDATE
 *      per SKU; see ./inventory.ts) and create the order with immutable line
 *      snapshots. One SKU short → the whole transaction rolls back.
 *   3. Create the processor's hosted checkout, expiring when the reservation
 *      does. If that call fails, release the reservation and cancel the order.
 *
 * ── PAYMENT IS CONFIRMED BY THE WEBHOOK, ONLY ───────────────────────────────
 *
 * The success page is a courtesy. An order becomes `paid` when a SIGNED event
 * says money moved, processed by `handlePaymentEvent`, which is idempotent at
 * two levels:
 *
 *   - the event id is recorded with a UNIQUE constraint before any work, so a
 *     redelivered event is acknowledged and skipped;
 *   - the order transition is a conditional UPDATE (`WHERE status =
 *     'pending_payment'`), so two DIFFERENT events for the same payment
 *     (completed + async_payment_succeeded) still commit stock exactly once.
 */

const MIN_EXPIRY_MINUTES = 31; // Stripe's own floor is 30 minutes.

type CheckoutInput = {
  items?: unknown;
  email?: unknown;
  address?: any;
  shippingOptionId?: unknown;
  customerNote?: unknown;
  acceptTerms?: unknown;
  successUrl?: unknown;
  cancelUrl?: unknown;
};

function validUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 500) return undefined;
  try {
    const url = new URL(value);
    if (url.search || url.hash) return undefined;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * The return URLs must point at the storefront. When STOREFRONT_ORIGIN is set
 * (it must be in production) anything else is refused, so the checkout cannot
 * be turned into an open redirect through the processor's hosted page.
 */
function allowedReturnUrl(value: unknown): string | undefined {
  const url = validUrl(value);
  if (!url) return undefined;
  const origin = (process.env.STOREFRONT_ORIGIN ?? '').trim().replace(/\/+$/, '');
  if (origin && new URL(url).origin !== origin) return undefined;
  return url;
}

export async function createCheckout(strapi: Core.Strapi, input: CheckoutInput) {
  const provider = paymentProvider();

  const fields: Record<string, string> = {};
  const email = cleanEmail(input.email);
  if (!email) fields.email = 'Enter a valid email address.';
  const a = input.address ?? {};
  const address = {
    name: cleanString(a.name, 120),
    line1: cleanString(a.line1, 160),
    line2: cleanString(a.line2, 160),
    city: cleanString(a.city, 100),
    region: cleanString(a.region, 100),
    postalCode: cleanString(a.postalCode, 20),
    country: cleanCountry(a.country),
    phone: cleanString(a.phone, 40),
  };
  if (!address.name) fields['address.name'] = 'Enter the recipient name.';
  if (!address.line1) fields['address.line1'] = 'Enter the street address.';
  if (!address.city) fields['address.city'] = 'Enter the city.';
  if (!address.country) fields['address.country'] = 'Choose a country.';
  if (input.acceptTerms !== true) fields.acceptTerms = 'Accept the Terms of Sale and the customs notice to continue.';
  const shippingOptionId = cleanString(input.shippingOptionId, 64);
  if (!shippingOptionId) fields.shippingOptionId = 'Choose a shipping option.';
  const successUrl = allowedReturnUrl(input.successUrl);
  const cancelUrl = allowedReturnUrl(input.cancelUrl);
  if (!successUrl || !cancelUrl) fields.returnUrls = 'Invalid return URLs.';
  if (Object.keys(fields).length > 0) {
    throw new CommerceError('validation_failed', 'Some details need attention.', 400, { fields });
  }

  const quote = await quoteCart(strapi, input.items, address.country);

  if (!quote.checkoutEnabled || !provider) {
    throw new CommerceError('checkout_disabled', quote.settings.checkoutDisabledMessage ?? 'Online checkout is not open yet.', 403);
  }
  if (quote.lines.some((line) => line.unit.isSample)) {
    // Belt and braces: samples are never served in production anyway.
    throw new CommerceError('validation_failed', 'Sample products cannot be purchased.', 400);
  }
  if (!quote.canCheckout || quote.lines.some((line) => line.quantity !== line.requestedQuantity)) {
    throw new CommerceError('cart_changed', 'Your cart changed since it was shown. Please review it.', 409, { quote });
  }
  const shipping = quote.shippingOptions.find((option) => option.id === shippingOptionId);
  if (!shipping) {
    throw new CommerceError('shipping_unavailable', 'That shipping option is no longer available for this destination.', 409, { quote });
  }

  const settings = quote.settings;
  const reference = await allocateReference(strapi);
  const accessToken = newAccessToken();
  const reservationMinutes = Math.max(MIN_EXPIRY_MINUTES, settings.reservationMinutes);
  const expiresAt = new Date(Date.now() + reservationMinutes * 60_000);
  const totalMinor = quote.subtotalMinor + shipping.price.amount;

  const order: any = await runAsSystem('checkout', () =>
    strapi.db.transaction(async ({ trx }) => {
      for (const line of quote.lines) {
        if (!line.unit.tracksStock) continue;
        const held = await reserve(strapi, trx, line.unit.sku, line.quantity, { orderReference: reference, channel: 'web' });
        if (!held) {
          // Throwing rolls back every reservation made above.
          throw new CommerceError('out_of_stock', `${line.unit.productName} has just sold out.`, 409, { sku: line.unit.sku });
        }
      }

      const created: any = await strapi.documents(ORDER_UID as any).create({
        data: {
          reference,
          status: 'pending_payment',
          channel: 'web',
          email,
          customerName: address.name,
          shippingAddress: address,
          items: quote.lines.map((line) => ({
            productDocumentId: line.unit.productDocumentId,
            productSlug: line.unit.productSlug,
            productName: line.unit.productName,
            sku: line.unit.sku,
            variantLabel: line.unit.variantLabel,
            categoryName: line.unit.categoryName,
            quantity: line.quantity,
            unitPrice: fromMinor(line.unit.price!.amount),
            listUnitPrice: line.unit.compareAtPrice ? fromMinor(line.unit.compareAtPrice.amount) : undefined,
            lineTotal: fromMinor(line.unit.price!.amount * line.quantity),
            unitCostEstimate: line.unit.costPriceMinor !== undefined ? fromMinor(line.unit.costPriceMinor) : undefined,
            fulfilmentType: line.unit.tracksStock ? 'in_stock' : line.unit.mode === 'made_to_order' ? 'made_to_order' : 'source_on_demand',
            weightGrams: line.unit.weightGrams,
            hsCode: line.unit.hsCode,
            countryOfOrigin: line.unit.countryOfOrigin,
          })),
          currency: quote.currency,
          subtotal: fromMinor(quote.subtotalMinor),
          discountTotal: 0,
          shippingTotal: fromMinor(shipping.price.amount),
          total: fromMinor(totalMinor),
          refundedTotal: 0,
          paymentStatus: 'unpaid',
          paymentProvider: provider.id,
          placedAt: new Date().toISOString(),
          reservationExpiresAt: expiresAt.toISOString(),
          stockState: quote.lines.some((line) => line.unit.tracksStock) ? 'reserved' : 'none',
          shippingCarrier: shipping.carrier,
          shippingService: shipping.serviceName,
          incoterm: shipping.incoterm,
          shippingZoneCode: shipping.zoneCode,
          totalWeightGrams: quote.totalWeightGrams,
          customerNote: cleanString(input.customerNote, 1000),
          accessTokenHash: sha256(accessToken),
          termsAcceptedAt: new Date().toISOString(),
          isTest: provider.testMode,
        } as any,
      });
      await addEvent(strapi, created, { kind: 'created', toStatus: 'pending_payment', message: 'Checkout started.' });
      return created;
    }),
  );

  const withRef = (url: string) => `${url}?ref=${encodeURIComponent(reference)}`;
  try {
    const session = await provider.createCheckoutSession({
      reference,
      email: email!,
      currency: quote.currency,
      lines: quote.lines.map((line) => ({
        name: line.unit.variantLabel ? `${line.unit.productName} — ${line.unit.variantLabel}` : line.unit.productName,
        sku: line.unit.sku,
        quantity: line.quantity,
        unitAmountMinor: line.unit.price!.amount,
      })),
      shipping: { label: `${shipping.serviceName} (${shipping.incoterm})`, amountMinor: shipping.price.amount },
      successUrl: withRef(successUrl!),
      cancelUrl: withRef(cancelUrl!),
      expiresAt: Math.floor(expiresAt.getTime() / 1000),
    });
    await runAsSystem('checkout', () =>
      strapi.documents(ORDER_UID as any).update({
        documentId: order.documentId,
        data: { paymentSessionId: session.sessionId, paymentStatus: 'pending' } as any,
      }),
    );
    return { reference, accessToken, checkoutUrl: session.url };
  } catch (error) {
    strapi.log.error(`[checkout] ${reference}: payment provider refused the session: ${(error as Error).message}`);
    await cancelUnpaid(strapi, reference, 'The payment provider could not open a checkout.');
    throw new CommerceError('payment_provider_error', 'Payment could not be started. Nothing was charged; please try again.', 502);
  }
}

/**
 * Cancels an unpaid order and returns its reserved units. Safe to call any
 * number of times and from any path (expiry webhook, failure, sweeper):
 * the conditional UPDATE lets exactly one caller through.
 */
export async function cancelUnpaid(strapi: Core.Strapi, reference: string, reason: string): Promise<boolean> {
  return runAsSystem('payment', async () => {
    const order = await findOrderByReference(strapi, reference);
    if (!order || order.status !== 'pending_payment') return false;

    return strapi.db.transaction(async ({ trx }) => {
      const claimed = await (strapi.db as any)
        .getConnection('orders')
        .transacting(trx)
        .where({ document_id: order.documentId, status: 'pending_payment' })
        .update({ status: 'cancelled', payment_status: 'failed', stock_state: 'released', updated_at: new Date() });
      if (Number(claimed) === 0) return false;

      if (order.stockState === 'reserved') {
        for (const item of order.items ?? []) {
          if (item.fulfilmentType !== 'in_stock') continue;
          await release(strapi, trx, item.sku, item.quantity, { orderReference: reference, channel: 'web', note: reason });
        }
      }
      await addEvent(strapi, order, { kind: 'status_changed', fromStatus: 'pending_payment', toStatus: 'cancelled', message: reason });
      return true;
    });
  });
}

/** Marks an order paid and turns its reservation into a sale. Exactly once. */
async function markPaid(strapi: Core.Strapi, event: PaymentEvent): Promise<string> {
  const order = event.orderReference ? await findOrderByReference(strapi, event.orderReference) : null;
  if (!order) return 'no matching order';
  if (order.channel !== 'web') return 'not a web order';

  if (event.amountMinor !== undefined) {
    const expected = Math.round(Number(order.total) * 100);
    if (event.amountMinor !== expected || (event.currency && event.currency !== order.currency)) {
      // Money arrived that does not match the order. Record it loudly and do
      // not fulfil: a person decides.
      await addEvent(strapi, order, {
        kind: 'payment',
        message: `AMOUNT MISMATCH: paid ${event.amountMinor} ${event.currency}, order total ${expected} ${order.currency}. Not fulfilled.`,
        data: { eventId: event.id },
      });
      await audit(strapi, { action: 'payment.amount_mismatch', subjectType: 'order', subjectId: order.reference });
      return 'amount mismatch';
    }
  }

  const fromStatus = order.status;
  if (fromStatus !== 'pending_payment' && fromStatus !== 'cancelled') return `already ${fromStatus}`;

  const conflicts: string[] = [];
  const done = await strapi.db.transaction(async ({ trx }) => {
    const claimed = await (strapi.db as any)
      .getConnection('orders')
      .transacting(trx)
      .where({ document_id: order.documentId, status: fromStatus })
      .update({
        status: 'paid',
        payment_status: 'paid',
        stock_state: 'committed',
        paid_at: new Date(),
        payment_intent_id: event.paymentIntentId ?? null,
        updated_at: new Date(),
      });
    if (Number(claimed) === 0) return false;

    for (const item of order.items ?? []) {
      if (item.fulfilmentType !== 'in_stock') continue;
      const context = { orderReference: order.reference, channel: 'web' as const };
      if (fromStatus === 'pending_payment' && order.stockState === 'reserved') {
        if (await commitReserved(strapi, trx, item.sku, item.quantity, context)) continue;
      }
      // The reservation is gone — the checkout expired and was released, and
      // then the payment arrived anyway. The customer has paid, so the sale
      // stands; whether units remain is reported, not assumed.
      const outcome = await sellUnreserved(strapi, trx, item.sku, item.quantity, 'sale', context);
      if (outcome !== 'ok') conflicts.push(`${item.sku}: ${outcome}`);
    }

    // Popularity for sorting only; never displayed. Raw SQL on BOTH product
    // rows (draft and published share document_id) so a later publish keeps it.
    for (const item of order.items ?? []) {
      if (!item.productDocumentId) continue;
      await (strapi.db as any)
        .getConnection('products')
        .transacting(trx)
        .where('document_id', item.productDocumentId)
        .update({ units_sold: strapi.db.connection.raw('COALESCE(units_sold, 0) + ?', [item.quantity]) });
    }

    await addEvent(strapi, order, {
      kind: 'status_changed',
      fromStatus,
      toStatus: 'paid',
      message: fromStatus === 'cancelled' ? 'Payment arrived after the checkout had expired; order reinstated.' : 'Payment confirmed.',
      data: { eventId: event.id, paymentIntentId: event.paymentIntentId },
    });
    if (conflicts.length > 0) {
      await addEvent(strapi, order, { kind: 'stock', message: `STOCK CONFLICT: ${conflicts.join('; ')}. Contact the customer.`, data: { conflicts } });
    }
    return true;
  });

  if (!done) return 'already processed';
  if (conflicts.length > 0) {
    await audit(strapi, { action: 'inventory.oversold_on_payment', subjectType: 'order', subjectId: order.reference, data: { conflicts } });
  }
  await fetchFee(strapi, order.reference).catch(() => undefined);
  return conflicts.length > 0 ? 'paid with stock conflict' : 'paid';
}

/** Records the ACTUAL processor fee once the processor reports it. */
export async function fetchFee(strapi: Core.Strapi, reference: string): Promise<void> {
  const provider = paymentProvider();
  const order = await findOrderByReference(strapi, reference);
  if (!provider || !order?.paymentIntentId || order.paymentFee !== null && order.paymentFee !== undefined) return;
  const fee = await provider.getFee(order.paymentIntentId);
  if (!fee) return;
  await runAsSystem('payment', () =>
    strapi.documents(ORDER_UID as any).update({
      documentId: order.documentId,
      data: { paymentFee: fromMinor(fee.feeMinor), paymentFeeCurrency: fee.currency } as any,
    }),
  );
}

const EVENT_LOG = 'api::payment-event.payment-event';

/**
 * Processes one verified payment event. Returns a short outcome for the log.
 * Throws only on an unexpected failure — the controller then answers 500 and
 * the processor retries, which is correct because nothing was committed.
 */
export async function handlePaymentEvent(strapi: Core.Strapi, providerId: 'stripe' | 'mock', event: PaymentEvent): Promise<string> {
  const provider = paymentProvider();
  if (provider && !provider.testMode && !event.livemode) return 'ignored: test event on a live account';

  // 1. Claim the event id. The UNIQUE constraint makes the second delivery fail here.
  let logEntry: any;
  try {
    logEntry = await strapi.documents(EVENT_LOG as any).create({
      data: {
        provider: providerId,
        eventId: event.id,
        eventType: event.rawType,
        orderReference: event.orderReference,
        outcome: 'processing',
        livemode: event.livemode,
      } as any,
    });
  } catch {
    const existing: any = await strapi.documents(EVENT_LOG as any).findFirst({ filters: { eventId: event.id } } as any);
    // A previous attempt that FAILED is retried; anything else is a duplicate.
    if (!existing || existing.outcome !== 'failed') return 'duplicate';
    logEntry = existing;
  }

  try {
    const outcome = await runAsSystem('payment', () => dispatch(strapi, event));
    await strapi.documents(EVENT_LOG as any).update({
      documentId: logEntry.documentId,
      data: { outcome: outcome.startsWith('ignored') ? 'ignored' : 'processed', message: outcome } as any,
    });
    return outcome;
  } catch (error) {
    await strapi.documents(EVENT_LOG as any).update({
      documentId: logEntry.documentId,
      data: { outcome: 'failed', message: (error as Error).message.slice(0, 2000) } as any,
    });
    throw error;
  }
}

async function dispatch(strapi: Core.Strapi, event: PaymentEvent): Promise<string> {
  switch (event.kind) {
    case 'paid':
      return markPaid(strapi, event);
    case 'pending': {
      const order = event.orderReference ? await findOrderByReference(strapi, event.orderReference) : null;
      if (!order) return 'no matching order';
      await addEvent(strapi, order, { kind: 'payment', message: 'Delayed payment method: awaiting funds. Do not fulfil yet.' });
      return 'pending';
    }
    case 'failed':
    case 'expired': {
      if (!event.orderReference) return 'ignored: no reference';
      const cancelled = await cancelUnpaid(
        strapi,
        event.orderReference,
        event.kind === 'expired' ? 'Checkout expired unpaid; stock released.' : 'Payment failed; stock released.',
      );
      return cancelled ? event.kind : `ignored: order not pending`;
    }
    case 'refund': {
      const { syncRefundFromProvider } = await import('./refunds');
      return syncRefundFromProvider(strapi, event);
    }
    case 'fee_ready': {
      const order = event.orderReference
        ? await findOrderByReference(strapi, event.orderReference)
        : event.paymentIntentId
          ? ((await strapi.documents(ORDER_UID as any).findFirst({ filters: { paymentIntentId: event.paymentIntentId } } as any)) as any)
          : null;
      if (!order) return 'ignored: no order';
      await fetchFee(strapi, order.reference);
      return 'fee recorded';
    }
    case 'dispute': {
      const order: any = event.paymentIntentId
        ? await strapi.documents(ORDER_UID as any).findFirst({ filters: { paymentIntentId: event.paymentIntentId } } as any)
        : null;
      if (order) {
        await addEvent(strapi, order, { kind: 'payment', message: 'DISPUTE OPENED by the cardholder. Respond in the Stripe dashboard.' });
      }
      await audit(strapi, { action: 'payment.dispute', subjectType: 'order', subjectId: order?.reference, summary: 'Chargeback opened.' });
      return 'dispute recorded';
    }
    default:
      return `ignored: ${event.rawType}`;
  }
}

/**
 * The sweeper. A webhook can be lost; a reservation must not be. Runs on a
 * cron and cancels unpaid orders whose reservation window has passed — after
 * asking the processor to expire the session, so a customer cannot pay a
 * session whose stock has just been released. (If they somehow still do,
 * `markPaid` reinstates the order and reports any stock conflict.)
 */
export async function sweepExpiredReservations(strapi: Core.Strapi): Promise<number> {
  const provider = paymentProvider();
  const grace = 5 * 60_000;
  const stale: any[] = await strapi.documents(ORDER_UID as any).findMany({
    filters: { status: 'pending_payment', reservationExpiresAt: { $lt: new Date(Date.now() - grace).toISOString() } },
    limit: 100,
  } as any);
  let count = 0;
  for (const order of stale) {
    if (provider && order.paymentSessionId) await provider.expireCheckoutSession(order.paymentSessionId);
    if (await cancelUnpaid(strapi, order.reference, 'Reservation expired without payment; stock released.')) count += 1;
  }
  return count;
}
