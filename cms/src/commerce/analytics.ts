import type { Core } from '@strapi/strapi';

import { getAllStock } from './inventory';
import { toMinor } from './money';

/**
 * Sales analytics.
 *
 * THREE RULES, because each is a way a small shop's dashboard lies to its owner:
 *
 * 1. REVENUE IS NOT PROFIT. Gross revenue, refunds, net revenue, fees, product
 *    costs and shipping costs are separate figures with separate labels.
 * 2. AN ESTIMATE IS LABELLED AS ONE. Payment fees are ACTUAL (read back from
 *    the processor) or unknown. Postage is ACTUAL (entered at fulfilment) or
 *    unknown. Product cost is an ESTIMATE (the cost price snapshotted on the
 *    order line). Unknowns are COUNTED, never treated as zero, and the profit
 *    figure carries a completeness note listing what it is missing.
 * 3. CURRENCIES ARE NEVER SUMMED TOGETHER. Every money figure is grouped by
 *    currency. A Stripe fee is reported in the SETTLEMENT currency (THB for a
 *    Thai account), so fees are grouped by `paymentFeeCurrency` and are only
 *    subtracted in the profit estimate when they are in the order currency.
 *
 * All arithmetic is integer minor units. `aggregateOrders` is pure and unit
 * tested; `computeAnalytics` loads the rows and calls it.
 */

export type AnalyticsOrderItem = {
  productName?: string | null;
  sku?: string | null;
  categoryName?: string | null;
  quantity?: number | null;
  unitPrice?: number | string | null;
  lineTotal?: number | string | null;
  unitCostEstimate?: number | string | null;
};

export type AnalyticsOrder = {
  reference: string;
  status: string;
  paymentStatus: string;
  channel: string;
  currency: string;
  total?: number | string | null;
  subtotal?: number | string | null;
  shippingTotal?: number | string | null;
  refundedTotal?: number | string | null;
  paymentFee?: number | string | null;
  paymentFeeCurrency?: string | null;
  paymentProvider?: string | null;
  paymentIntentId?: string | null;
  shippingCostActual?: number | string | null;
  paidAt?: string | null;
  placedAt?: string | null;
  createdAt?: string | null;
  isTest?: boolean | null;
  shippingAddress?: { country?: string | null } | null;
  items?: AnalyticsOrderItem[] | null;
};

export type StockForAlerts = { sku: string; onHand: number; reserved: number; lowStockThreshold: number };

export type AggregateOptions = {
  includeTest?: boolean;
  /** Products' display names by SKU, for the inventory alert list. */
  productNames?: Record<string, string>;
  stock?: StockForAlerts[];
};

/** Payment statuses that mean money was actually taken. */
const PAID = new Set(['paid', 'partially_refunded', 'refunded']);
const PENDING_FULFILMENT = ['paid', 'processing', 'awaiting_supplier', 'manufacturing', 'ready_to_ship'];

const minor = (value: unknown): number => toMinor(value) ?? 0;
const knownMinor = (value: unknown): number | null => toMinor(value);

type CurrencyFigures = {
  currency: string;
  paidOrders: number;
  grossRevenue: number;
  refunds: number;
  netRevenue: number;
  shippingCollected: number;
  /** ACTUAL payment fees, in the ORDER currency only (fees in another currency are reported separately). */
  paymentFeesActual: number;
  ordersWithFeeInOrderCurrency: number;
  ordersWithFeeInOtherCurrency: number;
  ordersWithFeeUnknown: number;
  /** ESTIMATED from the cost price snapshotted on each line. */
  productCostEstimated: number;
  linesWithoutCostEstimate: number;
  /** ACTUAL postage entered by fulfilment. */
  shippingCostActual: number;
  ordersWithShippingCostUnknown: number;
  estimatedOperatingProfit: number;
  completeness: string[];
  unitsSold: number;
};

const emptyFigures = (currency: string): CurrencyFigures => ({
  currency,
  paidOrders: 0,
  grossRevenue: 0,
  refunds: 0,
  netRevenue: 0,
  shippingCollected: 0,
  paymentFeesActual: 0,
  ordersWithFeeInOrderCurrency: 0,
  ordersWithFeeInOtherCurrency: 0,
  ordersWithFeeUnknown: 0,
  productCostEstimated: 0,
  linesWithoutCostEstimate: 0,
  shippingCostActual: 0,
  ordersWithShippingCostUnknown: 0,
  estimatedOperatingProfit: 0,
  completeness: [],
  unitsSold: 0,
});

type Ranked = { key: string; label: string; currency: string; units: number; revenue: number; orders: number };

function bump(map: Map<string, Ranked>, key: string, label: string, currency: string, units: number, revenue: number, order: boolean) {
  const id = `${currency}|${key}`;
  const row = map.get(id) ?? { key, label, currency, units: 0, revenue: 0, orders: 0 };
  row.units += units;
  row.revenue += revenue;
  if (order) row.orders += 1;
  map.set(id, row);
}

