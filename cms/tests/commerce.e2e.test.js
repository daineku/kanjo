/**
 * The Kanjo Parts — commerce end-to-end tests.
 *
 * Real Strapi, real database (throwaway SQLite), real HTTP routes, MOCK
 * payment provider. See ./harness.js for what that does and does not prove.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startStrapi, lib, asAdmin } = require('./harness');

let ctx;
let strapi;
let api;
let sign;
const runAsSystem = (fn) => lib('commerce/actor').runAsSystem('test', fn);

async function webhook(event) {
  const raw = JSON.stringify(event);
  return api('POST', '/payments/webhook/mock', raw, { 'x-mock-signature': sign(ctx.WEBHOOK_SECRET, raw), authorization: '' });
}

async function vehicle(chassis) {
  return strapi.documents('api::vehicle.vehicle').findFirst({ filters: { chassisCode: chassis } });
}

async function category(slug) {
  return strapi.documents('api::category.category').findFirst({ filters: { slug } });
}

let skuCounter = 0;
/** Creates and publishes a VALID product. Returns the published document. */
async function product(overrides = {}, { stock, publish = true } = {}) {
  skuCounter += 1;
  const cat = await category('interior-shift-knobs');
  const brand =
    (await strapi.documents('api::brand.brand').findFirst({ filters: { slug: 'test-brand' } })) ??
    (await strapi.documents('api::brand.brand').create({ data: { name: 'Test Brand', slug: 'test-brand' } }));
  const sku = overrides.sku ?? `T-${skuCounter}`;
  const doc = await strapi.documents('api::product.product').create({
    data: {
      name: `Test Part ${skuCounter}`,
      slug: `test-part-${skuCounter}`,
      sku,
      brand: { connect: [brand.documentId] },
      category: { connect: [cat.documentId] },
      productType: 'part',
      authenticity: 'genuine_aftermarket',
      condition: 'new',
      shortDescription: 'A test part.',
      description: 'A test part with a description long enough to pass the thin-content rule for publication in the store.',
      price: 50,
      currency: 'USD',
      availability: 'in_stock',
      weightGrams: 500,
      hsCode: '8708.99',
      imageRights: 'not_cleared',
      reviewStatus: 'approved',
      provenance: 'Test fixture.',
      costPrice: 20,
      supplierReference: 'SECRET-REF',
      sourceUrl: 'https://supplier.example/secret',
      ...overrides,
    },
  });
  if (!publish) return doc;
  await strapi.documents('api::product.product').publish({ documentId: doc.documentId });
  if (stock !== undefined) {
    await strapi.db.getConnection('inventory_items').where('sku', sku).update({ on_hand: stock });
  }
  lib('commerce/catalog').invalidateCatalog();
  return strapi.documents('api::product.product').findOne({ documentId: doc.documentId, status: 'published', populate: { variants: true } });
}

async function stockOf(sku) {
  const row = await strapi.db.getConnection('inventory_items').where('sku', sku).first();
  return { onHand: Number(row.on_hand), reserved: Number(row.reserved) };
}

const ADDRESS = { name: 'Test Buyer', line1: '1 Test Street', city: 'Testville', postalCode: '12345', country: 'US' };

async function checkout(items, extra = {}) {
  const quote = await api('POST', '/cart/quote', { items, country: 'US' });
  const shippingOptionId = quote.body.shippingOptions?.[0]?.id;
  return api('POST', '/checkout', {
    items,
    email: 'buyer@example.test',
    address: ADDRESS,
    shippingOptionId,
    acceptTerms: true,
    successUrl: 'http://localhost:3000/checkout/success',
    cancelUrl: 'http://localhost:3000/checkout/cancelled',
    ...extra,
  });
}

async function order(reference) {
  return strapi.documents('api::order.order').findFirst({ filters: { reference }, populate: { items: true } });
}

