import type { Core } from '@strapi/strapi';

import { availableToSell } from '../commerce/inventory';
import { toCsv } from '../importer/csv';
import { listingBlockers, type MappableProduct } from './mapper';

/**
 * The manual fallback: a CSV of listable products.
 *
 * For use when API access or seller approval is not available. It is NOT the
 * TikTok Seller Center bulk-upload template: that template is per category,
 * versioned, and downloaded from Seller Center (Products → Bulk upload). This
 * file is the DATA to paste into it — one row per seller SKU, generic column
 * names — plus a `blockers` column saying why a row should not be listed yet.
 *
 * Workflow: download this file → download the current template for the
 * category from Seller Center → copy the columns across → upload there.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const docs = (strapi: Core.Strapi, uid: string): any => (strapi as any).documents(uid);

export const EXPORT_COLUMNS = [
  'seller_sku',
  'product_name',
  'variant',
  'category',
  'tiktok_category_id',
  'brand',
  'condition',
  'authenticity',
  'price',
  'currency',
  'available_quantity',
  'weight_kg',
  'length_cm',
  'width_cm',
  'height_cm',
  'description',
  'main_image_url',
  'blockers',
] as const;

type ExportProduct = MappableProduct & {
  brand?: { name?: string | null } | null;
  mainImage?: { url?: string | null } | null;
};

export function exportRowsFor(
  product: ExportProduct,
  stockBySku: Record<string, number>,
): Record<(typeof EXPORT_COLUMNS)[number], string>[] {
  const blockers = listingBlockers(product).join(' | ');
  const cm = (mm: number | null | undefined) => (mm ? String(Math.ceil(mm / 10)) : '');
  const variants = product.variants && product.variants.length > 0 ? product.variants : [undefined];

  return variants.map((variant) => {
    const sku = variant?.sku ?? product.sku;
    const price = variant?.discountPrice ?? variant?.price ?? product.discountPrice ?? product.price;
    return {
      seller_sku: sku,
      product_name: product.name,
      variant: variant?.label ?? '',
      category: product.category?.name ?? '',
      tiktok_category_id: product.category?.tiktokCategoryId ?? '',
      brand: product.brand?.name ?? '',
      condition: product.condition ?? '',
      authenticity: product.authenticity ?? '',
      price: price === null || price === undefined ? '' : String(price),
      currency: product.currency,
      available_quantity: String(stockBySku[sku] ?? 0),
      weight_kg: product.weightGrams ? (product.weightGrams / 1000).toFixed(3) : '',
      length_cm: cm(product.lengthMm),
      width_cm: cm(product.widthMm),
      height_cm: cm(product.heightMm),
      description: (product.description || product.shortDescription || '').replace(/\s+/g, ' ').trim(),
      main_image_url: product.mainImage?.url ?? '',
      blockers,
    };
  });
}

export async function buildTikTokExportCsv(strapi: Core.Strapi): Promise<{ csv: string; rows: number }> {
  const rows: Record<string, string>[] = [];
  const pageSize = 100;
  for (let start = 0; ; start += pageSize) {
    const products = (await docs(strapi, 'api::product.product').findMany({
      status: 'published',
      // Samples are development fixtures and never leave for a marketplace.
      filters: { isSample: { $ne: true } },
      populate: { category: true, brand: true, variants: true, mainImage: true },
      sort: 'name:asc',
      start,
      limit: pageSize,
    })) as ExportProduct[];

    for (const product of products) {
      const skus = product.variants && product.variants.length > 0 ? product.variants.map((v) => v.sku) : [product.sku];
      const stock: Record<string, number> = {};
      for (const sku of skus) stock[sku] = await availableToSell(strapi, sku);
      rows.push(...exportRowsFor(product, stock));
    }
    if (products.length < pageSize) break;
  }
  return { csv: toCsv([...EXPORT_COLUMNS], rows), rows: rows.length };
}
