import type { Core } from '@strapi/strapi';

import { allowSampleCatalog, env, paymentModeFromEnv, publicOrigin } from './config';
import { getAllStock, sellable, type StockRow } from './inventory';
import { isCurrency, toMinor, type Currency, type Money } from './money';
import { countryList, splitList } from './util';

/**
 * The public catalogue: what the storefront is allowed to know.
 *
 * ── AN ALLOWLIST, NOT A FILTER ──────────────────────────────────────────────
 *
 * Nothing here spreads a database record into a response. Every public shape
 * is BUILT, field by field, from the record — so the cost price, the supplier,
 * the source URL, the margin and the provenance notes are not "removed" from
 * the output; they were never put in it. Adding a private field to a schema
 * cannot leak it. The shapes mirror lib/store/types.ts in the website.
 *
 * ── AVAILABILITY IS COMPUTED, NEVER TYPED ───────────────────────────────────
 *
 * An editor chooses a fulfilment MODE (in stock / made to order / sourced on
 * demand / …). Whether a visitor can actually buy is decided here, from that
 * mode plus the live inventory record plus how recently the supplier was
 * verified. A product marked "in stock" with no counted units is out of stock.
 */

export type Availability =
  | 'in_stock'
  | 'low_stock'
  | 'made_to_order'
  | 'source_on_demand'
  | 'on_request'
  | 'out_of_stock'
  | 'coming_soon'
  | 'discontinued';

export type StoreSettings = {
  currency: Currency;
  checkoutSwitch: boolean;
  checkoutDisabledMessage?: string;
  handlingDays: { inStock: number; sourced: number; madeToOrder: number };
  reservationMinutes: number;
  sourcingVerificationDays: number;
  customsDisclosure?: string;
  blockedCountries: string[];
  supportEmail?: string;
  reviewsEnabled: boolean;
};

/** One thing a customer can put in a cart: a product without variants, or one variant. */
export type SellableUnit = {
  sku: string;
  productDocumentId: string;
  productSlug: string;
  productName: string;
  variantLabel?: string;
  categoryName?: string;
  price?: Money;
  compareAtPrice?: Money;
  mode: string;
  availability: Availability;
  purchasable: boolean;
  /** True when a sale must take units from the inventory record. */
  tracksStock: boolean;
  maxQuantity?: number;
  weightGrams?: number;
  shippingClass: string;
  internationalShipping: boolean;
  restrictedCountries: string[];
  hsCode?: string;
  countryOfOrigin?: string;
  handlingDays: number;
  image?: PublicImage;
  isSample: boolean;
  /** Admin-only: snapshot into the order line as an ESTIMATE, never sent to the storefront. */
  costPriceMinor?: number;
};

export type PublicImage = { url: string; width: number; height: number; alt: string };

export type CatalogIndex = {
  loadedAt: number;
  settings: StoreSettings;
  products: any[];
  categories: any[];
  brands: any[];
  vehicles: any[];
};

const MAX_ORDER_QUANTITY = 99;
const PRODUCT_UID = 'api::product.product';

const PRODUCT_POPULATE = {
  brand: true,
  category: { populate: { parent: true } },
  mainImage: true,
  gallery: true,
  video: true,
  specifications: true,
  seo: true,
  variants: { populate: { image: true, vehicle: true } },
  fitments: { populate: { vehicle: { populate: { make: true } } } },
} as const;

// ── loading, with a short in-process memo ───────────────────────────────────

let memo: CatalogIndex | undefined;
const MEMO_MS = 30_000;

/** Called by the guard middlewares whenever catalogue content changes. */
export function invalidateCatalog() {
  memo = undefined;
}

async function findAll(strapi: Core.Strapi, uid: string, params: Record<string, unknown>): Promise<any[]> {
  const out: any[] = [];
  const limit = 100;
  for (let start = 0; ; start += limit) {
    const page = await strapi.documents(uid as any).findMany({ ...params, start, limit } as any);
    out.push(...page);
    if (page.length < limit) return out;
  }
}