before(async () => {
  ctx = await startStrapi('commerce');
  ({ strapi, api } = ctx);
  sign = lib('commerce/payments/mock').signMockEvent;

  await runAsSystem(async () => {
    const settings = await strapi.documents('api::store-setting.store-setting').findFirst({});
    await strapi.documents('api::store-setting.store-setting').update({ documentId: settings.documentId, data: { checkoutEnabled: true } });
    const zone = await strapi.documents('api::shipping-zone.shipping-zone').findFirst({ filters: { code: 'us' } });
    await strapi.documents('api::shipping-zone.shipping-zone').update({ documentId: zone.documentId, data: { enabled: true } });
    await strapi.documents('api::shipping-rate.shipping-rate').create({
      data: { zone: { connect: [zone.documentId] }, carrier: 'dhl', serviceName: 'Express (TEST RATE)', minWeightGrams: 0, maxWeightGrams: 30000, price: 40, currency: 'USD', incoterm: 'DAP', verified: true, verifiedSource: 'test fixture', enabled: true },
    });
    // An UNVERIFIED rate that must never be quoted.
    await strapi.documents('api::shipping-rate.shipping-rate').create({
      data: { zone: { connect: [zone.documentId] }, carrier: 'fedex', serviceName: 'Unverified', minWeightGrams: 0, maxWeightGrams: 30000, price: 1, currency: 'USD', incoterm: 'DAP', verified: false, enabled: true },
    });
  });
});

after(async () => {
  await ctx?.stop();
});

describe('structure seed', () => {
  it('creates the category tree, the five chassis, and disabled zones without rates', async () => {
    assert.equal(await strapi.documents('api::category.category').count({ filters: { parent: { $null: true } } }), 8);
    assert.ok(await category('rare-jdm-parts-discontinued-parts'));
    for (const chassis of ['EF', 'EG', 'EK', 'DC2', 'EP3']) assert.ok(await vehicle(chassis), chassis);
    const ca = await strapi.documents('api::shipping-zone.shipping-zone').findFirst({ filters: { code: 'ca' }, populate: { rates: true } });
    assert.equal(ca.enabled, false);
    assert.equal(ca.rates.length, 0);
    assert.equal(await strapi.documents('api::product.product').count({}), 0, 'boot never creates products');
  });
});

describe('storefront API access', () => {
  it('refuses requests without the storefront token', async () => {
    const response = await api('GET', '/catalog', undefined, { authorization: 'Bearer wrong' });
    assert.equal(response.status, 403);
  });
});

describe('publication rules', () => {
  it('refuses to publish an unapproved, thin, unweighed product', async () => {
    const draft = await product({ reviewStatus: 'draft', description: 'short', weightGrams: null }, { publish: false });
    await assert.rejects(
      () => strapi.documents('api::product.product').publish({ documentId: draft.documentId }),
      (error) => /approved/.test(error.message) && /80 characters/.test(error.message) && /weight/.test(error.message),
    );
  });

  it('refuses images whose rights are not cleared', async () => {
    const problems = lib('commerce/validation').productPublishProblems(
      { name: 'x', sku: 'X1', reviewStatus: 'approved', category: 1, authenticity: 'custom_made', condition: 'new', shortDescription: 's', description: 'd'.repeat(90), availability: 'out_of_stock', mainImage: { id: 1 }, imageRights: 'not_cleared' },
      { storeCurrency: 'USD', skusInUseElsewhere: new Set() },
    );
    assert.ok(problems.some((p) => /Image rights/.test(p)));
  });

  it('refuses a SKU already used by another product', async () => {
    await product({ sku: 'DUP-1' });
    const second = await product({ sku: 'DUP-1' }, { publish: false });
    await assert.rejects(() => strapi.documents('api::product.product').publish({ documentId: second.documentId }), /already belongs/);
  });

  it('creates a zero-stock inventory record on publish', async () => {
    const p = await product();
    assert.deepEqual(await stockOf(p.sku), { onHand: 0, reserved: 0 });
  });
});

