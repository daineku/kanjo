/**
 * Pure-function tests: no Strapi, no database.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const lib = (name) => require(path.join(__dirname, '..', 'dist', 'src', ...name.split('/')));

describe('money', () => {
  const { toMinor, fromMinor } = lib('commerce/money');
  it('converts decimals without float drift', () => {
    assert.equal(toMinor(19.99), 1999);
    assert.equal(toMinor('0.10'), 10);
    assert.equal(toMinor(1.005), 101);
    assert.equal(toMinor(null), null);
    assert.equal(toMinor(-1), null);
    assert.equal(fromMinor(1999), 19.99);
  });
});

describe('payment mode', () => {
  const { paymentModeFromEnv } = lib('commerce/config');
  it('is disabled with no credentials', () => assert.equal(paymentModeFromEnv({}).kind, 'disabled'));
  it('needs a webhook secret', () => assert.equal(paymentModeFromEnv({ STRIPE_SECRET_KEY: 'sk_live_x' }).kind, 'disabled'));
  it('refuses a test key in production unless allowed', () => {
    assert.equal(paymentModeFromEnv({ NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec' }).kind, 'disabled');
    assert.equal(paymentModeFromEnv({ NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec', KANJO_ALLOW_TEST_PAYMENTS: 'true' }).kind, 'stripe');
  });
  it('accepts a live key with a webhook secret', () => {
    const mode = paymentModeFromEnv({ NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec' });
    assert.equal(mode.kind, 'stripe');
    assert.equal(mode.testMode, false);
  });
  it('never allows the mock in production', () => assert.equal(paymentModeFromEnv({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'mock' }).kind, 'disabled'));
  it('rejects a publishable key', () => assert.equal(paymentModeFromEnv({ STRIPE_SECRET_KEY: 'pk_live_x', STRIPE_WEBHOOK_SECRET: 'w' }).kind, 'disabled'));
});

describe('storefront token', () => {
  const { storefrontToken } = lib('commerce/config');
  it('refuses short tokens', () => {
    assert.equal(storefrontToken({ STOREFRONT_API_TOKEN: 'short' }), undefined);
    assert.ok(storefrontToken({ STOREFRONT_API_TOKEN: 'x'.repeat(32) }));
  });
});

describe('order state machine', () => {
  const { transitionProblem } = lib('commerce/orders');
  it('allows the fulfilment path', () => {
    assert.equal(transitionProblem('paid', 'processing', {}, false), undefined);
    assert.equal(transitionProblem('processing', 'awaiting_supplier', {}, false), undefined);
    assert.equal(transitionProblem('ready_to_ship', 'shipped', { trackingNumber: 'X' }, false), undefined);
  });
  it('refuses skipping and reversing', () => {
    assert.match(transitionProblem('pending_payment', 'shipped', {}, false), /cannot go/);
    assert.match(transitionProblem('delivered', 'processing', {}, false), /cannot go/);
    assert.match(transitionProblem('cancelled', 'paid', {}, true), /cannot go/);
  });
  it('reserves paid/refunded for the system, except manual orders', () => {
    assert.match(transitionProblem('pending_payment', 'paid', { channel: 'web' }, false), /payment processor/);
    assert.equal(transitionProblem('pending_payment', 'paid', { channel: 'manual' }, false), undefined);
    assert.equal(transitionProblem('pending_payment', 'paid', { channel: 'web' }, true), undefined);
    assert.match(transitionProblem('paid', 'refunded', {}, false), /Refund entry/);
  });
  it('lets a manual carrier ship without tracking', () => {
    assert.equal(transitionProblem('ready_to_ship', 'shipped', { shippingCarrier: 'manual' }, false), undefined);
  });
});

describe('stripe event normalisation', () => {
  const { normalizeStripeEvent } = lib('commerce/payments/stripe');
  it('treats an unpaid completed session as pending (delayed method)', () => {
    const e = normalizeStripeEvent({ id: 'evt', type: 'checkout.session.completed', livemode: false, data: { object: { id: 'cs', payment_status: 'unpaid', metadata: { order_reference: 'KJ-1' } } } });
    assert.equal(e.kind, 'pending');
    assert.equal(e.orderReference, 'KJ-1');
  });
  it('reads a paid session', () => {
    const e = normalizeStripeEvent({ id: 'evt', type: 'checkout.session.completed', livemode: true, data: { object: { id: 'cs', payment_status: 'paid', client_reference_id: 'KJ-2', payment_intent: 'pi_1', amount_total: 1234, currency: 'usd' } } });
    assert.deepEqual([e.kind, e.orderReference, e.paymentIntentId, e.amountMinor, e.currency], ['paid', 'KJ-2', 'pi_1', 1234, 'USD']);
  });
  it('reads refunds and ignores unrelated events', () => {
    const r = normalizeStripeEvent({ id: 'e', type: 'refund.updated', data: { object: { id: 're_1', amount: 500, currency: 'usd', status: 'succeeded', payment_intent: 'pi_1' } } });
    assert.equal(r.kind, 'refund');
    assert.equal(r.refund.amountMinor, 500);
    assert.equal(normalizeStripeEvent({ id: 'e', type: 'customer.created', data: { object: {} } }).kind, 'ignored');
  });
});

describe('Stripe webhook signature (real SDK verifier)', () => {
  const { createStripeProvider } = lib('commerce/payments/stripe');
  const Stripe = require('stripe');
  const provider = createStripeProvider({ secretKey: 'sk_test_dummy', webhookSecret: 'whsec_test', testMode: true });
  const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.expired', livemode: false, data: { object: { id: 'cs_1', metadata: { order_reference: 'KJ-ABC' } } } });

  it('accepts a correctly signed raw body', () => {
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test' });
    const event = provider.verifyWebhook(Buffer.from(payload), { 'stripe-signature': header });
    assert.equal(event.kind, 'expired');
    assert.equal(event.orderReference, 'KJ-ABC');
  });
  it('rejects a body that was re-serialised or tampered with', () => {
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test' });
    assert.throws(() => provider.verifyWebhook(Buffer.from(payload.replace('KJ-ABC', 'KJ-XYZ')), { 'stripe-signature': header }), /signature/i);
    assert.throws(() => provider.verifyWebhook(Buffer.from(payload), {}), /Missing/);
  });
});

describe('uploads', () => {
  const { sniffImageType } = lib('commerce/uploads');
  it('identifies images by bytes, not name', () => {
    assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
    assert.equal(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), undefined);
    assert.equal(sniffImageType(Buffer.from('<html><script>')), undefined);
  });
});

describe('rate limit', () => {
  const { hit, resetRateLimits } = lib('commerce/ratelimit');
  it('blocks after the window maximum', () => {
    resetRateLimits();
    for (let i = 0; i < 10; i += 1) assert.equal(hit('checkout', 'ip', 0).allowed, true);
    assert.equal(hit('checkout', 'ip', 0).allowed, false);
    assert.equal(hit('checkout', 'other-ip', 0).allowed, true);
    assert.equal(hit('checkout', 'ip', 11 * 60_000).allowed, true);
  });
});
