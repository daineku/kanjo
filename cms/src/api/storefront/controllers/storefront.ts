import type { Core } from '@strapi/strapi';

import { buildCatalog, detail, loadCatalogIndex, loadRatings } from '../../../commerce/catalog';
import { publicQuote, quoteCart } from '../../../commerce/cart';
import { createCheckout, handlePaymentEvent } from '../../../commerce/checkout';
import { submitBuildInquiry, submitSourcingRequest } from '../../../commerce/enquiries';
import { getStock } from '../../../commerce/inventory';
import { lookupOrder } from '../../../commerce/orders';
import { paymentProvider, WebhookSignatureError } from '../../../commerce/payments';
import { hit } from '../../../commerce/ratelimit';
import { productReviews, reportReview, submitReview } from '../../../commerce/reviews';
import { CommerceError } from '../../../commerce/util';

/**
 * The storefront controller. Thin on purpose: validation, pricing, stock and
 * payments all live in src/commerce, where they are tested; this file maps
 * HTTP to those functions and every failure to one error shape:
 *
 *     { error: { code, message, fields?, quote? } }
 */

type Ctx = any;

const UNPARSED = Symbol.for('unparsedBody');
const MIN_FORM_MS = 2500;

function clientIp(ctx: Ctx): string {
  // Set by the website's server from the visitor's request. The CMS is not
  // reachable by browsers, so this header comes from a trusted caller.
  const forwarded = String(ctx.request.header['x-kanjo-client-ip'] ?? '').trim();
  return forwarded || ctx.request.ip || 'unknown';
}

function limit(ctx: Ctx, action: string) {
  const result = hit(action, clientIp(ctx));
  if (!result.allowed) {
    ctx.set('Retry-After', String(result.retryAfterSeconds));
    throw new CommerceError('rate_limited', 'Too many requests. Please wait a moment and try again.', 429);
  }
}

/** Honeypot + minimum fill time, for every public form. */
function spamCheck(body: any) {
  if (typeof body?.website === 'string' && body.website.trim() !== '') {
    throw new CommerceError('spam_rejected', 'Your submission could not be accepted.', 400);
  }
  const elapsed = Number(body?.elapsedMs);
  if (!Number.isFinite(elapsed) || elapsed < MIN_FORM_MS) {
    throw new CommerceError('spam_rejected', 'That was submitted too quickly. Please try again.', 400);
  }
}

async function respond(ctx: Ctx, fn: () => Promise<unknown>) {
  try {
    ctx.body = await fn();
  } catch (error) {
    if (error instanceof CommerceError) {
      ctx.status = error.status;
      const { quote, ...extra } = error.extra as any;
      ctx.body = {
        error: {
          code: error.code,
          message: error.message,
          ...extra,
          ...(quote ? { quote: publicQuote(quote) } : {}),
        },
      };
      return;
    }
    strapi.log.error(`[storefront] ${ctx.method} ${ctx.path}: ${(error as Error).stack ?? error}`);
    ctx.status = 500;
    ctx.body = { error: { code: 'store_unavailable', message: 'Something went wrong on our side. Nothing was charged.' } };
  }
}

declare const strapi: Core.Strapi;