export async function loadSettings(strapi: Core.Strapi): Promise<StoreSettings> {
  const raw: any = (await strapi.documents('api::store-setting.store-setting' as any).findFirst({})) ?? {};
  return {
    currency: isCurrency(raw.storeCurrency) ? raw.storeCurrency : 'USD',
    checkoutSwitch: raw.checkoutEnabled === true,
    checkoutDisabledMessage: raw.checkoutDisabledMessage || undefined,
    handlingDays: {
      inStock: raw.handlingDaysInStock ?? 3,
      sourced: raw.handlingDaysSourced ?? 14,
      madeToOrder: raw.handlingDaysMadeToOrder ?? 10,
    },
    reservationMinutes: Math.max(31, raw.reservationMinutes ?? 45),
    sourcingVerificationDays: raw.sourcingVerificationDays ?? 30,
    customsDisclosure: raw.customsDisclosure || undefined,
    blockedCountries: countryList(raw.blockedCountries),
    supportEmail: raw.supportEmail || undefined,
    reviewsEnabled: raw.reviewsEnabled !== false,
  };
}

export async function loadCatalogIndex(strapi: Core.Strapi, { fresh = false } = {}): Promise<CatalogIndex> {
  if (!fresh && memo && Date.now() - memo.loadedAt < MEMO_MS) return memo;

  const samples = allowSampleCatalog(env());
  const [settings, products, categories, brands, vehicles] = await Promise.all([
    loadSettings(strapi),
    findAll(strapi, PRODUCT_UID, { status: 'published', populate: PRODUCT_POPULATE }),
    findAll(strapi, 'api::category.category', { populate: { parent: true, seo: true }, sort: ['sortOrder:asc', 'name:asc'] }),
    findAll(strapi, 'api::brand.brand', { sort: ['name:asc'] }),
    findAll(strapi, 'api::vehicle.vehicle', { populate: { make: true }, sort: ['sortOrder:asc', 'yearFrom:asc'] }),
  ]);

  memo = {
    loadedAt: Date.now(),
    settings,
    // A sample is served only when the process was started asking for samples.
    // An archived product is never served, published or not.
    products: products.filter((p) => p.reviewStatus !== 'archived' && (samples || p.isSample !== true)),
    categories: categories.filter((c) => c.hidden !== true),
    brands,
    vehicles,
  };
  return memo;
}

// ── pricing ─────────────────────────────────────────────────────────────────

function priceOf(
  currency: Currency,
  price: unknown,
  discount: unknown,
): { price?: Money; compareAtPrice?: Money } {
  const base = toMinor(price);
  if (base === null || base <= 0) return {};
  const reduced = toMinor(discount);
  if (reduced !== null && reduced > 0 && reduced < base) {
    return { price: { amount: reduced, currency }, compareAtPrice: { amount: base, currency } };
  }
  return { price: { amount: base, currency } };
}

// ── availability ────────────────────────────────────────────────────────────

function sourcingIsFresh(product: any, settings: StoreSettings): boolean {
  if (!product.lastVerifiedAt) return false;
  if (!['available', 'limited'].includes(product.supplierAvailability)) return false;
  const ageMs = Date.now() - new Date(product.lastVerifiedAt).getTime();
  return ageMs >= 0 && ageMs <= settings.sourcingVerificationDays * 86_400_000;
}

function availabilityFor(
  product: any,
  stock: StockRow | undefined,
  settings: StoreSettings,
  hasPrice: boolean,
): { availability: Availability; purchasable: boolean; tracksStock: boolean; maxQuantity?: number } {
  const mode: string = product.availability;

  if (mode === 'coming_soon' || mode === 'discontinued' || mode === 'out_of_stock') {
    return { availability: mode, purchasable: false, tracksStock: false };
  }

  if (mode === 'in_stock') {
    const units = sellable(stock);
    if (units <= 0) return { availability: 'out_of_stock', purchasable: false, tracksStock: true };
    if (!hasPrice) return { availability: 'on_request', purchasable: false, tracksStock: true };
    const low = units <= (stock?.lowStockThreshold ?? 0);
    return {
      availability: low ? 'low_stock' : 'in_stock',
      purchasable: true,
      tracksStock: true,
      maxQuantity: Math.min(units, MAX_ORDER_QUANTITY),
    };
  }

  if (mode === 'made_to_order') {
    return hasPrice
      ? { availability: 'made_to_order', purchasable: true, tracksStock: false, maxQuantity: MAX_ORDER_QUANTITY }
      : { availability: 'on_request', purchasable: false, tracksStock: false };
  }

  if (mode === 'source_on_demand') {
    // Sold without stock, so it is only offered while somebody has recently
    // confirmed the supplier can still provide it.
    return hasPrice && sourcingIsFresh(product, settings)
      ? { availability: 'source_on_demand', purchasable: true, tracksStock: false, maxQuantity: 5 }
      : { availability: 'on_request', purchasable: false, tracksStock: false };
  }

  return { availability: 'out_of_stock', purchasable: false, tracksStock: false };
}