const sortRanked = (rows: Iterable<Ranked>) =>
  [...rows].sort((a, b) => a.currency.localeCompare(b.currency) || b.revenue - a.revenue || b.units - a.units);

export function aggregateOrders(orders: AnalyticsOrder[], options: AggregateOptions = {}) {
  const included = orders.filter((order) => options.includeTest || !order.isTest);
  const excludedTestOrders = orders.length - included.length;

  const byCurrency = new Map<string, CurrencyFigures>();
  const feesByCurrency = new Map<string, number>();
  const bestSellers = new Map<string, Ranked>();
  const byCategory = new Map<string, Ranked>();
  const byCountry = new Map<string, Ranked>();
  const byChannel = new Map<string, Ranked>();
  const statusCounts: Record<string, number> = {};
  const reconciliation: {
    reference: string;
    currency: string;
    total: number;
    refunded: number;
    paymentIntentId: string | null;
    paidAt: string | null;
    flag?: string;
  }[] = [];

  for (const order of included) {
    statusCounts[order.status] = (statusCounts[order.status] ?? 0) + 1;
    if (!PAID.has(order.paymentStatus)) continue;

    const currency = order.currency;
    const figures = byCurrency.get(currency) ?? emptyFigures(currency);
    byCurrency.set(currency, figures);

    const total = minor(order.total);
    const refunded = minor(order.refundedTotal);
    figures.paidOrders += 1;
    figures.grossRevenue += total;
    figures.refunds += refunded;
    figures.shippingCollected += minor(order.shippingTotal);

    const fee = knownMinor(order.paymentFee);
    const feeCurrency = (order.paymentFeeCurrency || currency).toUpperCase();
    if (fee === null) figures.ordersWithFeeUnknown += 1;
    else {
      feesByCurrency.set(feeCurrency, (feesByCurrency.get(feeCurrency) ?? 0) + fee);
      if (feeCurrency === currency) {
        figures.paymentFeesActual += fee;
        figures.ordersWithFeeInOrderCurrency += 1;
      } else {
        figures.ordersWithFeeInOtherCurrency += 1;
      }
    }

    const postage = knownMinor(order.shippingCostActual);
    if (postage === null) figures.ordersWithShippingCostUnknown += 1;
    else figures.shippingCostActual += postage;

    const country = (order.shippingAddress?.country || 'unknown').toUpperCase();
    // Revenue attributed to a country / channel is NET of refunds.
    const orderUnits = (order.items ?? []).reduce((n, item) => n + Math.max(0, Number(item.quantity ?? 0)), 0);
    bump(byCountry, country, country, currency, orderUnits, total - refunded, true);
    bump(byChannel, order.channel, order.channel, currency, orderUnits, total - refunded, true);

    for (const item of order.items ?? []) {
      const quantity = Math.max(0, Number(item.quantity ?? 0));
      const lineTotal = item.lineTotal !== undefined && item.lineTotal !== null ? minor(item.lineTotal) : minor(item.unitPrice) * quantity;
      figures.unitsSold += quantity;
      const cost = knownMinor(item.unitCostEstimate);
      if (cost === null) figures.linesWithoutCostEstimate += 1;
      else figures.productCostEstimated += cost * quantity;

      const sku = item.sku || 'unknown';
      bump(bestSellers, sku, item.productName || sku, currency, quantity, lineTotal, true);
      bump(byCategory, item.categoryName || 'Uncategorised', item.categoryName || 'Uncategorised', currency, quantity, lineTotal, true);
    }


    if (order.channel === 'web') {
      const entry: (typeof reconciliation)[number] = {
        reference: order.reference,
        currency,
        total,
        refunded,
        paymentIntentId: order.paymentIntentId ?? null,
        paidAt: order.paidAt ?? null,
      };
      if (!order.paymentIntentId) entry.flag = 'Paid web order with no payment intent id: cannot be matched to a Stripe payment';
      else if (order.paymentProvider && order.paymentProvider !== 'stripe') entry.flag = `Paid through "${order.paymentProvider}", not Stripe`;
      reconciliation.push(entry);
    }
  }

  for (const figures of byCurrency.values()) {
    figures.netRevenue = figures.grossRevenue - figures.refunds;
    figures.estimatedOperatingProfit =
      figures.netRevenue - figures.paymentFeesActual - figures.productCostEstimated - figures.shippingCostActual;

    const notes: string[] = [];
    if (figures.ordersWithFeeUnknown > 0) notes.push(`payment fee not yet known for ${figures.ordersWithFeeUnknown} order(s)`);
    if (figures.ordersWithFeeInOtherCurrency > 0) {
      notes.push(
        `payment fees for ${figures.ordersWithFeeInOtherCurrency} order(s) were charged in another currency (see fees by currency) and are NOT subtracted here — convert them manually`,
      );
    }
    if (figures.linesWithoutCostEstimate > 0) notes.push(`no cost estimate on ${figures.linesWithoutCostEstimate} order line(s)`);
    if (figures.ordersWithShippingCostUnknown > 0) notes.push(`actual postage not entered for ${figures.ordersWithShippingCostUnknown} order(s)`);
    notes.push('excludes duties paid on DDP shipments, packaging, platform and operating overheads');
    figures.completeness = notes;
  }

  const pendingFulfilment: Record<string, number> = {};
  for (const status of PENDING_FULFILMENT) pendingFulfilment[status] = statusCounts[status] ?? 0;

  const inventoryAlerts = (options.stock ?? [])
    .map((row) => ({ ...row, sellable: row.onHand - row.reserved }))
    .filter((row) => row.sellable <= row.lowStockThreshold)
    .map((row) => ({
      sku: row.sku,
      name: options.productNames?.[row.sku] ?? row.sku,
      onHand: row.onHand,
      reserved: row.reserved,
      sellable: Math.max(0, row.sellable),
      lowStockThreshold: row.lowStockThreshold,
      level: row.sellable <= 0 ? ('out' as const) : ('low' as const),
    }))
    .sort((a, b) => a.sellable - b.sellable || a.sku.localeCompare(b.sku));

  return {
    totals: {
      orders: included.length,
      paidOrders: [...byCurrency.values()].reduce((n, f) => n + f.paidOrders, 0),
      unitsSold: [...byCurrency.values()].reduce((n, f) => n + f.unitsSold, 0),
      excludedTestOrders,
    },
    /** One block per order currency. Amounts are integer minor units. */
    money: [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    /** ACTUAL payment fees, grouped by the currency the processor charged them in. */
    paymentFeesByCurrency: [...feesByCurrency.entries()]
      .map(([currency, amount]) => ({ currency, amount }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    bestSellers: sortRanked(bestSellers.values()).slice(0, 20),
    salesByCategory: sortRanked(byCategory.values()),
    salesByCountry: sortRanked(byCountry.values()),
    salesByChannel: sortRanked(byChannel.values()),
    ordersByStatus: statusCounts,
    pendingFulfilment,
    inventoryAlerts,
    stripeReconciliation: reconciliation.sort((a, b) => (a.paidAt ?? '').localeCompare(b.paidAt ?? '')),
  };
}

export type AnalyticsReport = ReturnType<typeof aggregateOrders> & {
  range: { from: string; to: string };
  includeTest: boolean;
  generatedAt: string;
  labels: Record<string, string>;
};

/** Field-level labels the dashboard prints beside each figure. */
export const ANALYTICS_LABELS = {
  grossRevenue: 'ACTUAL — totals of paid orders, including shipping charged',
  refunds: 'ACTUAL — refunded to customers',
  netRevenue: 'ACTUAL — gross revenue minus refunds. Revenue, not profit.',
  paymentFeesActual: 'ACTUAL — fees reported by the payment processor, in the order currency',
  productCostEstimated: 'ESTIMATE — cost price recorded on each order line at the time of sale',
  shippingCostActual: 'ACTUAL — postage entered at fulfilment (unknown where not entered)',
  estimatedOperatingProfit: 'ESTIMATE — net revenue minus the fees, product costs and postage known so far',
};

const ORDER_PAGE = 200;
const MAX_ORDERS = 20_000;

/**
 * Load orders whose `placedAt` (falling back to `createdAt`) is in [from, to)
 * and aggregate them. Dates are ISO strings; `to` is exclusive.
 */
export async function computeAnalytics(
  strapi: Core.Strapi,
  input: { from: string; to: string; includeTest?: boolean },
): Promise<AnalyticsReport> {
  const from = new Date(input.from);
  const to = new Date(input.to);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    throw new Error('Invalid date range');
  }

  const orders: AnalyticsOrder[] = [];
  for (let start = 0; start < MAX_ORDERS; start += ORDER_PAGE) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = (await (strapi as any).documents('api::order.order').findMany({
      filters: {
        $or: [
          { placedAt: { $gte: from.toISOString(), $lt: to.toISOString() } },
          { placedAt: { $null: true }, createdAt: { $gte: from.toISOString(), $lt: to.toISOString() } },
        ],
      },
      populate: { items: true, shippingAddress: { fields: ['country'] } },
      sort: 'createdAt:asc',
      start,
      limit: ORDER_PAGE,
    })) as AnalyticsOrder[];
    orders.push(...page);
    if (page.length < ORDER_PAGE) break;
  }

  const stockMap = await getAllStock(strapi);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inventoryRows = (await (strapi as any).documents('api::inventory-item.inventory-item').findMany({
    fields: ['sku', 'productName'],
    limit: 5000,
  })) as { sku: string; productName?: string | null }[];
  const productNames: Record<string, string> = {};
  for (const row of inventoryRows) if (row.productName) productNames[row.sku] = row.productName;

  const result = aggregateOrders(orders, {
    includeTest: Boolean(input.includeTest),
    productNames,
    stock: [...stockMap.values()],
  });

  return {
    ...result,
    range: { from: from.toISOString(), to: to.toISOString() },
    includeTest: Boolean(input.includeTest),
    generatedAt: new Date().toISOString(),
    labels: ANALYTICS_LABELS,
  };
}
