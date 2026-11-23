import type { MarketplaceOrderInput } from './types';

/**
 * Pure mapping between The Kanjo's catalogue and TikTok Shop payloads.
 *
 * Everything here is a function of its arguments — no Strapi, no network — so
 * the whole mapping layer is unit-tested (cms/tests/tiktok-mapper.test.js).
 *
 * PAYLOAD PROVENANCE: field names follow the 202309 Create Product / Search
 * Orders shapes as implemented by the open-source SDKs. They are the part of
 * this integration most likely to need adjusting against a real sandbox shop,
 * because category rules add REQUIRED attributes per category (and, in
 * Thailand, TIS certification attributes for automotive categories) that only
 * "Get Category Rules" for the seller's own shop can enumerate.
 */

export type MappableProduct = {
  documentId: string;
  name: string;
  sku: string;
  description?: string | null;
  shortDescription?: string | null;
  price?: number | string | null;
  discountPrice?: number | string | null;
  currency: string;
  weightGrams?: number | null;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
  condition?: string | null;
  authenticity?: string | null;
  imageRights?: string | null;
  isSample?: boolean | null;
  category?: { tiktokCategoryId?: string | null; name?: string | null } | null;
  variants?: {
    sku: string;
    label: string;
    color?: string | null;
    size?: string | null;
    material?: string | null;
    finish?: string | null;
    price?: number | string | null;
    discountPrice?: number | string | null;
  }[] | null;
};

export type ListingOverride = { tiktokPrice?: number | string | null; tiktokCurrency?: string | null };

export type MappingContext = {
  /** Currency the shop lists in (THB for a Thai shop). */
  shopCurrency: string;
  warehouseId: string;
  /** TikTok image URIs, already uploaded. First one is the main image. */
  imageUris: string[];
  /** Units to push per SKU — `availableToSell`, which already holds back the marketplace buffer. */
  stockBySku: Record<string, number>;
  /** Optional per-SKU price override held on the listing mapping. */
  overridesBySku?: Record<string, ListingOverride>;
};

export type MappingResult<T> = { ok: true; payload: T } | { ok: false; problems: string[] };

const toNumber = (value: number | string | null | undefined): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

/** Zero-decimal currencies TikTok Shop lists in. */
const ZERO_DECIMAL = new Set(['VND', 'IDR', 'JPY']);

export function formatAmount(value: number, currency: string): string {
  return ZERO_DECIMAL.has(currency) ? String(Math.round(value)) : value.toFixed(2);
}

/**
 * The price to list one SKU at, in the SHOP's currency.
 *
 * There is no currency conversion here, on purpose. Converting a USD price to
 * THB with a rate nobody chose would publish a price the merchant never set.
 * Either the product is already priced in the shop currency, or the listing
 * mapping carries an explicit TikTok price; otherwise the SKU is not listable.
 */
export function resolveListingPrice(
  product: MappableProduct,
  variant: { sku: string; price?: number | string | null; discountPrice?: number | string | null } | undefined,
  context: Pick<MappingContext, 'shopCurrency' | 'overridesBySku'>,
): { amount: number } | { problem: string } {
  const sku = variant?.sku ?? product.sku;
  const override = context.overridesBySku?.[sku];
  const overridePrice = toNumber(override?.tiktokPrice);
  if (overridePrice !== undefined && overridePrice > 0) {
    const overrideCurrency = (override?.tiktokCurrency ?? context.shopCurrency).toUpperCase();
    if (overrideCurrency !== context.shopCurrency) {
      return { problem: `${sku}: the TikTok price is in ${overrideCurrency}, but the shop lists in ${context.shopCurrency}` };
    }
    return { amount: overridePrice };
  }

  if (product.currency.toUpperCase() !== context.shopCurrency) {
    return {
      problem: `${sku}: priced in ${product.currency}, but the shop lists in ${context.shopCurrency}. Set an explicit TikTok price on the listing mapping — prices are never converted automatically`,
    };
  }

  const base = toNumber(variant?.price) ?? toNumber(product.price);
  const discount = toNumber(variant?.discountPrice) ?? (variant?.price ? undefined : toNumber(product.discountPrice));
  const amount = discount !== undefined && base !== undefined && discount > 0 && discount < base ? discount : base;
  if (amount === undefined || amount <= 0) return { problem: `${sku}: no price set` };
  return { amount };
}