function handlingDaysFor(product: any, settings: StoreSettings): number {
  if (typeof product.handlingDays === 'number') return product.handlingDays;
  if (product.availability === 'made_to_order' || product.madeToOrder) return settings.handlingDays.madeToOrder;
  if (product.availability === 'source_on_demand') return settings.handlingDays.sourced;
  return settings.handlingDays.inStock;
}

// ── images ──────────────────────────────────────────────────────────────────

function image(file: any, fallbackAlt: string): PublicImage | undefined {
  if (!file?.url || !file.width || !file.height) return undefined;
  const url = String(file.url).startsWith('/') ? `${publicOrigin(env())}${file.url}` : String(file.url);
  return { url, width: file.width, height: file.height, alt: file.alternativeText || fallbackAlt };
}

/**
 * Images are published only when somebody has recorded the right to use them.
 * `not_cleared` is the default for anything imported, so a supplier's photo
 * cannot reach the site by being attached and forgotten.
 */
function imagesCleared(product: any): boolean {
  return product.imageRights && product.imageRights !== 'not_cleared';
}

// ── sellable units ──────────────────────────────────────────────────────────

export function sellableUnits(product: any, stock: Map<string, StockRow>, settings: StoreSettings): SellableUnit[] {
  // A price in a currency other than the store's cannot be charged in one
  // checkout session, so it is treated as "no price": the product is shown and
  // offered by enquiry instead of being sold at a silently-converted figure.
  const currencyOk = product.currency === settings.currency;
  const cleared = imagesCleared(product);
  const mainImage = cleared ? image(product.mainImage, product.name) : undefined;

  const common = {
    productDocumentId: product.documentId as string,
    productSlug: product.slug as string,
    productName: product.name as string,
    categoryName: product.category?.name as string | undefined,
    mode: product.availability as string,
    shippingClass: (product.shippingClass ?? 'standard') as string,
    internationalShipping: product.internationalShipping !== false,
    restrictedCountries: countryList(product.restrictedCountries),
    hsCode: product.hsCode || undefined,
    countryOfOrigin: product.countryOfOrigin || undefined,
    handlingDays: handlingDaysFor(product, settings),
    isSample: product.isSample === true,
    costPriceMinor: toMinor(product.costPrice) ?? undefined,
  };

  const variants: any[] = Array.isArray(product.variants) ? product.variants : [];
  if (variants.length === 0) {
    const pricing = currencyOk ? priceOf(settings.currency, product.price, product.discountPrice) : {};
    return [
      {
        ...common,
        sku: product.sku,
        ...pricing,
        ...availabilityFor(product, stock.get(product.sku), settings, Boolean(pricing.price)),
        weightGrams: product.weightGrams ?? undefined,
        image: mainImage,
      },
    ];
  }

  return variants.map((variant) => {
    const ownPrice = toMinor(variant.price) !== null;
    const pricing = !currencyOk
      ? {}
      : ownPrice
        ? priceOf(settings.currency, variant.price, variant.discountPrice)
        : priceOf(settings.currency, product.price, product.discountPrice);
    return {
      ...common,
      sku: variant.sku,
      variantLabel: variant.label,
      ...pricing,
      ...availabilityFor(product, stock.get(variant.sku), settings, Boolean(pricing.price)),
      weightGrams: variant.weightGrams ?? product.weightGrams ?? undefined,
      image: (cleared ? image(variant.image, `${product.name} — ${variant.label}`) : undefined) ?? mainImage,
    };
  });
}

/** Every SKU the store could sell, keyed by SKU. Stock is read fresh by the caller. */
export function unitIndex(index: CatalogIndex, stock: Map<string, StockRow>): Map<string, SellableUnit> {
  const out = new Map<string, SellableUnit>();
  for (const product of index.products) {
    for (const unit of sellableUnits(product, stock, index.settings)) out.set(unit.sku, unit);
  }
  return out;
}

