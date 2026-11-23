import { parseMajorToMinor } from './money.ts'
import {
  AUTHENTICITY,
  CONDITIONS,
  type Authenticity,
  type Catalog,
  type FitmentStatus,
  type ProductCondition,
  type ProductSummary,
  type StoreCategory,
  type StoreVehicle,
} from './types.ts'

/**
 * Catalogue search, filtering, sorting and pagination — in memory.
 *
 * ── WHY IN MEMORY ───────────────────────────────────────────────────────────
 *
 * This is a curated store: hundreds of parts, not hundreds of thousands. The
 * whole published catalogue is one cached response (lib/store/client.ts), so a
 * filtered listing costs no request to the commerce backend at all — it cannot
 * be slowed by it and cannot fail because of it. The day the catalogue outgrows
 * this, the function signatures here are the seam: `runCatalogQuery` becomes a
 * backend call and no page changes.
 *
 * ── WHY PURE ────────────────────────────────────────────────────────────────
 *
 * No React, no `server-only`, no environment. `node` runs the tests against
 * the real functions (lib/store/filter.test.ts).
 *
 * ── FITMENT IS DATA, NEVER A GUESS ──────────────────────────────────────────
 *
 * A product matches a vehicle only through an explicit fitment record whose
 * year range contains the requested year, or by being flagged universal. A
 * product called "Civic EG front lip" with no fitment record does NOT match a
 * Civic EG: the title is marketing copy, the record is the claim.
 */

export const PAGE_SIZE = 24

export const SORTS = ['newest', 'price_asc', 'price_desc', 'popular'] as const
export type CatalogSort = (typeof SORTS)[number]

export type CatalogQuery = {
  q?: string
  /** Category slug; matches the category and every descendant. */
  category?: string
  brands: string[]
  /** Vehicle slug. */
  vehicle?: string
  year?: number
  /** Minor units. */
  minPrice?: number
  maxPrice?: number
  conditions: ProductCondition[]
  authenticity: Authenticity[]
  /** Only products that can be bought online right now. */
  purchasableOnly: boolean
  sort: CatalogSort
  page: number
}

export type RawSearchParams = Record<string, string | string[] | undefined>

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value

const many = (value: string | string[] | undefined): string[] =>
  (Array.isArray(value) ? value : value ? [value] : [])
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean)

const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/

/**
 * Reads a query from URL search params.
 *
 * Everything is bounded and allowlisted here, so nothing downstream handles a
 * raw visitor string: an unknown sort becomes the default, an unknown condition
 * is dropped, a malformed price is ignored rather than treated as zero.
 */
export function parseCatalogQuery(params: RawSearchParams, category?: string): CatalogQuery {
  const q = first(params.q)?.trim().slice(0, 80) || undefined
  const sortRaw = first(params.sort)
  const sort = (SORTS as readonly string[]).includes(sortRaw ?? '')
    ? (sortRaw as CatalogSort)
    : 'newest'

  const yearRaw = Number(first(params.year))
  const year = Number.isInteger(yearRaw) && yearRaw >= 1950 && yearRaw <= 2100 ? yearRaw : undefined

  const pageRaw = Number(first(params.page))
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 500 ? pageRaw : 1

  const vehicleRaw = first(params.vehicle)?.trim().toLowerCase()
  const minPrice = parseMajorToMinor(first(params.min))
  const maxPrice = parseMajorToMinor(first(params.max))

  return {
    q,
    category,
    brands: many(params.brand)
      .map((slug) => slug.toLowerCase())
      .filter((slug) => SLUG.test(slug))
      .slice(0, 20),
    vehicle: vehicleRaw && SLUG.test(vehicleRaw) ? vehicleRaw : undefined,
    year,
    minPrice,
    maxPrice,
    conditions: many(params.condition).filter((value): value is ProductCondition =>
      (CONDITIONS as readonly string[]).includes(value),
    ),
    authenticity: many(params.authenticity).filter((value): value is Authenticity =>
      (AUTHENTICITY as readonly string[]).includes(value),
    ),
    purchasableOnly: first(params.stock) === 'available',
    sort,
    page,
  }
}

