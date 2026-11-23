import type { Core } from '@strapi/strapi';

import { actorName } from '../commerce/actor';
import { audit } from '../commerce/audit';
import { ADAPTERS } from './adapters';
import { findDuplicates } from './duplicates';
import { hasErrors, normalizeRecord, parsePrice } from './normalize';
import type {
  DuplicateMatch,
  ExistingProduct,
  ImportIssue,
  LookupEntry,
  NormalizedRecord,
  SupplierAdapter,
} from './types';
import { parseCsv } from './csv';

/**
 * The persistent half of the import pipeline.
 *
 *   createImportBatch   extraction + normalization + duplicate detection,
 *                       stored as an import-batch with one import-item per row
 *   decideImportItem    HUMAN REVIEW: approve or reject a row
 *   promoteApproved     approved rows → DRAFT products (never published)
 *   reverifyFromCsv     refresh provenance on EXISTING products from a fresh
 *                       supplier file; never touches public fields
 *
 * What a promoted product does NOT get, by design:
 *   - a public price      (a suggestion is written to private provenance)
 *   - images              (the supplier's images are not ours to republish)
 *   - a public description (the supplier's text is kept privately as provenance)
 *   - an authenticity claim (stays `unverified` unless the reviewer set one)
 *   - availability        (`out_of_stock` until someone verifies the sourcing)
 * Publishing is blocked by the product validation until a person supplies them
 * and moves the review status to `approved`.
 */

const BATCH_UID = 'api::import-batch.import-batch';
const ITEM_UID = 'api::import-item.import-item';
const PRODUCT_UID = 'api::product.product';
const SUPPLIER_UID = 'api::supplier.supplier';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const docs = (strapi: Core.Strapi, uid: string): any => (strapi as any).documents(uid);

export const MAX_IMPORT_ROWS = 2000;

type SupplierRecord = { documentId: string; code: string; name: string; active?: boolean; accessMethod?: string };

async function loadSupplier(strapi: Core.Strapi, documentId: string): Promise<SupplierRecord> {
  const supplier = (await docs(strapi, SUPPLIER_UID).findOne({ documentId })) as SupplierRecord | null;
  if (!supplier) throw new ImportError('Supplier not found');
  if (supplier.active === false) throw new ImportError(`Supplier "${supplier.name}" is marked inactive`);
  return supplier;
}

export class ImportError extends Error {}

async function lookups(strapi: Core.Strapi): Promise<{ brands: LookupEntry[]; categories: LookupEntry[] }> {
  const [brands, categories] = await Promise.all([
    docs(strapi, 'api::brand.brand').findMany({ fields: ['name', 'slug'], limit: 1000 }),
    docs(strapi, 'api::category.category').findMany({ fields: ['name', 'slug'], limit: 1000 }),
  ]);
  return { brands, categories };
}

/** Every product (draft rows included) in the shape duplicate detection needs. */
export async function existingProducts(strapi: Core.Strapi): Promise<ExistingProduct[]> {
  const out = new Map<string, ExistingProduct>();
  for (let start = 0; ; start += 500) {
    const page = (await docs(strapi, PRODUCT_UID).findMany({
      fields: ['name', 'sku', 'supplierReference', 'sourceUrl'],
      populate: { supplier: { fields: ['code'] }, variants: { fields: ['sku'] } },
      start,
      limit: 500,
    })) as {
      documentId: string;
      name: string;
      sku: string;
      supplierReference?: string | null;
      sourceUrl?: string | null;
      supplier?: { code?: string } | null;
      variants?: { sku: string }[] | null;
    }[];
    for (const product of page) {
      out.set(product.documentId, {
        documentId: product.documentId,
        name: product.name,
        sku: product.sku,
        variantSkus: (product.variants ?? []).map((variant) => variant.sku),
        supplierCode: product.supplier?.code ?? undefined,
        supplierReference: product.supplierReference ?? undefined,
        sourceUrl: product.sourceUrl ?? undefined,
      });
    }
    if (page.length < 500) break;
  }
  return [...out.values()];
}

