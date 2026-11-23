import type { Core } from '@strapi/strapi';

import { ADAPTERS } from './adapters';
import { createImportBatch, decideImportItem, promoteApproved, reverifyFromCsv } from './pipeline';

/**
 * Importer — public surface for the kanjo-ops admin plugin.
 */

export * from './pipeline';
export { parseCsv, toCsv, CsvError } from './csv';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const docs = (strapi: Core.Strapi, uid: string): any => (strapi as any).documents(uid);

export const importerOps = {
  sources() {
    return Object.values(ADAPTERS).map((adapter) => ({
      id: adapter.id,
      authorization: adapter.authorization,
      available: adapter.id === 'csv',
    }));
  },

  async suppliers(strapi: Core.Strapi) {
    return docs(strapi, 'api::supplier.supplier').findMany({
      fields: ['name', 'code', 'platform', 'accessMethod', 'contentRights', 'active'],
      sort: 'name:asc',
      limit: 500,
    });
  },

  async batches(strapi: Core.Strapi) {
    return docs(strapi, 'api::import-batch.import-batch').findMany({
      sort: 'createdAt:desc',
      limit: 50,
      populate: { supplier: { fields: ['name'] } },
    });
  },

  async batch(strapi: Core.Strapi, documentId: string) {
    const batch = await docs(strapi, 'api::import-batch.import-batch').findOne({
      documentId,
      populate: { supplier: { fields: ['name', 'code'] } },
    });
    if (!batch) return null;
    const items = await docs(strapi, 'api::import-item.import-item').findMany({
      filters: { batch: { documentId: { $eq: documentId } } },
      sort: 'rowNumber:asc',
      limit: 2000,
    });
    return { batch, items };
  },

  create: createImportBatch,
  decide: decideImportItem,
  promote: promoteApproved,
  reverify: reverifyFromCsv,
};