describe('catalogue', () => {
  it('never exposes cost, supplier, source or provenance fields', async () => {
    const p = await product({}, { stock: 3 });
    const catalog = await api('GET', '/catalog');
    assert.equal(catalog.status, 200);
    const detail = await api('GET', `/products/${p.slug}`);
    const text = JSON.stringify([catalog.body, detail.body]);
    for (const secret of ['SECRET-REF', 'supplier.example', 'costPrice', 'Test fixture.', 'provenance', 'sourceUrl']) {
      assert.ok(!text.includes(secret), `leaked ${secret}`);
    }
    assert.equal(detail.body.product.price.amount, 5000);
    assert.equal(detail.body.product.availability, 'in_stock');
  });

  it('computes availability from stock, not from the editor\'s label', async () => {
    const p = await product({ availability: 'in_stock' }, { stock: 0 });
    const detail = await api('GET', `/products/${p.slug}`);
    assert.equal(detail.body.product.availability, 'out_of_stock');
    assert.equal(detail.body.product.purchasable, false);
  });

  it('hides sample products unless explicitly allowed', async () => {
    await product({ isSample: true, name: 'SAMPLE hidden' });
    const catalog = await api('GET', '/catalog');
    assert.ok(!catalog.body.products.some((x) => x.isSample));
  });

  it('only lists countries with a VERIFIED rate', async () => {
    const catalog = await api('GET', '/catalog');
    assert.deepEqual(catalog.body.settings.shippingCountries, ['US']);
  });

  it('serves structured fitment with explicit status', async () => {
    const eg = await vehicle('EG');
    const p = await product({ fitments: [{ vehicle: { connect: [eg.documentId] }, status: 'conditional', yearFrom: 1992, yearTo: 1995, notes: 'Hatch only' }] }, { stock: 1 });
    const detail = await api('GET', `/products/${p.slug}`);
    const [fit] = detail.body.product.fitmentDetails;
    assert.equal(fit.chassisCode, 'EG');
    assert.equal(fit.status, 'conditional');
    assert.equal(fit.yearFrom, 1992);
  });

  it('redirects a renamed product slug', async () => {
    const p = await product({ previousSlugs: 'old-name-slug' }, { stock: 1 });
    const response = await api('GET', '/products/old-name-slug');
    assert.equal(response.status, 404);
    assert.equal(response.body.error.redirectTo, `/parts/${p.slug}`);
  });
});

describe('cart quote', () => {
  it('prices from the database, clamps quantity to stock, and quotes only verified rates', async () => {
    const p = await product({ price: 30, discountPrice: 25 }, { stock: 2 });
    const quote = await api('POST', '/cart/quote', { items: [{ sku: p.sku, quantity: 5, price: 1 }], country: 'US' });
    assert.equal(quote.status, 200);
    const [line] = quote.body.lines;
    assert.equal(line.quantity, 2);
    assert.ok(line.issues.includes('quantity_reduced'));
    assert.equal(line.unitPrice.amount, 2500, 'the browser\'s price is ignored');
    assert.equal(quote.body.shippingOptions.length, 1);
    assert.equal(quote.body.shippingOptions[0].serviceName, 'Express (TEST RATE)');
    assert.equal(quote.body.canCheckout, false, 'a reduced quantity needs the customer to look again');
  });

  it('offers no rate for a country without a verified zone', async () => {
    const p = await product({}, { stock: 2 });
    const quote = await api('POST', '/cart/quote', { items: [{ sku: p.sku, quantity: 1 }], country: 'CA' });
    assert.equal(quote.body.shippingOptions.length, 0);
    assert.equal(quote.body.shippingUnavailableReason, 'country_not_served');
  });

  it('drops unknown SKUs', async () => {
    const quote = await api('POST', '/cart/quote', { items: [{ sku: 'NOPE', quantity: 1 }] });
    assert.deepEqual(quote.body.removedSkus, ['NOPE']);
  });
});

