import Link from 'next/link'

import {
  SORTS,
  catalogQueryParams,
  type CatalogQuery,
  type CatalogResult,
  type CatalogSort,
  vehicleTree,
} from '@/lib/store/filter'
import { AUTHENTICITY_LABEL, CONDITION_LABEL } from '@/lib/store/labels'
import { AUTHENTICITY, CONDITIONS, type Catalog, type StoreVehicle } from '@/lib/store/types'

import { ProductGrid } from './ProductCard'

/**
 * The filterable listing: a plain GET form, a grid and page links.
 *
 * NO CLIENT JAVASCRIPT. Every filter is a query parameter, the form submits
 * with GET, and the result is server-rendered — so filtering works with
 * scripts off, every state has a shareable URL, and the listing costs nothing
 * to hydrate. Those URLs are views, not pages: they are `noindex, follow` with
 * a canonical pointing at the unfiltered listing (see hasActiveFilters).
 */

const SORT_LABEL: Record<CatalogSort, string> = {
  newest: 'Newest',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  popular: 'Most popular',
}

function vehicleOptionLabel(vehicle: StoreVehicle): string {
  const years = `${vehicle.yearFrom}-${vehicle.yearTo ?? 'on'}`
  return `${vehicle.chassisCode}${vehicle.generation ? ` ${vehicle.generation}` : ''} (${years})`
}

/**
 * Make, Model, Chassis — as one select grouped by make and model — then Year.
 *
 * One select rather than three chained ones, because a chained select needs
 * JavaScript to repopulate the next list. With the optgroups the hierarchy is
 * still Make then Model then chassis to the eye and to a screen reader.
 */
export function VehicleFields({ vehicles, query }: { vehicles: StoreVehicle[]; query: Pick<CatalogQuery, 'vehicle' | 'year'> }) {
  const tree = vehicleTree(vehicles)
  const selected = vehicles.find((vehicle) => vehicle.slug === query.vehicle)
  return (
    <>
      <label className="k-store-field">
        <span className="k-small">VEHICLE</span>
        <select name="vehicle" defaultValue={query.vehicle ?? ''}>
          <option value="">Any vehicle</option>
          {tree.flatMap((make) =>
            make.models.map((model) => (
              <optgroup key={`${make.makeSlug}-${model.model}`} label={`${make.make} ${model.model}`}>
                {model.vehicles.map((vehicle) => (
                  <option key={vehicle.slug} value={vehicle.slug}>
                    {make.make} {model.model} {vehicleOptionLabel(vehicle)}
                  </option>
                ))}
              </optgroup>
            )),
          )}
        </select>
      </label>
      <label className="k-store-field k-store-field--narrow">
        <span className="k-small">YEAR</span>
        <input
          type="number"
          name="year"
          inputMode="numeric"
          min={selected?.yearFrom ?? 1950}
          max={selected?.yearTo ?? 2100}
          placeholder="Any"
          defaultValue={query.year ?? ''}
        />
      </label>
    </>
  )
}

