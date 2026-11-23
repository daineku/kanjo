import {
  AUTHENTICITY_DETAIL,
  AUTHENTICITY_LABEL,
  AVAILABILITY_LABEL,
  CONDITION_LABEL,
  FITMENT_LABEL,
} from '@/lib/store/labels'
import type { Authenticity, AvailabilityState, ProductCondition } from '@/lib/store/types'
import type { FitmentMatch } from '@/lib/store/filter'
import { formatMoney } from '@/lib/store/money'
import type { Money } from '@/lib/store/types'

/**
 * The small, repeated claims on every product surface.
 *
 * Each one is TEXT, not colour alone: a red chip that only means "replica" to
 * someone who can see red is not a disclosure. The authenticity chip in
 * particular is a statement of what the customer is buying, so it is always
 * rendered and never hidden behind a hover.
 */

const AUTHENTICITY_TONE: Record<Authenticity, 'genuine' | 'neutral' | 'warning'> = {
  genuine_oem: 'genuine',
  genuine_aftermarket: 'genuine',
  third_party_replacement: 'neutral',
  custom_made: 'neutral',
  replica_reproduction: 'warning',
  unverified: 'warning',
}

export function AuthenticityBadge({ value, detailed = false }: { value: Authenticity; detailed?: boolean }) {
  return (
    <span className="k-store-auth" data-tone={AUTHENTICITY_TONE[value]}>
      <span className="k-small k-store-auth-label">{AUTHENTICITY_LABEL[value]}</span>
      {detailed && <span className="k-store-auth-detail">{AUTHENTICITY_DETAIL[value]}</span>}
    </span>
  )
}

const AVAILABLE: ReadonlySet<AvailabilityState> = new Set(['in_stock', 'low_stock', 'made_to_order', 'source_on_demand'])

export function AvailabilityBadge({ value }: { value: AvailabilityState }) {
  return (
    <span className="k-small k-store-chip" data-state={AVAILABLE.has(value) ? 'available' : 'unavailable'}>
      {AVAILABILITY_LABEL[value]}
    </span>
  )
}

export function ConditionBadge({ value }: { value: ProductCondition }) {
  return <span className="k-small k-store-chip">{CONDITION_LABEL[value]}</span>
}

export function FitmentBadge({ value }: { value: FitmentMatch }) {
  return (
    <span className="k-small k-store-chip" data-fit={value}>
      {FITMENT_LABEL[value]}
    </span>
  )
}

export function SampleBadge() {
  return <span className="k-small k-store-sample">SAMPLE - NOT FOR SALE</span>
}

export function Price({
  price,
  compareAt,
  from = false,
  size = 'md',
}: {
  price?: Money
  compareAt?: Money
  from?: boolean
  size?: 'md' | 'lg'
}) {
  if (!price) {
    return <span className="k-small k-store-price-none">PRICE ON REQUEST</span>
  }
  return (
    <span className={`k-store-price k-store-price--${size}`}>
      {from && <span className="k-small">FROM </span>}
      <span className="k-store-price-value">{formatMoney(price)}</span>
      {compareAt && compareAt.amount > price.amount && (
        <s className="k-small k-store-price-was" aria-label={`Was ${formatMoney(compareAt)}`}>
          {formatMoney(compareAt)}
        </s>
      )}
    </span>
  )
}

/** "RATED 4.6 / 5 (12 REVIEWS)" — no star glyphs: Iceland has none. */
export function RatingLine({ rating }: { rating?: { average: number; count: number } }) {
  if (!rating || rating.count === 0) return null
  return (
    <span className="k-small k-store-rating">
      RATED {rating.average.toFixed(1)} / 5 ({rating.count} {rating.count === 1 ? 'REVIEW' : 'REVIEWS'})
    </span>
  )
}