describe('checkout → payment → stock', () => {
  it('reserves stock, snapshots the order, and commits on payment exactly once', async () => {
    const p = await product({ price: 100 }, { stock: 3 });
    const response = await checkout([{ sku: p.sku, quantity: 2 }]);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const { reference, accessToken, checkoutUrl } = response.body;
    assert.match(reference, /^KJ-[0-9A-Z]{8}$/);
    assert.ok(checkoutUrl.startsWith('http://localhost:3000/checkout/success?ref='));
    assert.deepEqual(await stockOf(p.sku), { onHand: 3, reserved: 2 });

    let o = await order(reference);
    assert.equal(o.status, 'pending_payment');
    assert.equal(Number(o.total), 240, '2 × 100 + 40 shipping');
    assert.equal(o.isTest, true);
    assert.equal(o.items[0].unitCostEstimate, 20);

    // Renaming / repricing the product does not touch the order.
    await strapi.documents('api::product.product').update({ documentId: p.documentId, data: { name: 'Renamed', price: 999 } });

    const paid = { id: 'evt_paid_1', rawType: 'checkout.session.completed', kind: 'paid', orderReference: reference, paymentIntentId: 'pi_mock_1', amountMinor: 24000, currency: 'USD' };
    assert.equal((await webhook(paid)).status, 200);
    assert.equal((await webhook(paid)).status, 200, 'redelivery acknowledged');
    // A DIFFERENT event for the same payment must not commit stock twice.
    assert.equal((await webhook({ ...paid, id: 'evt_paid_2', rawType: 'checkout.session.async_payment_succeeded' })).status, 200);

    o = await order(reference);
    assert.equal(o.status, 'paid');
    assert.equal(o.paymentStatus, 'paid');
    assert.equal(o.items[0].productName, p.name);
    assert.equal(Number(o.items[0].unitPrice), 100);
    assert.deepEqual(await stockOf(p.sku), { onHand: 1, reserved: 0 });

    const movements = await strapi.documents('api::inventory-movement.inventory-movement').findMany({ filters: { orderReference: reference } });
    assert.deepEqual(movements.map((m) => m.kind).sort(), ['reserve', 'sale']);

    const lookup = await api('POST', '/orders/lookup', { reference, token: accessToken });
    assert.equal(lookup.status, 200);
    assert.equal(lookup.body.order.status, 'paid');
    assert.ok(!JSON.stringify(lookup.body).includes('buyer@example.test'), 'no email in the customer view');
    assert.ok(!JSON.stringify(lookup.body).includes('1 Test Street'), 'no street address in the customer view');
    assert.equal((await api('POST', '/orders/lookup', { reference, token: 'wrong' })).status, 404);
    assert.equal((await api('POST', '/orders/lookup', { reference, email: 'BUYER@example.test' })).status, 200);
  });

  it('rejects a webhook with a bad signature', async () => {
    const raw = JSON.stringify({ id: 'evt_forged', kind: 'paid', orderReference: 'KJ-XXXXXXXX' });
    const response = await api('POST', '/payments/webhook/mock', raw, { 'x-mock-signature': 'deadbeef', authorization: '' });
    assert.equal(response.status, 400);
  });

  it('does not fulfil when the paid amount does not match', async () => {
    const p = await product({}, { stock: 1 });
    const { body } = await checkout([{ sku: p.sku, quantity: 1 }]);
    await webhook({ id: 'evt_mismatch', rawType: 'checkout.session.completed', kind: 'paid', orderReference: body.reference, amountMinor: 1, currency: 'USD' });
    assert.equal((await order(body.reference)).status, 'pending_payment');
  });

  it('lets exactly one of two simultaneous checkouts take the last unit', async () => {
    const p = await product({}, { stock: 1 });
    const results = await Promise.all([checkout([{ sku: p.sku, quantity: 1 }]), checkout([{ sku: p.sku, quantity: 1 }])]);
    const ok = results.filter((r) => r.status === 200);
    assert.equal(ok.length, 1, JSON.stringify(results.map((r) => r.body)));
    assert.deepEqual(await stockOf(p.sku), { onHand: 1, reserved: 1 });
  });

  it('releases stock when the checkout expires, and reinstates a late payment', async () => {
    const p = await product({}, { stock: 2 });
    const { body } = await checkout([{ sku: p.sku, quantity: 1 }]);
    await webhook({ id: 'evt_exp', rawType: 'checkout.session.expired', kind: 'expired', orderReference: body.reference });
    assert.equal((await order(body.reference)).status, 'cancelled');
    assert.deepEqual(await stockOf(p.sku), { onHand: 2, reserved: 0 });

    await webhook({ id: 'evt_late', rawType: 'checkout.session.completed', kind: 'paid', orderReference: body.reference, amountMinor: 9000, currency: 'USD' });
    assert.equal((await order(body.reference)).status, 'paid');
    assert.deepEqual(await stockOf(p.sku), { onHand: 1, reserved: 0 });
  });

  it('the sweeper cancels reservations whose window passed', async () => {
    const p = await product({}, { stock: 1 });
    const { body } = await checkout([{ sku: p.sku, quantity: 1 }]);
    const o = await order(body.reference);
    await strapi.db.getConnection('orders').where('document_id', o.documentId).update({ reservation_expires_at: new Date(Date.now() - 3600_000) });
    assert.equal(await lib('commerce/checkout').sweepExpiredReservations(strapi), 1);
    assert.deepEqual(await stockOf(p.sku), { onHand: 1, reserved: 0 });
  });

  it('refuses checkout while the owner switch is off', async () => {
    const settings = await strapi.documents('api::store-setting.store-setting').findFirst({});
    await strapi.documents('api::store-setting.store-setting').update({ documentId: settings.documentId, data: { checkoutEnabled: false } });
    lib('commerce/catalog').invalidateCatalog();
    const p = await product({}, { stock: 1 });
    const response = await checkout([{ sku: p.sku, quantity: 1 }]);
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'checkout_disabled');
    await strapi.documents('api::store-setting.store-setting').update({ documentId: settings.documentId, data: { checkoutEnabled: true } });
    lib('commerce/catalog').invalidateCatalog();
  });

  it('refuses return URLs outside the storefront', async () => {
    const p = await product({}, { stock: 1 });
    const response = await checkout([{ sku: p.sku, quantity: 1 }], { successUrl: 'https://evil.example/x' });
    assert.equal(response.status, 400);
  });
});