export function CatalogFilters({
  action,
  catalog,
  query,
  result,
  showSearch = true,
}: {
  action: string
  catalog: Catalog
  query: CatalogQuery
  result: CatalogResult
  showSearch?: boolean
}) {
  return (
    <form method="get" action={action} className="k-store-filters" aria-label="Filter products">
      {showSearch && (
        <label className="k-store-field k-store-field--wide">
          <span className="k-small">SEARCH</span>
          <input type="search" name="q" defaultValue={query.q ?? ''} placeholder="Part, brand or SKU" maxLength={80} />
        </label>
      )}

      {catalog.vehicles.length > 0 && <VehicleFields vehicles={catalog.vehicles} query={query} />}

      {result.brandFacets.length > 0 && (
        <fieldset className="k-store-fieldset">
          <legend className="k-small">BRAND</legend>
          {result.brandFacets.map((brand) => (
            <label key={brand.slug} className="k-store-check">
              <input type="checkbox" name="brand" value={brand.slug} defaultChecked={query.brands.includes(brand.slug)} />
              <span>
                {brand.name} <span className="k-store-count">({brand.count})</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <fieldset className="k-store-fieldset">
        <legend className="k-small">CONDITION</legend>
        {CONDITIONS.map((condition) => (
          <label key={condition} className="k-store-check">
            <input type="checkbox" name="condition" value={condition} defaultChecked={query.conditions.includes(condition)} />
            <span>{CONDITION_LABEL[condition]}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="k-store-fieldset">
        <legend className="k-small">AUTHENTICITY</legend>
        {AUTHENTICITY.map((value) => (
          <label key={value} className="k-store-check">
            <input type="checkbox" name="authenticity" value={value} defaultChecked={query.authenticity.includes(value)} />
            <span>{AUTHENTICITY_LABEL[value]}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="k-store-fieldset k-store-fieldset--row">
        <legend className="k-small">PRICE ({catalog.settings.currency})</legend>
        <label className="k-store-field k-store-field--narrow">
          <span className="k-small">MIN</span>
          <input type="text" inputMode="decimal" name="min" defaultValue={query.minPrice !== undefined ? query.minPrice / 100 : ''} />
        </label>
        <label className="k-store-field k-store-field--narrow">
          <span className="k-small">MAX</span>
          <input type="text" inputMode="decimal" name="max" defaultValue={query.maxPrice !== undefined ? query.maxPrice / 100 : ''} />
        </label>
      </fieldset>

      <label className="k-store-check">
        <input type="checkbox" name="stock" value="available" defaultChecked={query.purchasableOnly} />
        <span>Only items I can buy online now</span>
      </label>

      <label className="k-store-field">
        <span className="k-small">SORT</span>
        <select name="sort" defaultValue={query.sort}>
          {SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {SORT_LABEL[sort]}
            </option>
          ))}
        </select>
      </label>

      <div className="k-store-actions">
        <button type="submit" className="k-store-button">
          APPLY
        </button>
        <Link href={action} prefetch={false} className="k-store-button k-store-button--quiet">
          CLEAR
        </Link>
      </div>
    </form>
  )
}

export function Pagination({ action, query, result }: { action: string; query: CatalogQuery; result: CatalogResult }) {
  if (result.pageCount <= 1) return null
  const href = (page: number) => {
    const params = catalogQueryParams(query, { page }).toString()
    return params ? `${action}?${params}` : action
  }
  return (
    <nav className="k-store-pagination" aria-label="Pages">
      {result.page > 1 && (
        <Link href={href(result.page - 1)} prefetch={false} className="k-store-button k-store-button--quiet" rel="prev">
          PREVIOUS
        </Link>
      )}
      <span className="k-small">
        PAGE {result.page} OF {result.pageCount}
      </span>
      {result.page < result.pageCount && (
        <Link href={href(result.page + 1)} prefetch={false} className="k-store-button k-store-button--quiet" rel="next">
          NEXT
        </Link>
      )}
    </nav>
  )
}

/** Filters beside the results on desktop; filters in a disclosure above them on a phone. */
export function CatalogListing({
  action,
  catalog,
  query,
  result,
  showSearch = true,
  emptyMessage = 'No parts match these filters yet.',
}: {
  action: string
  catalog: Catalog
  query: CatalogQuery
  result: CatalogResult
  showSearch?: boolean
  emptyMessage?: string
}) {
  const vehicle = query.vehicle ? catalog.vehicles.find((entry) => entry.slug === query.vehicle) : undefined
  return (
    <div className="k-store-listing">
      <details className="k-store-filter-panel" open>
        <summary className="k-small">FILTERS</summary>
        <CatalogFilters action={action} catalog={catalog} query={query} result={result} showSearch={showSearch} />
      </details>
      <div className="k-store-results">
        <p className="k-small k-store-result-count" aria-live="polite">
          {result.total} {result.total === 1 ? 'PART' : 'PARTS'}
          {vehicle ? ` FOR ${vehicle.make.toUpperCase()} ${vehicle.model.toUpperCase()} ${vehicle.chassisCode}` : ''}
          {query.year ? ` ${query.year}` : ''}
        </p>
        {vehicle && (
          <p className="k-small k-store-fit-note">
            Fitment comes from each part&apos;s compatibility record, not its title. Check the fitment status on the part
            page before ordering.
          </p>
        )}
        {result.items.length === 0 ? (
          <div className="k-store-empty">
            <p className="k-body">{emptyMessage}</p>
            <p>
              <Link href="/parts/sourcing" prefetch={false} className="k-link-action k-small">
                ASK US TO SOURCE IT
              </Link>
            </p>
          </div>
        ) : (
          <ProductGrid products={result.items} fitment={result.fitment} priorityCount={2} />
        )}
        <Pagination action={action} query={query} result={result} />
      </div>
    </div>
  )
}
