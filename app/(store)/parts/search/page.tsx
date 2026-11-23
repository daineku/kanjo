import type { Metadata } from 'next'

import { CatalogListing } from '@/components/store/CatalogBrowser'
import { Breadcrumbs, SampleCatalogNotice, StoreSection, StoreUnavailable } from '@/components/store/StoreChrome'
import { STORE_NAME, storePageMetadata } from '@/lib/seo/store'
import { parseCatalogQuery, runCatalogQuery } from '@/lib/store/filter'
import { loadStorePage, type SearchParams } from '@/lib/store/page'

/**
 * /parts/search — every product, every filter. Always `noindex, follow`: a
 * search result page is a view of the catalogue, and the categories and
 * product pages are what should be indexed.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await loadStorePage()
  return storePageMetadata(settings, {
    title: `Search parts - ${STORE_NAME}`,
    description: `Search ${STORE_NAME} by part, brand, SKU or vehicle.`,
    path: '/parts/search',
    noIndex: true,
  })
}

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams
  const { settings, catalog } = await loadStorePage()
  if (!catalog) return <StoreUnavailable />

  const query = parseCatalogQuery(raw)
  const result = runCatalogQuery(catalog, query)

  return (
    <>
      <div className="k-shell">
        <Breadcrumbs
          settings={settings}
          crumbs={[
            { name: 'Parts', path: '/parts' },
            { name: 'Search', path: '/parts/search' },
          ]}
        />
      </div>
      {catalog.settings.sampleCatalog && <SampleCatalogNotice />}
      <StoreSection id="search" level={1} eyebrow="THE KANJO PARTS" heading={query.q ? `RESULTS FOR "${query.q.toUpperCase()}"` : 'ALL PARTS'}>
        <CatalogListing action="/parts/search" catalog={catalog} query={query} result={result} />
      </StoreSection>
    </>
  )
}