async function paidOrder(stock = 3, quantity = 2) {
  const p = await product({ price: 100 }, { stock });
  const { body } = await checkout([{ sku: p.sku, quantity }]);
  const total = (100 * quantity + 40) * 100;
  await webhook({ id: `evt_${body.reference}`, rawType: 'checkout.session.completed', kind: 'paid', orderReference: body.reference, paymentIntentId: `pi_${body.reference}`, amountMinor: total, currency: 'USD' });
  return { p, reference: body.reference, o: await order(body.reference) };
}

describe('admin guards: orders', () => {
  it('blocks hand-marking a web order paid, and enforces the state machine', async () => {
    const p = await product({}, { stock: 1 });
    const { body } = await checkout([{ sku: p.sku, quantity: 1 }]);
    const o = await order(body.reference);
    await assert.rejects(
      () => asAdmin(strapi, () => strapi.documents('api::order.order').update({ documentId: o.documentId, data: { status: 'paid' } })),
      /payment processor/,
    );
  });

  it('requires tracking before shipped, records history, and keeps money immutable', async () => {
    const { o, reference } = await paidOrder();
    const edit = (data) => asAdmin(strapi, () => strapi.documents('api::order.order').update({ documentId: o.documentId, data }));
    await edit({ status: 'processing' });
    await edit({ status: 'ready_to_ship' });
    await assert.rejects(() => edit({ status: 'shipped' }), /tracking number/);
    await edit({ status: 'shipped', trackingNumber: 'JD0123', total: 1, items: [] });
    await assert.rejects(() => edit({ status: 'processing' }), /cannot go from "shipped"/);

    const after = await order(reference);
    assert.equal(after.status, 'shipped');
    assert.equal(Number(after.total), 240, 'total unchanged');
    assert.equal(after.items.length, 1, 'line items unchanged');
    assert.ok(after.shippedAt);
    const events = await strapi.documents('api::order-event.order-event').findMany({ filters: { orderReference: reference } });
    assert.ok(events.some((e) => e.toStatus === 'shipped' && e.actor === 'admin:owner@example.test'));
    assert.ok(events.some((e) => e.kind === 'tracking'));
  });

  it('refuses deleting a paid order and editing ledgers', async () => {
    const { o } = await paidOrder();
    // Mock-paid orders are test orders (deletable); make this one a real record.
    await strapi.db.getConnection('orders').where('document_id', o.documentId).update({ is_test: false });
    await assert.rejects(() => asAdmin(strapi, () => strapi.documents('api::order.order').delete({ documentId: o.documentId })), /cannot be deleted/);
    await assert.rejects(
      () => asAdmin(strapi, () => strapi.documents('api::audit-log.audit-log').create({ data: { action: 'forged' } })),
      /written by the system/,
    );
  });
});

