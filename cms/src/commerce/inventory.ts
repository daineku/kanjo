import type { Core } from '@strapi/strapi';

import { actorName, runAsSystem } from './actor';
import { requestRevalidation } from './revalidate';

/**
 * Inventory: the one authoritative stock record.
 *
 * ── WHY STOCK IS NOT A FIELD ON THE PRODUCT ─────────────────────────────────
 *
 * A product uses Draft & Publish, so it exists as TWO rows (draft, published)
 * and publishing re-creates the published row from the draft. A stock counter
 * living there would be overwritten by every publish. `inventory-item` has no
 * Draft & Publish: one row per sellable SKU, owned by fulfilment, untouched by
 * editorial work.
 *
 * ── WHY THE COUNTERS MOVE IN RAW SQL ────────────────────────────────────────
 *
 * Two checkouts for the last unit must not both succeed. Reading the count and
 * then writing it back is a race no matter how it is wrapped; a single
 * conditional UPDATE is not:
 *
 *     UPDATE inventory_items SET reserved = reserved + :q
 *      WHERE sku = :sku AND on_hand - reserved >= :q
 *
 * Either the row matched and the units are held, or it did not and nothing
 * changed. The affected-row count is the answer. Every function below is that
 * one statement with a different WHERE and SET.
 *
 * ── THE LIFECYCLE OF A UNIT ─────────────────────────────────────────────────
 *
 *   reserve   checkout started        reserved += q     (on_hand unchanged)
 *   commit    payment confirmed       on_hand -= q, reserved -= q
 *   release   payment failed/expired  reserved -= q
 *   restock / adjust / return         on_hand changes, with a ledger entry
 *
 * `availableToSell` is on_hand − reserved − marketplaceBuffer. It is what the
 * website shows and what is pushed to marketplaces; the website's own checkout
 * may also use the buffer (see `reserve`), which is the point of having one.
 */

const TABLE = 'inventory_items';
const UID = 'api::inventory-item.inventory-item';
const MOVEMENT_UID = 'api::inventory-movement.inventory-movement';

type Trx = any;

export type StockRow = {
  sku: string;
  onHand: number;
  reserved: number;
  lowStockThreshold: number;
  marketplaceBuffer: number;
};

function table(strapi: Core.Strapi, trx?: Trx) {
  // getConnection applies the configured Postgres schema, if any.
  const query = (strapi.db as any).getConnection(TABLE);
  return trx ? query.transacting(trx) : query;
}

function toRow(raw: any): StockRow {
  return {
    sku: raw.sku,
    onHand: Number(raw.on_hand ?? 0),
    reserved: Number(raw.reserved ?? 0),
    lowStockThreshold: Number(raw.low_stock_threshold ?? 0),
    marketplaceBuffer: Number(raw.marketplace_buffer ?? 0),
  };
}

export async function getStock(strapi: Core.Strapi, skus: string[], trx?: Trx): Promise<Map<string, StockRow>> {
  const out = new Map<string, StockRow>();
  if (skus.length === 0) return out;
  const rows = await table(strapi, trx).whereIn('sku', skus).select('*');
  for (const raw of rows) out.set(raw.sku, toRow(raw));
  return out;
}

export async function getAllStock(strapi: Core.Strapi): Promise<Map<string, StockRow>> {
  const out = new Map<string, StockRow>();
  const rows = await table(strapi).select('*');
  for (const raw of rows) out.set(raw.sku, toRow(raw));
  return out;
}

/** Units the website can sell right now: on hand, minus units held by open checkouts. */
export function sellable(row: StockRow | undefined): number {
  if (!row) return 0;
  return Math.max(0, row.onHand - row.reserved);
}

/** Units a MARKETPLACE may be told about: also minus the safety buffer. */
export async function availableToSell(strapi: Core.Strapi, sku: string): Promise<number> {
  const row = (await getStock(strapi, [sku])).get(sku);
  if (!row) return 0;
  return Math.max(0, row.onHand - row.reserved - row.marketplaceBuffer);
}

export type MovementKind = 'reserve' | 'release' | 'sale' | 'restock' | 'adjustment' | 'return' | 'marketplace_sale';

type MovementContext = {
  orderReference?: string;
  channel?: 'web' | 'tiktok_shop' | 'manual' | 'system';
  note?: string;
};

async function recordMovement(
  strapi: Core.Strapi,
  sku: string,
  kind: MovementKind,
  quantity: number,
  context: MovementContext,
  trx?: Trx,
) {
  const after = (await getStock(strapi, [sku], trx)).get(sku);
  const actor = actorName(strapi);
  // Every stock change passes through here, and the raw-SQL counters emit no
  // Strapi webhook, so this is where the website is told its cached
  // availability is stale (coalesced; see ./revalidate.ts).
  requestRevalidation(strapi, ['store-catalog']);
  // Inside strapi.db.transaction the Document Service joins the transaction
  // implicitly, so the ledger entry commits or rolls back with the counters.
  await runAsSystem('inventory', () =>
    strapi.documents(MOVEMENT_UID as any).create({
      data: {
        sku,
        kind,
        quantity,
        onHandAfter: after?.onHand,
        reservedAfter: after?.reserved,
        channel: context.channel ?? 'system',
        orderReference: context.orderReference,
        actor,
        note: context.note,
      } as any,
    }),
  );
}

const now = () => new Date();

