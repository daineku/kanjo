'use strict';

/**
 * Thin HTTP adapters over the app's compiled modules.
 *
 * `strapi.kanjo` is assigned in the app's src/index.ts register():
 *   strapi.kanjo = { analytics: computeAnalytics, importer: importerOps, tiktok: tikTokOps }
 * Resolving it per request (not at load) means plugin/app load order does not
 * matter, and a missing wiring line fails with a message saying so.
 */

const kanjo = (strapi) => {
  const modules = strapi.kanjo;
  if (!modules || !modules.analytics || !modules.importer || !modules.tiktok) {
    throw new Error('kanjo-ops: strapi.kanjo is not registered. Add it in src/index.ts register().');
  }
  return modules;
};

const MAX_CSV_CHARS = 5 * 1024 * 1024;

/** Expected, user-facing failures become 400s with their message; anything else is a 500. */
async function respond(ctx, fn) {
  try {
    ctx.body = await fn();
  } catch (error) {
    const name = error && error.name;
    const expected = name === 'ImportError' || name === 'CsvError' || name === 'AdapterNotAuthorizedError' || /Invalid date range/.test(String(error && error.message));
    if (expected) {
      ctx.status = 400;
      ctx.body = { error: { message: error.message } };
      return;
    }
    (globalThis.strapi ? globalThis.strapi.log : console).error(`[kanjo-ops] ${ctx.method} ${ctx.path}: ${error && error.stack ? error.stack : error}`);
    ctx.status = 500;
    ctx.body = { error: { message: 'The operation failed. The server log has the details.' } };
  }
}

const body = (ctx) => (ctx.request.body && typeof ctx.request.body === 'object' ? ctx.request.body : {});

const csvFrom = (ctx) => {
  const csv = body(ctx).csv;
  if (typeof csv !== 'string' || csv.trim() === '') {
    const error = new Error('Paste or upload a CSV file');
    error.name = 'ImportError';
    throw error;
  }
  if (csv.length > MAX_CSV_CHARS) {
    const error = new Error('The CSV is larger than 5 MB; split it');
    error.name = 'ImportError';
    throw error;
  }
  return csv;
};