describe('refunds', () => {
  it('partial then full refund, with restock, through the admin', async () => {
    const { o, reference, p } = await paidOrder(3, 2);
    const refund = (amount, restock = false) =>
      asAdmin(strapi, () => strapi.documents('api::refund.refund').create({ data: { order: { connect: [o.documentId] }, amount, reason: 'requested_by_customer', restock } }));

    await assert.rejects(() => refund(500), /still refundable/);
    await refund(40);
    let after = await order(reference);
    assert.equal(after.paymentStatus, 'partially_refunded');
    assert.equal(after.status, 'paid');

    await refund(200, true);
    after = await order(reference);
    assert.equal(after.status, 'refunded');
    assert.equal(Number(after.refundedTotal), 240);
    assert.deepEqual(await stockOf(p.sku), { onHand: 3, reserved: 0 });
    await assert.rejects(() => refund(1), /has nothing to refund|still refundable/);
  });

  it('records a refund made in the processor dashboard exactly once', async () => {
    const { reference } = await paidOrder(2, 1);
    const event = { id: 'evt_ext_refund', rawType: 'refund.created', kind: 'refund', orderReference: reference, refund: { id: 're_ext_1', amountMinor: 3000, currency: 'USD', status: 'succeeded' } };
    await webhook(event);
    await webhook({ ...event, id: 'evt_ext_refund_2', rawType: 'refund.updated' });
    const after = await order(reference);
    assert.equal(Number(after.refundedTotal), 30);
    assert.equal(after.paymentStatus, 'partially_refunded');
  });
});

describe('inventory guards', () => {
  it('records admin stock edits in the ledger and protects the reserved counter', async () => {
    const p = await product({}, { stock: 5 });
    const item = await strapi.documents('api::inventory-item.inventory-item').findFirst({ filters: { sku: p.sku } });
    await asAdmin(strapi, () => strapi.documents('api::inventory-item.inventory-item').update({ documentId: item.documentId, data: { onHand: 8, reserved: 99 } }));
    assert.deepEqual(await stockOf(p.sku), { onHand: 8, reserved: 0 });
    const [adjust] = await strapi.documents('api::inventory-movement.inventory-movement').findMany({ filters: { sku: p.sku, kind: 'adjustment' } });
    assert.equal(adjust.quantity, 3);
  });
});

describe('marketplace orders', () => {
  it('imports once, takes stock, and reports oversell instead of going negative', async () => {
    const { importMarketplaceOrder } = lib('commerce/orders');
    const p = await product({}, { stock: 1 });
    const input = { channel: 'tiktok_shop', externalOrderId: 'TT-1', status: 'paid', customerName: 'TT Buyer', currency: 'USD', items: [{ sku: p.sku, quantity: 2, unitPriceMinor: 5000, productName: 'x' }], shippingMinor: 0, totalMinor: 10000 };
    const first = await importMarketplaceOrder(strapi, input);
    const second = await importMarketplaceOrder(strapi, input);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.reference, first.reference);
    assert.equal(first.conflicts.length, 1);
    assert.deepEqual(await stockOf(p.sku), { onHand: 0, reserved: 0 });
  });
});