export type BatchSummary = {
  batchDocumentId: string;
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
};

/**
 * Extraction → normalization → duplicate detection → stored for review.
 * Nothing becomes a product here.
 */
export async function createImportBatch(
  strapi: Core.Strapi,
  input: { supplierDocumentId: string; source: SupplierAdapter['id']; label?: string; csv?: string },
): Promise<BatchSummary> {
  const adapter = ADAPTERS[input.source];
  if (!adapter) throw new ImportError(`Unknown import source "${input.source}"`);
  const supplier = await loadSupplier(strapi, input.supplierDocumentId);
  const actor = actorName(strapi);

  const raws = [];
  for await (const record of adapter.fetch({ supplierCode: supplier.code, csv: input.csv })) {
    raws.push(record);
    if (raws.length > MAX_IMPORT_ROWS) {
      throw new ImportError(`More than ${MAX_IMPORT_ROWS} rows; split the file`);
    }
  }
  if (raws.length === 0) throw new ImportError('The source contained no rows');

  const [{ brands, categories }, existing] = await Promise.all([lookups(strapi), existingProducts(strapi)]);

  const batch = (await docs(strapi, BATCH_UID).create({
    data: {
      label: (input.label ?? `${supplier.name} ${new Date().toISOString().slice(0, 10)}`).slice(0, 120),
      supplier: { connect: [input.supplierDocumentId] },
      source: input.source,
      status: 'received',
      totalRows: raws.length,
      createdByName: actor,
    },
  })) as { documentId: string };

  const earlier: { rowNumber: number; record: NormalizedRecord }[] = [];
  let valid = 0;
  let duplicates = 0;
  let invalid = 0;

  for (const raw of raws) {
    const { normalized, issues } = normalizeRecord(raw, { supplierCode: supplier.code, brands, categories });
    const matches = findDuplicates(normalized, { supplierCode: supplier.code, existing, earlier });
    const exact = matches.find((match) => match.strength === 'exact');
    for (const match of matches.filter((m) => m.strength === 'possible')) {
      issues.push({ level: 'warning', message: `Possibly the same item as ${match.label}` });
    }

    const state = hasErrors(issues) ? 'invalid' : exact ? 'duplicate' : 'valid';
    if (state === 'valid') valid += 1;
    else if (state === 'duplicate') duplicates += 1;
    else invalid += 1;

    await docs(strapi, ITEM_UID).create({
      data: {
        batch: { connect: [batch.documentId] },
        rowNumber: raw.rowNumber,
        supplierReference: normalized.supplierReference || null,
        sourceUrl: normalized.sourceUrl ?? null,
        name: normalized.name || null,
        raw: raw.values,
        normalized,
        issues: { issues, duplicates: matches } as { issues: ImportIssue[]; duplicates: DuplicateMatch[] },
        state,
        duplicateOf: exact ? `${exact.reason}: ${exact.label}` : null,
        decision: 'pending',
      },
    });
    earlier.push({ rowNumber: raw.rowNumber, record: normalized });
  }

  await docs(strapi, BATCH_UID).update({
    documentId: batch.documentId,
    data: {
      status: 'in_review',
      validRows: valid,
      duplicateRows: duplicates,
      invalidRows: invalid,
      log: `Normalized ${raws.length} rows: ${valid} valid, ${duplicates} duplicates, ${invalid} invalid.`,
    },
  });

  await audit(strapi, {
    action: 'import.batch_created',
    actor,
    subjectType: 'import-batch',
    subjectId: batch.documentId,
    summary: `Import from ${supplier.name}: ${raws.length} rows (${valid} valid, ${duplicates} duplicate, ${invalid} invalid)`,
  });

  return { batchDocumentId: batch.documentId, totalRows: raws.length, validRows: valid, duplicateRows: duplicates, invalidRows: invalid };
}