/** Reasons a product must not be pushed to TikTok Shop at all. */
export function listingBlockers(product: MappableProduct): string[] {
  const problems: string[] = [];
  if (product.isSample) problems.push('Sample products are never listed on a marketplace');
  if (!product.category?.tiktokCategoryId) {
    problems.push(`Category "${product.category?.name ?? 'none'}" has no TikTok category id mapped`);
  }
  if (product.imageRights === 'not_cleared' || !product.imageRights) {
    problems.push('Image rights are not cleared; a listing needs images we may publish');
  }
  if (product.authenticity === 'unverified') {
    problems.push('Authenticity is unverified; it must be stated before listing');
  }
  if (product.authenticity === 'replica_reproduction') {
    problems.push('Replica/reproduction parts are not pushed automatically: marketplace IP policy must be checked by a person');
  }
  if (product.condition && product.condition !== 'new' && product.condition !== 'new_old_stock') {
    problems.push('Pre-owned automotive parts appear unsupported on TikTok Shop Thailand and are prohibited on TikTok Shop US');
  }
  const weight = toNumber(product.weightGrams);
  if (!weight || weight <= 0) problems.push('Package weight is required');
  return problems;
}

type SalesAttribute = { name: string; value_name: string };

function salesAttributes(variant: NonNullable<MappableProduct['variants']>[number]): SalesAttribute[] {
  const attributes: SalesAttribute[] = [];
  if (variant.color) attributes.push({ name: 'Color', value_name: variant.color });
  if (variant.size) attributes.push({ name: 'Size', value_name: variant.size });
  if (variant.material) attributes.push({ name: 'Material', value_name: variant.material });
  if (variant.finish) attributes.push({ name: 'Finish', value_name: variant.finish });
  // A variant with none of the structured options still needs one
  // distinguishing attribute, or TikTok sees identical SKUs.
  if (attributes.length === 0) attributes.push({ name: 'Option', value_name: variant.label });
  return attributes;
}

/** Markdown-ish text → the minimal HTML TikTok accepts in a description. */
export function descriptionHtml(product: MappableProduct): string {
  const source = (product.description || product.shortDescription || product.name).trim();
  const escape = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return source
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/^#+\s*/gm, '').replace(/[*_`]/g, '').trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escape(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export type CreateProductPayload = {
  save_mode: 'LISTING';
  title: string;
  description: string;
  category_id: string;
  main_images: { uri: string }[];
  package_weight: { value: string; unit: 'KILOGRAM' };
  package_dimensions?: { length: string; width: string; height: string; unit: 'CENTIMETER' };
  skus: {
    seller_sku: string;
    price: { amount: string; currency: string };
    inventory: { warehouse_id: string; quantity: number }[];
    sales_attributes?: SalesAttribute[];
  }[];
};

export function toCreateProductPayload(
  product: MappableProduct,
  context: MappingContext,
): MappingResult<CreateProductPayload> {
  const problems = listingBlockers(product);
  if (context.imageUris.length === 0) problems.push('No product image was uploaded');
  if (!context.warehouseId) problems.push('The shop has no warehouse to hold inventory');

  const variants = product.variants ?? [];
  const skus: CreateProductPayload['skus'] = [];

  const pushSku = (sku: string, variant: NonNullable<MappableProduct['variants']>[number] | undefined) => {
    const price = resolveListingPrice(product, variant, context);
    if ('problem' in price) {
      problems.push(price.problem);
      return;
    }
    skus.push({
      seller_sku: sku,
      price: { amount: formatAmount(price.amount, context.shopCurrency), currency: context.shopCurrency },
      inventory: [{ warehouse_id: context.warehouseId, quantity: Math.max(0, Math.floor(context.stockBySku[sku] ?? 0)) }],
      ...(variant ? { sales_attributes: salesAttributes(variant) } : {}),
    });
  };

  if (variants.length === 0) pushSku(product.sku, undefined);
  else for (const variant of variants) pushSku(variant.sku, variant);

  const seen = new Set<string>();
  for (const sku of skus) {
    if (seen.has(sku.seller_sku)) problems.push(`Duplicate SKU ${sku.seller_sku}`);
    seen.add(sku.seller_sku);
  }

  if (problems.length > 0) return { ok: false, problems };

  const weightKg = (Number(product.weightGrams) / 1000).toFixed(3);
  const dims = [product.lengthMm, product.widthMm, product.heightMm].map((value) => toNumber(value));
  const hasDims = dims.every((value) => value !== undefined && value > 0);

  return {
    ok: true,
    payload: {
      save_mode: 'LISTING',
      // TikTok titles are capped; ours are capped at 140 in the schema already.
      title: product.name.slice(0, 255),
      description: descriptionHtml(product),
      category_id: String(product.category?.tiktokCategoryId),
      main_images: context.imageUris.slice(0, 9).map((uri) => ({ uri })),
      package_weight: { value: weightKg, unit: 'KILOGRAM' },
      ...(hasDims
        ? {
            package_dimensions: {
              length: String(Math.ceil((dims[0] as number) / 10)),
              width: String(Math.ceil((dims[1] as number) / 10)),
              height: String(Math.ceil((dims[2] as number) / 10)),
              unit: 'CENTIMETER' as const,
            },
          }
        : {}),
      skus,
    },
  };
}