/** Holds `quantity` units for a checkout. False = not enough stock; nothing changed. */
export async function reserve(
  strapi: Core.Strapi,
  trx: Trx,
  sku: string,
  quantity: number,
  context: MovementContext,
): Promise<boolean> {
  const knex = strapi.db.connection;
  const affected = await table(strapi, trx)
    .where('sku', sku)
    .whereRaw('on_hand - reserved >= ?', [quantity])
    .update({ reserved: knex.raw('reserved + ?', [quantity]), updated_at: now() });
  if (Number(affected) !== 1) return false;
  await recordMovement(strapi, sku, 'reserve', quantity, context, trx);
  return true;
}

/** Returns held units to sale. False = the hold was not there (already released or committed). */
export async function release(
  strapi: Core.Strapi,
  trx: Trx,
  sku: string,
  quantity: number,
  context: MovementContext,
): Promise<boolean> {
  const knex = strapi.db.connection;
  const affected = await table(strapi, trx)
    .where('sku', sku)
    .where('reserved', '>=', quantity)
    .update({ reserved: knex.raw('reserved - ?', [quantity]), updated_at: now() });
  if (Number(affected) !== 1) return false;
  await recordMovement(strapi, sku, 'release', quantity, context, trx);
  return true;
}

/** Turns a hold into a sale: the units leave the building. */
export async function commitReserved(
  strapi: Core.Strapi,
  trx: Trx,
  sku: string,
  quantity: number,
  context: MovementContext,
): Promise<boolean> {
  const knex = strapi.db.connection;
  const affected = await table(strapi, trx)
    .where('sku', sku)
    .where('reserved', '>=', quantity)
    .where('on_hand', '>=', quantity)
    .update({
      on_hand: knex.raw('on_hand - ?', [quantity]),
      reserved: knex.raw('reserved - ?', [quantity]),
      updated_at: now(),
    });
  if (Number(affected) !== 1) return false;
  await recordMovement(strapi, sku, 'sale', quantity, context, trx);
  return true;
}

/**
 * Sells units that were never reserved here — a marketplace order, or a
 * payment that arrived after its reservation had been released.
 *
 * Tries, in order:
 *   1. unreserved stock                       → 'ok'
 *   2. stock held by an open website checkout → 'took_reserved' (a conflict:
 *      that checkout may now fail at payment and must be handled by a person)
 *   3. nothing left                           → 'oversold'; on_hand goes to 0,
 *      never negative, and the caller records the shortfall.
 */
export async function sellUnreserved(
  strapi: Core.Strapi,
  trx: Trx,
  sku: string,
  quantity: number,
  kind: 'sale' | 'marketplace_sale',
  context: MovementContext,
): Promise<'ok' | 'took_reserved' | 'oversold' | 'unknown_sku'> {
  const knex = strapi.db.connection;

  const clean = await table(strapi, trx)
    .where('sku', sku)
    .whereRaw('on_hand - reserved >= ?', [quantity])
    .update({ on_hand: knex.raw('on_hand - ?', [quantity]), updated_at: now() });
  if (Number(clean) === 1) {
    await recordMovement(strapi, sku, kind, quantity, context, trx);
    return 'ok';
  }

  const tight = await table(strapi, trx)
    .where('sku', sku)
    .where('on_hand', '>=', quantity)
    .update({ on_hand: knex.raw('on_hand - ?', [quantity]), updated_at: now() });
  if (Number(tight) === 1) {
    await recordMovement(strapi, sku, kind, quantity, { ...context, note: 'CONFLICT: took units reserved by an open website checkout' }, trx);
    return 'took_reserved';
  }

  const exists = await table(strapi, trx).where('sku', sku).update({ on_hand: 0, updated_at: now() });
  if (Number(exists) !== 1) return 'unknown_sku';
  await recordMovement(strapi, sku, kind, quantity, { ...context, note: 'OVERSOLD: fewer units on hand than were sold' }, trx);
  return 'oversold';
}

/** Adds units back: a restock, a customer return, or a refund with "restock". */
export async function addStock(
  strapi: Core.Strapi,
  trx: Trx | undefined,
  sku: string,
  quantity: number,
  kind: 'restock' | 'return',
  context: MovementContext,
): Promise<boolean> {
  const knex = strapi.db.connection;
  const affected = await table(strapi, trx)
    .where('sku', sku)
    .update({ on_hand: knex.raw('on_hand + ?', [quantity]), updated_at: now() });
  if (Number(affected) !== 1) return false;
  await recordMovement(strapi, sku, kind, quantity, context, trx);
  return true;
}

/** Ledger entry for an admin editing `onHand` directly in the Content Manager. */
export async function recordAdjustment(strapi: Core.Strapi, sku: string, delta: number, note?: string) {
  await recordMovement(strapi, sku, 'adjustment', delta, { channel: 'manual', note });
}

/**
 * Makes sure every sellable SKU of a product has an inventory record.
 *
 * A new record starts at ZERO on hand. Stock is something a person counts and
 * enters; publishing a product never conjures units.
 */
export async function ensureInventoryItems(
  strapi: Core.Strapi,
  product: { documentId: string; name: string },
  skus: { sku: string; label?: string }[],
): Promise<void> {
  const existing = await getStock(strapi, skus.map((entry) => entry.sku));
  for (const { sku, label } of skus) {
    const productName = label ? `${product.name} — ${label}` : product.name;
    if (existing.has(sku)) {
      await (strapi.db as any).getConnection(TABLE).where('sku', sku).update({
        product_name: productName,
        product_document_id: product.documentId,
      });
      continue;
    }
    await strapi.documents(UID as any).create({
      data: { sku, productName, productDocumentId: product.documentId, onHand: 0, reserved: 0 } as any,
    });
  }
}