/**
 * Whether the query narrows, reorders or pages the listing.
 *
 * This is the indexing rule: a URL for which this is true is a VIEW of a
 * category, not a page of its own, so it is served `noindex, follow` with its
 * canonical pointing at the unfiltered category. `category` itself does not
 * count — it is the page.
 */
export function hasActiveFilters(query: CatalogQuery): boolean {
  return Boolean(
    query.q ||
      query.brands.length > 0 ||
      query.vehicle ||
      query.year !== undefined ||
      query.minPrice !== undefined ||
      query.maxPrice !== undefined ||
      query.conditions.length > 0 ||
      query.authenticity.length > 0 ||
      query.purchasableOnly ||
      query.sort !== 'newest' ||
      query.page > 1,
  )
}

/** Serialises a query back to search params, omitting defaults. */
export function catalogQueryParams(
  query: CatalogQuery,
  overrides: Partial<CatalogQuery> = {},
): URLSearchParams {
  const merged = { ...query, ...overrides }
  const params = new URLSearchParams()
  if (merged.q) params.set('q', merged.q)
  for (const brand of merged.brands) params.append('brand', brand)
  if (merged.vehicle) params.set('vehicle', merged.vehicle)
  if (merged.year !== undefined) params.set('year', String(merged.year))
  if (merged.minPrice !== undefined) params.set('min', (merged.minPrice / 100).toString())
  if (merged.maxPrice !== undefined) params.set('max', (merged.maxPrice / 100).toString())
  for (const condition of merged.conditions) params.append('condition', condition)
  for (const value of merged.authenticity) params.append('authenticity', value)
  if (merged.purchasableOnly) params.set('stock', 'available')
  if (merged.sort !== 'newest') params.set('sort', merged.sort)
  if (merged.page > 1) params.set('page', String(merged.page))
  return params
}

// ── Categories ──────────────────────────────────────────────────────────────

/** The slug itself plus every descendant slug. Cycle-safe. */
export function categoryWithDescendants(categories: StoreCategory[], slug: string): Set<string> {
  const result = new Set<string>([slug])
  let grew = true
  while (grew) {
    grew = false
    for (const category of categories) {
      if (category.parentSlug && result.has(category.parentSlug) && !result.has(category.slug)) {
        result.add(category.slug)
        grew = true
      }
    }
  }
  return result
}

/** Root-first ancestor chain ending at the category itself. Cycle-safe. */
export function categoryTrail(categories: StoreCategory[], slug: string): StoreCategory[] {
  const bySlug = new Map(categories.map((category) => [category.slug, category]))
  const trail: StoreCategory[] = []
  const seen = new Set<string>()
  let current = bySlug.get(slug)
  while (current && !seen.has(current.slug)) {
    seen.add(current.slug)
    trail.unshift(current)
    current = current.parentSlug ? bySlug.get(current.parentSlug) : undefined
  }
  return trail
}

export function childCategories(categories: StoreCategory[], parentSlug?: string): StoreCategory[] {
  return categories
    .filter((category) => (category.parentSlug ?? undefined) === parentSlug)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'en'))
}

// ── Vehicles ────────────────────────────────────────────────────────────────

export type VehicleTree = {
  make: string
  makeSlug: string
  models: { model: string; vehicles: StoreVehicle[] }[]
}[]

