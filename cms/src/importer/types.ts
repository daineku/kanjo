/**
 * Supplier ingestion — types.
 *
 *   discovery → extraction → normalization → duplicate detection
 *             → HUMAN REVIEW → draft product → (editorial work) → publication
 *
 * The pipeline never publishes. Its furthest reach is a DRAFT product with no
 * public price, no images and no public description — the three things that
 * need a person: a price decision, image rights, and original copy.
 */

/** One record as the supplier's source gave it. Keys are normalised headers. */
export type RawSupplierRecord = {
  rowNumber: number;
  values: Record<string, string>;
};

export type AdapterContext = {
  supplierCode: string;
  /** For the CSV adapter: the file's text. */
  csv?: string;
};

/**
 * A source of supplier records.
 *
 * `authorization` states what the adapter needs before it may run. An adapter
 * for a platform we hold no authorization for exists only as a stub that
 * throws — see adapters.ts. There is deliberately no scraping adapter.
 */
export interface SupplierAdapter {
  id: 'csv' | 'authorized_api' | 'authorized_feed';
  authorization: string;
  fetch(context: AdapterContext): AsyncIterable<RawSupplierRecord>;
}

export type IssueLevel = 'error' | 'warning';
export type ImportIssue = { level: IssueLevel; field?: string; message: string };

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'THB', 'CAD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const CONDITIONS = ['new', 'new_old_stock', 'used_excellent', 'used_good', 'used_fair', 'refurbished'] as const;
export const AUTHENTICITIES = [
  'genuine_oem',
  'genuine_aftermarket',
  'third_party_replacement',
  'replica_reproduction',
  'custom_made',
  'unverified',
] as const;
export const SUPPLIER_AVAILABILITY = ['unknown', 'available', 'limited', 'unavailable'] as const;

export type NormalizedRecord = {
  supplierReference: string;
  sourceUrl?: string;
  name: string;
  slug: string;
  sku: string;
  brandName?: string;
  brandDocumentId?: string;
  categoryName?: string;
  categoryDocumentId?: string;
  sourcePrice?: number;
  sourceCurrency?: Currency;
  supplierAvailability: (typeof SUPPLIER_AVAILABILITY)[number];
  weightGrams?: number;
  condition: (typeof CONDITIONS)[number];
  /** Always `unverified` out of the importer unless a reviewer sets it. */
  authenticity: (typeof AUTHENTICITIES)[number];
  countryOfOrigin?: string;
  /** The supplier's own text. Kept privately as provenance; never published. */
  supplierDescription?: string;
  notes?: string;
  marginPercent?: number;
  isSample: boolean;
};

export type LookupEntry = { documentId: string; name: string; slug: string };

export type NormalizeContext = {
  supplierCode: string;
  brands: LookupEntry[];
  categories: LookupEntry[];
};

export type ExistingProduct = {
  documentId: string;
  name: string;
  sku: string;
  variantSkus: string[];
  supplierCode?: string;
  supplierReference?: string;
  sourceUrl?: string;
};

export type DuplicateMatch = {
  /** `exact` blocks promotion; `possible` is a warning for the reviewer. */
  strength: 'exact' | 'possible';
  reason: 'supplier_reference' | 'source_url' | 'sku' | 'similar_name';
  /** A product documentId, or `row:<n>` for an earlier row of the same batch. */
  of: string;
  label: string;
};
