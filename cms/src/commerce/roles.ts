import type { Core } from '@strapi/strapi';

/**
 * The two operating roles, created in the admin at boot if they do not exist.
 *
 *   OWNER / PLATFORM ADMINISTRATOR — use Strapi's built-in Super Admin. It is
 *   the only role that can manage users, roles, API tokens and settings, which
 *   is exactly what the owner needs and nobody else should have.
 *
 *   FULFILLMENT PARTNER — this file. Least privilege:
 *     orders           read + update, and only the fulfilment fields (status,
 *                      carrier, tracking, shipped/delivered dates, actual
 *                      shipping cost, internal notes). Not the email; not
 *                      payment identifiers. The guard (./guards.ts) further
 *                      restricts which status moves are possible.
 *     order events     read
 *     inventory        read + update of on-hand / thresholds / location / notes
 *     movements        read
 *     products         read, and update of the fulfilment fields only
 *                      (weight, dimensions, HS code, handling days, shipping
 *                      class). No price, no cost, no supplier, no publish.
 *     shipping         read zones and rates
 *     sourcing/builds  read + update status and notes (they quote the work)
 *   Nothing else: no reviews, no suppliers, no imports, no analytics, no
 *   TikTok, no settings, no refunds (money is the owner's decision).
 *
 * Field lists are re-applied on every boot, so a role edited by hand in the
 * admin is put back to this definition. That is deliberate: the definition
 * lives in code review, not in a settings screen. To change it, change this
 * file.
 */

const CM = 'plugin::content-manager.explorer';

type Permission = { action: string; subject: string; properties?: { fields?: string[] }; conditions?: string[] };

const read = (subject: string, fields?: string[]): Permission => ({ action: `${CM}.read`, subject, ...(fields ? { properties: { fields } } : {}) });
const update = (subject: string, fields: string[]): Permission => ({ action: `${CM}.update`, subject, properties: { fields } });

const ORDER_READ = [
  'reference', 'status', 'channel', 'customerName', 'shippingAddress', 'items', 'currency', 'total',
  'shippingCarrier', 'shippingService', 'incoterm', 'shippingZoneCode', 'trackingNumber', 'trackingUrl',
  'shippedAt', 'deliveredAt', 'shippingCostActual', 'totalWeightGrams', 'customerNote', 'internalNotes',
  'placedAt', 'paidAt', 'paymentStatus', 'isTest', 'events',
];
const ORDER_UPDATE = ['status', 'shippingCarrier', 'trackingNumber', 'trackingUrl', 'shippedAt', 'deliveredAt', 'shippingCostActual', 'internalNotes'];

const PRODUCT_READ = [
  'name', 'slug', 'sku', 'brand', 'category', 'productType', 'condition', 'availability', 'madeToOrder',
  'variants', 'weightGrams', 'lengthMm', 'widthMm', 'heightMm', 'shippingClass', 'hsCode', 'handlingDays',
  'internationalShipping', 'restrictedCountries', 'countryOfOrigin', 'mainImage',
];
const PRODUCT_UPDATE = ['weightGrams', 'lengthMm', 'widthMm', 'heightMm', 'shippingClass', 'hsCode', 'handlingDays'];

export const FULFILLMENT_PERMISSIONS: Permission[] = [
  read('api::order.order', ORDER_READ),
  update('api::order.order', ORDER_UPDATE),
  read('api::order-event.order-event'),
  read('api::inventory-item.inventory-item'),
  update('api::inventory-item.inventory-item', ['onHand', 'lowStockThreshold', 'location', 'stockVerifiedAt', 'notes']),
  read('api::inventory-movement.inventory-movement'),
  read('api::product.product', PRODUCT_READ),
  update('api::product.product', PRODUCT_UPDATE),
  read('api::shipping-zone.shipping-zone'),
  read('api::shipping-rate.shipping-rate'),
  read('api::sourcing-request.sourcing-request'),
  update('api::sourcing-request.sourcing-request', ['status', 'internalNotes']),
  read('api::build-inquiry.build-inquiry'),
  update('api::build-inquiry.build-inquiry', ['status', 'internalNotes']),
];

export const FULFILLMENT_ROLE = {
  code: 'kanjo-fulfillment-partner',
  name: 'Fulfillment Partner',
  description: 'Thai operating partner: orders, packing, shipping, tracking and stock. Managed in code (cms/src/commerce/roles.ts).',
};

export async function ensureRoles(strapi: Core.Strapi) {
  try {
    const roles = strapi.service('admin::role') as any;
    let role = await roles.findOne({ code: FULFILLMENT_ROLE.code });
    if (!role) role = await roles.create(FULFILLMENT_ROLE);
    await roles.assignPermissions(
      role.id,
      FULFILLMENT_PERMISSIONS.map((permission) => ({
        action: permission.action,
        subject: permission.subject,
        properties: permission.properties ?? {},
        conditions: permission.conditions ?? [],
      })),
    );
  } catch (error) {
    // A role failure must not stop the CMS booting; it is logged loudly and
    // the role stays as it was.
    strapi.log.error(`[roles] could not apply the Fulfillment Partner role: ${(error as Error).message}`);
  }
}
