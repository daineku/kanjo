import {
  AUTHENTICITIES,
  CONDITIONS,
  CURRENCIES,
  SUPPLIER_AVAILABILITY,
  type Currency,
  type ImportIssue,
  type LookupEntry,
  type NormalizeContext,
  type NormalizedRecord,
  type RawSupplierRecord,
} from './types';

/**
 * Normalisation: one raw supplier row → one typed record plus its issues.
 *
 * Pure. An `error` issue makes the row `invalid` (it cannot be promoted); a
 * `warning` is shown to the reviewer and does not block. Nothing is guessed
 * silently: an unparseable price is an error naming the value, an unmatched
 * brand is a warning naming the brand.
 */

/** Header aliases, so a supplier's own export needs less editing. */
const ALIASES: Record<string, string[]> = {
  supplier_reference: ['supplier_reference', 'supplier_ref', 'reference', 'item_id', 'product_id', 'supplier_sku', 'id'],
  source_url: ['source_url', 'url', 'link', 'product_url'],
  name: ['name', 'title', 'product_name', 'product_title'],
  sku: ['sku', 'our_sku', 'kanjo_sku'],
  brand: ['brand', 'make', 'manufacturer'],
  category: ['category', 'category_slug', 'category_name'],
  source_price: ['source_price', 'price', 'cost', 'supplier_price'],
  source_currency: ['source_currency', 'currency'],
  availability: ['availability', 'supplier_availability', 'stock_status', 'in_stock'],
  weight: ['weight', 'weight_g', 'weight_grams', 'weight_kg'],
  condition: ['condition'],
  authenticity: ['authenticity', 'product_class'],
  country_of_origin: ['country_of_origin', 'origin', 'made_in'],
  description: ['description', 'supplier_description', 'details'],
  notes: ['notes', 'note', 'remarks'],
  margin_percent: ['margin_percent', 'margin'],
};

function pick(values: Record<string, string>, field: keyof typeof ALIASES): string {
  for (const alias of ALIASES[field] ?? []) {
    const value = values[alias];
    if (value !== undefined && value.trim() !== '') return value.replace(/\s+/g, ' ').trim();
  }
  return '';
}

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
    .replace(/-+$/g, '');
}

const SYMBOL_CURRENCY: [RegExp, Currency][] = [
  [/฿|\bthb\b|\bbaht\b/i, 'THB'],
  [/€|\beur\b/i, 'EUR'],
  [/£|\bgbp\b/i, 'GBP'],
  [/\bcad\b|c\$/i, 'CAD'],
  [/\$|\busd\b/i, 'USD'],
];

/**
 * "฿1,250.00", "THB 1250", "1.250,50 €", "12.5" → { amount, currency? }.
 * Returns null when the text is not a single non-negative number.
 */
export function parsePrice(input: string): { amount: number; currency?: Currency } | null {
  const text = input.trim();
  if (!text) return null;
  const currency = SYMBOL_CURRENCY.find(([pattern]) => pattern.test(text))?.[1];

  let digits = text.replace(/[^\d.,-]/g, '');
  if (!digits || digits.startsWith('-') || !/\d/.test(digits)) return null;

  const lastDot = digits.lastIndexOf('.');
  const lastComma = digits.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: whichever comes last is the decimal separator.
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    digits = digits.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma >= 0) {
    // Only commas: "1,250" is thousands; "12,50" is a decimal comma.
    digits = /^\d{1,3}(,\d{3})+$/.test(digits) ? digits.replace(/,/g, '') : digits.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3}){2,}$/.test(digits)) {
    // "1.250.000": dots as thousands. A single ".250" stays a decimal.
    digits = digits.replace(/\./g, '');
  }

  if (!/^\d+(\.\d+)?$/.test(digits)) return null;
  const amount = Number(digits);
  if (!Number.isFinite(amount)) return null;
  return { amount: Math.round(amount * 100) / 100, currency };
}

/** "1.2 kg", "350g", "2 lb", "12 oz", "450" (grams) → grams. */
export function parseWeightGrams(input: string, headerHint?: string): number | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;
  const match = text.match(/^([\d.,]+)\s*([a-z]*)\.?$/);
  if (!match) return null;
  const value = Number((match[1] as string).replace(',', '.'));
  if (!Number.isFinite(value) || value < 0) return null;
  const unit = match[2] || (headerHint === 'weight_kg' ? 'kg' : 'g');
  const factor: Record<string, number> = {
    g: 1, gram: 1, grams: 1, gr: 1,
    kg: 1000, kgs: 1000, kilogram: 1000, kilograms: 1000,
    lb: 453.59237, lbs: 453.59237, pound: 453.59237, pounds: 453.59237,
    oz: 28.349523, ounce: 28.349523, ounces: 28.349523,
  };
  const multiplier = factor[unit];
  if (multiplier === undefined) return null;
  return Math.round(value * multiplier);
}