export function toPriceUpdatePayload(
  entries: { tiktokSkuId: string; amount: number }[],
  shopCurrency: string,
) {
  return {
    skus: entries.map((entry) => ({
      id: entry.tiktokSkuId,
      price: { amount: formatAmount(entry.amount, shopCurrency), currency: shopCurrency },
    })),
  };
}

export function toInventoryUpdatePayload(
  entries: { tiktokSkuId: string; quantity: number }[],
  warehouseId: string,
) {
  return {
    skus: entries.map((entry) => ({
      id: entry.tiktokSkuId,
      inventory: [{ warehouse_id: warehouseId, quantity: Math.max(0, Math.floor(entry.quantity)) }],
    })),
  };
}

// ── Orders ──────────────────────────────────────────────────────────────────

/** TikTok order statuses that mean the buyer has paid. */
const PAID_STATUSES = new Set([
  'AWAITING_SHIPMENT',
  'PARTIALLY_SHIPPING',
  'AWAITING_COLLECTION',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
]);

const minorFactor = (currency: string) => (ZERO_DECIMAL.has(currency) ? 1 : 100);

export function toMinor(value: unknown, currency: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * minorFactor(currency));
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : value == null ? '' : String(value));

/**
 * One TikTok order → the commerce core's marketplace order input.
 *
 * Returns `null` for an order that is not ours to import yet (unpaid, on
 * hold) and a `skipped` reason for one that cannot be imported safely. A line
 * with no seller SKU cannot be matched to our inventory, so the whole order is
 * skipped with a reason rather than imported with a guessed product.
 */
export function mapTikTokOrder(
  raw: Record<string, unknown>,
): { input: MarketplaceOrderInput } | { skipped: string } | null {
  const id = text(raw.id);
  if (!id) return { skipped: 'order has no id' };

  const status = text(raw.status).toUpperCase();
  let mapped: 'paid' | 'cancelled';
  if (status === 'CANCELLED') mapped = 'cancelled';
  else if (PAID_STATUSES.has(status)) mapped = 'paid';
  else return null;

  const payment = (raw.payment ?? {}) as Record<string, unknown>;
  const currency = text(payment.currency).toUpperCase();
  if (!currency) return { skipped: `order ${id}: no payment currency` };

  // TikTok reports one line item per UNIT; fold them by seller SKU.
  const lines = Array.isArray(raw.line_items) ? (raw.line_items as Record<string, unknown>[]) : [];
  const bySku = new Map<string, MarketplaceOrderInput['items'][number]>();
  for (const line of lines) {
    const sku = text(line.seller_sku);
    if (!sku) return { skipped: `order ${id}: a line item has no seller SKU` };
    const unitPriceMinor = toMinor(line.sale_price, currency);
    const existing = bySku.get(sku);
    if (existing) existing.quantity += 1;
    else {
      bySku.set(sku, {
        sku,
        quantity: 1,
        unitPriceMinor,
        productName: text(line.product_name) || sku,
        externalLineId: text(line.id) || undefined,
      });
    }
  }
  if (bySku.size === 0) return { skipped: `order ${id}: no line items` };

  const recipient = (raw.recipient_address ?? {}) as Record<string, unknown>;
  const districts = Array.isArray(recipient.district_info)
    ? (recipient.district_info as Record<string, unknown>[])
    : [];
  const district = (level: string) =>
    text(districts.find((entry) => text(entry.address_level_name).toLowerCase() === level)?.address_name);

  const name = text(recipient.name) || 'TikTok Shop buyer';
  const line1 = text(recipient.address_line1) || text(recipient.address_detail) || text(recipient.full_address);
  const country = text(recipient.region_code).toUpperCase();
  const paidTime = Number(raw.paid_time);

  return {
    input: {
      channel: 'tiktok_shop',
      externalOrderId: id,
      status: mapped,
      customerName: name,
      email: text(raw.buyer_email) || undefined,
      address:
        line1 && country
          ? {
              name,
              line1,
              line2: text(recipient.address_line2) || undefined,
              city: district('city') || district('district') || text(recipient.address_line3) || '-',
              region: district('province') || district('state') || undefined,
              postalCode: text(recipient.postal_code) || undefined,
              country,
              phone: text(recipient.phone_number) || undefined,
            }
          : undefined,
      currency,
      items: [...bySku.values()],
      shippingMinor: toMinor(payment.shipping_fee, currency),
      totalMinor: toMinor(payment.total_amount, currency),
      paidAt: Number.isFinite(paidTime) && paidTime > 0 ? new Date(paidTime * 1000).toISOString() : undefined,
    },
  };
}
