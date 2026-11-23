import type { Metadata } from 'next'
import Link from 'next/link'

import { StoreSection, StoreUnavailable } from '@/components/store/StoreChrome'
import { STORE_NAME, storePageMetadata } from '@/lib/seo/store'
import { getStorePages } from '@/lib/store/client'
import { loadStorePage } from '@/lib/store/page'

export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await loadStorePage()
  return storePageMetadata(settings, {
    title: `Store policies - ${STORE_NAME}`,
    description: `Terms of sale, shipping, returns and privacy for ${STORE_NAME}.`,
    path: '/policies',
  })
}

export default async function PoliciesIndex() {
  await loadStorePage()
  const pages = await getStorePages()
  if (!pages) return <StoreUnavailable />
  return (
    <StoreSection id="policies" level={1} eyebrow={STORE_NAME} heading="STORE POLICIES">
      {pages.length === 0 ? (
        <p className="k-body">Store policies are being prepared.</p>
      ) : (
        <ul className="k-store-policy-list">
          {pages.map((page) => (
            <li key={page.slug}>
              <Link href={`/policies/${page.slug}`} prefetch={false} className="k-store-category">
                <span className="k-item-title">{page.title}</span>
                {!page.legalReviewed && <span className="k-small k-store-sample">DRAFT</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </StoreSection>
  )
}
