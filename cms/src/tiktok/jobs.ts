import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Core } from '@strapi/strapi';

import { actorName, runAsSystem } from '../commerce/actor';
import { audit } from '../commerce/audit';
import { availableToSell } from '../commerce/inventory';
import { importMarketplaceOrder } from '../commerce/orders';
import { TikTokApiError, type TikTokClient } from './client';
import { readShippingProviderMap, readTikTokConfig } from './config';
import { getAuthorizedClient, getConnection, isLive, updateConnection } from './connection';
import {
  ensureListings,
  listingForSku,
  listingsForProduct,
  recordListingError,
  updateListing,
  type ListingRecord,
} from './listings';
import {
  mapTikTokOrder,
  resolveListingPrice,
  toCreateProductPayload,
  toInventoryUpdatePayload,
  toPriceUpdatePayload,
  type ListingOverride,
  type MappableProduct,
} from './mapper';
import type { EnqueueJobInput, TikTokJobKind } from './types';

/**
 * The synchronization queue.
 *
 * Every outbound change to TikTok Shop is a row in `tiktok-sync-job`, worked by
 * a cron task. That gives the four properties the integration needs:
 *
 *  - DUPLICATE PREVENTION. A live job's `dedupeKey` is `${kind}:${subject}` and
 *    the column is unique, so ten stock changes to one SKU while a job is
 *    waiting collapse into one push of the CURRENT value. Jobs carry subjects,
 *    not values: the worker reads the truth when it runs.
 *  - RETRY. Transient failures are re-queued with exponential backoff and
 *    jitter; a 429 (or business code 36009002) honours Retry-After and stops
 *    the batch. After `maxAttempts` a job is `dead` and visible in the ops log.
 *  - AN ERROR LOG. `lastError` on the job, and on each listing it concerned.
 *  - MANUAL RESYNC. The ops screen enqueues the same jobs with `requestedBy`.
 *
 * STOCK AUTHORITY. The website's `inventory-item` is the single source of
 * truth. TikTok is only ever TOLD a number — `availableToSell`, which is
 * on-hand minus reserved minus the per-SKU marketplace buffer — and a TikTok
 * order decrements our stock when it is imported. TikTok's own stock figure is
 * never read back into ours.
 */

const JOB_UID = 'api::tiktok-sync-job.tiktok-sync-job';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const docs = (strapi: Core.Strapi, uid: string): any => (strapi as any).documents(uid);

type JobRecord = {
  documentId: string;
  kind: TikTokJobKind;
  dedupeKey: string;
  subject?: string | null;
  payload?: Record<string, unknown> | null;
  status: string;
  attempts?: number | null;
  maxAttempts?: number | null;
  runAfter?: string | null;
  updatedAt?: string;
};

const FLAG_FOR_KIND: Record<TikTokJobKind, 'syncProducts' | 'syncInventory' | 'importOrders' | null> = {
  product_upsert: 'syncProducts',
  price_update: 'syncProducts',
  product_deactivate: 'syncProducts',
  inventory_update: 'syncInventory',
  order_import: 'importOrders',
  fulfillment_update: 'importOrders',
  token_refresh: null,
};

export type EnqueueResult = { queued: boolean; reason?: string };

/**
 * Queue a job. Returns why nothing was queued when nothing was.
 *
 * `force` is for an explicit manual resync from the ops screen: it skips the
 * per-area sync switch, never the requirement that the shop is authorized.
 */