// ── public serialisers ──────────────────────────────────────────────────────

const AVAILABILITY_RANK: Availability[] = [
  'in_stock',
  'low_stock',
  'made_to_order',
  'source_on_demand',
  'on_request',
  'coming_soon',
  'out_of_stock',
  'discontinued',
];

function vehicleLabel(vehicle: any): string {
  return vehicle?.label ?? '';
}

function fitmentRows(product: any) {
  const rows: any[] = Array.isArray(product.fitments) ? product.fitments : [];
  return rows
    .filter((row) => row.vehicle?.documentId)
    .map((row) => {
      const vehicle = row.vehicle;
      return {
        vehicleId: vehicle.documentId as string,
        vehicleSlug: vehicle.slug as string,
        vehicleLabel: vehicleLabel(vehicle),
        make: (vehicle.make?.name ?? '') as string,
        model: vehicle.model as string,
        chassisCode: vehicle.chassisCode as string,
        // A fitment with no explicit state is unverified. It is never promoted.
        status: (['confirmed', 'conditional', 'unverified'].includes(row.status) ? row.status : 'unverified') as string,
        yearFrom: (row.yearFrom ?? vehicle.yearFrom) as number,
        yearTo: (row.yearTo ?? vehicle.yearTo ?? undefined) as number | undefined,
        engine: row.engine || undefined,
        bodyStyle: row.bodyStyle || undefined,
        market: row.market || undefined,
        installationRequirements: row.installationRequirements || undefined,
        notes: row.notes || undefined,
      };
    });
}

export type RatingIndex = Map<string, { average: number; count: number }>;

export function summarize(product: any, stock: Map<string, StockRow>, settings: StoreSettings, ratings: RatingIndex) {
  const units = sellableUnits(product, stock, settings);
  const priced = units.filter((unit) => unit.price);
  const pool = priced.filter((unit) => unit.purchasable).length > 0 ? priced.filter((unit) => unit.purchasable) : priced;
  const cheapest = pool.slice().sort((a, b) => a.price!.amount - b.price!.amount)[0];
  const best = units
    .slice()
    .sort((a, b) => AVAILABILITY_RANK.indexOf(a.availability) - AVAILABILITY_RANK.indexOf(b.availability))[0];
  const fitments = fitmentRows(product);
  const rating = ratings.get(product.documentId);

  return {
    id: product.documentId as string,
    slug: product.slug as string,
    sku: product.sku as string,
    name: product.name as string,
    brand: product.brand?.name || undefined,
    brandSlug: product.brand?.slug || undefined,
    categorySlug: product.category?.slug || undefined,
    categoryName: product.category?.name || undefined,
    productType: product.productType,
    authenticity: product.authenticity ?? 'unverified',
    condition: product.condition ?? 'new',
    shortDescription: product.shortDescription || undefined,
    price: cheapest?.price,
    compareAtPrice: cheapest?.compareAtPrice,
    priceVaries: new Set(priced.map((unit) => unit.price!.amount)).size > 1,
    availability: (best?.availability ?? 'out_of_stock') as Availability,
    purchasable: units.some((unit) => unit.purchasable),
    image: imagesCleared(product) ? image(product.mainImage, product.name) : undefined,
    featured: product.featured === true,
    madeToOrder: product.madeToOrder === true || product.availability === 'made_to_order',
    universalFit: product.universalFit === true,
    fitments: fitments.map(({ vehicleId, vehicleSlug, chassisCode, status, yearFrom, yearTo }) => ({
      vehicleId,
      vehicleSlug,
      chassisCode,
      status,
      yearFrom,
      yearTo,
    })),
    tags: splitList(product.tags),
    publishedAt: product.publishedAt,
    updatedAt: product.updatedAt,
    popularity: product.unitsSold ?? 0,
    ...(rating ? { rating } : {}),
    isSample: product.isSample === true,
  };
}

