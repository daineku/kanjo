import type { Core } from '@strapi/strapi';

import { runAsSystem } from '../commerce/actor';
import { POLICY_DRAFTS } from './policies';

/**
 * The store's STRUCTURE: categories, vehicles, settings, shipping zones and
 * draft policy pages. Real reference data, no merchandise.
 *
 * Runs at every boot but writes only into EMPTY tables, so it seeds a fresh
 * database and never reverts an edit: rename a category in the admin and it
 * stays renamed. To re-seed, empty the table.
 *
 * What is deliberately NOT here: products, stock, prices, shipping RATES,
 * reviews, customers. Those are real-world facts that only the business can
 * supply. Sample products exist separately (./samples.ts) and only on request.
 */

export const CATEGORY_TREE: [string, string, string[]][] = [
  ['Exterior', 'exterior', ['Front Lips', 'Rear Lips', 'Side Skirts', 'Bumpers', 'Spoilers & Wings', 'Grilles', 'Lighting', 'Mirrors', 'Body Accessories']],
  ['Interior', 'interior', ['Steering Wheels', 'Shift Knobs', 'Seats & Accessories', 'Interior Trim', 'Gauge Pods', 'Dash Accessories', 'Custom Interior Components']],
  ['Performance', 'performance', ['Engine Components', 'Intake Systems', 'Exhaust Components', 'Cooling Systems', 'ECU & Electronics', 'Transmission Components']],
  ['Suspension & Brakes', 'suspension-brakes', ['Coilovers', 'Springs', 'Control Arms', 'Bushings', 'Brake Components']],
  ['Wheels & Accessories', 'wheels-accessories', ['Wheels', 'Wheel Hardware', 'Wheel Accessories']],
  ['Rare JDM Parts', 'rare-jdm-parts', ['Discontinued Parts', 'Used Original Parts', 'Limited Production Components', 'Hard-to-Find Components']],
  ['Custom 3D Printed', 'custom-3d-printed', ['Interior Components', 'Custom Mounts', 'Decorative Trim', 'Replacement Plastic Components', 'Made-to-Order Parts']],
  ['The Kanjo Merchandise', 'merchandise', ['Stickers', 'Apparel', 'Accessories']],
];

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The initial vehicle database: the five Honda chassis the store starts with.
 * Production years are the generation's overall span; a part that fits only
 * some years narrows them on its own fitment row. Markets vary (JDM, USDM,
 * EDM trims and engines differ), which is why `marketNotes` exists and why a
 * fitment carries its own engine/body/market qualifiers.
 */
export const VEHICLES = [
  { label: 'Honda Civic EF (1987–1991)', model: 'Civic', generation: '4th generation', chassisCode: 'EF', chassisCodes: 'EF, ED, EE', yearFrom: 1987, yearTo: 1991, bodyStyles: 'Hatchback, Sedan, Wagon, CRX', engines: 'D15B, D16A, ZC, B16A', marketNotes: 'Chassis code varies by market and body style (EF in Japan; ED/EE elsewhere).', sortOrder: 10 },
  { label: 'Honda Civic EG (1991–1995)', model: 'Civic', generation: '5th generation', chassisCode: 'EG', chassisCodes: 'EG, EH, EJ', yearFrom: 1991, yearTo: 1995, bodyStyles: 'Hatchback, Sedan, Coupe, Del Sol', engines: 'D15B, D16Z6, D16A, B16A', marketNotes: 'EG6 = JDM SiR hatchback (B16A). Coupe/sedan codes differ by market.', sortOrder: 20 },
  { label: 'Honda Civic EK (1995–2000)', model: 'Civic', generation: '6th generation', chassisCode: 'EK', chassisCodes: 'EK, EJ, EM', yearFrom: 1995, yearTo: 2000, bodyStyles: 'Hatchback, Sedan, Coupe', engines: 'D15B, D16Y8, B16A, B16B', marketNotes: 'EK9 = JDM Type R (B16B, 1997–2000). EM1 = USDM Si coupe.', sortOrder: 30 },
  { label: 'Honda Integra DC2 (1993–2001)', model: 'Integra', generation: '3rd generation', chassisCode: 'DC2', chassisCodes: 'DC2, DB8', yearFrom: 1993, yearTo: 2001, bodyStyles: 'Coupe, Sedan', engines: 'B18B, B18C', marketNotes: 'Sold as Acura Integra in North America. DC2 Type R: B18C (JDM 96 spec / USDM spec differ).', sortOrder: 40 },
  { label: 'Honda Civic EP3 (2001–2005)', model: 'Civic', generation: '7th generation', chassisCode: 'EP3', chassisCodes: 'EP3', yearFrom: 2001, yearTo: 2005, bodyStyles: 'Hatchback', engines: 'K20A, K20A2, K20A3', marketNotes: 'UK-built Type R (JDM/EDM K20A) and USDM Si (K20A3).', sortOrder: 50 },
];

