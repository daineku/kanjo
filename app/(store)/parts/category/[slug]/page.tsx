import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'

import { CatalogListing } from '@/components/store/CatalogBrowser'
import { Breadcrumbs, SampleCatalogNotice, StoreSection, StoreUnavailable } from '@/components/store/StoreChrome'
import { STORE_NAME, storePageMetadata } from '@/lib/seo/store'
import { findRedirect } from '@/lib/store/client'
import {
  categoryTrail,
  childCategories,
  hasActiveFilters,
  parseCatalogQuery,
  realProductCount,
  runCatalogQuery,
} from '@/lib/store/filter'
import { loadStorePage, type SearchParams } from '@/lib/store/page'

type Props = { params: Promise<{ slug: string }>; searchParams: SearchParams }

/**
 * /parts/category/[slug]
 *
 * INDEXING: the bare category URL is the page. Any filter, sort or page number
 * makes it a VIEW — `noindex, follow`, canonical to the bare URL — so the
 * index holds one URL per category rather than one per combination of
 * checkboxes. A category with no products is `noindex` too: an empty listing
 * is thin content.
 */

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, raw] = await Promise.all([params, searchParams])
  const { settings, catalog } = await loadStorePage()
  const category = catalog?.categories.find((entry) => entry.slug === slug)
  if (!catalog || !category) return { title: STORE_NAME, robots: { index: false } }

  const query = parseCatalogQuery(raw, slug)
  const path = `/parts/category/${slug}`
  return storePageMetadata(settings, {
    title: category.seoTitle ?? `${category.name} - JDM and Honda Parts`,
    description:
      category.seoDescription ??
      category.description ??
      `${category.name} for Honda Civic, Integra and other JDM cars from ${STORE_NAME}.`,
    path,
    canonical: path,
    noIndex: hasActiveFilters(query) || realProductCount(catalog, slug) === 0,
  })
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const [{ slug }, raw] = await Promise.all([params, searchParams])
  const { settings, catalog } = await loadStorePage()
  if (!catalog) return <StoreUnavailable />

  const category = catalog.categories.find((entry) => entry.slug === slug)
  if (!category) {
    const redirect = await findRedirect(`/parts/category/${slug}`)
    if (redirect) permanentRedirect(redirect.toPath)
    notFound()
  }

  const query = parseCatalogQuery(raw, slug)
  const result = runCatalogQuery(catalog, query)
  const trail = categoryTrail(catalog.categories, slug)
  const children = childCategories(catalog.categories, slug).filter((child) => child.productCount > 0)
  const path = `/parts/category/${slug}`

  return (
    <>
      <div className="k-shell">
        <Breadcrumbs
          settings={settings}
          crumbs={[
            { name: 'Parts', path: '/parts' },
            ...trail.map((entry) => ({ name: entry.name, path: `/parts/category/${entry.slug}` })),
          ]}
        />
      </div>
      {catalog.settings.sampleCatalog && <SampleCatalogNotice />}
      <StoreSection
        id="category"
        level={1}
        eyebrow={trail.length > 1 ? trail[trail.length - 2]!.name.toUpperCase() : 'THE KANJO PARTS'}
        heading={category.name.toUpperCase()}
        standfirst={category.description ? <p>{category.description}</p> : undefined}
      >
        {children.length > 0 && (
          <ul className="k-store-subcats">
            {children.map((child) => (
              <li key={child.slug}>
                <Link href={`/parts/category/${child.slug}`} prefetch={false} className="k-inline-link k-small">
                  {child.name} ({child.productCount})
                </Link>
              </li>
            ))}
          </ul>
        )}
        <CatalogListing
          action={path}
          catalog={catalog}
          query={query}
          result={result}
          emptyMessage="Nothing is listed in this category yet."
        />
      </StoreSection>
    </>
  )
}
