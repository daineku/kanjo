import type { Core } from '@strapi/strapi';

import { checkoutState, findAll, loadCatalogIndex, unitIndex, type SellableUnit, type StoreSettings } from './catalog';
import { getStock } from './inventory';
import type { Currency, Money } from './money';
import { toMinor } from './money';
import { cleanCountry, countryList, splitList } from './util';

/**
 * The cart quote: the server's answer to "what would this cart cost".
 *
 * The browser sends SKUs and quantities and NOTHING else. Prices, totals,
 * stock, weight and shipping are all recomputed here from the database on
 * every call — the same function runs again inside checkout, so the number a
 * customer is shown and the number they are charged come from one place.
 *
 * ── SHIPPING IS QUOTED ONLY FROM VERIFIED RATES ─────────────────────────────
 *
 * A shipping rate reaches a customer only when it is enabled, belongs to an
 * enabled zone that lists the destination, is in the store currency, covers
 * the cart's weight, and carries `verified: true` — set by a person who
 * checked it against the carrier's tariff. If no rate qualifies the quote says
 * WHY and returns no options; the site then offers a manual quote. No rate is
 * estimated, interpolated or defaulted.
 */

export type CartItemInput = { sku: string; quantity: number };

export type QuoteLine = {
  unit: SellableUnit;
  quantity: number;
  requestedQuantity: number;
  issues: string[];
};

export type ShippingOption = {
  id: string;
  carrier: string;
  serviceName: string;
  price: Money;
  incoterm: 'DAP' | 'DDP';
  minDays?: number;
  maxDays?: number;
  tracked: boolean;
  zoneCode: string;
};

export type Quote = {
  settings: StoreSettings;
  currency: Currency;
  lines: QuoteLine[];
  removedSkus: string[];
  subtotalMinor: number;
  totalWeightGrams: number;
  country?: string;
  shippingOptions: ShippingOption[];
  shippingUnavailableReason?: string;
  handlingDays: number;
  checkoutEnabled: boolean;
  canCheckout: boolean;
};

const MAX_LINES = 50;
const MAX_QUANTITY = 99;

/** Bounds and de-duplicates what the browser sent. Throws nothing; bad rows are dropped. */
export function normalizeItems(input: unknown): CartItemInput[] {
  if (!Array.isArray(input)) return [];
  const merged = new Map<string, number>();
  for (const raw of input.slice(0, MAX_LINES * 2)) {
    const sku = typeof raw?.sku === 'string' ? raw.sku.trim().slice(0, 64) : '';
    const quantity = Math.floor(Number(raw?.quantity));
    if (!sku || !Number.isFinite(quantity) || quantity < 1) continue;
    merged.set(sku, Math.min(MAX_QUANTITY, (merged.get(sku) ?? 0) + quantity));
  }
  return [...merged].slice(0, MAX_LINES).map(([sku, quantity]) => ({ sku, quantity }));
}

/** Issues that stop a line being sold at all (as opposed to "we lowered the quantity"). */
const BLOCKING = new Set(['not_purchasable', 'out_of_stock', 'price_unavailable', 'not_shippable_to_country']);

export async function quoteCart(
  strapi: Core.Strapi,
  rawItems: unknown,
  rawCountry?: unknown,
): Promise<Quote> {
  const items = normalizeItems(rawItems);
  const country = cleanCountry(rawCountry);

  const index = await loadCatalogIndex(strapi);
  const settings = index.settings;
  // Stock is read FRESH for exactly the SKUs in the cart; only the catalogue
  // content comes from the short memo.
  const stock = await getStock(strapi, items.map((item) => item.sku));
  const units = unitIndex(index, stock);

  const lines: QuoteLine[] = [];
  const removedSkus: string[] = [];

  for (const item of items) {
    const unit = units.get(item.sku);
    if (!unit) {
      removedSkus.push(item.sku);
      continue;
    }
    const issues: string[] = [];
    let quantity = item.quantity;

    if (!unit.price) issues.push('price_unavailable');
    if (!unit.purchasable) {
      issues.push(unit.availability === 'out_of_stock' ? 'out_of_stock' : 'not_purchasable');
      quantity = 0;
    } else if (unit.maxQuantity !== undefined && quantity > unit.maxQuantity) {
      quantity = unit.maxQuantity;
      issues.push('quantity_reduced');
    }

    if (country) {
      const domestic = country === 'TH';
      if ((!unit.internationalShipping && !domestic) || unit.restrictedCountries.includes(country)) {
        issues.push('not_shippable_to_country');
      }
    }
    lines.push({ unit, quantity, requestedQuantity: item.quantity, issues });
  }

  const sellableLines = lines.filter((line) => line.quantity > 0 && line.unit.price);
  const subtotalMinor = sellableLines.reduce((sum, line) => sum + line.unit.price!.amount * line.quantity, 0);
  const weightKnown = sellableLines.every((line) => typeof line.unit.weightGrams === 'number' && line.unit.weightGrams > 0);
  const totalWeightGrams = sellableLines.reduce((sum, line) => sum + (line.unit.weightGrams ?? 0) * line.quantity, 0);

  let shippingOptions: ShippingOption[] = [];
  let shippingUnavailableReason: string | undefined;

  if (!country) {
    shippingUnavailableReason = 'no_country';
  } else if (sellableLines.length === 0) {
    shippingUnavailableReason = undefined;
  } else if (lines.some((line) => line.issues.includes('not_shippable_to_country'))) {
    shippingUnavailableReason = 'restricted_item';
  } else if (!weightKnown) {
    // A rate is chosen by weight. Guessing a weight is guessing a price.
    shippingUnavailableReason = 'weight_unknown';
  } else {
    const result = await shippingOptionsFor(strapi, settings, country, totalWeightGrams, sellableLines);
    shippingOptions = result.options;
    shippingUnavailableReason = result.reason;
  }

  const checkout = checkoutState(settings);
  // A lowered quantity is not blocking for the cart page, but the customer
  // must see the new number before paying, so it blocks checkout until the
  // cart is re-saved at the quantity on offer.
  const clean =
    lines.length > 0 &&
    removedSkus.length === 0 &&
    lines.every((line) => line.quantity === line.requestedQuantity && !line.issues.some((issue) => BLOCKING.has(issue)));

  return {
    settings,
    currency: settings.currency,
    lines,
    removedSkus,
    subtotalMinor,
    totalWeightGrams,
    country,
    shippingOptions,
    shippingUnavailableReason,
    handlingDays: sellableLines.reduce((max, line) => Math.max(max, line.unit.handlingDays), 0),
    checkoutEnabled: checkout.enabled,
    canCheckout: checkout.enabled && clean && sellableLines.length === lines.length,
  };
}

