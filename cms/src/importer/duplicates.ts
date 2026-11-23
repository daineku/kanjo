import type { DuplicateMatch, ExistingProduct, NormalizedRecord } from './types';

/**
 * Duplicate detection. Pure.
 *
 * EXACT matches block promotion — the same supplier item, the same listing
 * URL, or a SKU already in use would create a second product for one thing:
 *   - same supplier + same supplier reference
 *   - same source URL
 *   - same SKU (including an existing product's variant SKUs)
 *
 * A POSSIBLE match is a similar name. Two suppliers selling the same part will
 * not share a reference or a URL, so name similarity is the only signal — but
 * "Civic EG front lip" and "Civic EK front lip" are also similar and are
 * different parts, so this is a warning for a person, never an automatic skip.
 */

const STOP_WORDS = new Set(['the', 'a', 'an', 'for', 'and', 'with', 'of', 'to', 'in', 'set', 'pcs', 'pc', 'new']);

export function nameTokens(name: string): string[] {
  return [
    ...new Set(
      name
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(' ')
        .filter((word) => word.length > 0 && !STOP_WORDS.has(word)),
    ),
  ].sort();
}

/** Jaccard similarity of the two names' token sets, 0…1. */
export function nameSimilarity(a: string, b: string): number {
  const left = nameTokens(a);
  const right = new Set(nameTokens(b));
  if (left.length === 0 || right.size === 0) return 0;
  const shared = left.filter((word) => right.has(word)).length;
  return shared / (left.length + right.size - shared);
}

export const SIMILARITY_THRESHOLD = 0.8;

const sameUrl = (a?: string, b?: string) => Boolean(a && b && a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase());

export function findDuplicates(
  record: NormalizedRecord,
  context: {
    supplierCode: string;
    existing: ExistingProduct[];
    /** Rows of the same batch that came before this one. */
    earlier: { rowNumber: number; record: NormalizedRecord }[];
  },
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  const sku = record.sku.toLowerCase();

  for (const product of context.existing) {
    if (
      record.supplierReference &&
      product.supplierCode === context.supplierCode &&
      product.supplierReference === record.supplierReference
    ) {
      matches.push({ strength: 'exact', reason: 'supplier_reference', of: product.documentId, label: product.name });
    } else if (sameUrl(record.sourceUrl, product.sourceUrl)) {
      matches.push({ strength: 'exact', reason: 'source_url', of: product.documentId, label: product.name });
    } else if (sku && [product.sku, ...product.variantSkus].some((value) => value.toLowerCase() === sku)) {
      matches.push({ strength: 'exact', reason: 'sku', of: product.documentId, label: product.name });
    } else if (record.name && nameSimilarity(record.name, product.name) >= SIMILARITY_THRESHOLD) {
      matches.push({ strength: 'possible', reason: 'similar_name', of: product.documentId, label: product.name });
    }
  }

  for (const earlier of context.earlier) {
    const other = earlier.record;
    const of = `row:${earlier.rowNumber}`;
    const label = `row ${earlier.rowNumber}: ${other.name}`;
    if (record.supplierReference && other.supplierReference === record.supplierReference) {
      matches.push({ strength: 'exact', reason: 'supplier_reference', of, label });
    } else if (sameUrl(record.sourceUrl, other.sourceUrl)) {
      matches.push({ strength: 'exact', reason: 'source_url', of, label });
    } else if (sku && other.sku.toLowerCase() === sku) {
      matches.push({ strength: 'exact', reason: 'sku', of, label });
    } else if (record.name && nameSimilarity(record.name, other.name) >= SIMILARITY_THRESHOLD) {
      matches.push({ strength: 'possible', reason: 'similar_name', of, label });
    }
  }

  return matches;
}
