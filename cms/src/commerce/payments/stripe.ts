import Stripe from 'stripe';

import type {
  CheckoutSession,
  CheckoutSessionInput,
  PaymentEvent,
  PaymentProvider,
  RefundResult,
} from './types';
import { WebhookSignatureError } from './types';

/**
 * Stripe Checkout, for a merchant account held by the operating partner in
 * Thailand.
 *
 * What that account implies, and how this file accounts for it:
 *
 *   - It can CHARGE in the store currency (USD/EUR/GBP/…) but SETTLES in THB,
 *     so the processor fee comes back in THB. `getFee` returns the fee with
 *     its own currency and the order stores both; nothing converts it.
 *   - One Checkout Session is one currency. The cart is single-currency by
 *     construction (../catalog.ts refuses to price a product in another one).
 *
 * Prices are sent as `price_data` built from OUR database at the moment of
 * checkout — there are no Stripe Price objects to drift out of step with the
 * catalogue, and nothing the browser sent is in this request.
 *
 * The secret key lives in the server environment only. It is never logged and
 * never returned from any endpoint.
 */

const REFUND_REASONS = new Set(['duplicate', 'fraudulent', 'requested_by_customer']);

export function createStripeProvider(options: {
  secretKey: string;
  webhookSecret: string;
  testMode: boolean;
}): PaymentProvider {
  // No apiVersion override: the SDK pins the version it was built and typed
  // against. Set the webhook endpoint's API version to match in the dashboard.
  const stripe = new Stripe(options.secretKey, {
    maxNetworkRetries: 2,
    timeout: 20_000,
    appInfo: { name: 'thekanjo-parts' },
  });

  return {
    id: 'stripe',
    testMode: options.testMode,

    async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession> {
      const currency = input.currency.toLowerCase();
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          customer_email: input.email,
          client_reference_id: input.reference,
          line_items: input.lines.map((line) => ({
            quantity: line.quantity,
            price_data: {
              currency,
              unit_amount: line.unitAmountMinor,
              product_data: { name: line.name, metadata: { sku: line.sku } },
            },
          })),
          shipping_options: [
            {
              shipping_rate_data: {
                type: 'fixed_amount',
                display_name: input.shipping.label,
                fixed_amount: { amount: input.shipping.amountMinor, currency },
              },
            },
          ],
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          expires_at: input.expiresAt,
          metadata: { order_reference: input.reference },
          payment_intent_data: {
            description: `The Kanjo Parts order ${input.reference}`,
            metadata: { order_reference: input.reference },
          },
        } as any,
        // A retried request for the same order returns the same session
        // instead of opening a second one.
        { idempotencyKey: `kanjo_checkout_${input.reference}` },
      );
      if (!session.url) throw new Error('Stripe returned a Checkout Session without a URL.');
      return { sessionId: session.id, url: session.url };
    },

    async expireCheckoutSession(sessionId: string): Promise<void> {
      try {
        await stripe.checkout.sessions.expire(sessionId);
      } catch (error) {
        // "Already expired" and "already completed" both land here. Neither is
        // a problem for the caller, which only wants the session to be unusable.
        const code = (error as any)?.code ?? (error as any)?.raw?.code;
        if (code && code !== 'resource_missing') return;
      }
    },

    async refund(input): Promise<RefundResult> {
      try {
        const refund = await stripe.refunds.create(
          {
            payment_intent: input.paymentIntentId,
            amount: input.amountMinor,
            ...(REFUND_REASONS.has(input.reason) ? { reason: input.reason as any } : {}),
            metadata: { order_reference: input.orderReference, kanjo_reason: input.reason },
          },
          { idempotencyKey: input.idempotencyKey },
        );
        const status = refund.status === 'succeeded' ? 'succeeded' : refund.status === 'failed' || refund.status === 'canceled' ? 'failed' : 'pending';
        return { refundId: refund.id, status, failureMessage: (refund as any).failure_reason ?? undefined };
      } catch (error) {
        return { refundId: '', status: 'failed', failureMessage: (error as Error).message };
      }
    },

    async getFee(paymentIntentId: string) {
      const intent: any = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['latest_charge.balance_transaction'],
      });
      const transaction = intent?.latest_charge?.balance_transaction;
      // Null straight after a successful payment: Stripe creates the balance
      // transaction asynchronously. `charge.updated` says when it is ready.
      if (!transaction || typeof transaction === 'string' || typeof transaction.fee !== 'number') return null;
      return { feeMinor: transaction.fee, currency: String(transaction.currency).toUpperCase() };
    },

    verifyWebhook(rawBody, headers): PaymentEvent {
      const signature = headers['stripe-signature'];
      if (typeof signature !== 'string' || signature === '') {
        throw new WebhookSignatureError('Missing Stripe-Signature header.');
      }
      let event: any;
      try {
        // Verified over the RAW bytes. A re-serialised body does not verify.
        event = stripe.webhooks.constructEvent(rawBody, signature, options.webhookSecret);
      } catch (error) {
        throw new WebhookSignatureError((error as Error).message);
      }
      return normalizeStripeEvent(event);
    },
  };
}

/** Exported for the tests, which feed it recorded-shape event objects. */
export function normalizeStripeEvent(event: any): PaymentEvent {
  const object = event?.data?.object ?? {};
  const base = { id: String(event.id), rawType: String(event.type), livemode: event.livemode === true };
  const id = (value: unknown) => (typeof value === 'string' ? value : (value as any)?.id);

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const paid = object.payment_status === 'paid' || object.payment_status === 'no_payment_required';
      return {
        ...base,
        // `completed` with payment_status "unpaid" is a delayed payment method:
        // the customer finished the form, the money has not arrived.
        kind: paid ? 'paid' : 'pending',
        orderReference: object.metadata?.order_reference ?? object.client_reference_id ?? undefined,
        sessionId: object.id,
        paymentIntentId: id(object.payment_intent),
        amountMinor: object.amount_total ?? undefined,
        currency: object.currency ? String(object.currency).toUpperCase() : undefined,
      };
    }
    case 'checkout.session.async_payment_failed':
    case 'checkout.session.expired':
      return {
        ...base,
        kind: event.type === 'checkout.session.expired' ? 'expired' : 'failed',
        orderReference: object.metadata?.order_reference ?? object.client_reference_id ?? undefined,
        sessionId: object.id,
        paymentIntentId: id(object.payment_intent),
      };
    case 'refund.created':
    case 'refund.updated':
    case 'refund.failed':
      return {
        ...base,
        kind: 'refund',
        orderReference: object.metadata?.order_reference ?? undefined,
        paymentIntentId: id(object.payment_intent),
        refund: {
          id: object.id,
          amountMinor: object.amount,
          currency: String(object.currency).toUpperCase(),
          status: object.status === 'succeeded' ? 'succeeded' : object.status === 'failed' ? 'failed' : object.status === 'canceled' ? 'canceled' : 'pending',
        },
      };
    case 'charge.updated':
      return object.balance_transaction
        ? { ...base, kind: 'fee_ready', paymentIntentId: id(object.payment_intent), orderReference: object.metadata?.order_reference ?? undefined }
        : { ...base, kind: 'ignored' };
    case 'charge.dispute.created':
      return { ...base, kind: 'dispute', paymentIntentId: id(object.payment_intent), amountMinor: object.amount ?? undefined };
    default:
      return { ...base, kind: 'ignored' };
  }
}
