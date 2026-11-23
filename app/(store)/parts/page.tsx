import type { Metadata } from 'next'
import Link from 'next/link'

import { ProductGrid } from '@/components/store/ProductCard'
import { VehicleFields } from '@/components/store/CatalogBrowser'
import { SampleCatalogNotice, StoreSection, StoreUnavailable } from '@/components/store/StoreChrome'
import { OnlineStoreStructuredData, STORE_NAME, storePageMetadata } from '@/lib/seo/store'
import { categoryWithDescendants, childCategories, realProducts } from '@/lib/store/filter'
import { loadStorePage } from '@/lib/store/page'
import type { Catalog, ProductSummary } from '@/lib/store/types'

/**
 * /parts — THE KANJO PARTS.
 *
 * Every section below is driven by real catalogue data and is OMITTED when it
 * has nothing to show. A new store with three products shows three products
 * and the services, not eight headings over empty grids.
 */

const DESCRIPTION =
  'Rare JDM parts, genuine and aftermarket Honda components and custom 3D-printed parts for Civic EG, EK, EF, EP3 and Integra DC2. Sourced in Asia, shipped from Thailand.'

export const revalidate = 300

export async function generateMetadata(): Promise<Metadata> {
  const { settings, catalog } = await loadStorePage()
  return storePageMetadata(settings, {
    title: `${STORE_NAME} - Rare JDM and Honda Parts`,
    description: DESCRIPTION,
    path: '/parts',
    // A store with no real products yet (or only development samples) is not
    // a page worth indexing.
    noIndex: !catalog || realProducts(catalog).length === 0,
  })
}

function inCategory(catalog: Catalog, slug: string): ProductSummary[] {
  const slugs = categoryWithDescendants(catalog.categories, slug)
  return catalog.products.filter((product) => product.categorySlug && slugs.has(product.categorySlug))
}

const newest = (products: ProductSummary[]) =>
  [...products].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))

export default async function PartsHome() {
  const { settings, catalog } = await loadStorePage()
  if (!catalog) return <StoreUnavailable />

  const products = catalog.products
  const featured = newest(products.filter((product) => product.featured)).slice(0, 8)
  const rare = newest(inCategory(catalog, 'rare-jdm-parts')).slice(0, 4)
  const printed = newest(inCategory(catalog, 'custom-3d-printed')).slice(0, 4)
  const arrivals = newest(products).slice(0, 8)
  const topCategories = childCategories(catalog.categories).filter((category) => category.productCount > 0)

  return (
    <>
      <OnlineStoreStructuredData settings={settings} description={DESCRIPTION} />

      <section className="k-store-hero" aria-labelledby="parts-title">
        <div className="k-shell">
          <p className="k-small" style={{ color: 'var(--k-accent)' }}>
            RARE JDM PARTS. CUSTOM COMPONENTS. WORLDWIDE SHIPPING.
          </p>
          <h1 id="parts-title" className="k-hero-title k-store-hero-title">
            {STORE_NAME}
          </h1>
          <p className="k-body k-store-standfirst">Built for enthusiasts. Sourced in Asia. Shipped worldwide.</p>
          <form method="get" action="/parts/search" className="k-store-hero-search" role="search">
            <label className="k-store-field k-store-field--wide">
              <span className="k-visually-hidden">Search parts</span>
              <input type="search" name="q" placeholder="Search parts, brands or SKUs" maxLength={80} />
            </label>
            <button type="submit" className="k-store-button">
              SEARCH
            </button>
          </form>
          <p className="k-small k-store-fineprint">
            Shipping availability depends on the destination, carrier and item. Import duties may apply.
          </p>
        </div>
      </section>

      {catalog.settings.sampleCatalog && <SampleCatalogNotice />}

      {featured.length > 0 && (
        <StoreSection id="featured" eyebrow="SELECTED" heading="FEATURED PARTS">
          <ProductGrid products={featured} priorityCount={2} />
        </StoreSection>
      )}

      {catalog.vehicles.length > 0 && (
        <StoreSection
          id="vehicle"
          eyebrow="FITMENT"
          heading="SHOP BY VEHICLE"
          standfirst={<p>Pick your car to see parts with a recorded fitment for it.</p>}
        >
          <form method="get" action="/parts/search" className="k-store-vehicle-form">
            <VehicleFields vehicles={catalog.vehicles} query={{}} />
            <button type="submit" className="k-store-button">
              SHOW PARTS
            </button>
          </form>
        </StoreSection>
      )}

      {topCategories.length > 0 && (
        <StoreSection id="categories" eyebrow="CATALOGUE" heading="SHOP BY CATEGORY">
          <ul className="k-store-categories">
            {topCategories.map((category) => (
              <li key={category.slug}>
                <Link href={`/parts/category/${category.slug}`} prefetch={false} className="k-store-category">
                  <span className="k-item-title">{category.name}</span>
                  <span className="k-small">
                    {category.productCount} {category.productCount === 1 ? 'PART' : 'PARTS'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </StoreSection>
      )}

      {rare.length > 0 && (
        <StoreSection
          id="rare"
          eyebrow="HARD TO FIND"
          heading="RARE JDM FINDS"
          action={{ label: 'ALL RARE PARTS', href: '/parts/category/rare-jdm-parts' }}
        >
          <ProductGrid products={rare} />
        </StoreSection>
      )}

      {printed.length > 0 && (
        <StoreSection
          id="printed"
          eyebrow="MADE TO ORDER"
          heading="CUSTOM 3D-PRINTED COMPONENTS"
          action={{ label: 'ALL CUSTOM PARTS', href: '/parts/category/custom-3d-printed' }}
        >
          <ProductGrid products={printed} />
        </StoreSection>
      )}

      {arrivals.length > 0 && (
        <StoreSection
          id="new"
          eyebrow="LATEST"
          heading="NEW ARRIVALS"
          action={{ label: 'SEARCH ALL PARTS', href: '/parts/search' }}
        >
          <ProductGrid products={arrivals} />
        </StoreSection>
      )}

      {products.length === 0 && (
        <StoreSection id="empty" heading="THE CATALOGUE IS BEING PREPARED">
          <p className="k-body">No parts are listed yet. If you are looking for something specific, ask us to find it.</p>
        </StoreSection>
      )}

      <StoreSection
        id="sourcing"
        eyebrow="SERVICE"
        heading="RARE PARTS SOURCING"
        standfirst={
          <p>
            Looking for a discontinued or hard-to-find part? Tell us the car and the part, and we will look for it
            through our contacts in Thailand and across Asia. A request is not an order and costs nothing.
          </p>
        }
      >
        <Link href="/parts/sourcing" prefetch={false} className="k-store-button">
          REQUEST A PART
        </Link>
      </StoreSection>

      <StoreSection
        id="builds"
        eyebrow="SERVICE"
        heading="CUSTOM BUILDS"
        standfirst={<p>Built in Thailand. Driven worldwide. Custom Honda builds by enquiry and quotation.</p>}
      >
        <Link href="/builds" prefetch={false} className="k-store-button k-store-button--quiet">
          ABOUT CUSTOM BUILDS
        </Link>
      </StoreSection>
    </>
  )
}
