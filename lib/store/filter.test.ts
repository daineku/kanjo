/**
 * Tests for the store's deployment switch and its catalogue query.
 *
 * Run with `npm run test:store`. Two things here are claims the site makes to a
 * customer and are therefore tested from the negative side first: that a part
 * FITS a car (only ever through an explicit fitment record), and that the store
 * does not exist on a deployment that was not given a backend.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { revalidationTags, storeConfigFromEnv, storeMediaPatternFromEnv } from './config.ts'
import {
  PAGE_SIZE,
  catalogQueryParams,
  categoryTrail,
  categoryWithDescendants,
  hasActiveFilters,
  matchFitment,
  parseCatalogQuery,
  relatedProducts,
  runCatalogQuery,
  vehicleTree,
  vehicleYears,
} from './filter.ts'
import { formatMoney, parseMajorToMinor } from './money.ts'
import type { Catalog, ProductSummary, StoreVehicle } from './types.ts'

// ── fixtures ────────────────────────────────────────────────────────────────

const EG: StoreVehicle = {
  id: 'v-eg',
  slug: 'honda-civic-eg',
  label: 'Honda Civic EG (1991-1995)',
  make: 'Honda',
  makeSlug: 'honda',
  model: 'Civic',
  chassisCode: 'EG',
  yearFrom: 1991,
  yearTo: 1995,
  bodyStyles: [],
  engines: [],
}
const EK: StoreVehicle = { ...EG, id: 'v-ek', slug: 'honda-civic-ek', chassisCode: 'EK', yearFrom: 1995, yearTo: 2000 }
const DC2: StoreVehicle = { ...EG, id: 'v-dc2', slug: 'honda-integra-dc2', model: 'Integra', chassisCode: 'DC2', yearFrom: 1993, yearTo: 2001 }

function product(overrides: Partial<ProductSummary> & { slug: string }): ProductSummary {
  return {
    id: overrides.slug,
    sku: overrides.slug.toUpperCase(),
    name: overrides.slug,
    productType: 'part',
    authenticity: 'genuine_aftermarket',
    condition: 'new',
    priceVaries: false,
    availability: 'in_stock',
    purchasable: true,
    featured: false,
    madeToOrder: false,
    universalFit: false,
    fitments: [],
    tags: [],
    publishedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    popularity: 0,
    isSample: false,
    ...overrides,
  }
}

const fit = (vehicle: StoreVehicle, status: 'confirmed' | 'conditional' | 'unverified', yearFrom = vehicle.yearFrom, yearTo = vehicle.yearTo) => ({
  vehicleId: vehicle.id,
  vehicleSlug: vehicle.slug,
  chassisCode: vehicle.chassisCode,
  status,
  yearFrom,
  yearTo,
})

const catalog: Catalog = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  settings: {
    currency: 'USD',
    checkoutEnabled: false,
    paymentTestMode: false,
    reviewsEnabled: true,
    shippingCountries: [],
    handlingDays: { inStock: 3, sourced: 14, madeToOrder: 10 },
    sampleCatalog: false,
  },
  categories: [
    { id: 'c1', slug: 'exterior', name: 'Exterior', sortOrder: 0, productCount: 2 },
    { id: 'c2', slug: 'front-lips', name: 'Front Lips', parentSlug: 'exterior', sortOrder: 0, productCount: 2 },
    { id: 'c3', slug: 'interior', name: 'Interior', sortOrder: 1, productCount: 2 },
  ],
  brands: [],
  vehicles: [EK, DC2, EG],
  products: [
    product({
      slug: 'eg-lip',
      name: 'Front Lip',
      brand: 'Spoon',
      brandSlug: 'spoon',
      categorySlug: 'front-lips',
      price: { amount: 25000, currency: 'USD' },
      fitments: [fit(EG, 'confirmed', 1992, 1995), fit(EG, 'unverified', 1991, 1991)],
      publishedAt: '2026-03-01T00:00:00.000Z',
      popularity: 5,
    }),
    product({
      slug: 'civic-eg-titled-only',
      // The trap: a title that names the chassis, with no fitment record.
      name: 'Civic EG Style Lip',
      categorySlug: 'front-lips',
      price: { amount: 9000, currency: 'USD' },
      authenticity: 'replica_reproduction',
      publishedAt: '2026-02-01T00:00:00.000Z',
    }),
    product({
      slug: 'shift-knob',
      name: 'Titanium Shift Knob',
      brand: 'Mugen',
      brandSlug: 'mugen',
      categorySlug: 'interior',
      universalFit: true,
      price: { amount: 12000, currency: 'USD' },
      tags: ['jdm', 'interior'],
      publishedAt: '2026-04-01T00:00:00.000Z',
      popularity: 9,
    }),
    product({
      slug: 'rare-cluster',
      name: 'Gauge Cluster',
      categorySlug: 'interior',
      condition: 'used_good',
      availability: 'on_request',
      purchasable: false,
      fitments: [fit(EK, 'conditional')],
      publishedAt: '2026-01-15T00:00:00.000Z',
    }),
  ],
}

const slugs = (query: Parameters<typeof parseCatalogQuery>[0], category?: string) =>
  runCatalogQuery(catalog, parseCatalogQuery(query, category)).items.map((item) => item.slug)

// ── the deployment switch ───────────────────────────────────────────────────

test('the store is off unless BOTH the URL and the token are present', () => {
  assert.equal(storeConfigFromEnv({}).enabled, false)
  assert.equal(storeConfigFromEnv({ STORE_CMS_URL: 'https://cms.example.com' }).enabled, false)
  assert.equal(storeConfigFromEnv({ STORE_CMS_TOKEN: 'secret' }).enabled, false)
  assert.equal(storeConfigFromEnv({ STORE_CMS_URL: '  ', STORE_CMS_TOKEN: 'secret' }).enabled, false)

  const on = storeConfigFromEnv({ STORE_CMS_URL: 'https://cms.example.com/', STORE_CMS_TOKEN: ' secret ' })
  assert.deepEqual(on, {
    enabled: true,
    baseUrl: 'https://cms.example.com',
    apiUrl: 'https://cms.example.com/api/storefront',
    token: 'secret',
  })
})

test('a malformed or insecure backend URL disables the store instead of throwing', () => {
  for (const url of ['not a url', 'http://cms.example.com', 'ftp://cms.example.com', 'https://user:pw@cms.example.com']) {
    const config = storeConfigFromEnv({ STORE_CMS_URL: url, STORE_CMS_TOKEN: 'secret' })
    assert.equal(config.enabled, false, `should refuse ${url}`)
  }
  // Plain http is acceptable to this machine only.
  assert.equal(storeConfigFromEnv({ STORE_CMS_URL: 'http://localhost:1337', STORE_CMS_TOKEN: 's' }).enabled, true)
})

test('the image pattern is pinned to one host and one path prefix', () => {
  assert.equal(storeMediaPatternFromEnv({}), null)
  assert.deepEqual(storeMediaPatternFromEnv({ STORE_CMS_URL: 'https://cms.example.com' }), {
    protocol: 'https',
    hostname: 'cms.example.com',
    pathname: '/uploads/**',
  })
  assert.deepEqual(
    storeMediaPatternFromEnv({ STORE_CMS_URL: 'https://cms.example.com', STORE_MEDIA_URL: 'https://media.example.com/parts/' }),
    { protocol: 'https', hostname: 'media.example.com', pathname: '/parts/**' },
  )
  assert.deepEqual(storeMediaPatternFromEnv({ STORE_CMS_URL: 'http://localhost:1337' }), {
    protocol: 'http',
    hostname: 'localhost',
    port: '1337',
    pathname: '/uploads/**',
  })
  assert.equal(storeMediaPatternFromEnv({ STORE_MEDIA_URL: 'http://media.example.com' }), null)
  assert.equal(storeMediaPatternFromEnv({ STORE_MEDIA_URL: 'https://*.example.com' }), null)
})

test('revalidation only ever clears tags in the store namespace', () => {
  assert.deepEqual(revalidationTags(undefined), ['store-catalog'])
  assert.deepEqual(revalidationTags({ tags: [] }), ['store-catalog'])
  assert.deepEqual(revalidationTags({ tags: ['patreon', 'youtube', 7, null] }), ['store-catalog'])
  assert.deepEqual(revalidationTags({ tags: ['store-catalog', 'store-product-eg-lip', 'patreon', 'store-catalog'] }), [
    'store-catalog',
    'store-product-eg-lip',
  ])
  assert.deepEqual(revalidationTags({ tags: ['store-../../x', 'STORE-catalog'] }), ['store-catalog'])
})

// ── fitment ─────────────────────────────────────────────────────────────────

test('a product fits a vehicle only through an explicit record — never its title', () => {
  const titled = catalog.products.find((item) => item.slug === 'civic-eg-titled-only')!
  assert.equal(matchFitment(titled, EG.slug), null)
  assert.equal(matchFitment(titled, EG.slug, 1993), null)
  assert.deepEqual(slugs({ vehicle: EG.slug }).includes('civic-eg-titled-only'), false)
})

test('the year must fall inside the fitment range, and the strongest status wins', () => {
  const lip = catalog.products.find((item) => item.slug === 'eg-lip')!
  assert.equal(matchFitment(lip, EG.slug, 1993), 'confirmed')
  assert.equal(matchFitment(lip, EG.slug, 1991), 'unverified')
  assert.equal(matchFitment(lip, EG.slug, 1996), null)
  assert.equal(matchFitment(lip, EG.slug), 'confirmed')
  assert.equal(matchFitment(lip, EK.slug, 1996), null)
})

test('an open-ended fitment range has no upper bound', () => {
  // Built by hand: `fit()` treats an undefined yearTo as "use the vehicle's".
  const open = product({ slug: 'open', fitments: [{ ...fit(EG, 'confirmed', 1992), yearTo: undefined }] })
  assert.equal(matchFitment(open, EG.slug, 2030), 'confirmed')
  assert.equal(matchFitment(open, EG.slug, 1991), null)
})

test('a universal part matches any vehicle and is labelled universal, not confirmed', () => {
  const knob = catalog.products.find((item) => item.slug === 'shift-knob')!
  assert.equal(matchFitment(knob, EG.slug, 1993), 'universal')
  const result = runCatalogQuery(catalog, parseCatalogQuery({ vehicle: EG.slug, year: '1993' }))
  assert.deepEqual(result.items.map((item) => item.slug).sort(), ['eg-lip', 'shift-knob'])
  assert.deepEqual(result.fitment, { 'eg-lip': 'confirmed', 'shift-knob': 'universal' })
})

test('the selector is Make, then Model, then chassis in production order', () => {
  const tree = vehicleTree(catalog.vehicles)
  assert.equal(tree.length, 1)
  assert.equal(tree[0]!.make, 'Honda')
  assert.deepEqual(tree[0]!.models.map((entry) => entry.model), ['Civic', 'Integra'])
  assert.deepEqual(tree[0]!.models[0]!.vehicles.map((vehicle) => vehicle.chassisCode), ['EG', 'EK'])
  assert.deepEqual(vehicleYears(EG, 2026), [1991, 1992, 1993, 1994, 1995])
  assert.deepEqual(vehicleYears({ ...EG, yearFrom: 2024, yearTo: undefined }, 2026), [2024, 2025, 2026])
})

// ── categories ──────────────────────────────────────────────────────────────

test('a category listing includes its descendants', () => {
  assert.deepEqual([...categoryWithDescendants(catalog.categories, 'exterior')].sort(), ['exterior', 'front-lips'])
  assert.deepEqual(slugs({}, 'exterior').sort(), ['civic-eg-titled-only', 'eg-lip'])
  assert.deepEqual(categoryTrail(catalog.categories, 'front-lips').map((entry) => entry.slug), ['exterior', 'front-lips'])
})

test('a parent cycle in category data cannot hang the build', () => {
  const cyclic = [
    { id: 'a', slug: 'a', name: 'A', parentSlug: 'b', sortOrder: 0, productCount: 0 },
    { id: 'b', slug: 'b', name: 'B', parentSlug: 'a', sortOrder: 0, productCount: 0 },
  ]
  assert.deepEqual([...categoryWithDescendants(cyclic, 'a')].sort(), ['a', 'b'])
  assert.equal(categoryTrail(cyclic, 'a').length, 2)
})

// ── filters, sort, pagination ───────────────────────────────────────────────

test('text search matches name, brand, sku and tags, and every term must match', () => {
  assert.deepEqual(slugs({ q: 'mugen' }), ['shift-knob'])
  assert.deepEqual(slugs({ q: 'JDM knob' }), ['shift-knob'])
  assert.deepEqual(slugs({ q: 'RARE-CLUSTER' }), ['rare-cluster'])
  assert.deepEqual(slugs({ q: 'knob spoon' }), [])
})

test('brand, condition, authenticity and availability filters narrow the set', () => {
  assert.deepEqual(slugs({ brand: 'spoon' }), ['eg-lip'])
  assert.deepEqual(slugs({ brand: ['spoon', 'mugen'] }).sort(), ['eg-lip', 'shift-knob'])
  assert.deepEqual(slugs({ condition: 'used_good' }), ['rare-cluster'])
  assert.deepEqual(slugs({ authenticity: 'replica_reproduction' }), ['civic-eg-titled-only'])
  assert.equal(slugs({ stock: 'available' }).includes('rare-cluster'), false)
})

test('a price range excludes products with no online price', () => {
  assert.deepEqual(slugs({ min: '100', max: '200' }), ['shift-knob'])
  assert.equal(slugs({ max: '10000' }).includes('rare-cluster'), false)
})

test('sorting: a product with no price is last in both price directions', () => {
  assert.deepEqual(slugs({ sort: 'price_asc' }), ['civic-eg-titled-only', 'shift-knob', 'eg-lip', 'rare-cluster'])
  assert.deepEqual(slugs({ sort: 'price_desc' }), ['eg-lip', 'shift-knob', 'civic-eg-titled-only', 'rare-cluster'])
  assert.deepEqual(slugs({ sort: 'popular' })[0], 'shift-knob')
  assert.deepEqual(slugs({})[0], 'shift-knob') // newest
})

test('brand facets are counted before the brand filter is applied', () => {
  const result = runCatalogQuery(catalog, parseCatalogQuery({ brand: 'spoon' }))
  assert.deepEqual(result.brandFacets, [
    { slug: 'mugen', name: 'Mugen', count: 1 },
    { slug: 'spoon', name: 'Spoon', count: 1 },
  ])
})

test('pagination is bounded and an out-of-range page is clamped', () => {
  const many: Catalog = {
    ...catalog,
    products: Array.from({ length: PAGE_SIZE * 2 + 3 }, (_, index) =>
      product({ slug: `p-${String(index).padStart(3, '0')}`, publishedAt: `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}.000Z` }),
    ),
  }
  const first = runCatalogQuery(many, parseCatalogQuery({}))
  assert.equal(first.items.length, PAGE_SIZE)
  assert.equal(first.pageCount, 3)
  const last = runCatalogQuery(many, parseCatalogQuery({ page: '3' }))
  assert.equal(last.items.length, 3)
  const beyond = runCatalogQuery(many, parseCatalogQuery({ page: '99' }))
  assert.equal(beyond.page, 3)
})

test('visitor input is allowlisted, bounded, and round-trips through the URL', () => {
  const query = parseCatalogQuery({
    sort: 'drop table',
    condition: ['new', 'mint'],
    authenticity: 'genuine_oem,fake',
    brand: ['Spoon', '../etc'],
    vehicle: 'Honda-Civic-EG',
    year: '1993.5',
    page: '-2',
    min: 'abc',
    max: '199.999',
    q: 'x'.repeat(500),
  })
  assert.equal(query.sort, 'newest')
  assert.deepEqual(query.conditions, ['new'])
  assert.deepEqual(query.authenticity, ['genuine_oem'])
  assert.deepEqual(query.brands, ['spoon'])
  assert.equal(query.vehicle, 'honda-civic-eg')
  assert.equal(query.year, undefined)
  assert.equal(query.page, 1)
  assert.equal(query.minPrice, undefined)
  assert.equal(query.maxPrice, undefined)
  assert.equal(query.q?.length, 80)

  const params = catalogQueryParams(parseCatalogQuery({ brand: 'spoon', min: '120.5', sort: 'popular', page: '2' }))
  assert.equal(params.toString(), 'brand=spoon&min=120.5&sort=popular&page=2')
})

test('any narrowing, reordering or paging makes a listing a non-indexable view', () => {
  assert.equal(hasActiveFilters(parseCatalogQuery({}, 'exterior')), false)
  for (const params of [{ q: 'lip' }, { brand: 'spoon' }, { sort: 'popular' }, { page: '2' }, { stock: 'available' }, { vehicle: 'honda-civic-eg' }, { max: '10' }]) {
    assert.equal(hasActiveFilters(parseCatalogQuery(params, 'exterior')), true, JSON.stringify(params))
  }
})

test('related products prefer the same category and never mix samples with real stock', () => {
  const lip = catalog.products.find((item) => item.slug === 'eg-lip')!
  assert.deepEqual(relatedProducts(catalog, lip).map((item) => item.slug), ['civic-eg-titled-only'])
  const withSample: Catalog = {
    ...catalog,
    products: [...catalog.products, product({ slug: 'sample-lip', categorySlug: 'front-lips', isSample: true })],
  }
  assert.equal(relatedProducts(withSample, lip).some((item) => item.isSample), false)
})

// ── money ───────────────────────────────────────────────────────────────────

test('money is formatted from integer minor units with an ISO code', () => {
  assert.equal(formatMoney({ amount: 12900, currency: 'USD' }), 'USD 129.00')
  assert.equal(formatMoney({ amount: 123456789, currency: 'THB' }), 'THB 1,234,567.89')
  assert.equal(formatMoney({ amount: 5, currency: 'GBP' }), 'GBP 0.05')
  assert.equal(parseMajorToMinor('120.5'), 12050)
  assert.equal(parseMajorToMinor('19.99'), 1999)
  assert.equal(parseMajorToMinor('-5'), undefined)
  assert.equal(parseMajorToMinor('1e9'), undefined)
})

test('categories holding only samples count as empty for indexing', async () => {
  const { realProductCount } = await import('./filter.ts')
  assert.equal(realProductCount(catalog, 'exterior'), 2)
  const sampled: Catalog = { ...catalog, products: catalog.products.map((item) => ({ ...item, isSample: true })) }
  assert.equal(realProductCount(sampled, 'exterior'), 0)
})