const DEFAULT_CUSTOMS =
  'International orders are shipped DAP (Delivered At Place) unless the shipping option says DDP. ' +
  'With DAP, import duties, taxes and customs brokerage fees in your country are NOT included in the price and are payable by you on delivery. ' +
  'Rules for low-value imports have changed recently in the United States, the European Union, the United Kingdom and Canada; check your country\'s current rules before ordering.';

const ZONES = [
  { name: 'Thailand (domestic)', code: 'th', countries: 'TH' },
  { name: 'United States', code: 'us', countries: 'US' },
  { name: 'Canada', code: 'ca', countries: 'CA' },
  { name: 'United Kingdom', code: 'uk', countries: 'GB' },
  { name: 'Ireland', code: 'ie', countries: 'IE' },
  {
    name: 'European Union',
    code: 'eu',
    countries: 'AT, BE, BG, HR, CY, CZ, DK, EE, FI, FR, DE, GR, HU, IT, LV, LT, LU, MT, NL, PL, PT, RO, SK, SI, ES, SE',
  },
];

async function isEmpty(strapi: Core.Strapi, uid: string) {
  return (await strapi.documents(uid as any).count({} as any)) === 0;
}

export async function seedStructure(strapi: Core.Strapi): Promise<string[]> {
  const done: string[] = [];
  await runAsSystem('seed', async () => {
    if (await isEmpty(strapi, 'api::category.category')) {
      for (const [i, [name, slug, children]] of CATEGORY_TREE.entries()) {
        const parent: any = await strapi.documents('api::category.category').create({ data: { name, slug, sortOrder: i * 10 } as any });
        for (const [j, child] of children.entries()) {
          await strapi.documents('api::category.category').create({
            data: { name: child, slug: `${slug}-${slugify(child)}`, sortOrder: j * 10, parent: { connect: [parent.documentId] } } as any,
          });
        }
      }
      done.push('categories');
    }

    if (await isEmpty(strapi, 'api::vehicle-make.vehicle-make')) {
      const honda: any = await strapi.documents('api::vehicle-make.vehicle-make').create({ data: { name: 'Honda', slug: 'honda' } as any });
      for (const vehicle of VEHICLES) {
        await strapi.documents('api::vehicle.vehicle').create({
          data: { ...vehicle, slug: slugify(`honda-${vehicle.model}-${vehicle.chassisCode}`), make: { connect: [honda.documentId] } } as any,
        });
      }
      done.push('vehicles');
    }

    const settings = await strapi.documents('api::store-setting.store-setting' as any).findFirst({} as any);
    if (!settings) {
      await strapi.documents('api::store-setting.store-setting' as any).create({
        data: {
          storeCurrency: 'USD',
          checkoutEnabled: false,
          checkoutDisabledMessage: 'Online checkout opens soon. Add parts to your cart to save them, or send us a sourcing request.',
          handlingDaysInStock: 3,
          handlingDaysSourced: 14,
          handlingDaysMadeToOrder: 10,
          reservationMinutes: 45,
          sourcingVerificationDays: 30,
          customsDisclosure: DEFAULT_CUSTOMS,
          reviewsEnabled: true,
        } as any,
      });
      done.push('store settings');
    }

    if (await isEmpty(strapi, 'api::shipping-zone.shipping-zone')) {
      // Zones only, all DISABLED, with NO rates. A carrier rate is a number
      // somebody has to look up and verify; inventing one would quote a
      // customer a price nobody agreed to.
      for (const zone of ZONES) {
        await strapi.documents('api::shipping-zone.shipping-zone').create({ data: { ...zone, enabled: false } as any });
      }
      done.push('shipping zones (disabled, no rates)');
    }

    if (await isEmpty(strapi, 'api::store-page.store-page')) {
      for (const page of POLICY_DRAFTS) {
        const created: any = await strapi.documents('api::store-page.store-page').create({
          data: { ...page, legalReviewed: false } as any,
        });
        // Published so the links work, but legalReviewed=false keeps each page
        // under a DRAFT banner and out of the index until the merchant signs off.
        await strapi.documents('api::store-page.store-page').publish({ documentId: created.documentId } as any);
      }
      done.push('policy page drafts');
    }
  });
  return done;
}
