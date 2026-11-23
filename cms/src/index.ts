import type { Core } from '@strapi/strapi';

import { computeAnalytics } from './commerce/analytics';
import { registerGuards } from './commerce/guards';
import { ensureRoles } from './commerce/roles';
import { importerOps } from './importer';
import { seedStructure } from './seed/structure';
import { tikTokOps } from './tiktok';

/**
 * The Kanjo Parts CMS.
 *
 *   register   installs the Document Service guards (src/commerce/guards.ts)
 *              before anything can write.
 *   bootstrap  seeds the store STRUCTURE into empty tables (categories,
 *              vehicles, settings, disabled shipping zones, draft policies)
 *              and re-applies the Fulfillment Partner role definition.
 *
 * No products, prices, stock, rates or reviews are ever created at boot.
 */
export default {
  register({ strapi }: { strapi: Core.Strapi }) {
    registerGuards(strapi);
    // The kanjo-ops admin plugin's plain-JS server reaches the compiled app
    // code through this one handle (src/plugins/kanjo-ops/server).
    (strapi as any).kanjo = { analytics: computeAnalytics, importer: importerOps, tiktok: tikTokOps };
  },

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    if (process.env.KANJO_SKIP_BOOTSTRAP_SEED !== 'true') {
      const seeded = await seedStructure(strapi);
      if (seeded.length > 0) strapi.log.info(`[seed] created: ${seeded.join(', ')}`);
    }
    await ensureRoles(strapi);
  },
};
