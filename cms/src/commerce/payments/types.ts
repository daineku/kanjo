/**
 * The payment provider boundary.
 *
 * The order code talks to this interface and to nothing else, so Stripe's SDK
 * types never leak into order handling and the automated tests can drive the
 * whole checkout with the mock provider. The mock is selectable only outside
 * production (see ../config.ts).
 */

export type CheckoutSessionInput = {
  reference: string;
  email: string;
  currency: string;
  lines: { name: string; sku: string; quantity: number; unitAmountMinor: number }[];
  shipping: { label: string; amountMinor: number };
  successUrl: string;
  cancelUrl: string;
  /** Unix seconds. The stock reservation is held until exactly this moment. */
  expiresAt: number;
};

export type CheckoutSession = { sessionId: string; url: string };

export type RefundResult = { refundId: string; status: 'succeeded' | 'pending' | 'failed'; failureMessage?: string };

/**
 * A webhook delivery, reduced to what order handling needs.
 *
 *   paid      money has been captured for a checkout
 *   pending   checkout completed with a delayed payment method; do NOT fulfil
 *   failed    a delayed payment failed
 *   expired   the hosted checkout expired unpaid
 *   refund    a refund was created or changed state (also covers refunds made
 *             in the provider's dashboard)
 *   fee_ready the processor fee for a payment can now be read
 *   dispute   a chargeback was opened
 *   ignored   a verified event this integration does not act on
 */
export type PaymentEvent = {
  id: string;
  rawType: string;
  livemode: boolean;
  kind: 'paid' | 'pending' | 'failed' | 'expired' | 'refund' | 'fee_ready' | 'dispute' | 'ignored';
  orderReference?: string;
  sessionId?: string;
  paymentIntentId?: string;
  amountMinor?: number;
  currency?: string;
  refund?: { id: string; amountMinor: number; currency: string; status: 'succeeded' | 'pending' | 'failed' | 'canceled' };
};

export interface PaymentProvider {
  readonly id: 'stripe' | 'mock';
  readonly testMode: boolean;
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession>;
  /** Best effort: an already-completed or already-expired session is not an error. */
  expireCheckoutSession(sessionId: string): Promise<void>;
  refund(input: {
    paymentIntentId: string;
    amountMinor: number;
    reason: string;
    orderReference: string;
    idempotencyKey: string;
  }): Promise<RefundResult>;
  /** The ACTUAL processor fee, or null while the processor has not settled it. */
  getFee(paymentIntentId: string): Promise<{ feeMinor: number; currency: string } | null>;
  /** Verifies the signature over the RAW body and returns the event. Throws on a bad signature. */
  verifyWebhook(rawBody: Buffer | string, headers: Record<string, string | string[] | undefined>): PaymentEvent;
}

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}
