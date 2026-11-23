import type { Core } from '@strapi/strapi';

/**
 * Scheduled work. Imports are lazy so a failing module cannot stop the CMS
 * booting; each task logs and swallows its own errors.
 */

const safely = (name: string, fn: (strapi: Core.Strapi) => Promise<unknown>) => async ({ strapi }: { strapi: Core.Strapi }) => {
  try {
    await fn(strapi);
  } catch (error) {
    strapi.log.error(`[cron:${name}] ${(error as Error).message}`);
  }
};

export default {
  // Cancels unpaid checkouts whose stock reservation has lapsed, in case the
  // processor's "expired" webhook was lost.
  sweepReservations: {
    task: safely('sweepReservations', async (strapi) => {
      const { sweepExpiredReservations } = await import('../src/commerce/checkout');
      const count = await sweepExpiredReservations(strapi);
      if (count > 0) strapi.log.info(`[cron:sweepReservations] released ${count} expired checkout(s)`);
    }),
    options: { rule: '*/5 * * * *' },
  },

  // The TikTok Shop job queue. Inert until a shop is authorised and a sync
  // switch is on (src/tiktok/jobs.ts).
  tiktokJobs: {
    task: safely('tiktokJobs', async (strapi) => {
      const { runTikTokJobs } = await import('../src/tiktok/jobs');
      await runTikTokJobs(strapi);
    }),
    options: { rule: '0 * * * * *' },
  },

  // Token refresh and order-import polling (TikTok recommends reconciling by
  // polling as well as by webhook).
  tiktokMaintenance: {
    task: safely('tiktokMaintenance', async (strapi) => {
      const { scheduleTikTokMaintenance } = await import('../src/tiktok/jobs');
      await scheduleTikTokMaintenance(strapi);
    }),
    options: { rule: '*/15 * * * *' },
  },
};
