import Image from 'next/image'
import Link from 'next/link'

import type { FitmentMatch } from '@/lib/store/filter'
import type { ProductSummary } from '@/lib/store/types'

import { AuthenticityBadge, AvailabilityBadge, ConditionBadge, FitmentBadge, Price, SampleBadge } from './Badges'

/**
 * One product in a grid.
 *
 * A server component with no state: the whole card is one link, the image is
 * lazy unless the caller says it is above the fold, and its box is reserved by
 * aspect-ratio so nothing shifts when it arrives. No hover swap to a second
 * image — that is a request per hover, which the media rules forbid.
 */
export function ProductCard({
  product,
  fitment,
  priority = false,
}: {
  product: ProductSummary
  fitment?: FitmentMatch
  priority?: boolean
}) {
  return (
    <Link href={`/parts/${product.slug}`} prefetch={false} className="k-store-card">
      <span className="k-store-card-media">
        {product.image ? (
          <Image
            src={product.image.url}
            alt={product.image.alt}
            width={product.image.width}
            height={product.image.height}
            sizes="(max-width: 599px) 50vw, (max-width: 1023px) 33vw, 300px"
            priority={priority}
            loading={priority ? undefined : 'lazy'}
          />
        ) : (
          <span className="k-small k-store-card-noimage">NO PHOTO YET</span>
        )}
        {product.isSample && (
          <span className="k-store-card-flag">
            <SampleBadge />
          </span>
        )}
      </span>
      <span className="k-store-card-body">
        {product.brand && <span className="k-small k-store-card-brand">{product.brand}</span>}
        <span className="k-item-title k-store-card-title">{product.name}</span>
        <Price price={product.price} compareAt={product.compareAtPrice} from={product.priceVaries} />
        <span className="k-store-chips">
          <AuthenticityBadge value={product.authenticity} />
          <ConditionBadge value={product.condition} />
          <AvailabilityBadge value={product.availability} />
          {fitment && <FitmentBadge value={fitment} />}
        </span>
      </span>
    </Link>
  )
}

export function ProductGrid({
  products,
  fitment,
  priorityCount = 0,
}: {
  products: ProductSummary[]
  fitment?: Record<string, FitmentMatch>
  priorityCount?: number
}) {
  return (
    <ul className="k-store-grid">
      {products.map((product, index) => (
        <li key={product.slug}>
          <ProductCard product={product} fitment={fitment?.[product.slug]} priority={index < priorityCount} />
        </li>
      ))}
    </ul>
  )
}
