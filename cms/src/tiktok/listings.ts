import type { Core } from '@strapi/strapi';

/**
 * Upkeep of the product ↔ listing mapping (`tiktok-listing`).
 *
 * One row per SELLER SKU (a product with three variants has three rows), each
 * carrying the TikTok product id and TikTok SKU id it maps to, the last price
 * and stock pushed, and the last error for that SKU. Errors are recorded per
 * listing so one product with a missing category does not hide behind a
 * generic "sync failed".
 */

const UID = 'api::tiktok-listing.tiktok-listing';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const docs = (strapi: Core.Strapi, uid: string): any => (strapi as any).documents(uid);

export type ListingRecord = {
  documentId: string;
  productDocumentId: string;
  productName?: string | null;
  sku: string;
  tiktokProductId?: string | null;
  tiktokSkuId?: string | null;
  tiktokCategoryId?: string | null;
  listingStatus?: string | null;
  syncEnabled?: boolean | null;
  lastPushedPrice?: number | string | null;
  lastPushedStock?: number | null;
  lastSyncedAt?: string | null;
  lastError?: string | null;
  // Optional explicit marketplace price — see the schema note in the module README.
  tiktokPrice?: number | string | null;
  tiktokCurrency?: string | null;
};

export async function listingsForProduct(strapi: Core.Strapi, productDocumentId: string): Promise<ListingRecord[]> {
  return (await docs(strapi, UID).findMany({
    filters: { productDocumentId: { $eq: productDocumentId } },
    limit: 200,
  })) as ListingRecord[];
}

export async function listingForSku(strapi: Core.Strapi, sku: string): Promise<ListingRecord | null> {
  return ((await docs(strapi, UID).findFirst({ filters: { sku: { $eq: sku } } })) as ListingRecord | null) ?? null;
}

export async function updateListing(
  strapi: Core.Strapi,
  documentId: string,
  data: Partial<Omit<ListingRecord, 'documentId'>>,
): Promise<void> {
  await docs(strapi, UID).update({ documentId, data });
}

/**
 * Make sure a mapping row exists for every SKU of a product, and retire rows
 * for SKUs the product no longer has (kept, marked, never deleted — the TikTok
 * ids on them are the only link back to a listing that may still be live).
 */
export async function ensureListings(
  strapi: Core.Strapi,
  product: { documentId: string; name: string; skus: string[]; tiktokCategoryId?: string | null },
): Promise<ListingRecord[]> {
  const existing = await listingsForProduct(strapi, product.documentId);
  const bySku = new Map(existing.map((row) => [row.sku, row]));
  const wanted = new Set(product.skus);

  for (const sku of product.skus) {
    const row = bySku.get(sku);
    if (row) {
      if (row.productName !== product.name || (product.tiktokCategoryId ?? null) !== (row.tiktokCategoryId ?? null)) {
        await updateListing(strapi, row.documentId, {
          productName: product.name,
          tiktokCategoryId: product.tiktokCategoryId ?? null,
        });
      }
      continue;
    }
    // The SKU may already be mapped under another product (a SKU moved). The
    // column is unique, so adopt the row instead of failing the whole sync.
    const elsewhere = await listingForSku(strapi, sku);
    if (elsewhere) {
      await updateListing(strapi, elsewhere.documentId, {
        productDocumentId: product.documentId,
        productName: product.name,
      });
    } else {
      await docs(strapi, UID).create({
        data: {
          productDocumentId: product.documentId,
          productName: product.name,
          sku,
          tiktokCategoryId: product.tiktokCategoryId ?? null,
          listingStatus: 'not_listed',
          syncEnabled: true,
        },
      });
    }
  }

  for (const row of existing) {
    if (!wanted.has(row.sku) && row.listingStatus !== 'deactivated') {
      await updateListing(strapi, row.documentId, {
        lastError: 'This SKU no longer exists on the product. Deactivate or remove it in TikTok Seller Center.',
      });
    }
  }

  return listingsForProduct(strapi, product.documentId);
}

export async function recordListingError(strapi: Core.Strapi, rows: ListingRecord[], message: string): Promise<void> {
  for (const row of rows) {
    await updateListing(strapi, row.documentId, {
      lastError: message.slice(0, 2000),
      ...(row.tiktokProductId ? {} : { listingStatus: 'error' }),
    });
  }
}
