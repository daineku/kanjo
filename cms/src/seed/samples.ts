import type { Core } from '@strapi/strapi';

import { runAsSystem } from '../commerce/actor';
import { slugify } from './structure';

/**
 * DEVELOPMENT SAMPLE CATALOGUE. NOT MERCHANDISE.
 *
 * Every product here is invented to exercise the storefront: the names start
 * with "SAMPLE", the SKUs with "SAMPLE-", the brand is the fictional "Sample
 * Workshop", `isSample` is true, and the descriptions say so. The storefront
 * only ever receives them when the CMS runs with KANJO_ALLOW_SAMPLE_CATALOG=
 * true, and even then marks them "SAMPLE — NOT FOR SALE", keeps them out of the
 * index and emits no Product structured data. Checkout refuses them.
 *
 * Loaded only by `npm run seed:samples`, never at boot. Removed by
 * `npm run seed:samples -- --remove`.
 */

const BRAND = { name: 'Sample Workshop', slug: 'sample-workshop' };

type Sample = {
  name: string;
  sku: string;
  category: string;
  productType: 'part' | 'accessory' | 'custom_3d_print' | 'merchandise';
  authenticity: string;
  condition: string;
  availability: string;
  price?: number;
  discountPrice?: number;
  weightGrams: number;
  hsCode: string;
  featured?: boolean;
  universalFit?: boolean;
  stock?: number;
  fitments?: { chassis: string; status: 'confirmed' | 'conditional' | 'unverified'; yearFrom?: number; yearTo?: number; notes?: string }[];
  variants?: { sku: string; label: string; color?: string; price?: number; stock?: number }[];
};

const SAMPLES: Sample[] = [
  { name: 'SAMPLE Front Lip — EG Hatch', sku: 'SAMPLE-EXT-001', category: 'exterior-front-lips', productType: 'part', authenticity: 'replica_reproduction', condition: 'new', availability: 'in_stock', price: 189, weightGrams: 3200, hsCode: '8708.29', featured: true, stock: 4, fitments: [{ chassis: 'EG', status: 'confirmed', yearFrom: 1992, yearTo: 1995, notes: 'Hatchback bumper only.' }] },
  { name: 'SAMPLE Side Skirts — EK Coupe', sku: 'SAMPLE-EXT-002', category: 'exterior-side-skirts', productType: 'part', authenticity: 'third_party_replacement', condition: 'new', availability: 'made_to_order', price: 260, weightGrams: 6000, hsCode: '8708.29', fitments: [{ chassis: 'EK', status: 'conditional', notes: 'Coupe; hatchback needs trimming.' }] },
  { name: 'SAMPLE Shift Knob — Titanium', sku: 'SAMPLE-INT-001', category: 'interior-shift-knobs', productType: 'accessory', authenticity: 'genuine_aftermarket', condition: 'new', availability: 'in_stock', price: 49, discountPrice: 39, weightGrams: 250, hsCode: '8708.99', featured: true, universalFit: true, stock: 12, variants: [{ sku: 'SAMPLE-INT-001-M10', label: 'M10×1.5', stock: 6 }, { sku: 'SAMPLE-INT-001-M12', label: 'M12×1.25', stock: 0 }] },
  { name: 'SAMPLE Gauge Pod — A-Pillar (3D printed)', sku: 'SAMPLE-3DP-001', category: 'custom-3d-printed-interior-components', productType: 'custom_3d_print', authenticity: 'custom_made', condition: 'new', availability: 'made_to_order', price: 65, weightGrams: 300, hsCode: '3926.90', featured: true, fitments: [{ chassis: 'EG', status: 'confirmed' }, { chassis: 'EK', status: 'unverified' }], variants: [{ sku: 'SAMPLE-3DP-001-BLK', label: 'Matte black', color: 'Black' }, { sku: 'SAMPLE-3DP-001-RED', label: 'Kanjo red', color: 'Red', price: 72 }] },
  { name: 'SAMPLE Used Tail Light — DC2', sku: 'SAMPLE-RARE-001', category: 'rare-jdm-parts-used-original-parts', productType: 'part', authenticity: 'genuine_oem', condition: 'used_good', availability: 'in_stock', price: 340, weightGrams: 2100, hsCode: '8512.20', stock: 1, fitments: [{ chassis: 'DC2', status: 'confirmed', yearFrom: 1998, yearTo: 2001, notes: 'Facelift lamp; left side.' }] },
  { name: 'SAMPLE Discontinued Intake Duct — EP3', sku: 'SAMPLE-RARE-002', category: 'rare-jdm-parts-discontinued-parts', productType: 'part', authenticity: 'genuine_oem', condition: 'new_old_stock', availability: 'source_on_demand', price: 120, weightGrams: 800, hsCode: '8708.99', fitments: [{ chassis: 'EP3', status: 'conditional', notes: 'Fits EDM/JDM K20A; not USDM Si.' }] },
  { name: 'SAMPLE Coilover Kit — EF/EG', sku: 'SAMPLE-SUS-001', category: 'suspension-brakes-coilovers', productType: 'part', authenticity: 'genuine_aftermarket', condition: 'new', availability: 'out_of_stock', price: 890, weightGrams: 18000, hsCode: '8708.80', fitments: [{ chassis: 'EF', status: 'unverified' }, { chassis: 'EG', status: 'confirmed' }] },
  { name: 'SAMPLE Kanjo Loop Sticker Pack', sku: 'SAMPLE-MER-001', category: 'merchandise-stickers', productType: 'merchandise', authenticity: 'custom_made', condition: 'new', availability: 'in_stock', price: 9, weightGrams: 40, hsCode: '4911.99', universalFit: true, stock: 50 },
];