/** Human review of one row. Invalid and duplicate rows cannot be approved. */
export async function decideImportItem(
  strapi: Core.Strapi,
  input: { itemDocumentId: string; decision: 'approved' | 'rejected' | 'pending'; reviewNote?: string; authenticity?: string },
): Promise<void> {
  const item = (await docs(strapi, ITEM_UID).findOne({ documentId: input.itemDocumentId })) as {
    documentId: string;
    state: string;
    productDocumentId?: string | null;
    normalized?: NormalizedRecord | null;
    name?: string | null;
  } | null;
  if (!item) throw new ImportError('Import row not found');
  if (item.productDocumentId) throw new ImportError('This row has already been promoted to a product');
  if (input.decision === 'approved' && item.state !== 'valid') {
    throw new ImportError(`A ${item.state} row cannot be approved. Fix the source and re-import it.`);
  }

  const data: Record<string, unknown> = { decision: input.decision, reviewNote: input.reviewNote?.slice(0, 2000) ?? null };
  // The reviewer — not the supplier's spreadsheet — may state authenticity.
  if (input.authenticity && item.normalized) {
    const allowed = ['genuine_oem', 'genuine_aftermarket', 'third_party_replacement', 'replica_reproduction', 'custom_made', 'unverified'];
    if (!allowed.includes(input.authenticity)) throw new ImportError('Unknown authenticity value');
    data.normalized = { ...item.normalized, authenticity: input.authenticity };
  }
  await docs(strapi, ITEM_UID).update({ documentId: item.documentId, data });

  await audit(strapi, {
    action: `import.item_${input.decision}`,
    actor: actorName(strapi),
    subjectType: 'import-item',
    subjectId: item.documentId,
    summary: `${input.decision} import row "${item.name ?? ''}"${input.authenticity ? ` (authenticity: ${input.authenticity})` : ''}`,
  });
}

/** The private provenance note written onto a promoted draft. */
export function provenanceText(record: NormalizedRecord, supplierName: string, batchLabel: string, now: string): string {
  const lines = [
    `Imported ${now} from supplier "${supplierName}" (batch "${batchLabel}").`,
    `Supplier reference: ${record.supplierReference}`,
  ];
  if (record.sourceUrl) lines.push(`Source: ${record.sourceUrl}`);
  if (record.sourcePrice !== undefined && record.sourceCurrency) {
    lines.push(`Source price: ${record.sourcePrice} ${record.sourceCurrency}`);
    if (record.marginPercent !== undefined) {
      const suggested = Math.round(record.sourcePrice * (1 + record.marginPercent / 100) * 100) / 100;
      lines.push(
        `SUGGESTED selling price at ${record.marginPercent}% margin: ${suggested} ${record.sourceCurrency} — before shipping, fees and duty; NOT applied. Set the public price yourself.`,
      );
    }
  }
  if (record.brandName && !record.brandDocumentId) lines.push(`Supplier brand (unmatched): ${record.brandName}`);
  if (record.categoryName && !record.categoryDocumentId) lines.push(`Supplier category (unmatched): ${record.categoryName}`);
  if (record.notes) lines.push(`Supplier notes: ${record.notes}`);
  if (record.supplierDescription) {
    lines.push('', 'SUPPLIER DESCRIPTION — reference only, NOT licensed for publication. Write original copy:', record.supplierDescription);
  }
  return lines.join('\n');
}

/** The draft product a promoted row becomes. Pure, so it is unit-tested. */
export function draftProductData(
  record: NormalizedRecord,
  context: { supplierDocumentId: string; supplierName: string; batchLabel: string; now: string },
): Record<string, unknown> {
  return {
    name: record.name,
    slug: record.slug,
    sku: record.sku,
    ...(record.brandDocumentId ? { brand: { connect: [record.brandDocumentId] } } : {}),
    ...(record.categoryDocumentId ? { category: { connect: [record.categoryDocumentId] } } : {}),
    productType: 'part',
    authenticity: record.authenticity,
    condition: record.condition,
    // Public fields deliberately left empty: price, description, images.
    currency: record.sourceCurrency ?? 'USD',
    availability: 'out_of_stock',
    countryOfOrigin: record.countryOfOrigin ?? null,
    weightGrams: record.weightGrams ?? null,
    imageRights: 'not_cleared',
    reviewStatus: 'draft',
    isSample: record.isSample,
    supplier: { connect: [context.supplierDocumentId] },
    supplierReference: record.supplierReference,
    sourceUrl: record.sourceUrl ?? null,
    sourcePrice: record.sourcePrice ?? null,
    sourceCurrency: record.sourceCurrency ?? null,
    supplierAvailability: record.supplierAvailability,
    lastVerifiedAt: context.now,
    importStatus: 'imported_unreviewed',
    marginPercent: record.marginPercent ?? null,
    provenance: provenanceText(record, context.supplierName, context.batchLabel, context.now),
  };
}

