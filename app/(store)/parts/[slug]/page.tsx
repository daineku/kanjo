import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'

import { AddToCart, type BuyOption } from '@/components/store/AddToCart'
import {
  AuthenticityBadge,
  AvailabilityBadge,
  ConditionBadge,
  FitmentBadge,
  Price,
  RatingLine,
  SampleBadge,
} from '@/components/store/Badges'
import { ProductGrid } from '@/components/store/ProductCard'
import { ReportReview, ReviewForm } from '@/components/store/ReviewForms'
import { Breadcrumbs, Notice, StoreSection, StoreUnavailable } from '@/components/store/StoreChrome'
import { renderRichText } from '@/lib/richText'
import { ProductStructuredData, STORE_NAME, storePageMetadata } from '@/lib/seo/store'
import { findRedirect, getProduct, getProductReviews } from '@/lib/store/client'
import { countryName } from '@/lib/store/countries'
import { categoryTrail, relatedProducts } from '@/lib/store/filter'
import { AVAILABILITY_LABEL } from '@/lib/store/labels'
import { loadStorePage } from '@/lib/store/page'
import type { ProductDetail } from '@/lib/store/types'

type Props = { params: Promise<{ slug: string }> }

/**
 * /parts/[slug] — one product.
 *
 * Rendered on the server and cached (ISR, tagged per product), so the page a
 * crawler and a first visit receive is the finished document. The only client
 * code is the buy box and the review forms.
 *
 * What a buyer is told explicitly, never by implication:
 *   - what the part IS (authenticity, condition), in words, above the fold;
 *   - what it FITS, as a table of recorded fitments with a status per row;
 *   - when it ships and that duties may apply.
 */

export const revalidate = 300

export async function generateStaticParams() {
  // Rendered on first request and then cached; nothing is built ahead.
  return []
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const { settings } = await loadStorePage()
  const lookup = await getProduct(slug)
  if (lookup.state !== 'found') return { title: STORE_NAME, robots: { index: false } }
  const product = lookup.product
  const title = product.seoTitle ?? [product.brand, product.name].filter(Boolean).join(' ')
  return storePageMetadata(settings, {
    title,
    description:
      product.seoDescription ??
      product.shortDescription ??
      `${product.name}${product.brand ? ` by ${product.brand}` : ''} at ${STORE_NAME}.`,
    path: `/parts/${product.slug}`,
    canonical: safeCanonical(product.canonicalUrl) ?? `/parts/${product.slug}`,
    noIndex: product.noIndex || product.isSample,
    image: product.image,
  })
}

/** A canonical override is honoured only as a path on this site, or an https URL. */
function safeCanonical(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (/^\/[^/\\]/.test(value)) return value
  return /^https:\/\/[^\s]+$/.test(value) ? value : undefined
}

function buyOptions(product: ProductDetail): BuyOption[] {
  if (product.variants.length > 0) {
    return product.variants.map((variant) => ({
      sku: variant.sku,
      label: variant.label,
      price: variant.price,
      compareAtPrice: variant.compareAtPrice,
      availability: variant.availability,
      purchasable: variant.purchasable,
      maxQuantity: variant.maxQuantity,
    }))
  }
  return [
    {
      sku: product.sku,
      label: product.name,
      price: product.price,
      compareAtPrice: product.compareAtPrice,
      availability: product.availability,
      purchasable: product.purchasable,
      maxQuantity: product.maxQuantity,
    },
  ]
}