export async function enqueueTikTokJobWithResult(
  strapi: Core.Strapi,
  input: EnqueueJobInput,
  options: { force?: boolean } = {},
): Promise<EnqueueResult> {
  const connection = await getConnection(strapi);
  if (!isLive(connection, readTikTokConfig())) {
    return { queued: false, reason: 'TikTok Shop is not connected' };
  }
  const flag = FLAG_FOR_KIND[input.kind];
  if (flag && !options.force && !connection[flag]) {
    return { queued: false, reason: `Automatic ${flag} is switched off` };
  }

  const baseKey = `${input.kind}:${input.subject}`;
  const existing = (await docs(strapi, JOB_UID).findMany({
    filters: { dedupeKey: { $in: [baseKey, `${baseKey}:next`] } },
    limit: 2,
  })) as JobRecord[];

  const base = existing.find((job) => job.dedupeKey === baseKey);
  const next = existing.find((job) => job.dedupeKey === `${baseKey}:next`);

  // A waiting job will read current state when it runs: nothing to add.
  if (base && base.status === 'queued') return { queued: false, reason: 'Already queued' };
  // One is running against possibly-older state: allow exactly one follow-up.
  if (base && next) return { queued: false, reason: 'Already queued' };

  try {
    await docs(strapi, JOB_UID).create({
      data: {
        kind: input.kind,
        dedupeKey: base ? `${baseKey}:next` : baseKey,
        subject: input.subject,
        payload: input.payload ?? null,
        status: 'queued',
        attempts: 0,
        maxAttempts: 6,
        runAfter: new Date().toISOString(),
        requestedBy: input.requestedBy ?? actorName(strapi),
      },
    });
    return { queued: true };
  } catch {
    // The unique index beat us to it: another request queued the same job.
    return { queued: false, reason: 'Already queued' };
  }
}

/** The fire-and-forget form the commerce middlewares call. Never throws. */
export async function enqueueTikTokJob(strapi: Core.Strapi, input: EnqueueJobInput): Promise<void> {
  try {
    await enqueueTikTokJobWithResult(strapi, input);
  } catch (error) {
    strapi.log.warn(`[tiktok] could not queue ${input.kind}:${input.subject}: ${(error as Error).message}`);
  }
}

// ── Backoff ─────────────────────────────────────────────────────────────────

const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 60 * 60_000;

/** Exponential backoff with full jitter in the upper half of the window. */
export function backoffDelayMs(attempt: number, retryAfterMs?: number, random: () => number = Math.random): number {
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    // The server said when. Add a little jitter so parallel jobs do not align.
    return Math.min(retryAfterMs + Math.floor(random() * 5_000), MAX_DELAY_MS);
  }
  const ceiling = Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1), MAX_DELAY_MS);
  return Math.floor(ceiling / 2 + random() * (ceiling / 2));
}

// ── Worker ──────────────────────────────────────────────────────────────────

let workerBusy = false;
const STALE_RUNNING_MS = 15 * 60_000;
const BATCH_SIZE = 10;

class JobSkipped extends Error {}

async function finish(strapi: Core.Strapi, job: JobRecord, status: string, lastError: string | null) {
  await docs(strapi, JOB_UID).update({
    documentId: job.documentId,
    data: {
      status,
      lastError,
      finishedAt: new Date().toISOString(),
      // Free the live key so the next change to this subject can queue.
      dedupeKey: `${job.dedupeKey}#${job.documentId}`,
    },
  });
}

/**
 * Work the queue. Safe to call from a cron tick every minute: a tick that
 * arrives while the previous one is still running returns immediately.
 */
