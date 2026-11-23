/**
 * TikTok Shop integration — public surface.
 *
 * The commerce core imports from './jobs' (enqueueTikTokJob, runTikTokJobs).
 * The kanjo-ops admin plugin loads this file from the compiled app and uses
 * `tikTokOps` below, so the plugin's plain-JS server never reaches into the
 * individual modules.
 */

import type { Core } from '@strapi/strapi';

import { actorName } from '../commerce/actor';
import { audit } from '../commerce/audit';
import { readTikTokConfig, tikTokConfigProblems } from './config';
import { completeAuthorization, describeConnection, getConnection, updateConnection } from './connection';
import { TIKTOK_ELIGIBILITY } from './eligibility';
import { buildTikTokExportCsv } from './export';
import { enqueueTikTokJobWithResult, retryTikTokJob, runTikTokJobs, scheduleTikTokMaintenance } from './jobs';
import { buildAuthorizeUrl, createAuthState, verifyAuthState } from './oauth';
import type { TikTokJobKind } from './types';
import { TIKTOK_JOB_KINDS } from './types';
import { handleTikTokWebhook } from './webhook';

export { enqueueTikTokJob, runTikTokJobs, scheduleTikTokMaintenance } from './jobs';
export { handleTikTokWebhook } from './webhook';
export type { MarketplaceOrderInput } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const docs = (strapi: Core.Strapi, uid: string): any => (strapi as any).documents(uid);

const SYNC_FLAGS = ['syncProducts', 'syncInventory', 'importOrders'] as const;

export const tikTokOps = {
  async overview(strapi: Core.Strapi) {
    const config = readTikTokConfig();
    const connection = await describeConnection(strapi);
    return {
      connection,
      configProblems: tikTokConfigProblems(),
      // Only offered when it can actually work; the state is freshly signed.
      authorizeUrl:
        config && connection.status !== 'connected' ? buildAuthorizeUrl(config, createAuthState(config)) : null,
      checklist: TIKTOK_ELIGIBILITY,
      callbackPath: '/api/kanjo-ops/tiktok/oauth/callback',
      webhookPath: '/api/kanjo-ops/tiktok/webhook',
    };
  },

  async setFlags(strapi: Core.Strapi, input: Record<string, unknown>) {
    const data: Record<string, boolean> = {};
    for (const flag of SYNC_FLAGS) if (typeof input[flag] === 'boolean') data[flag] = input[flag] as boolean;
    await getConnection(strapi);
    await updateConnection(strapi, data);
    await audit(strapi, {
      action: 'tiktok.flags_changed',
      actor: actorName(strapi),
      subjectType: 'tiktok-connection',
      summary: `TikTok sync switches set: ${JSON.stringify(data)}`,
      data,
    });
    return describeConnection(strapi);
  },

  /** The browser lands here from TikTok with `code` and `state`. */
  async completeAuthorization(strapi: Core.Strapi, input: { code?: string; state?: string }) {
    const config = readTikTokConfig();
    if (!config) return { ok: false as const, message: 'TikTok Shop is not configured on this server.' };
    if (!verifyAuthState(config, input.state)) {
      return { ok: false as const, message: 'The authorization link expired or was not issued by this server. Start again from the admin.' };
    }
    if (!input.code) return { ok: false as const, message: 'TikTok did not return an authorization code.' };
    try {
      const connection = await completeAuthorization(strapi, input.code);
      await audit(strapi, {
        action: 'tiktok.authorized',
        actor: 'seller-authorization',
        subjectType: 'tiktok-connection',
        summary: `Authorized TikTok shop "${connection.shopName ?? ''}" (${connection.shopRegion ?? ''})`,
      });
      return { ok: true as const, message: `Connected to ${connection.shopName ?? 'the shop'}.` };
    } catch (error) {
      await updateConnection(strapi, { status: 'error', lastError: (error as Error).message.slice(0, 1000) });
      return { ok: false as const, message: 'TikTok refused the authorization. See the connection error in the admin.' };
    }
  },

  async listings(strapi: Core.Strapi) {
    return docs(strapi, 'api::tiktok-listing.tiktok-listing').findMany({ sort: 'updatedAt:desc', limit: 200 });
  },

  async jobs(strapi: Core.Strapi) {
    return docs(strapi, 'api::tiktok-sync-job.tiktok-sync-job').findMany({
      sort: 'createdAt:desc',
      limit: 100,
      fields: ['kind', 'subject', 'status', 'attempts', 'maxAttempts', 'runAfter', 'lastError', 'finishedAt', 'requestedBy', 'createdAt'],
    });
  },

  async resync(strapi: Core.Strapi, input: { kind?: string; subject?: string }) {
    const kind = input.kind as TikTokJobKind;
    if (!TIKTOK_JOB_KINDS.includes(kind)) return { queued: false, reason: 'Unknown job kind' };
    const subject = (input.subject ?? '').trim() || (kind === 'order_import' ? 'poll' : kind === 'token_refresh' ? 'connection' : '');
    if (!subject) return { queued: false, reason: 'A subject (product id, SKU or order reference) is required' };
    const actor = actorName(strapi);
    const result = await enqueueTikTokJobWithResult(strapi, { kind, subject, requestedBy: actor }, { force: true });
    await audit(strapi, {
      action: 'tiktok.manual_resync',
      actor,
      subjectType: 'tiktok-sync-job',
      subjectId: `${kind}:${subject}`,
      summary: result.queued ? `Queued ${kind} for ${subject}` : `Resync of ${kind}:${subject} not queued: ${result.reason}`,
    });
    return result;
  },

  /** Queue an upsert for every published, non-sample product. */
  async resyncAllProducts(strapi: Core.Strapi) {
    const actor = actorName(strapi);
    let queued = 0;
    let reason: string | undefined;
    for (let start = 0; ; start += 100) {
      const products = (await docs(strapi, 'api::product.product').findMany({
        status: 'published',
        filters: { isSample: { $ne: true } },
        fields: ['name'],
        start,
        limit: 100,
      })) as { documentId: string }[];
      for (const product of products) {
        const result = await enqueueTikTokJobWithResult(
          strapi,
          { kind: 'product_upsert', subject: product.documentId, requestedBy: actor },
          { force: true },
        );
        if (result.queued) queued += 1;
        else reason = result.reason;
      }
      if (products.length < 100) break;
    }
    await audit(strapi, {
      action: 'tiktok.manual_resync_all',
      actor,
      subjectType: 'tiktok-sync-job',
      summary: `Queued ${queued} product upserts`,
    });
    return { queued, reason: queued === 0 ? reason : undefined };
  },

  async retryJob(strapi: Core.Strapi, documentId: string) {
    const result = await retryTikTokJob(strapi, documentId);
    await audit(strapi, {
      action: 'tiktok.job_retry',
      actor: actorName(strapi),
      subjectType: 'tiktok-sync-job',
      subjectId: documentId,
      summary: result.queued ? 'Job re-queued' : `Retry refused: ${result.reason}`,
    });
    return result;
  },

  async runNow(strapi: Core.Strapi) {
    await runTikTokJobs(strapi);
    return { ok: true };
  },

  async exportCsv(strapi: Core.Strapi) {
    const result = await buildTikTokExportCsv(strapi);
    await audit(strapi, {
      action: 'tiktok.csv_export',
      actor: actorName(strapi),
      subjectType: 'product',
      summary: `Exported ${result.rows} SKU rows for manual TikTok upload`,
    });
    return result;
  },

  webhook: handleTikTokWebhook,
  maintenance: scheduleTikTokMaintenance,
};