export default {
  async catalog(ctx: Ctx) {
    await respond(ctx, () => buildCatalog(strapi));
  },

  async product(ctx: Ctx) {
    await respond(ctx, async () => {
      const slug = String(ctx.params.slug ?? '').slice(0, 200);
      const index = await loadCatalogIndex(strapi);
      const product = index.products.find((p: any) => p.slug === slug);
      if (!product) {
        // A renamed product keeps its old slugs in `previousSlugs`; an explicit
        // redirect entry covers anything else (a discontinued line, a merge).
        const renamed = index.products.find((p: any) =>
          String(p.previousSlugs ?? '')
            .split(/[\s,]+/)
            .includes(slug),
        );
        const redirect: any = renamed
          ? { toPath: `/parts/${renamed.slug}` }
          : await strapi.documents('api::redirect.redirect' as any).findFirst({ filters: { fromPath: `/parts/${slug}` } } as any);
        throw new CommerceError('not_found', 'Product not found.', 404, redirect ? { redirectTo: redirect.toPath } : {});
      }
      const skus = [product.sku, ...((product.variants ?? []) as any[]).map((variant) => variant.sku)];
      const [stock, ratings] = await Promise.all([getStock(strapi, skus), loadRatings(strapi)]);
      return { product: detail(product, index, stock, ratings) };
    });
  },

  async reviews(ctx: Ctx) {
    await respond(ctx, () => productReviews(strapi, String(ctx.params.slug ?? '').slice(0, 200)));
  },

  async pages(ctx: Ctx) {
    await respond(ctx, async () => {
      const pages: any[] = await strapi.documents('api::store-page.store-page' as any).findMany({ status: 'published', limit: 100 } as any);
      return {
        pages: pages.map((page) => ({
          slug: page.slug,
          title: page.title,
          body: page.body ?? '',
          legalReviewed: page.legalReviewed === true,
          effectiveDate: page.effectiveDate || undefined,
          updatedAt: page.updatedAt,
        })),
      };
    });
  },

  async redirects(ctx: Ctx) {
    await respond(ctx, async () => {
      const rows: any[] = await strapi.documents('api::redirect.redirect' as any).findMany({ limit: 1000 } as any);
      return { redirects: rows.map((row) => ({ fromPath: row.fromPath, toPath: row.toPath, permanent: row.permanent !== false })) };
    });
  },

  async quote(ctx: Ctx) {
    await respond(ctx, async () => {
      limit(ctx, 'quote');
      const body = ctx.request.body ?? {};
      return publicQuote(await quoteCart(strapi, body.items, body.country));
    });
  },

  async checkout(ctx: Ctx) {
    await respond(ctx, async () => {
      limit(ctx, 'checkout');
      return createCheckout(strapi, ctx.request.body ?? {});
    });
  },

  async lookup(ctx: Ctx) {
    await respond(ctx, async () => {
      limit(ctx, 'lookup');
      return { order: await lookupOrder(strapi, ctx.request.body ?? {}) };
    });
  },

  async submitReview(ctx: Ctx) {
    await respond(ctx, async () => {
      limit(ctx, 'review');
      const body = ctx.request.body ?? {};
      spamCheck(body);
      return submitReview(strapi, body, clientIp(ctx));
    });
  },

  async reportReview(ctx: Ctx) {
    await respond(ctx, async () => {
      limit(ctx, 'report');
      return reportReview(strapi, String(ctx.params.id ?? '').slice(0, 64), ctx.request.body ?? {}, clientIp(ctx));
    });
  },

  async sourcing(ctx: Ctx) {
    await respond(ctx, async () => {
      limit(ctx, 'sourcing');
      const body = ctx.request.body ?? {};
      spamCheck(body);
      return submitSourcingRequest(strapi, body, clientIp(ctx));
    });
  },

  async build(ctx: Ctx) {
    await respond(ctx, async () => {
      limit(ctx, 'build');
      const body = ctx.request.body ?? {};
      spamCheck(body);
      return submitBuildInquiry(strapi, body, clientIp(ctx));
    });
  },

  /**
   * The payment processor's webhook. Signature-verified over the RAW body
   * (config/middlewares.ts keeps it), deduplicated by event id, processed
   * synchronously — every handler is a few small queries — and answered 2xx
   * only once the effect is committed, so a failure is retried by the
   * processor rather than lost.
   */
  async webhook(ctx: Ctx) {
    const provider = paymentProvider();
    if (!provider || provider.id !== ctx.params.provider) {
      ctx.status = 404;
      ctx.body = { error: { code: 'not_found', message: 'No such payment provider.' } };
      return;
    }
    const raw = ctx.request.body?.[UNPARSED];
    if (raw === undefined) {
      strapi.log.error('[webhook] raw body unavailable; check strapi::body includeUnparsed.');
      ctx.status = 500;
      ctx.body = { received: false };
      return;
    }
    let event;
    try {
      event = provider.verifyWebhook(raw, ctx.request.header);
    } catch (error) {
      if (error instanceof WebhookSignatureError) {
        strapi.log.warn(`[webhook] rejected: ${error.message}`);
        ctx.status = 400;
        ctx.body = { received: false };
        return;
      }
      throw error;
    }
    try {
      const outcome = await handlePaymentEvent(strapi, provider.id, event);
      strapi.log.info(`[webhook] ${event.rawType} ${event.id}: ${outcome}`);
      ctx.body = { received: true };
    } catch (error) {
      strapi.log.error(`[webhook] ${event.rawType} ${event.id} failed: ${(error as Error).message}`);
      ctx.status = 500;
      ctx.body = { received: false };
    }
  },
};