export function detail(
  product: any,
  index: CatalogIndex,
  stock: Map<string, StockRow>,
  ratings: RatingIndex,
) {
  const settings = index.settings;
  const units = sellableUnits(product, stock, settings);
  const cleared = imagesCleared(product);
  const variants: any[] = Array.isArray(product.variants) ? product.variants : [];
  const fitments = fitmentRows(product);

  const gallery: PublicImage[] = [];
  if (cleared) {
    for (const file of [product.mainImage, ...(Array.isArray(product.gallery) ? product.gallery : [])]) {
      const item = image(file, product.name);
      if (item && !gallery.some((existing) => existing.url === item.url)) gallery.push(item);
    }
  }

  // Related: same category first, then anything sharing a fitted vehicle.
  const vehicleIds = new Set(fitments.map((row) => row.vehicleId));
  const related = index.products
    .filter((other) => other.documentId !== product.documentId)
    .map((other) => {
      const sameCategory = other.category?.documentId && other.category.documentId === product.category?.documentId;
      const sharesVehicle = (other.fitments ?? []).some((row: any) => vehicleIds.has(row.vehicle?.documentId));
      return { slug: other.slug as string, score: (sameCategory ? 2 : 0) + (sharesVehicle ? 1 : 0) };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((entry) => entry.slug);

  const single = variants.length === 0 ? units[0] : undefined;

  return {
    ...summarize(product, stock, settings, ratings),
    manufacturer: product.manufacturer || undefined,
    description: product.description || undefined,
    specifications: (product.specifications ?? []).map((spec: any) => ({ label: spec.label, value: spec.value })),
    gallery,
    videoUrl: cleared && product.video?.url ? image({ ...product.video, width: 1, height: 1 }, '')?.url : undefined,
    variants: variants.map((variant, i) => {
      const unit = units[i]!;
      return {
        sku: unit.sku,
        label: variant.label,
        color: variant.color || undefined,
        size: variant.size || undefined,
        material: variant.material || undefined,
        finish: variant.finish || undefined,
        vehicleLabel: variant.vehicle ? vehicleLabel(variant.vehicle) : undefined,
        // A variant with no chargeable price is listed, not sold: amount 0 never
        // reaches a customer as a price because `purchasable` is false with it.
        price: unit.price ?? { amount: 0, currency: settings.currency },
        compareAtPrice: unit.compareAtPrice,
        availability: unit.availability,
        purchasable: unit.purchasable,
        maxQuantity: unit.maxQuantity,
        image: cleared ? image(variant.image, `${product.name} — ${variant.label}`) : undefined,
      };
    }),
    fitmentDetails: fitments,
    countryOfOrigin: product.countryOfOrigin || undefined,
    weightGrams: product.weightGrams ?? undefined,
    dimensionsMm:
      product.lengthMm || product.widthMm || product.heightMm
        ? { length: product.lengthMm ?? undefined, width: product.widthMm ?? undefined, height: product.heightMm ?? undefined }
        : undefined,
    shippingClass: product.shippingClass ?? 'standard',
    internationalShipping: product.internationalShipping !== false,
    handlingDays: handlingDaysFor(product, settings),
    maxQuantity: single?.maxQuantity,
    seoTitle: product.seo?.metaTitle || undefined,
    seoDescription: product.seo?.metaDescription || undefined,
    canonicalUrl: product.seo?.canonicalUrl || undefined,
    noIndex: product.seo?.noIndex === true || product.isSample === true,
    relatedSlugs: related,
  };
}

export async function loadRatings(strapi: Core.Strapi): Promise<RatingIndex> {
  const rows = await findAll(strapi, 'api::review.review', {
    filters: { status: 'approved' },
    fields: ['productDocumentId', 'rating'],
  });
  const sums = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    const entry = sums.get(row.productDocumentId) ?? { total: 0, count: 0 };
    entry.total += row.rating;
    entry.count += 1;
    sums.set(row.productDocumentId, entry);
  }
  const out: RatingIndex = new Map();
  for (const [id, { total, count }] of sums) {
    out.set(id, { average: Math.round((total / count) * 10) / 10, count });
  }
  return out;
}

/** The storefront's `checkoutEnabled`: the owner's switch AND working credentials. */
export function checkoutState(settings: StoreSettings) {
  const mode = paymentModeFromEnv(env());
  const enabled = settings.checkoutSwitch && mode.kind !== 'disabled';
  return {
    enabled,
    testMode: mode.kind !== 'disabled' && mode.testMode,
    message: enabled ? undefined : settings.checkoutDisabledMessage,
  };
}

export async function buildCatalog(strapi: Core.Strapi) {
  const [index, stock, ratings, shippingCountries] = await Promise.all([
    loadCatalogIndex(strapi),
    getAllStock(strapi),
    loadRatings(strapi),
    servedCountries(strapi),
  ]);
  const settings = index.settings;
  const products = index.products.map((product) => summarize(product, stock, settings, ratings));
  const checkout = checkoutState(settings);

  // Counts include a category's descendants, so a parent with products only in
  // its children is not reported (and indexed) as empty.
  const direct = new Map<string, number>();
  for (const product of products) {
    if (product.categorySlug) direct.set(product.categorySlug, (direct.get(product.categorySlug) ?? 0) + 1);
  }
  const childrenOf = new Map<string, string[]>();
  for (const category of index.categories) {
    const parent = category.parent?.slug;
    if (parent) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), category.slug]);
  }
  const total = (slug: string, seen = new Set<string>()): number => {
    if (seen.has(slug)) return 0;
    seen.add(slug);
    return (direct.get(slug) ?? 0) + (childrenOf.get(slug) ?? []).reduce((sum, child) => sum + total(child, seen), 0);
  };

  const visible = new Set(index.categories.map((category: any) => category.slug));
  const brandCounts = new Map<string, number>();
  for (const product of products) {
    if (product.brandSlug) brandCounts.set(product.brandSlug, (brandCounts.get(product.brandSlug) ?? 0) + 1);
  }

  return {
    generatedAt: new Date().toISOString(),
    settings: {
      currency: settings.currency,
      checkoutEnabled: checkout.enabled,
      checkoutDisabledMessage: checkout.message,
      paymentTestMode: checkout.testMode,
      reviewsEnabled: settings.reviewsEnabled,
      customsDisclosure: settings.customsDisclosure,
      supportEmail: settings.supportEmail,
      shippingCountries,
      handlingDays: settings.handlingDays,
      sampleCatalog: allowSampleCatalog(env()),
    },
    categories: index.categories
      // A category under a hidden parent is hidden with it.
      .filter((category: any) => !category.parent || visible.has(category.parent.slug))
      .map((category: any) => ({
        id: category.documentId,
        slug: category.slug,
        name: category.name,
        description: category.description || undefined,
        parentSlug: category.parent?.slug || undefined,
        sortOrder: category.sortOrder ?? 0,
        productCount: total(category.slug),
        seoTitle: category.seo?.metaTitle || undefined,
        seoDescription: category.seo?.metaDescription || undefined,
      })),
    brands: index.brands
      .map((brand: any) => ({ slug: brand.slug, name: brand.name, productCount: brandCounts.get(brand.slug) ?? 0 }))
      .filter((brand) => brand.productCount > 0),
    vehicles: index.vehicles.map((vehicle: any) => ({
      id: vehicle.documentId,
      slug: vehicle.slug,
      label: vehicle.label,
      make: vehicle.make?.name ?? '',
      makeSlug: vehicle.make?.slug ?? '',
      model: vehicle.model,
      generation: vehicle.generation || undefined,
      chassisCode: vehicle.chassisCode,
      yearFrom: vehicle.yearFrom,
      yearTo: vehicle.yearTo ?? undefined,
      bodyStyles: splitList(vehicle.bodyStyles),
      engines: splitList(vehicle.engines),
      marketNotes: vehicle.marketNotes || undefined,
    })),
    products,
  };
}

/** Countries with at least one enabled zone holding an enabled, VERIFIED rate in the store currency. */
export async function servedCountries(strapi: Core.Strapi): Promise<string[]> {
  const settings = await loadSettings(strapi);
  const zones = await findAll(strapi, 'api::shipping-zone.shipping-zone', {
    filters: { enabled: true },
    populate: { rates: true },
  });
  const out = new Set<string>();
  for (const zone of zones) {
    const usable = (zone.rates ?? []).some(
      (rate: any) => rate.enabled !== false && rate.verified === true && rate.currency === settings.currency,
    );
    if (!usable) continue;
    for (const code of countryList(zone.countries)) {
      if (!settings.blockedCountries.includes(code)) out.add(code);
    }
  }
  return [...out].sort();
}

export { findAll };