/** Make → Model → chassis, for the selector. Sorted, stable. */
export function vehicleTree(vehicles: StoreVehicle[]): VehicleTree {
  const makes = new Map<string, { make: string; makeSlug: string; models: Map<string, StoreVehicle[]> }>()
  for (const vehicle of vehicles) {
    let make = makes.get(vehicle.makeSlug)
    if (!make) {
      make = { make: vehicle.make, makeSlug: vehicle.makeSlug, models: new Map() }
      makes.set(vehicle.makeSlug, make)
    }
    const list = make.models.get(vehicle.model) ?? []
    list.push(vehicle)
    make.models.set(vehicle.model, list)
  }
  return [...makes.values()]
    .sort((a, b) => a.make.localeCompare(b.make, 'en'))
    .map((make) => ({
      make: make.make,
      makeSlug: make.makeSlug,
      models: [...make.models.entries()]
        .sort(([a], [b]) => a.localeCompare(b, 'en'))
        .map(([model, list]) => ({
          model,
          vehicles: [...list].sort((a, b) => a.yearFrom - b.yearFrom || a.chassisCode.localeCompare(b.chassisCode)),
        })),
    }))
}

/** The production years of one vehicle, newest last. Open-ended ranges stop at `through`. */
export function vehicleYears(vehicle: StoreVehicle, through: number): number[] {
  const last = Math.min(vehicle.yearTo ?? through, through, vehicle.yearFrom + 80)
  const years: number[] = []
  for (let year = vehicle.yearFrom; year <= last; year += 1) years.push(year)
  return years
}

export type FitmentMatch = FitmentStatus | 'universal'

const FITMENT_RANK: Record<FitmentStatus, number> = { confirmed: 3, conditional: 2, unverified: 1 }

/**
 * How a product fits a vehicle (and year), or null when it does not.
 *
 * With several matching records the strongest status wins — a part confirmed
 * for 1992–1995 and unverified for 1991 is "confirmed" for a 1993 car and
 * "unverified" for a 1991 one. A universal part is reported as `universal`
 * only when no explicit record matches, so an explicit confirmation is never
 * hidden behind the weaker label.
 */
export function matchFitment(
  product: Pick<ProductSummary, 'fitments' | 'universalFit'>,
  vehicleSlug: string,
  year?: number,
): FitmentMatch | null {
  let best: FitmentStatus | null = null
  for (const fitment of product.fitments) {
    if (fitment.vehicleSlug !== vehicleSlug) continue
    if (year !== undefined) {
      if (year < fitment.yearFrom) continue
      if (fitment.yearTo !== undefined && year > fitment.yearTo) continue
    }
    if (!best || FITMENT_RANK[fitment.status] > FITMENT_RANK[best]) best = fitment.status
  }
  if (best) return best
  return product.universalFit ? 'universal' : null
}

// ── The query ───────────────────────────────────────────────────────────────

export type CatalogResult = {
  items: ProductSummary[]
  total: number
  page: number
  pageCount: number
  /** Brands present in the result set BEFORE the brand filter, with counts. */
  brandFacets: { slug: string; name: string; count: number }[]
  /** Fitment per returned product slug, when a vehicle is selected. */
  fitment: Record<string, FitmentMatch>
}

function normalise(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
}

function searchable(product: ProductSummary): string {
  return normalise(
    [product.name, product.brand, product.sku, product.categoryName, ...product.tags]
      .filter(Boolean)
      .join(' '),
  )
}

function comparePrice(a: ProductSummary, b: ProductSummary, direction: 1 | -1): number {
  // A product with no online price sorts last in BOTH directions: "price on
  // request" is not cheaper than everything, and it is not dearer either.
  if (!a.price && !b.price) return 0
  if (!a.price) return 1
  if (!b.price) return -1
  return (a.price.amount - b.price.amount) * direction
}