export async function runTikTokJobs(strapi: Core.Strapi): Promise<void> {
  if (workerBusy) return;
  workerBusy = true;
  try {
    const config = readTikTokConfig();
    const connection = await getConnection(strapi);
    if (!isLive(connection, config)) return;

    // A job left `running` by a crashed process goes back in the queue.
    const stale = (await docs(strapi, JOB_UID).findMany({
      filters: { status: { $eq: 'running' }, updatedAt: { $lt: new Date(Date.now() - STALE_RUNNING_MS).toISOString() } },
      limit: 50,
    })) as JobRecord[];
    for (const job of stale) {
      await docs(strapi, JOB_UID).update({ documentId: job.documentId, data: { status: 'queued' } });
    }

    const due = (await docs(strapi, JOB_UID).findMany({
      filters: {
        status: { $eq: 'queued' },
        $or: [{ runAfter: { $null: true } }, { runAfter: { $lte: new Date().toISOString() } }],
      },
      sort: 'createdAt:asc',
      limit: BATCH_SIZE,
    })) as JobRecord[];

    for (const job of due) {
      const attempts = (job.attempts ?? 0) + 1;
      await docs(strapi, JOB_UID).update({ documentId: job.documentId, data: { status: 'running', attempts } });

      try {
        await runAsSystem(`tiktok:${job.kind}`, () => handleJob(strapi, job));
        await finish(strapi, job, 'succeeded', null);
      } catch (error) {
        if (error instanceof JobSkipped) {
          await finish(strapi, job, 'cancelled', error.message);
          continue;
        }
        const apiError = error instanceof TikTokApiError ? error : undefined;
        const message = (error as Error).message.slice(0, 2000);
        const permanent = apiError ? !apiError.retryable : error instanceof PermanentJobError;
        const maxAttempts = job.maxAttempts ?? 6;

        if (permanent) {
          await finish(strapi, job, 'failed', message);
        } else if (attempts >= maxAttempts) {
          await finish(strapi, job, 'dead', `Gave up after ${attempts} attempts. Last error: ${message}`);
        } else {
          await docs(strapi, JOB_UID).update({
            documentId: job.documentId,
            data: {
              status: 'queued',
              lastError: message,
              runAfter: new Date(Date.now() + backoffDelayMs(attempts, apiError?.retryAfterMs)).toISOString(),
            },
          });
        }
        strapi.log.warn(`[tiktok] job ${job.kind}:${job.subject ?? ''} failed (attempt ${attempts}): ${message}`);

        // Throttled: every further call in this tick would be throttled too.
        if (apiError?.rateLimited) break;
      }
    }
  } catch (error) {
    strapi.log.error(`[tiktok] job worker error: ${(error as Error).message}`);
  } finally {
    workerBusy = false;
  }
}

/** Re-queue a failed or dead job from the ops screen. */
export async function retryTikTokJob(strapi: Core.Strapi, documentId: string): Promise<EnqueueResult> {
  const job = (await docs(strapi, JOB_UID).findOne({ documentId })) as JobRecord | null;
  if (!job) return { queued: false, reason: 'Job not found' };
  if (!['failed', 'dead', 'cancelled'].includes(job.status)) {
    return { queued: false, reason: `A ${job.status} job cannot be retried` };
  }
  return enqueueTikTokJobWithResult(
    strapi,
    { kind: job.kind, subject: job.subject ?? '', payload: job.payload ?? undefined },
    { force: true },
  );
}

/** An error that retrying cannot fix (bad mapping, missing data). */
export class PermanentJobError extends Error {}

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleJob(strapi: Core.Strapi, job: JobRecord): Promise<void> {
  const subject = job.subject ?? '';
  switch (job.kind) {
    case 'token_refresh': {
      const session = await getAuthorizedClient(strapi, { forceRefresh: true });
      if (!session) throw new JobSkipped('TikTok Shop is not connected');
      return;
    }
    case 'product_upsert':
      return upsertProduct(strapi, subject);
    case 'price_update':
      return pushPrices(strapi, subject);
    case 'inventory_update':
      return pushInventory(strapi, subject);
    case 'product_deactivate':
      return deactivateProduct(strapi, subject);
    case 'order_import':
      return importOrders(strapi, subject);
    case 'fulfillment_update':
      return pushFulfillment(strapi, subject);
    default: {
      const unhandled: never = job.kind;
      throw new PermanentJobError(`Unknown job kind ${String(unhandled)}`);
    }
  }
}

async function session(strapi: Core.Strapi) {
  const value = await getAuthorizedClient(strapi);
  if (!value) throw new JobSkipped('TikTok Shop is not connected');
  return value;
}

let warehouseCache: { shopId: string; id: string } | undefined;

