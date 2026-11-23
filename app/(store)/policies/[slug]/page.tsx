import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { Notice, StoreSection, StoreUnavailable } from '@/components/store/StoreChrome'
import { formatDate } from '@/lib/format'
import { renderRichText } from '@/lib/richText'
import { STORE_NAME, storePageMetadata } from '@/lib/seo/store'
import { getStorePages } from '@/lib/store/client'
import { loadStorePage } from '@/lib/store/page'

type Props = { params: Promise<{ slug: string }> }

/**
 * /policies/[slug] — Terms of Sale, Shipping, Returns, Privacy, Contact.
 *
 * A policy is a legal statement by the merchant. Until the merchant has signed
 * it off (`legalReviewed` in the CMS) it renders under a DRAFT banner and is
 * kept out of the index — publishing a page and approving its content are
 * deliberately two different actions.
 */

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const { settings } = await loadStorePage()
  const page = (await getStorePages())?.find((entry) => entry.slug === slug)
  if (!page) return { title: STORE_NAME, robots: { index: false } }
  return storePageMetadata(settings, {
    title: page.title,
    description: `${page.title} for ${STORE_NAME}.`,
    path: `/policies/${page.slug}`,
    noIndex: !page.legalReviewed,
  })
}

export default async function PolicyPage({ params }: Props) {
  const { slug } = await params
  await loadStorePage()
  const pages = await getStorePages()
  if (!pages) return <StoreUnavailable />
  const page = pages.find((entry) => entry.slug === slug)
  if (!page) notFound()

  return (
    <StoreSection
      id="policy"
      level={1}
      eyebrow={
        page.effectiveDate ? `EFFECTIVE ${formatDate(page.effectiveDate).toUpperCase()}` : STORE_NAME
      }
      heading={page.title.toUpperCase()}
    >
      {!page.legalReviewed && (
        <Notice tone="warning" title="DRAFT - PENDING MERCHANT AND LEGAL REVIEW">
          <p>
            This policy has not yet been approved by the merchant and is not a final statement of terms. It may change
            before the store opens for orders.
          </p>
        </Notice>
      )}
      <div className="k-body k-prose k-rt">{renderRichText(page.body)}</div>
    </StoreSection>
  )
}