/**
 * Approved rows → draft products. Re-checks duplicates against the catalogue
 * as it is NOW (another batch may have been promoted since this one was
 * reviewed). Never publishes.
 */
export async function promoteApproved(
  strapi: Core.Strapi,
  batchDocumentId: string,
): Promise<{ promoted: number; skipped: { row: number; reason: string }[] }> {
  const batch = (await docs(strapi, BATCH_UID).findOne({
    documentId: batchDocumentId,
    populate: { supplier: { fields: ['name', 'code'] } },
  })) as { documentId: string; label: string; promotedRows?: number; supplier?: { documentId: string; name: string; code: string } | null } | null;
  if (!batch) throw new ImportError('Import batch not found');
  if (!batch.supplier) throw new ImportError('The batch has no supplier');

  const items = (await docs(strapi, ITEM_UID).findMany({
    filters: { batch: { documentId: { $eq: batchDocumentId } }, decision: { $eq: 'approved' }, productDocumentId: { $null: true } },
    sort: 'rowNumber:asc',
    limit: MAX_IMPORT_ROWS,
  })) as { documentId: string; rowNumber: number; normalized: NormalizedRecord }[];

  const existing = await existingProducts(strapi);
  const actor = actorName(strapi);
  const now = new Date().toISOString();
  let promoted = 0;
  const skipped: { row: number; reason: string }[] = [];

  for (const item of items) {
    const record = item.normalized;
    const exact = findDuplicates(record, { supplierCode: batch.supplier.code, existing, earlier: [] }).find(
      (match) => match.strength === 'exact',
    );
    if (exact) {
      skipped.push({ row: item.rowNumber, reason: `now duplicates ${exact.label} (${exact.reason})` });
      await docs(strapi, ITEM_UID).update({
        documentId: item.documentId,
        data: { state: 'duplicate', duplicateOf: `${exact.reason}: ${exact.label}`, decision: 'pending' },
      });
      continue;
    }

    try {
      const product = (await docs(strapi, PRODUCT_UID).create({
        data: draftProductData(record, {
          supplierDocumentId: batch.supplier.documentId,
          supplierName: batch.supplier.name,
          batchLabel: batch.label,
          now,
        }),
        // Draft only. Publication is a separate, validated, human action.
        status: 'draft',
      })) as { documentId: string };
      await docs(strapi, ITEM_UID).update({ documentId: item.documentId, data: { productDocumentId: product.documentId } });
      existing.push({
        documentId: product.documentId,
        name: record.name,
        sku: record.sku,
        variantSkus: [],
        supplierCode: batch.supplier.code,
        supplierReference: record.supplierReference,
        sourceUrl: record.sourceUrl,
      });
      promoted += 1;
    } catch (error) {
      skipped.push({ row: item.rowNumber, reason: (error as Error).message.slice(0, 300) });
    }
  }

  const promotedRows = (batch.promotedRows ?? 0) + promoted;
  await docs(strapi, BATCH_UID).update({
    documentId: batchDocumentId,
    data: {
      promotedRows,
      status: 'promoted',
      log: `Promoted ${promoted} rows to draft products at ${now}.${skipped.length ? ` Skipped: ${skipped.map((s) => `row ${s.row} (${s.reason})`).join('; ')}` : ''}`,
    },
  });
  await audit(strapi, {
    action: 'import.promoted',
    actor,
    subjectType: 'import-batch',
    subjectId: batchDocumentId,
    summary: `Promoted ${promoted} approved rows to DRAFT products; ${skipped.length} skipped`,
  });
  return { promoted, skipped };
}