async function defaultWarehouseId(client: TikTokClient, shopId: string): Promise<string> {
  if (warehouseCache && warehouseCache.shopId === shopId) return warehouseCache.id;
  const warehouses = await client.getWarehouses();
  const chosen =
    warehouses.find((w) => w.isDefault && w.type !== 'RETURN_WAREHOUSE') ??
    warehouses.find((w) => w.type !== 'RETURN_WAREHOUSE') ??
    warehouses[0];
  if (!chosen) throw new PermanentJobError('The shop has no warehouse. Create one in TikTok Seller Center.');
  warehouseCache = { shopId, id: chosen.id };
  return chosen.id;
}

type LoadedProduct = MappableProduct & {
  mainImage?: { url?: string; name?: string } | null;
  gallery?: { url?: string; name?: string }[] | null;
};

async function loadPublishedProduct(strapi: Core.Strapi, documentId: string): Promise<LoadedProduct | null> {
  return (await docs(strapi, 'api::product.product').findOne({
    documentId,
    status: 'published',
    populate: { category: true, variants: true, mainImage: true, gallery: true },
  })) as LoadedProduct | null;
}

const skusOf = (product: MappableProduct): string[] =>
  product.variants && product.variants.length > 0 ? product.variants.map((variant) => variant.sku) : [product.sku];