function yearRange(from: number, to?: number) {
  return to ? (from === to ? `${from}` : `${from}-${to}`) : `${from} onward`
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params
  const { settings, catalog } = await loadStorePage()
  const lookup = await getProduct(slug)

  if (lookup.state === 'unavailable') return <StoreUnavailable />
  if (lookup.state === 'missing') {
    if (lookup.redirectTo) permanentRedirect(lookup.redirectTo)
    const redirect = await findRedirect(`/parts/${slug}`)
    if (redirect) permanentRedirect(redirect.toPath)
    notFound()
  }

  const product = lookup.product
  const reviews = catalog?.settings.reviewsEnabled !== false ? await getProductReviews(product.slug) : { reviews: [] }
  const checkoutEnabled = catalog?.settings.checkoutEnabled ?? false
  const trail = catalog && product.categorySlug ? categoryTrail(catalog.categories, product.categorySlug) : []
  const summary = catalog?.products.find((entry) => entry.slug === product.slug)
  const relatedBySlug = catalog
    ? product.relatedSlugs
        .map((relatedSlug) => catalog.products.find((entry) => entry.slug === relatedSlug))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    : []
  const related =
    relatedBySlug.length > 0 ? relatedBySlug.slice(0, 4) : catalog && summary ? relatedProducts(catalog, summary) : []
  const gallery = [product.image, ...product.gallery].filter(
    (image, index, all): image is NonNullable<typeof image> =>
      Boolean(image) && all.findIndex((other) => other?.url === image?.url) === index,
  )
  const handling = product.handlingDays

  return (
    <>
      <ProductStructuredData settings={settings} product={product} reviews={reviews.reviews} />
      <div className="k-shell">
        <Breadcrumbs
          settings={settings}
          crumbs={[
            { name: 'Parts', path: '/parts' },
            ...trail.map((entry) => ({ name: entry.name, path: `/parts/category/${entry.slug}` })),
            { name: product.name, path: `/parts/${product.slug}` },
          ]}
        />
      </div>

      <article className="k-store-product" aria-labelledby="product-title">
        <div className="k-shell k-store-product-grid">
          <div className="k-store-gallery">
            {gallery.length > 0 ? (
              <>
                <div className="k-store-gallery-main">
                  <Image
                    src={gallery[0]!.url}
                    alt={gallery[0]!.alt || product.name}
                    width={gallery[0]!.width}
                    height={gallery[0]!.height}
                    sizes="(max-width: 899px) 100vw, 640px"
                    priority
                  />
                </div>
                {gallery.length > 1 && (
                  <ul className="k-store-gallery-rest">
                    {gallery.slice(1).map((image) => (
                      <li key={image.url}>
                        <a href={image.url} target="_blank" rel="noopener noreferrer">
                          <Image
                            src={image.url}
                            alt={image.alt}
                            width={image.width}
                            height={image.height}
                            sizes="(max-width: 899px) 33vw, 200px"
                            loading="lazy"
                          />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <div className="k-store-gallery-main k-store-card-noimage">
                <span className="k-small">NO PHOTO YET</span>
              </div>
            )}
          </div>

          <div className="k-store-buybox">
            {product.isSample && (
              <Notice tone="warning" title="SAMPLE - NOT FOR SALE">
                <p>This is illustrative development data, not a real product. It cannot be ordered.</p>
              </Notice>
            )}
            {product.brand && (
              <p className="k-small">
                {product.brandSlug ? (
                  <Link href={`/parts/search?brand=${product.brandSlug}`} prefetch={false}>
                    {product.brand}
                  </Link>
                ) : (
                  product.brand
                )}
              </p>
            )}
            <h1 id="product-title" className="k-section-title k-store-product-title">
              {product.name}
            </h1>
            <RatingLine rating={product.rating} />
            <Price price={product.price} compareAt={product.compareAtPrice} from={product.priceVaries} size="lg" />
            <p className="k-small">SKU {product.sku}</p>

            <AuthenticityBadge value={product.authenticity} detailed />

            <div className="k-store-chips">
              <ConditionBadge value={product.condition} />
              <AvailabilityBadge value={product.availability} />
              {product.isSample && <SampleBadge />}
              {product.universalFit && <FitmentBadge value="universal" />}
            </div>

            {product.shortDescription && <p className="k-body">{product.shortDescription}</p>}

            <AddToCart options={buyOptions(product)} checkoutEnabled={checkoutEnabled} isSample={product.isSample} />

            <dl className="k-store-facts">
              <div>
                <dt className="k-small">DISPATCH</dt>
                <dd>
                  {product.availability === 'made_to_order'
                    ? `Made to order. Expected dispatch within ${handling} business days of payment.`
                    : product.availability === 'source_on_demand'
                      ? `Sourced after your order. Expected dispatch within ${handling} business days of payment.`
                      : `${AVAILABILITY_LABEL[product.availability]}. Expected dispatch within ${handling} business days of payment.`}
                </dd>
              </div>
              <div>
                <dt className="k-small">SHIPPING</dt>
                <dd>
                  {product.internationalShipping
                    ? 'Ships from Thailand. Rates are shown in the cart for confirmed destinations. Import duties and taxes may apply.'
                    : 'Not eligible for international shipping. Ask us about collection or local delivery.'}
                </dd>
              </div>
              {product.countryOfOrigin && (
                <div>
                  <dt className="k-small">COUNTRY OF ORIGIN</dt>
                  <dd>{countryName(product.countryOfOrigin)}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        <StoreSection id="fitment" eyebrow="COMPATIBILITY" heading="VEHICLE FITMENT">
          {product.fitmentDetails.length === 0 ? (
            <p className="k-body">
              {product.universalFit
                ? 'Universal: not specific to one vehicle. Check the dimensions and specifications before ordering.'
                : 'No vehicle fitment has been recorded for this part. Do not assume it fits your car; ask us before ordering.'}
            </p>
          ) : (
            <div className="k-store-table-wrap">
              <table className="k-store-table">
                <thead>
                  <tr>
                    <th scope="col">VEHICLE</th>
                    <th scope="col">YEARS</th>
                    <th scope="col">FITMENT</th>
                    <th scope="col">NOTES</th>
                  </tr>
                </thead>
                <tbody>
                  {product.fitmentDetails.map((fitment, index) => (
                    <tr key={`${fitment.vehicleSlug}-${index}`}>
                      <th scope="row">
                        {fitment.make} {fitment.model} {fitment.chassisCode}
                        {fitment.bodyStyle ? ` (${fitment.bodyStyle})` : ''}
                      </th>
                      <td>{yearRange(fitment.yearFrom, fitment.yearTo)}</td>
                      <td>
                        <FitmentBadge value={fitment.status} />
                      </td>
                      <td>
                        {[
                          fitment.engine && `Engine: ${fitment.engine}`,
                          fitment.market && `Market: ${fitment.market}`,
                          fitment.installationRequirements && `Installation: ${fitment.installationRequirements}`,
                          fitment.notes,
                        ]
                          .filter(Boolean)
                          .join('. ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="k-small k-store-fit-note">
            CONFIRMED: checked against the vehicle. CONDITIONAL: fits with the noted requirement. UNVERIFIED: reported but
            not yet checked by us.
          </p>
        </StoreSection>

        {(product.description || product.specifications.length > 0) && (
          <StoreSection id="details" eyebrow="DETAILS" heading="DESCRIPTION AND SPECIFICATIONS">
            {product.description && <div className="k-body k-prose k-rt">{renderRichText(product.description)}</div>}
            {(product.specifications.length > 0 || product.weightGrams || product.dimensionsMm) && (
              <dl className="k-store-specs">
                {product.specifications.map((spec) => (
                  <div key={spec.label}>
                    <dt className="k-small">{spec.label}</dt>
                    <dd>{spec.value}</dd>
                  </div>
                ))}
                {product.manufacturer && (
                  <div>
                    <dt className="k-small">MANUFACTURER</dt>
                    <dd>{product.manufacturer}</dd>
                  </div>
                )}
                {product.weightGrams ? (
                  <div>
                    <dt className="k-small">SHIPPING WEIGHT</dt>
                    <dd>{(product.weightGrams / 1000).toFixed(2)} kg</dd>
                  </div>
                ) : null}
                {product.dimensionsMm && (product.dimensionsMm.length || product.dimensionsMm.width || product.dimensionsMm.height) ? (
                  <div>
                    <dt className="k-small">PACKED DIMENSIONS</dt>
                    <dd>
                      {[product.dimensionsMm.length, product.dimensionsMm.width, product.dimensionsMm.height]
                        .map((value) => (value ? `${value}` : '-'))
                        .join(' x ')}{' '}
                      mm
                    </dd>
                  </div>
                ) : null}
              </dl>
            )}
          </StoreSection>
        )}

        {catalog?.settings.reviewsEnabled !== false && (
          <StoreSection id="reviews" eyebrow="CUSTOMERS" heading="REVIEWS">
            {reviews.summary && reviews.summary.count > 0 ? (
              <p className="k-small">
                AVERAGE {reviews.summary.average.toFixed(1)} / 5 FROM {reviews.summary.count}{' '}
                {reviews.summary.count === 1 ? 'REVIEW' : 'REVIEWS'}
              </p>
            ) : (
              <p className="k-body">No reviews yet.</p>
            )}
            {reviews.reviews.length > 0 && (
              <ul className="k-store-reviews">
                {reviews.reviews.map((review) => (
                  <li key={review.id} className="k-store-review">
                    <p className="k-small">
                      {review.rating} / 5 · {review.authorName} · {review.submittedAt.slice(0, 10)}
                      {review.verifiedPurchase && <span className="k-store-verified"> · VERIFIED PURCHASE</span>}
                    </p>
                    {review.title && <p className="k-item-title">{review.title}</p>}
                    <p className="k-body k-store-review-body">{review.body}</p>
                    {review.photos.length > 0 && (
                      <ul className="k-store-review-photos">
                        {review.photos.map((photo) => (
                          <li key={photo.url}>
                            <Image src={photo.url} alt={photo.alt} width={photo.width} height={photo.height} sizes="120px" loading="lazy" />
                          </li>
                        ))}
                      </ul>
                    )}
                    {review.adminReply && (
                      <div className="k-store-review-reply">
                        <p className="k-small">REPLY FROM THE KANJO</p>
                        <p className="k-body">{review.adminReply.body}</p>
                      </div>
                    )}
                    <ReportReview reviewId={review.id} />
                  </li>
                ))}
              </ul>
            )}
            {!product.isSample && <ReviewForm productSlug={product.slug} />}
          </StoreSection>
        )}

        {related.length > 0 && (
          <StoreSection id="related" eyebrow="ALSO CONSIDER" heading="RELATED PARTS">
            <ProductGrid products={related} />
          </StoreSection>
        )}
      </article>
    </>
  )
}
