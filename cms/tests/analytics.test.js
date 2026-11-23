'use strict';

/** Analytics aggregation tests. Pure; no database. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { aggregateOrders } = require('../dist/src/commerce/analytics');

const order = (over) => ({
  reference: 'K-1',
  status: 'paid',
  paymentStatus: 'paid',
  channel: 'web',
  currency: 'USD',
  total: '110.00',
  shippingTotal: '10.00',
  refundedTotal: '0',
  paymentFee: null,
  paymentFeeCurrency: null,
  paymentProvider: 'stripe',
  paymentIntentId: 'pi_1',
  shippingCostActual: null,
  paidAt: '2026-11-01T10:00:00.000Z',
  isTest: false,
  shippingAddress: { country: 'us' },
  items: [{ productName: 'Lip', sku: 'LIP', categoryName: 'Front Lips', quantity: 2, unitPrice: '50.00', lineTotal: '100.00', unitCostEstimate: '20.00' }],
  ...over,
});

test('revenue, refunds, fees, costs and profit are separate, in minor units', () => {
  const report = aggregateOrders([
    order({ paymentFee: '4.50', paymentFeeCurrency: 'USD', shippingCostActual: '8.00' }),
    order({ reference: 'K-2', paymentStatus: 'partially_refunded', refundedTotal: '30.00', paymentIntentId: 'pi_2' }),
  ]);
  const usd = report.money.find((m) => m.currency === 'USD');
  assert.equal(usd.paidOrders, 2);
  assert.equal(usd.grossRevenue, 22000);
  assert.equal(usd.refunds, 3000);
  assert.equal(usd.netRevenue, 19000);
  assert.equal(usd.shippingCollected, 2000);
  assert.equal(usd.paymentFeesActual, 450);
  assert.equal(usd.ordersWithFeeUnknown, 1);
  assert.equal(usd.productCostEstimated, 8000);
  assert.equal(usd.shippingCostActual, 800);
  assert.equal(usd.ordersWithShippingCostUnknown, 1);
  assert.equal(usd.estimatedOperatingProfit, 19000 - 450 - 8000 - 800);
  assert.ok(usd.completeness.some((n) => n.includes('payment fee not yet known for 1')));
  assert.ok(usd.completeness.some((n) => n.includes('actual postage not entered for 1')));
  assert.equal(usd.unitsSold, 4);
});

test('currencies are never summed together', () => {
  const report = aggregateOrders([order({}), order({ reference: 'K-T', currency: 'THB', total: '3500.00', shippingTotal: '0', items: [] })]);
  assert.deepEqual(report.money.map((m) => [m.currency, m.grossRevenue]), [['THB', 350000], ['USD', 11000]]);
});

test('a THB fee on a USD order is reported by its own currency and NOT subtracted from USD profit', () => {
  const report = aggregateOrders([order({ paymentFee: '160.00', paymentFeeCurrency: 'THB' })]);
  const usd = report.money[0];
  assert.equal(usd.paymentFeesActual, 0);
  assert.equal(usd.ordersWithFeeInOtherCurrency, 1);
  assert.equal(usd.ordersWithFeeUnknown, 0);
  assert.deepEqual(report.paymentFeesByCurrency, [{ currency: 'THB', amount: 16000 }]);
  assert.ok(usd.completeness.some((n) => n.includes('another currency') && n.includes('NOT subtracted')));
  assert.equal(usd.estimatedOperatingProfit, 11000 - 4000);
});

test('missing cost estimates are counted, not treated as zero cost silently', () => {
  const report = aggregateOrders([order({ items: [{ sku: 'A', quantity: 1, lineTotal: '100', unitCostEstimate: null }] })]);
  assert.equal(report.money[0].linesWithoutCostEstimate, 1);
  assert.ok(report.money[0].completeness.some((n) => n.includes('no cost estimate on 1')));
});

test('unpaid and failed orders count as orders but not revenue; test orders are excluded by default', () => {
  const orders = [
    order({}),
    order({ reference: 'K-P', status: 'pending_payment', paymentStatus: 'unpaid' }),
    order({ reference: 'K-F', status: 'cancelled', paymentStatus: 'failed' }),
    order({ reference: 'K-X', isTest: true }),
  ];
  const report = aggregateOrders(orders);
  assert.equal(report.totals.orders, 3);
  assert.equal(report.totals.paidOrders, 1);
  assert.equal(report.totals.excludedTestOrders, 1);
  assert.equal(aggregateOrders(orders, { includeTest: true }).totals.paidOrders, 2);
});

test('breakdowns: best sellers, category, country, channel — per currency, net of refunds by country/channel', () => {
  const report = aggregateOrders([
    order({}),
    order({ reference: 'K-2', channel: 'tiktok_shop', paymentIntentId: null, paymentProvider: 'tiktok_shop', refundedTotal: '10.00', shippingAddress: { country: 'TH' } }),
  ]);
  assert.deepEqual(report.bestSellers.map((r) => [r.key, r.units, r.revenue, r.orders]), [['LIP', 4, 20000, 2]]);
  assert.deepEqual(report.salesByCategory.map((r) => r.key), ['Front Lips']);
  assert.deepEqual(report.salesByCountry.map((r) => [r.key, r.revenue, r.units]), [['US', 11000, 2], ['TH', 10000, 2]]);
  assert.deepEqual(report.salesByChannel.map((r) => [r.key, r.revenue]), [['web', 11000], ['tiktok_shop', 10000]]);
});

test('pending fulfilment counts by status', () => {
  const report = aggregateOrders([order({ status: 'awaiting_supplier' }), order({ status: 'shipped' }), order({ status: 'paid' })]);
  assert.equal(report.pendingFulfilment.awaiting_supplier, 1);
  assert.equal(report.pendingFulfilment.paid, 1);
  assert.equal(report.pendingFulfilment.shipped, undefined);
  assert.equal(report.ordersByStatus.shipped, 1);
});

test('inventory alerts: sellable at or under the threshold, out-of-stock first', () => {
  const report = aggregateOrders([], {
    stock: [
      { sku: 'A', onHand: 5, reserved: 0, lowStockThreshold: 1 },
      { sku: 'B', onHand: 2, reserved: 1, lowStockThreshold: 1 },
      { sku: 'C', onHand: 1, reserved: 1, lowStockThreshold: 0 },
    ],
    productNames: { B: 'Knob' },
  });
  assert.deepEqual(report.inventoryAlerts.map((a) => [a.sku, a.sellable, a.level, a.name]), [['C', 0, 'out', 'C'], ['B', 1, 'low', 'Knob']]);
});

test('Stripe reconciliation lists paid web orders and flags ones without a payment intent', () => {
  const report = aggregateOrders([
    order({ paidAt: '2026-11-02T00:00:00.000Z' }),
    order({ reference: 'K-0', paymentIntentId: null, paidAt: '2026-11-01T00:00:00.000Z' }),
    order({ reference: 'K-T', channel: 'tiktok_shop', paymentIntentId: null }),
  ]);
  assert.deepEqual(report.stripeReconciliation.map((r) => [r.reference, Boolean(r.flag)]), [['K-0', true], ['K-1', false]]);
  assert.equal(report.stripeReconciliation[1].total, 11000);
});