async function loadImageBytes(strapi: Core.Strapi, url: string): Promise<Uint8Array> {
  if (url.startsWith('/')) {
    // The local upload provider: the file is on this machine.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const publicDir = (strapi as any).dirs?.static?.public as string | undefined;
    if (!publicDir) throw new PermanentJobError('Cannot locate the local upload directory');
    return new Uint8Array(await readFile(join(publicDir, url)));
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not read product image (HTTP ${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

async function stockFor(strapi: Core.Strapi, skus: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const sku of skus) out[sku] = await availableToSell(strapi, sku);
  return out;
}

const overridesFrom = (rows: ListingRecord[]): Record<string, ListingOverride> =>
  Object.fromEntries(rows.map((row) => [row.sku, { tiktokPrice: row.tiktokPrice, tiktokCurrency: row.tiktokCurrency }]));

async function upsertProduct(strapi: Core.Strapi, productDocumentId: string): Promise<void> {
  const product = await loadPublishedProduct(strapi, productDocumentId);
  // Unpublished or deleted since the job was queued: the right action is to take it down.
  if (!product) return deactivateProduct(strapi, productDocumentId);

  const { client, connection, shopCurrency } = await session(strapi);
  const skus = skusOf(product);
  const listings = await ensureListings(strapi, {
    documentId: product.documentId,
    name: product.name,
    skus,
    tiktokCategoryId: product.category?.tiktokCategoryId ?? null,
  });
  const active = listings.filter((row) => skus.includes(row.sku) && row.syncEnabled !== false);
  if (active.length === 0) throw new JobSkipped('Sync is disabled for every SKU of this product');

  if (!shopCurrency) {
    const message = `Unknown listing currency for shop region "${connection.shopRegion ?? ''}"`;
    await recordListingError(strapi, active, message);
    throw new PermanentJobError(message);
  }

  const alreadyListed = active.some((row) => row.tiktokProductId);
  if (alreadyListed) {
    // The listing exists: keep its price, stock and active state in step.
    // (Title, description and images of an existing listing are NOT re-pushed
    // automatically — Edit Product replaces the whole listing and re-enters
    // TikTok's review. That stays a deliberate, manual action.)
    await pushPrices(strapi, productDocumentId);
    for (const row of active) await pushInventory(strapi, row.sku);
    const productIds = [...new Set(active.map((row) => row.tiktokProductId).filter(Boolean))] as string[];
    if (productIds.length > 0) await client.setProductsActive(productIds, true);
    return;
  }

  const warehouseId = await defaultWarehouseId(client, connection.shopId ?? '');
  const stockBySku = await stockFor(strapi, skus);

  // Validate the mapping BEFORE uploading anything, with a placeholder image
  // list, so a product with no category does not burn image uploads.
  const images = [product.mainImage, ...(product.gallery ?? [])].filter(
    (image): image is { url: string; name?: string } => Boolean(image?.url),
  );
  const dryRun = toCreateProductPayload(product, {
    shopCurrency,
    warehouseId,
    imageUris: images.map((_, index) => `pending-${index}`),
    stockBySku,
    overridesBySku: overridesFrom(listings),
  });
  if (!dryRun.ok) {
    const message = dryRun.problems.join('; ');
    await recordListingError(strapi, active, message);
    throw new PermanentJobError(message);
  }

  const imageUris: string[] = [];
  for (const [index, image] of images.slice(0, 9).entries()) {
    const bytes = await loadImageBytes(strapi, image.url);
    imageUris.push(await client.uploadProductImage(bytes, image.name ?? `image-${index}.jpg`, index === 0 ? 'MAIN_IMAGE' : 'MAIN_IMAGE'));
  }

  const mapped = toCreateProductPayload(product, {
    shopCurrency,
    warehouseId,
    imageUris,
    stockBySku,
    overridesBySku: overridesFrom(listings),
  });
  if (!mapped.ok) throw new PermanentJobError(mapped.problems.join('; '));

  let created: Awaited<ReturnType<TikTokClient['createProduct']>>;
  try {
    created = await client.createProduct(mapped.payload);
  } catch (error) {
    await recordListingError(strapi, active, (error as Error).message);
    throw error;
  }

  const now = new Date().toISOString();
  for (const row of active) {
    const sku = mapped.payload.skus.find((entry) => entry.seller_sku === row.sku);
    const remote = created.skus.find((entry) => entry.sellerSku === row.sku);
    await updateListing(strapi, row.documentId, {
      tiktokProductId: created.productId,
      tiktokSkuId: remote?.id || null,
      // A new listing goes through TikTok's audit; the webhook moves it to live.
      listingStatus: 'pending',
      lastPushedPrice: sku ? Number(sku.price.amount) : null,
      lastPushedStock: sku?.inventory[0]?.quantity ?? null,
      lastSyncedAt: now,
      lastError: remote?.id ? null : 'TikTok did not return a SKU id for this seller SKU',
    });
  }
  await audit(strapi, {
    action: 'tiktok.product_listed',
    actor: 'system',
    subjectType: 'product',
    subjectId: productDocumentId,
    summary: `Created TikTok listing ${created.productId} for ${product.name}`,
  });
}

async function pushPrices(strapi: Core.Strapi, productDocumentId: string): Promise<void> {
  const product = await loadPublishedProduct(strapi, productDocumentId);
  if (!product) throw new JobSkipped('The product is not published');
  const { client, shopCurrency } = await session(strapi);
  if (!shopCurrency) throw new PermanentJobError('Unknown listing currency for the shop region');

  const listings = (await listingsForProduct(strapi, productDocumentId)).filter(
    (row) => row.tiktokProductId && row.tiktokSkuId && row.syncEnabled !== false,
  );
  if (listings.length === 0) throw new JobSkipped('No live TikTok listing for this product');

  const overrides = overridesFrom(listings);
  const byProduct = new Map<string, { row: ListingRecord; amount: number }[]>();
  for (const row of listings) {
    const variant = product.variants?.find((entry) => entry.sku === row.sku);
    const price = resolveListingPrice(product, variant, { shopCurrency, overridesBySku: overrides });
    if ('problem' in price) {
      await updateListing(strapi, row.documentId, { lastError: price.problem });
      continue;
    }
    const group = byProduct.get(row.tiktokProductId as string) ?? [];
    group.push({ row, amount: price.amount });
    byProduct.set(row.tiktokProductId as string, group);
  }
  if (byProduct.size === 0) throw new PermanentJobError('No SKU of this product has a listable price');

  for (const [tiktokProductId, group] of byProduct) {
    await client.updatePrice(
      tiktokProductId,
      toPriceUpdatePayload(group.map((entry) => ({ tiktokSkuId: entry.row.tiktokSkuId as string, amount: entry.amount })), shopCurrency),
    );
    for (const entry of group) {
      await updateListing(strapi, entry.row.documentId, {
        lastPushedPrice: entry.amount,
        lastSyncedAt: new Date().toISOString(),
        lastError: null,
      });
    }
  }
}

async function pushInventory(strapi: Core.Strapi, sku: string): Promise<void> {
  const row = await listingForSku(strapi, sku);
  if (!row || !row.tiktokProductId || !row.tiktokSkuId) throw new JobSkipped(`SKU ${sku} has no TikTok listing`);
  if (row.syncEnabled === false) throw new JobSkipped(`Sync is disabled for SKU ${sku}`);

  const { client, connection } = await session(strapi);
  const warehouseId = await defaultWarehouseId(client, connection.shopId ?? '');
  // Read at the moment of the push, not when the job was queued.
  const quantity = await availableToSell(strapi, sku);

  try {
    await client.updateInventory(
      row.tiktokProductId,
      toInventoryUpdatePayload([{ tiktokSkuId: row.tiktokSkuId, quantity }], warehouseId),
    );
  } catch (error) {
    await updateListing(strapi, row.documentId, { lastError: (error as Error).message.slice(0, 2000) });
    throw error;
  }
  await updateListing(strapi, row.documentId, {
    lastPushedStock: quantity,
    lastSyncedAt: new Date().toISOString(),
    lastError: null,
  });
}

async function deactivateProduct(strapi: Core.Strapi, productDocumentId: string): Promise<void> {
  const listings = (await listingsForProduct(strapi, productDocumentId)).filter((row) => row.tiktokProductId);
  if (listings.length === 0) throw new JobSkipped('No TikTok listing to deactivate');
  const { client } = await session(strapi);
  const productIds = [...new Set(listings.map((row) => row.tiktokProductId as string))];
  await client.setProductsActive(productIds, false);
  for (const row of listings) {
    await updateListing(strapi, row.documentId, {
      listingStatus: 'deactivated',
      lastSyncedAt: new Date().toISOString(),
      lastError: null,
    });
  }
  await audit(strapi, {
    action: 'tiktok.product_deactivated',
    actor: 'system',
    subjectType: 'product',
    subjectId: productDocumentId,
    summary: `Deactivated TikTok listing(s) ${productIds.join(', ')}`,
  });
}

const MAX_ORDER_PAGES = 10;

/**
 * Import orders. `subject` is one TikTok order id (from a webhook), or `poll`
 * for the periodic reconciliation TikTok itself recommends alongside webhooks.
 *
 * Import is idempotent in the commerce core on (channel, externalOrderId), so
 * a webhook and a poll delivering the same order produce one order.
 */
async function importOrders(strapi: Core.Strapi, subject: string): Promise<void> {
  const { client, connection } = await session(strapi);
  const startedAt = new Date();
  let raws: Record<string, unknown>[] = [];

  if (subject && subject !== 'poll') {
    raws = await client.getOrders([subject], process.env.TIKTOK_ORDER_DETAIL_API_VERSION?.trim() || '202309');
  } else {
    const lastSync = connection.lastSyncAt ? Date.parse(connection.lastSyncAt) : NaN;
    // Overlap the previous window by an hour; first run looks back a week.
    const since = Number.isFinite(lastSync) ? lastSync - 60 * 60_000 : Date.now() - 7 * 24 * 60 * 60_000;
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_ORDER_PAGES; page += 1) {
      const result = await client.searchOrders({ updateTimeGe: Math.floor(since / 1000) }, { pageToken });
      raws.push(...result.orders);
      pageToken = result.nextPageToken;
      if (!pageToken) break;
    }
  }

  const skipped: string[] = [];
  for (const raw of raws) {
    const mapped = mapTikTokOrder(raw);
    if (!mapped) continue;
    if ('skipped' in mapped) {
      skipped.push(mapped.skipped);
      continue;
    }
    const result = await importMarketplaceOrder(strapi, mapped.input);

    // An oversell: TikTok sold units the website no longer had. The commerce
    // core records the order event and the audit entry and does NOT take stock
    // negative; here the affected listings are flagged for a human to resolve.
    for (const sku of result.conflicts ?? []) {
      const row = await listingForSku(strapi, sku);
      if (row) {
        await updateListing(strapi, row.documentId, {
          lastError: `INVENTORY CONFLICT: TikTok order ${mapped.input.externalOrderId} (${result.reference}) sold more ${sku} than the website had available. Resolve the order, then check the marketplace buffer for this SKU.`,
        });
      }
    }
    // Stock moved; tell TikTok the new number for every SKU on the order.
    if (result.created) {
      for (const item of mapped.input.items) {
        await enqueueTikTokJob(strapi, { kind: 'inventory_update', subject: item.sku, requestedBy: 'system' });
      }
    }
  }

  if (!subject || subject === 'poll') {
    await updateConnection(strapi, {
      lastSyncAt: startedAt.toISOString(),
      lastError: skipped.length > 0 ? `Orders not imported: ${skipped.slice(0, 10).join('; ')}` : null,
    });
  } else if (skipped.length > 0) {
    throw new PermanentJobError(skipped.join('; '));
  }
}

async function pushFulfillment(strapi: Core.Strapi, orderReference: string): Promise<void> {
  const order = (await docs(strapi, 'api::order.order').findFirst({
    filters: { reference: { $eq: orderReference } },
  })) as
    | { channel?: string; externalOrderId?: string | null; trackingNumber?: string | null; shippingCarrier?: string | null; status?: string }
    | null;

  if (!order) throw new PermanentJobError(`Order ${orderReference} not found`);
  if (order.channel !== 'tiktok_shop' || !order.externalOrderId) {
    throw new JobSkipped('Not a TikTok Shop order');
  }
  if (!order.trackingNumber) throw new PermanentJobError('The order has no tracking number yet');

  const providerId = readShippingProviderMap()[order.shippingCarrier ?? ''];
  if (!providerId) {
    throw new PermanentJobError(
      `No TikTok shipping provider id is mapped for carrier "${order.shippingCarrier ?? 'none'}". Set TIKTOK_SHIPPING_PROVIDER_MAP, or enter the tracking number in TikTok Seller Center.`,
    );
  }

  const { client } = await session(strapi);
  await client.markOrderShipped(
    order.externalOrderId,
    { trackingNumber: order.trackingNumber, shippingProviderId: providerId },
    process.env.TIKTOK_FULFILLMENT_API_VERSION?.trim() || '202309',
  );
  await audit(strapi, {
    action: 'tiktok.fulfillment_pushed',
    actor: 'system',
    subjectType: 'order',
    subjectId: orderReference,
    summary: `Reported tracking ${order.trackingNumber} to TikTok order ${order.externalOrderId}`,
  });
}

/** Cron helper: queue the periodic order reconciliation and token upkeep. */
export async function scheduleTikTokMaintenance(strapi: Core.Strapi): Promise<void> {
  await enqueueTikTokJob(strapi, { kind: 'order_import', subject: 'poll', requestedBy: 'system' });
  const connection = await getConnection(strapi);
  const expiresAt = connection.accessTokenExpiresAt ? Date.parse(connection.accessTokenExpiresAt) : NaN;
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() < 2 * 24 * 60 * 60_000) {
    await enqueueTikTokJob(strapi, { kind: 'token_refresh', subject: 'connection', requestedBy: 'system' });
  }
}