const html = (title, message) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{font:16px/1.5 system-ui,sans-serif;background:#000003;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{max-width:520px;border-left:3px solid #e84a4a;padding:16px 24px;background:#111}</style></head><body><main><h1>${title}</h1><p>${message}</p><p>You can close this window and return to the CMS admin.</p></main></body></html>`;

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

module.exports = ({ strapi }) => ({
  // ── Analytics ────────────────────────────────────────────────────────────
  async analytics(ctx) {
    await respond(ctx, () => {
      const now = new Date();
      const to = ctx.query.to ? String(ctx.query.to) : now.toISOString();
      const from = ctx.query.from
        ? String(ctx.query.from)
        : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      return kanjo(strapi).analytics(strapi, { from, to, includeTest: ctx.query.includeTest === 'true' });
    });
  },

  // ── Imports ──────────────────────────────────────────────────────────────
  async importMeta(ctx) {
    await respond(ctx, async () => ({
      sources: kanjo(strapi).importer.sources(),
      suppliers: await kanjo(strapi).importer.suppliers(strapi),
    }));
  },
  async importBatches(ctx) {
    await respond(ctx, () => kanjo(strapi).importer.batches(strapi));
  },
  async importBatch(ctx) {
    await respond(ctx, async () => {
      const result = await kanjo(strapi).importer.batch(strapi, ctx.params.id);
      if (!result) {
        const error = new Error('Import batch not found');
        error.name = 'ImportError';
        throw error;
      }
      return result;
    });
  },
  async importCreate(ctx) {
    await respond(ctx, () => {
      const input = body(ctx);
      const source = input.source || 'csv';
      return kanjo(strapi).importer.create(strapi, {
        supplierDocumentId: String(input.supplierDocumentId || ''),
        source,
        label: typeof input.label === 'string' ? input.label : undefined,
        csv: source === 'csv' ? csvFrom(ctx) : undefined,
      });
    });
  },
  async importDecide(ctx) {
    await respond(ctx, async () => {
      const input = body(ctx);
      if (!['approved', 'rejected', 'pending'].includes(input.decision)) {
        const error = new Error('decision must be approved, rejected or pending');
        error.name = 'ImportError';
        throw error;
      }
      await kanjo(strapi).importer.decide(strapi, {
        itemDocumentId: ctx.params.id,
        decision: input.decision,
        reviewNote: typeof input.reviewNote === 'string' ? input.reviewNote : undefined,
        authenticity: typeof input.authenticity === 'string' && input.authenticity ? input.authenticity : undefined,
      });
      return { ok: true };
    });
  },
  async importPromote(ctx) {
    await respond(ctx, () => kanjo(strapi).importer.promote(strapi, ctx.params.id));
  },
  async importReverify(ctx) {
    await respond(ctx, () =>
      kanjo(strapi).importer.reverify(strapi, {
        supplierDocumentId: String(body(ctx).supplierDocumentId || ''),
        csv: csvFrom(ctx),
      }),
    );
  },

  // ── TikTok Shop ──────────────────────────────────────────────────────────
  async tiktokOverview(ctx) {
    await respond(ctx, () => kanjo(strapi).tiktok.overview(strapi));
  },
  async tiktokFlags(ctx) {
    await respond(ctx, () => kanjo(strapi).tiktok.setFlags(strapi, body(ctx)));
  },
  async tiktokListings(ctx) {
    await respond(ctx, () => kanjo(strapi).tiktok.listings(strapi));
  },
  async tiktokJobs(ctx) {
    await respond(ctx, () => kanjo(strapi).tiktok.jobs(strapi));
  },
  async tiktokResync(ctx) {
    await respond(ctx, () => kanjo(strapi).tiktok.resync(strapi, body(ctx)));
  },
  async tiktokResyncAll(ctx) {
    await respond(ctx, () => kanjo(strapi).tiktok.resyncAllProducts(strapi));
  },
  async tiktokRetry(ctx) {
    await respond(ctx, () => kanjo(strapi).tiktok.retryJob(strapi, ctx.params.id));
  },
  async tiktokRun(ctx) {
    await respond(ctx, () => kanjo(strapi).tiktok.runNow(strapi));
  },
  async tiktokExport(ctx) {
    await respond(ctx, () => kanjo(strapi).tiktok.exportCsv(strapi));
  },

  // ── Public: TikTok → us ──────────────────────────────────────────────────
  async tiktokWebhook(ctx) {
    const requestBody = ctx.request.body;
    const raw = requestBody ? requestBody[Symbol.for('unparsedBody')] : undefined;
    try {
      const result = await kanjo(strapi).tiktok.webhook(strapi, {
        rawBody: typeof raw === 'string' ? raw : undefined,
        authorizationHeader: ctx.get('authorization'),
      });
      ctx.status = result.status;
      ctx.body = result.body;
    } catch (error) {
      strapi.log.error(`[kanjo-ops] TikTok webhook: ${error && error.message}`);
      // 500 makes TikTok retry, which is right for an unexpected failure.
      ctx.status = 500;
      ctx.body = { error: 'internal' };
    }
  },

  async tiktokCallback(ctx) {
    ctx.set('Cache-Control', 'no-store');
    ctx.set('Referrer-Policy', 'no-referrer');
    ctx.type = 'text/html';
    try {
      const result = await kanjo(strapi).tiktok.completeAuthorization(strapi, {
        code: typeof ctx.query.code === 'string' ? ctx.query.code : undefined,
        state: typeof ctx.query.state === 'string' ? ctx.query.state : undefined,
      });
      ctx.status = result.ok ? 200 : 400;
      ctx.body = html(result.ok ? 'TikTok Shop connected' : 'Authorization not completed', escapeHtml(result.message));
    } catch (error) {
      strapi.log.error(`[kanjo-ops] TikTok callback: ${error && error.message}`);
      ctx.status = 500;
      ctx.body = html('Authorization not completed', 'The server could not complete the authorization.');
    }
  },
});