describe('reviews', () => {
  const submit = (body) => api('POST', '/reviews', { rating: 5, body: 'Fits perfectly and the finish is excellent quality.', authorName: 'R', elapsedMs: 5000, ...body });

  it('rejects honeypot and too-fast submissions', async () => {
    const p = await product({}, { stock: 1 });
    assert.equal((await submit({ productSlug: p.slug, email: 'a@example.test', website: 'spam' })).status, 400);
    assert.equal((await submit({ productSlug: p.slug, email: 'a@example.test', elapsedMs: 100 })).status, 400);
  });

  it('holds reviews for moderation, marks verified purchase only from a shipped order, refuses duplicates', async () => {
    const { o, p } = await paidOrder(2, 1);
    // Test-mode orders never verify a review; treat this one as a real order.
    await strapi.db.getConnection('orders').where('document_id', o.documentId).update({ is_test: false });
    // Paid but not shipped: not yet verified.
    const early = await submit({ productSlug: p.slug, email: 'buyer@example.test' });
    assert.equal(early.status, 200);
    assert.equal((await submit({ productSlug: p.slug, email: 'buyer@example.test' })).status, 409);

    const review = await strapi.documents('api::review.review').findFirst({ filters: { productDocumentId: p.documentId } });
    assert.equal(review.status, 'pending');
    assert.equal(review.verifiedPurchase, false);
    assert.equal((await api('GET', `/products/${p.slug}/reviews`)).body.reviews.length, 0, 'pending is invisible');

    // An admin cannot tick "verified" without a qualifying order...
    await assert.rejects(
      () => asAdmin(strapi, () => strapi.documents('api::review.review').update({ documentId: review.documentId, data: { verifiedPurchase: true } })),
      /Verified purchase/,
    );
    // ...but can once the order has shipped.
    await asAdmin(strapi, () => strapi.documents('api::order.order').update({ documentId: o.documentId, data: { status: 'ready_to_ship' } }));
    await asAdmin(strapi, () => strapi.documents('api::order.order').update({ documentId: o.documentId, data: { status: 'shipped', trackingNumber: 'X1' } }));
    await asAdmin(strapi, () => strapi.documents('api::review.review').update({ documentId: review.documentId, data: { verifiedPurchase: true, status: 'approved', adminReply: 'Thanks!' } }));

    const visible = await api('GET', `/products/${p.slug}/reviews`);
    assert.equal(visible.body.reviews.length, 1);
    assert.equal(visible.body.reviews[0].verifiedPurchase, true);
    assert.equal(visible.body.summary.count, 1);
    assert.ok(!JSON.stringify(visible.body).includes('buyer@example.test'));
    assert.equal(visible.body.reviews[0].adminReply.body, 'Thanks!');

    lib('commerce/catalog').invalidateCatalog();
    const detail = await api('GET', `/products/${p.slug}`);
    assert.deepEqual(detail.body.product.rating, { average: 5, count: 1 });
  });
});

describe('enquiries', () => {
  it('stores a sourcing request and a build inquiry', async () => {
    const s = await api('POST', '/sourcing-requests', { fullName: 'A', email: 'a@example.test', country: 'GB', vehicle: 'Civic EK9 1998', requestedPart: 'Type R front lip', elapsedMs: 4000 });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    const b = await api('POST', '/build-inquiries', { fullName: 'B', email: 'b@example.test', destinationCountry: 'IE', preferredChassis: 'EG6', budgetRange: '15k–25k USD', intendedUse: 'track', elapsedMs: 4000 });
    assert.equal(b.status, 200);
    const invalid = await api('POST', '/sourcing-requests', { fullName: 'A', email: 'nope', elapsedMs: 4000 });
    assert.equal(invalid.status, 400);
    assert.ok(invalid.body.error.fields.email);
  });
});

describe('fulfillment role', () => {
  it('exists with no access to refunds, suppliers or costs', async () => {
    const role = await strapi.service('admin::role').findOne({ code: 'kanjo-fulfillment-partner' });
    assert.ok(role);
    const permissions = await strapi.service('admin::permission').findMany({ where: { role: { id: role.id } } });
    const subjects = new Set(permissions.map((p) => p.subject));
    for (const forbidden of ['api::refund.refund', 'api::supplier.supplier', 'api::review.review', 'api::store-setting.store-setting']) {
      assert.ok(!subjects.has(forbidden), forbidden);
    }
    const productRead = permissions.find((p) => p.subject === 'api::product.product' && p.action.endsWith('.read'));
    assert.ok(!productRead.properties.fields.includes('costPrice'));
    assert.ok(!productRead.properties.fields.includes('supplier'));
    const orderRead = permissions.find((p) => p.subject === 'api::order.order' && p.action.endsWith('.read'));
    assert.ok(!orderRead.properties.fields.includes('email'));
  });
});
