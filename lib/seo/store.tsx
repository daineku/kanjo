import type { Metadata } from 'next'

import type { SiteSettings } from '@/lib/content/types'
import { moneyDecimal } from '@/lib/store/money'
import type {
  AvailabilityState,
  ProductCondition,
  ProductDetail,
  StoreImage,
  StoreReview,
} from '@/lib/store/types'

import { absoluteUrl, siteOrigin } from './metadata'
import { JsonLd } from './structuredData'

/**
 * Metadata and structured data for THE KANJO PARTS.
 *
 * The site-wide rule holds here with more at stake: A FIELD IS EMITTED ONLY IF
 * IT IS TRUE AND CONFIGURED. Product markup is a machine-readable offer — a
 * price, an availability, a condition, a rating — that a search engine shows to
 * buyers as fact. So:
 *
 *   - no `offers` at all when the product has no online price;
 *   - availability is mapped from the backend's LIVE state, not the editor's
 *     intention;
 *   - `aggregateRating` and `review` only when approved reviews exist, from
 *     exactly those reviews — never a default, never a seeded number;
 *   - no Product node at all for a development sample.
 */

export const STORE_NAME = 'THE KANJO PARTS'

export function storePageMetadata(
  settings: SiteSettings,
  {
    title,
    description,
    path,
    noIndex = false,
    image,
    canonical,
  }: {
    title: string
    description: string
    path: string
    noIndex?: boolean
    image?: StoreImage
    /** Defaults to `path`. A filtered view passes the unfiltered page. */
    canonical?: string
  },
): Metadata {
  const images = image
    ? [{ url: image.url, width: image.width, height: image.height, alt: image.alt || undefined }]
    : undefined
  return {
    title,
    description,
    alternates: { canonical: canonical ?? path },
    openGraph: {
      type: 'website',
      title,
      description,
      url: absoluteUrl(settings, path),
      siteName: settings.title,
      ...(images ? { images } : {}),
    },
    twitter: {
      card: images ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(images ? { images: images.map((entry) => entry.url) } : {}),
    },
    ...(noIndex ? { robots: { index: false, follow: true } } : {}),
  }
}

/** For checkout, orders, cart: never indexed, and links not followed into. */
export const PRIVATE_ROBOTS: Metadata['robots'] = { index: false, follow: false }

const AVAILABILITY_SCHEMA: Record<AvailabilityState, string | null> = {
  in_stock: 'https://schema.org/InStock',
  low_stock: 'https://schema.org/LimitedAvailability',
  made_to_order: 'https://schema.org/MadeToOrder',
  source_on_demand: 'https://schema.org/BackOrder',
  // Not purchasable online: no offer is asserted.
  on_request: null,
  out_of_stock: 'https://schema.org/OutOfStock',
  coming_soon: 'https://schema.org/PreOrder',
  discontinued: 'https://schema.org/Discontinued',
}

const CONDITION_SCHEMA: Record<ProductCondition, string> = {
  new: 'https://schema.org/NewCondition',
  new_old_stock: 'https://schema.org/NewCondition',
  used_excellent: 'https://schema.org/UsedCondition',
  used_good: 'https://schema.org/UsedCondition',
  used_fair: 'https://schema.org/UsedCondition',
  refurbished: 'https://schema.org/RefurbishedCondition',
}

export function ProductStructuredData({
  settings,
  product,
  reviews,
}: {
  settings: SiteSettings
  product: ProductDetail
  reviews: StoreReview[]
}) {
  if (product.isSample) return null

  const url = absoluteUrl(settings, `/parts/${product.slug}`)
  const images = [product.image, ...product.gallery]
    .filter((image): image is StoreImage => Boolean(image))
    .map((image) => image.url)
  const availability = AVAILABILITY_SCHEMA[product.availability]

  const offer =
    product.price && availability
      ? {
          offers: {
            '@type': 'Offer',
            url,
            price: moneyDecimal(product.price),
            priceCurrency: product.price.currency,
            availability,
            itemCondition: CONDITION_SCHEMA[product.condition],
          },
        }
      : {}

  const rating =
    product.rating && product.rating.count > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: product.rating.average.toFixed(1),
            reviewCount: product.rating.count,
            bestRating: 5,
            worstRating: 1,
          },
          ...(reviews.length > 0
            ? {
                review: reviews.slice(0, 5).map((review) => ({
                  '@type': 'Review',
                  reviewRating: { '@type': 'Rating', ratingValue: review.rating, bestRating: 5, worstRating: 1 },
                  author: { '@type': 'Person', name: review.authorName },
                  datePublished: review.submittedAt.slice(0, 10),
                  reviewBody: review.body,
                  ...(review.title ? { name: review.title } : {}),
                })),
              }
            : {}),
        }
      : {}

  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'Product',
        '@id': `${url}#product`,
        name: product.name,
        sku: product.sku,
        url,
        ...(product.shortDescription || product.seoDescription
          ? { description: product.seoDescription ?? product.shortDescription }
          : {}),
        ...(images.length > 0 ? { image: images } : {}),
        ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
        ...(product.manufacturer ? { manufacturer: { '@type': 'Organization', name: product.manufacturer } } : {}),
        ...(product.categoryName ? { category: product.categoryName } : {}),
        ...(product.countryOfOrigin ? { countryOfOrigin: product.countryOfOrigin } : {}),
        ...(product.weightGrams
          ? { weight: { '@type': 'QuantitativeValue', value: product.weightGrams, unitCode: 'GRM' } }
          : {}),
        itemCondition: CONDITION_SCHEMA[product.condition],
        ...offer,
        ...rating,
      }}
    />
  )
}

export type Crumb = { name: string; path: string }

export function BreadcrumbStructuredData({ settings, crumbs }: { settings: SiteSettings; crumbs: Crumb[] }) {
  if (crumbs.length < 2) return null
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((crumb, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: crumb.name,
          item: absoluteUrl(settings, crumb.path),
        })),
      }}
    />
  )
}

/**
 * The store as an entity, on /parts only.
 *
 * Name, URL and description — the three things that are configured. No
 * address, phone, legal entity, return policy or shipping policy markup: none
 * of those has been confirmed by the merchant, and stating them in a format
 * built to be trusted would be a false claim.
 */
export function OnlineStoreStructuredData({ settings, description }: { settings: SiteSettings; description: string }) {
  const origin = siteOrigin(settings)
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'OnlineStore',
        '@id': `${origin}/parts#store`,
        name: STORE_NAME,
        url: `${origin}/parts`,
        description,
        isPartOf: { '@id': `${origin}/#website` },
      }}
    />
  )
}