export function runCatalogQuery(catalog: Catalog, query: CatalogQuery): CatalogResult {
  const categorySlugs = query.category
    ? categoryWithDescendants(catalog.categories, query.category)
    : null
  const terms = query.q ? normalise(query.q).split(/\s+/).filter(Boolean).slice(0, 8) : []
  const fitment: Record<string, FitmentMatch> = {}

  const beforeBrand = catalog.products.filter((product) => {
    if (categorySlugs && !(product.categorySlug && categorySlugs.has(product.categorySlug))) return false

    if (terms.length > 0) {
      const haystack = searchable(product)
      if (!terms.every((term) => haystack.includes(term))) return false
    }

    if (query.vehicle) {
      const match = matchFitment(product, query.vehicle, query.year)
      if (!match) return false
      fitment[product.slug] = match
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      if (!product.price) return false
      if (query.minPrice !== undefined && product.price.amount < query.minPrice) return false
      if (query.maxPrice !== undefined && product.price.amount > query.maxPrice) return false
    }

    if (query.conditions.length > 0 && !query.conditions.includes(product.condition)) return false
    if (query.authenticity.length > 0 && !query.authenticity.includes(product.authenticity)) return false
    if (query.purchasableOnly && !product.purchasable) return false
    return true
  })

  const brandCounts = new Map<string, { slug: string; name: string; count: number }>()
  for (const product of beforeBrand) {
    if (!product.brandSlug || !product.brand) continue
    const entry = brandCounts.get(product.brandSlug) ?? {
      slug: product.brandSlug,
      name: product.brand,
      count: 0,
    }
    entry.count += 1
    brandCounts.set(product.brandSlug, entry)
  }

  const matched =
    query.brands.length > 0
      ? beforeBrand.filter((product) => product.brandSlug && query.brands.includes(product.brandSlug))
      : beforeBrand

  const sorted = [...matched].sort((a, b) => {
    switch (query.sort) {
      case 'price_asc':
        return comparePrice(a, b, 1) || a.name.localeCompare(b.name, 'en')
      case 'price_desc':
        return comparePrice(a, b, -1) || a.name.localeCompare(b.name, 'en')
      case 'popular':
        return b.popularity - a.popularity || b.publishedAt.localeCompare(a.publishedAt)
      case 'newest':
      default:
        return b.publishedAt.localeCompare(a.publishedAt) || a.name.localeCompare(b.name, 'en')
    }
  })

  const total = sorted.length
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const page = Math.min(query.page, pageCount)
  const items = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return {
    items,
    total,
    page,
    pageCount,
    brandFacets: [...brandCounts.values()].sort((a, b) => a.name.localeCompare(b.name, 'en')),
    fitment: Object.fromEntries(items.filter((item) => fitment[item.slug]).map((item) => [item.slug, fitment[item.slug]!])),
  }
}

/** Products related to one product: same category first, then shared fitment. */
export function relatedProducts(catalog: Catalog, product: ProductSummary, limit = 4): ProductSummary[] {
  const vehicles = new Set(product.fitments.map((fitment) => fitment.vehicleSlug))
  return catalog.products
    .filter((candidate) => candidate.slug !== product.slug && candidate.isSample === product.isSample)
    .map((candidate) => {
      let score = 0
      if (candidate.categorySlug && candidate.categorySlug === product.categorySlug) score += 3
      if (candidate.brandSlug && candidate.brandSlug === product.brandSlug) score += 1
      if (candidate.fitments.some((fitment) => vehicles.has(fitment.vehicleSlug))) score += 2
      return { candidate, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.candidate.popularity - a.candidate.popularity)
    .slice(0, limit)
    .map((entry) => entry.candidate)
}

/**
 * Real (non-sample) products in a category and its descendants.
 *
 * Counted HERE rather than trusted from `productCount`, because indexing
 * decisions hang on it: a category whose only entries are development samples
 * is empty as far as a search engine should be concerned.
 */
export function realProductCount(catalog: Catalog, categorySlug: string): number {
  const slugs = categoryWithDescendants(catalog.categories, categorySlug)
  return catalog.products.filter(
    (product) => !product.isSample && product.categorySlug !== undefined && slugs.has(product.categorySlug),
  ).length
}

/** Products a real customer can be shown as merchandise: published and not a sample. */
export function realProducts(catalog: Catalog): ProductSummary[] {
  return catalog.products.filter((product) => !product.isSample)
}