/**
 * Re-verification: the hook for scheduled price and availability checks where
 * a supplier has authorized a feed, and for a manual re-check from a fresh
 * CSV. It updates PRIVATE provenance only — lastVerifiedAt, sourcePrice,
 * supplierAvailability — matching rows by supplier + supplier reference.
 *
 * It never publishes, never changes the public price and never changes
 * public availability. A supplier going out of stock on a source-on-demand
 * product makes it stale; the storefront's freshness rule (verification older
 * than the store setting) is what then stops it being sold.
 */
export async function reverifyFromCsv(
  strapi: Core.Strapi,
  input: { supplierDocumentId: string; csv: string },
): Promise<{ matched: number; updated: number; unmatched: string[]; priceChanges: { sku: string; from?: number; to: number }[] }> {
  const supplier = await loadSupplier(strapi, input.supplierDocumentId);
  const { records } = parseCsv(input.csv);
  const now = new Date().toISOString();
  let matched = 0;
  let updated = 0;
  const unmatched: string[] = [];
  const priceChanges: { sku: string; from?: number; to: number }[] = [];

  for (const raw of records) {
    const { normalized } = normalizeRecord(raw, { supplierCode: supplier.code, brands: [], categories: [] });
    if (!normalized.supplierReference) continue;

    const products = (await docs(strapi, PRODUCT_UID).findMany({
      filters: {
        supplier: { documentId: { $eq: supplier.documentId } },
        supplierReference: { $eq: normalized.supplierReference },
      },
      fields: ['sku', 'sourcePrice', 'sourceCurrency'],
      limit: 5,
    })) as { documentId: string; sku: string; sourcePrice?: number | string | null; sourceCurrency?: string | null }[];

    if (products.length === 0) {
      unmatched.push(normalized.supplierReference);
      continue;
    }
    matched += 1;

    const seen = new Set<string>();
    for (const product of products) {
      if (seen.has(product.documentId)) continue;
      seen.add(product.documentId);
      const data: Record<string, unknown> = {
        lastVerifiedAt: now,
        supplierAvailability: normalized.supplierAvailability,
      };
      if (normalized.sourcePrice !== undefined && normalized.sourceCurrency) {
        const previous = product.sourcePrice === null || product.sourcePrice === undefined ? undefined : Number(product.sourcePrice);
        if (previous !== normalized.sourcePrice || product.sourceCurrency !== normalized.sourceCurrency) {
          priceChanges.push({ sku: product.sku, from: previous, to: normalized.sourcePrice });
        }
        data.sourcePrice = normalized.sourcePrice;
        data.sourceCurrency = normalized.sourceCurrency;
      }
      // Updates the DRAFT row; Strapi copies it on the next publish. The
      // published row is refreshed directly too so the storefront's freshness
      // check sees the new verification time without a re-publish. Neither
      // write touches a public field.
      await docs(strapi, PRODUCT_UID).update({ documentId: product.documentId, data });
      await strapi.db
        .query(PRODUCT_UID as never)
        .updateMany({ where: { documentId: product.documentId, publishedAt: { $notNull: true } }, data } as never);
      updated += 1;
    }
  }

  await audit(strapi, {
    action: 'import.reverified',
    actor: actorName(strapi),
    subjectType: 'supplier',
    subjectId: supplier.documentId,
    summary: `Re-verified ${updated} products from ${supplier.name}; ${unmatched.length} rows matched nothing; ${priceChanges.length} source price changes`,
    data: { priceChanges: priceChanges.slice(0, 100) },
  });
  return { matched, updated, unmatched, priceChanges };
}

/** Exposed for the price-parsing tests and the ops screen preview. */
export { parsePrice };