const DESCRIPTION =
  'This is a DEVELOPMENT SAMPLE created to test The Kanjo Parts storefront. It is not a real product, it is not for sale, and its price, stock, fitment and photos are invented for testing. ' +
  'Sample products are only served when the CMS is started with KANJO_ALLOW_SAMPLE_CATALOG=true and are never indexed.';

export async function seedSamples(strapi: Core.Strapi): Promise<number> {
  return runAsSystem('seed-samples', async () => {
    let brand: any = await strapi.documents('api::brand.brand').findFirst({ filters: { slug: BRAND.slug } } as any);
    if (!brand) brand = await strapi.documents('api::brand.brand').create({ data: BRAND as any });

    const vehicles: any[] = await strapi.documents('api::vehicle.vehicle').findMany({ limit: 100 } as any);
    const categories: any[] = await strapi.documents('api::category.category').findMany({ limit: 500 } as any);
    let created = 0;

    for (const sample of SAMPLES) {
      const exists = await strapi.documents('api::product.product').count({ filters: { sku: sample.sku } } as any);
      if (exists > 0) continue;
      const category = categories.find((c) => c.slug === sample.category);
      const product: any = await strapi.documents('api::product.product').create({
        data: {
          name: sample.name,
          slug: slugify(sample.name),
          sku: sample.sku,
          brand: { connect: [brand.documentId] },
          category: category ? { connect: [category.documentId] } : undefined,
          productType: sample.productType,
          authenticity: sample.authenticity,
          condition: sample.condition,
          shortDescription: `Development sample — not for sale. ${sample.name.replace('SAMPLE ', '')}.`,
          description: DESCRIPTION,
          price: sample.price,
          discountPrice: sample.discountPrice,
          currency: 'USD',
          availability: sample.availability,
          weightGrams: sample.weightGrams,
          hsCode: sample.hsCode,
          internationalShipping: true,
          featured: sample.featured === true,
          universalFit: sample.universalFit === true,
          imageRights: 'not_cleared',
          reviewStatus: 'approved',
          isSample: true,
          provenance: 'Invented development sample. Not a real product.',
          ...(sample.availability === 'source_on_demand' ? { lastVerifiedAt: new Date().toISOString(), supplierAvailability: 'available' } : {}),
          variants: (sample.variants ?? []).map((variant) => ({ sku: variant.sku, label: variant.label, color: variant.color, price: variant.price })),
          fitments: (sample.fitments ?? []).map((fitment) => {
            const vehicle = vehicles.find((v) => v.chassisCode === fitment.chassis);
            return { vehicle: vehicle ? { connect: [vehicle.documentId] } : undefined, status: fitment.status, yearFrom: fitment.yearFrom, yearTo: fitment.yearTo, notes: fitment.notes };
          }),
          seo: { noIndex: true },
        } as any,
      });

      if (sample.availability === 'source_on_demand') {
        // A sourced product needs its supplier; attach a clearly fictional one.
        let supplier: any = await strapi.documents('api::supplier.supplier').findFirst({ filters: { code: 'sample-supplier' } } as any);
        if (!supplier) {
          supplier = await strapi.documents('api::supplier.supplier').create({
            data: { name: 'SAMPLE Supplier (fictional)', code: 'sample-supplier', platform: 'other', country: 'TH', notes: 'Development sample. Not a real supplier.' } as any,
          });
        }
        await strapi.documents('api::product.product').update({ documentId: product.documentId, data: { supplier: { connect: [supplier.documentId] } } as any });
      }

      await strapi.documents('api::product.product').publish({ documentId: product.documentId } as any);

      // Stock for the in-stock samples, through the same table the store uses.
      const stockRows = sample.variants?.length
        ? sample.variants.map((variant) => ({ sku: variant.sku, onHand: variant.stock ?? 0 }))
        : [{ sku: sample.sku, onHand: sample.stock ?? 0 }];
      for (const row of stockRows) {
        await (strapi.db as any).getConnection('inventory_items').where('sku', row.sku).update({ on_hand: row.onHand, notes: 'SAMPLE stock' });
      }
      created += 1;
    }
    return created;
  });
}

export async function removeSamples(strapi: Core.Strapi): Promise<number> {
  return runAsSystem('seed-samples', async () => {
    const products: any[] = await strapi.documents('api::product.product').findMany({ filters: { isSample: true }, populate: { variants: true }, limit: 500 } as any);
    for (const product of products) {
      const skus = [product.sku, ...(product.variants ?? []).map((variant: any) => variant.sku)];
      await strapi.documents('api::product.product').delete({ documentId: product.documentId } as any);
      await (strapi.db as any).getConnection('inventory_items').whereIn('sku', skus).delete();
    }
    return products.length;
  });
}