async function shippingOptionsFor(
  strapi: Core.Strapi,
  settings: StoreSettings,
  country: string,
  weightGrams: number,
  lines: QuoteLine[],
): Promise<{ options: ShippingOption[]; reason?: string }> {
  if (settings.blockedCountries.includes(country)) return { options: [], reason: 'country_not_served' };

  const zones = (
    await findAll(strapi, 'api::shipping-zone.shipping-zone', { filters: { enabled: true }, populate: { rates: true } })
  ).filter((zone) => countryList(zone.countries).includes(country));
  if (zones.length === 0) return { options: [], reason: 'country_not_served' };

  const classes = new Set(lines.map((line) => line.unit.shippingClass));
  const options: ShippingOption[] = [];

  for (const zone of zones) {
    for (const rate of zone.rates ?? []) {
      if (rate.enabled === false || rate.verified !== true) continue;
      if (rate.currency !== settings.currency) continue;
      if (weightGrams < (rate.minWeightGrams ?? 0) || weightGrams > rate.maxWeightGrams) continue;
      if (splitList(rate.excludedShippingClasses).some((excluded) => classes.has(excluded))) continue;
      const price = toMinor(rate.price);
      if (price === null) continue;
      options.push({
        id: rate.documentId,
        carrier: rate.carrier,
        serviceName: rate.serviceName,
        price: { amount: price, currency: settings.currency },
        incoterm: rate.incoterm === 'DDP' ? 'DDP' : 'DAP',
        minDays: rate.minDays ?? undefined,
        maxDays: rate.maxDays ?? undefined,
        tracked: rate.tracked !== false,
        zoneCode: zone.code,
      });
    }
  }

  options.sort((a, b) => a.price.amount - b.price.amount);
  return options.length > 0 ? { options } : { options, reason: 'no_verified_rate' };
}

/** The quote in the shape lib/store/types.ts → CartQuote declares. */
export function publicQuote(quote: Quote) {
  const currency = quote.currency;
  return {
    currency,
    lines: quote.lines.map((line) => ({
      sku: line.unit.sku,
      productSlug: line.unit.productSlug,
      productName: line.unit.productName,
      variantLabel: line.unit.variantLabel,
      image: line.unit.image,
      quantity: line.quantity,
      requestedQuantity: line.requestedQuantity,
      unitPrice: line.unit.price ?? { amount: 0, currency },
      compareAtUnitPrice: line.unit.compareAtPrice,
      lineTotal: { amount: (line.unit.price?.amount ?? 0) * line.quantity, currency },
      availability: line.unit.availability,
      maxQuantity: line.unit.maxQuantity,
      issues: line.issues,
      isSample: line.unit.isSample,
    })),
    removedSkus: quote.removedSkus,
    subtotal: { amount: quote.subtotalMinor, currency },
    totalWeightGrams: quote.totalWeightGrams,
    country: quote.country,
    shippingOptions: quote.shippingOptions.map(({ zoneCode: _zone, ...option }) => option),
    shippingUnavailableReason: quote.shippingUnavailableReason,
    customsDisclosure: quote.settings.customsDisclosure,
    handlingDays: quote.handlingDays,
    checkoutEnabled: quote.checkoutEnabled,
    canCheckout: quote.canCheckout,
  };
}