const AVAILABILITY_WORDS: Record<string, NormalizedRecord['supplierAvailability']> = {
  available: 'available', in_stock: 'available', instock: 'available', yes: 'available', true: 'available', y: 'available', '1': 'available',
  limited: 'limited', low: 'limited', low_stock: 'limited',
  unavailable: 'unavailable', out_of_stock: 'unavailable', sold_out: 'unavailable', no: 'unavailable', false: 'unavailable', n: 'unavailable', '0': 'unavailable',
  unknown: 'unknown',
};

const token = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

function matchLookup(value: string, entries: LookupEntry[]): LookupEntry | undefined {
  const slug = slugify(value);
  const lower = value.toLowerCase();
  return (
    entries.find((entry) => entry.slug === slug) ??
    entries.find((entry) => entry.name.toLowerCase() === lower) ??
    entries.find((entry) => slugify(entry.name) === slug)
  );
}

const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A SKU derived from the supplier code and reference, when the row has none. */
export function deriveSku(supplierCode: string, reference: string): string {
  const clean = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${clean(supplierCode)}-${clean(reference)}`.slice(0, 64).replace(/-+$/g, '');
}

export function normalizeRecord(
  raw: RawSupplierRecord,
  context: NormalizeContext,
): { normalized: NormalizedRecord; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const v = raw.values;

  const name = pick(v, 'name');
  if (!name) issues.push({ level: 'error', field: 'name', message: 'Name is required' });
  else if (name.length > 140) issues.push({ level: 'error', field: 'name', message: 'Name is longer than 140 characters' });

  const supplierReference = pick(v, 'supplier_reference');
  if (!supplierReference) {
    issues.push({ level: 'error', field: 'supplier_reference', message: 'The supplier’s own identifier is required: it is how a re-import recognises this item' });
  }

  let sourceUrl = pick(v, 'source_url') || undefined;
  if (sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('scheme');
      // Tracking parameters make one listing look like many.
      for (const key of [...url.searchParams.keys()]) {
        if (/^(utm_|sp_atk|xptdk|fbclid|gclid|smtt|share)/i.test(key)) url.searchParams.delete(key);
      }
      url.hash = '';
      sourceUrl = url.toString().slice(0, 600);
    } catch {
      issues.push({ level: 'error', field: 'source_url', message: `"${sourceUrl}" is not a web address` });
      sourceUrl = undefined;
    }
  } else {
    issues.push({ level: 'warning', field: 'source_url', message: 'No source URL: provenance will rest on the supplier reference alone' });
  }

  let sku = pick(v, 'sku');
  if (!sku && supplierReference) sku = deriveSku(context.supplierCode, supplierReference);
  if (sku && (!SKU_PATTERN.test(sku) || sku.length > 64)) {
    issues.push({ level: 'error', field: 'sku', message: `SKU "${sku}" may contain only letters, digits, dot, dash and underscore (max 64)` });
  }

  const brandInput = pick(v, 'brand');
  const brand = brandInput ? matchLookup(brandInput, context.brands) : undefined;
  if (brandInput && !brand) {
    issues.push({ level: 'warning', field: 'brand', message: `Brand "${brandInput}" is not in the catalogue; create it or leave the product unbranded` });
  }

  const categoryInput = pick(v, 'category');
  const category = categoryInput ? matchLookup(categoryInput, context.categories) : undefined;
  if (!categoryInput) issues.push({ level: 'warning', field: 'category', message: 'No category given' });
  else if (!category) issues.push({ level: 'warning', field: 'category', message: `Category "${categoryInput}" does not match any category slug or name` });

  let sourcePrice: number | undefined;
  let sourceCurrency: Currency | undefined;
  const priceInput = pick(v, 'source_price');
  if (priceInput) {
    const parsed = parsePrice(priceInput);
    if (!parsed) issues.push({ level: 'error', field: 'source_price', message: `"${priceInput}" is not a price` });
    else {
      sourcePrice = parsed.amount;
      sourceCurrency = parsed.currency;
    }
  } else {
    issues.push({ level: 'warning', field: 'source_price', message: 'No source price' });
  }

  const currencyInput = pick(v, 'source_currency').toUpperCase();
  if (currencyInput) {
    if ((CURRENCIES as readonly string[]).includes(currencyInput)) {
      if (sourceCurrency && sourceCurrency !== currencyInput) {
        issues.push({ level: 'warning', field: 'source_currency', message: `The price is written in ${sourceCurrency} but the currency column says ${currencyInput}; using ${currencyInput}` });
      }
      sourceCurrency = currencyInput as Currency;
    } else {
      issues.push({ level: 'error', field: 'source_currency', message: `Currency "${currencyInput}" is not one of ${CURRENCIES.join(', ')}` });
    }
  }
  if (sourcePrice !== undefined && !sourceCurrency) {
    issues.push({ level: 'error', field: 'source_currency', message: 'A source price needs a currency' });
  }

  const availabilityInput = pick(v, 'availability');
  let supplierAvailability: NormalizedRecord['supplierAvailability'] = 'unknown';
  if (availabilityInput) {
    const mapped = AVAILABILITY_WORDS[token(availabilityInput)];
    if (mapped) supplierAvailability = mapped;
    else issues.push({ level: 'warning', field: 'availability', message: `Availability "${availabilityInput}" not recognised; recorded as unknown` });
  }

  let weightGrams: number | undefined;
  const weightHeader = (ALIASES.weight as string[]).find((alias) => (v[alias] ?? '').trim() !== '');
  const weightInput = pick(v, 'weight');
  if (weightInput) {
    const parsed = parseWeightGrams(weightInput, weightHeader);
    if (parsed === null) issues.push({ level: 'warning', field: 'weight', message: `Weight "${weightInput}" not understood; left empty` });
    else weightGrams = parsed;
  }

  let condition: NormalizedRecord['condition'] = 'new';
  const conditionInput = token(pick(v, 'condition'));
  if (conditionInput) {
    const mapped = conditionInput === 'used' ? 'used_good' : conditionInput === 'nos' ? 'new_old_stock' : conditionInput;
    if ((CONDITIONS as readonly string[]).includes(mapped)) condition = mapped as NormalizedRecord['condition'];
    else issues.push({ level: 'warning', field: 'condition', message: `Condition "${conditionInput}" not recognised; recorded as new — check it` });
  }

  // Authenticity is a claim to customers. A supplier's spreadsheet cell is not
  // evidence, so an imported value is kept as a NOTE for the reviewer and the
  // record itself stays `unverified` until a person sets it.
  const authenticityInput = token(pick(v, 'authenticity'));
  if (authenticityInput && authenticityInput !== 'unverified') {
    const known = (AUTHENTICITIES as readonly string[]).includes(authenticityInput);
    issues.push({
      level: 'warning',
      field: 'authenticity',
      message: known
        ? `Supplier states "${authenticityInput}". Recorded as unverified until a reviewer confirms it`
        : `Authenticity "${authenticityInput}" not recognised; recorded as unverified`,
    });
  }

  const origin = pick(v, 'country_of_origin').toUpperCase();
  let countryOfOrigin: string | undefined;
  if (origin) {
    if (/^[A-Z]{2}$/.test(origin)) countryOfOrigin = origin;
    else issues.push({ level: 'warning', field: 'country_of_origin', message: `Country of origin "${origin}" must be a two-letter ISO code; left empty` });
  }

  let marginPercent: number | undefined;
  const marginInput = pick(v, 'margin_percent').replace('%', '');
  if (marginInput) {
    const value = Number(marginInput);
    if (Number.isFinite(value) && value >= 0 && value <= 1000) marginPercent = value;
    else issues.push({ level: 'warning', field: 'margin_percent', message: `Margin "${marginInput}" ignored` });
  }

  return {
    normalized: {
      supplierReference,
      sourceUrl,
      name,
      slug: slugify(name),
      sku,
      brandName: brand?.name ?? (brandInput || undefined),
      brandDocumentId: brand?.documentId,
      categoryName: category?.name ?? (categoryInput || undefined),
      categoryDocumentId: category?.documentId,
      sourcePrice,
      sourceCurrency,
      supplierAvailability,
      weightGrams,
      condition,
      authenticity: 'unverified',
      countryOfOrigin,
      supplierDescription: pick(v, 'description') || undefined,
      notes: pick(v, 'notes') || undefined,
      marginPercent,
      isSample: /^sample\b/i.test(name) || /^sample\b/i.test(supplierReference),
    },
    issues,
  };
}

export const hasErrors = (issues: ImportIssue[]): boolean => issues.some((issue) => issue.level === 'error');
