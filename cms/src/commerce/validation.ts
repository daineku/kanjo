/**
 * Publication rules for a product, as a PURE function so the tests exercise
 * the real thing.
 *
 * A product cannot be published until it would be honest and shippable on the
 * storefront. Each rule exists because the opposite would publish something
 * false: a "genuine" label with no evidence, a supplier's photo nobody has
 * cleared, a sellable item the shipping calculator cannot weigh, a fitment
 * whose years contradict the vehicle.
 */

const SELLABLE_MODES = ['in_stock', 'made_to_order', 'source_on_demand'];
const SKU = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type ProductForValidation = {
  name?: string;
  sku?: string;
  reviewStatus?: string;
  category?: unknown;
  brand?: unknown;
  authenticity?: string;
  condition?: string;
  shortDescription?: string | null;
  description?: string | null;
  price?: unknown;
  discountPrice?: unknown;
  currency?: string;
  availability?: string;
  supplier?: unknown;
  lastVerifiedAt?: string | null;
  provenance?: string | null;
  weightGrams?: number | null;
  hsCode?: string | null;
  internationalShipping?: boolean;
  mainImage?: unknown;
  gallery?: unknown[] | null;
  imageRights?: string;
  isSample?: boolean;
  variants?: { sku?: string; label?: string; price?: unknown; discountPrice?: unknown }[] | null;
  fitments?: { vehicle?: any; status?: string; yearFrom?: number | null; yearTo?: number | null }[] | null;
};

const num = (value: unknown) => (value === null || value === undefined || value === '' ? undefined : Number(value));

export function productPublishProblems(
  product: ProductForValidation,
  context: { storeCurrency: string; skusInUseElsewhere: Set<string> },
): string[] {
  const problems: string[] = [];
  const add = (message: string) => problems.push(message);

  if (product.reviewStatus !== 'approved') {
    add('Set "Review status" to "approved" before publishing. (Draft → ready_for_review → approved is the editorial workflow.)');
  }
  if (!product.name?.trim()) add('Name is required.');
  if (!product.sku || !SKU.test(product.sku)) add('A SKU (letters, digits, dot, dash, underscore) is required.');
  if (!product.category) add('Choose a category.');
  if (!product.authenticity) add('Choose how authentic the part is.');
  if (!product.condition) add('Choose the condition.');

  // Thin pages help nobody and are what search engines demote.
  if (!product.shortDescription?.trim()) add('Write a short description.');
  if ((product.description ?? '').trim().length < 80) {
    add('Write a full description of at least 80 characters, in your own words (not a supplier\'s copy).');
  }

  if (product.currency && product.currency !== context.storeCurrency) {
    add(`Price the product in the store currency (${context.storeCurrency}); one checkout cannot mix currencies.`);
  }
  const price = num(product.price);
  const discount = num(product.discountPrice);
  if (price !== undefined && (!Number.isFinite(price) || price <= 0)) add('Price must be above zero (leave it empty for "price on request").');
  if (discount !== undefined && (price === undefined || discount >= price)) add('A discount price must be lower than the price.');

  const sellable = SELLABLE_MODES.includes(product.availability ?? '');
  if (sellable && product.internationalShipping !== false && !product.hsCode?.trim()) {
    add('Add the customs HS code: every international parcel declares one.');
  }
  const variants = product.variants ?? [];
  if (sellable && !(Number(product.weightGrams) > 0) && variants.length === 0) {
    add('Add the shipped weight in grams: shipping is priced by weight.');
  }

  if (product.availability === 'source_on_demand') {
    if (!product.supplier) add('A sourced-on-demand product needs its supplier.');
    if (!product.lastVerifiedAt) add('Record when the supplier last confirmed availability ("Last verified at").');
  }

  if (product.authenticity === 'genuine_oem' || product.authenticity === 'genuine_aftermarket') {
    if (!product.brand) add('A genuine part must name its brand.');
    if (!(product.provenance ?? '').trim()) {
      add('Record the evidence that the part is genuine in "Provenance" (invoice, packaging, part number check).');
    }
  }

  const hasImages = Boolean(product.mainImage) || (product.gallery ?? []).length > 0;
  if (hasImages && (!product.imageRights || product.imageRights === 'not_cleared')) {
    add('Images are attached but "Image rights" is "not_cleared". Use your own photos, or record the licence.');
  }

  const seen = new Set<string>();
  if (product.sku) seen.add(product.sku);
  for (const variant of variants) {
    if (!variant.sku || !SKU.test(variant.sku)) add(`Variant "${variant.label ?? '?'}" needs a valid SKU.`);
    else if (seen.has(variant.sku)) add(`SKU ${variant.sku} is used twice in this product.`);
    else seen.add(variant.sku);
    const vp = num(variant.price);
    const vd = num(variant.discountPrice);
    if (vp !== undefined && vp <= 0) add(`Variant ${variant.sku}: price must be above zero.`);
    if (vd !== undefined && (vd >= (vp ?? price ?? 0))) add(`Variant ${variant.sku}: discount must be lower than its price.`);
  }
  for (const sku of seen) {
    if (context.skusInUseElsewhere.has(sku)) add(`SKU ${sku} already belongs to another product.`);
  }

  for (const [i, fitment] of (product.fitments ?? []).entries()) {
    const label = `Fitment ${i + 1}`;
    if (!fitment.vehicle) {
      add(`${label}: choose the vehicle.`);
      continue;
    }
    const vehicle = fitment.vehicle;
    const from = fitment.yearFrom ?? vehicle.yearFrom;
    const to = fitment.yearTo ?? vehicle.yearTo;
    if (from && to && from > to) add(`${label}: "year from" is after "year to".`);
    if (vehicle.yearFrom && from && from < vehicle.yearFrom) add(`${label}: ${from} is before the ${vehicle.label} was made.`);
    if (vehicle.yearTo && to && to > vehicle.yearTo) add(`${label}: ${to} is after the ${vehicle.label} ended production.`);
    if (!['confirmed', 'conditional', 'unverified'].includes(fitment.status ?? '')) add(`${label}: choose a fitment status.`);
  }

  return problems;
}
