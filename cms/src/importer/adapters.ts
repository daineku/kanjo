import { parseCsv } from './csv';
import type { AdapterContext, RawSupplierRecord, SupplierAdapter } from './types';

/**
 * Supplier adapters — the "extraction" stage.
 *
 * ONE adapter works today: CSV. A person (or the supplier) prepares the file
 * from data they are entitled to share, using cms/templates/
 * supplier-import-template.csv.
 *
 * The other two are deliberate STUBS. They exist so the pipeline's shape is
 * complete and adding a real integration is one class, but each throws until
 * the authorization it names is in hand:
 *
 *  - Shopee: product data is available through the Shopee Open Platform to an
 *    APPROVED partner app that the SHOP OWNER has authorized. Without both
 *    there is no permitted programmatic access. Scraping Shopee product pages
 *    is NOT implemented here, on purpose — it is outside the platform's terms,
 *    and copied listings carry images and descriptions we hold no rights to.
 *  - Supplier feeds: a direct feed (CSV/XML/JSON URL) a supplier has agreed in
 *    writing to provide.
 */

export class AdapterNotAuthorizedError extends Error {}

export const csvAdapter: SupplierAdapter = {
  id: 'csv',
  authorization: 'A CSV file prepared from data the supplier has agreed to share.',
  async *fetch(context: AdapterContext): AsyncIterable<RawSupplierRecord> {
    if (typeof context.csv !== 'string' || context.csv.trim() === '') {
      throw new Error('No CSV content was supplied');
    }
    const { records } = parseCsv(context.csv);
    for (const record of records) yield record;
  },
};

export const authorizedApiAdapter: SupplierAdapter = {
  id: 'authorized_api',
  authorization:
    'UNIMPLEMENTED — pending authorization. Requires an approved platform partner application (e.g. Shopee Open Platform) AND the shop owner’s authorization of that application.',
  // eslint-disable-next-line require-yield
  async *fetch(): AsyncIterable<RawSupplierRecord> {
    throw new AdapterNotAuthorizedError(
      'No authorized supplier API is connected. Platform API access needs an approved partner app and the shop owner’s authorization; until then, import a CSV.',
    );
  },
};

export const authorizedFeedAdapter: SupplierAdapter = {
  id: 'authorized_feed',
  authorization:
    'UNIMPLEMENTED — pending authorization. Requires a feed URL the supplier has agreed in writing to provide, recorded on the supplier (accessMethod, authorizationNotes).',
  // eslint-disable-next-line require-yield
  async *fetch(): AsyncIterable<RawSupplierRecord> {
    throw new AdapterNotAuthorizedError(
      'No authorized supplier feed is configured. Record the supplier’s written permission and feed details first; until then, import a CSV.',
    );
  },
};

export const ADAPTERS: Record<SupplierAdapter['id'], SupplierAdapter> = {
  csv: csvAdapter,
  authorized_api: authorizedApiAdapter,
  authorized_feed: authorizedFeedAdapter,
};
