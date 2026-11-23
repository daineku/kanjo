'use client'

import Image from 'next/image'
import Link from 'next/link'

import { setCartQuantity } from '@/lib/store/browser'
import { countryName } from '@/lib/store/countries'
import {
  AVAILABILITY_LABEL,
  CARRIER_LABEL,
  CART_ISSUE_LABEL,
  INCOTERM_DETAIL,
  SHIPPING_UNAVAILABLE_LABEL,
} from '@/lib/store/labels'
import { formatMoney } from '@/lib/store/money'
import type { CartQuote, ShippingOption } from '@/lib/store/types'

/** Shared pieces of the cart and checkout pages. Everything shown comes from the server's quote. */

export function CartLines({ quote, editable }: { quote: CartQuote; editable: boolean }) {
  return (
    <ul className="k-store-lines">
      {quote.lines.map((line) => {
        const max = Math.min(99, line.maxQuantity ?? 99)
        return (
          <li key={line.sku} className="k-store-line" data-problem={line.issues.length > 0 || undefined}>
            <span className="k-store-line-media">
              {line.image ? (
                <Image src={line.image.url} alt={line.image.alt} width={line.image.width} height={line.image.height} sizes="88px" />
              ) : null}
            </span>
            <span className="k-store-line-body">
              <Link href={`/parts/${line.productSlug}`} prefetch={false} className="k-item-title">
                {line.productName}
              </Link>
              <span className="k-small">
                {line.variantLabel ? `${line.variantLabel} · ` : ''}SKU {line.sku} · {AVAILABILITY_LABEL[line.availability]}
                {line.isSample ? ' · SAMPLE - NOT FOR SALE' : ''}
              </span>
              <span className="k-small">
                {formatMoney(line.unitPrice)} EACH
                {line.compareAtUnitPrice && line.compareAtUnitPrice.amount > line.unitPrice.amount && (
                  <s> {formatMoney(line.compareAtUnitPrice)}</s>
                )}
              </span>
              {line.issues.map((issue) => (
                <span key={issue} className="k-small k-store-line-issue">
                  {CART_ISSUE_LABEL[issue]}
                </span>
              ))}
            </span>
            <span className="k-store-line-qty">
              {editable ? (
                <>
                  <label className="k-store-field k-store-field--narrow">
                    <span className="k-visually-hidden">Quantity for {line.productName}</span>
                    <input
                      type="number"
                      min={1}
                      max={max}
                      inputMode="numeric"
                      defaultValue={line.requestedQuantity}
                      key={`${line.sku}-${line.requestedQuantity}`}
                      onBlur={(event) => {
                        const next = Math.floor(Number(event.target.value))
                        if (Number.isFinite(next) && next !== line.requestedQuantity) {
                          setCartQuantity(line.sku, Math.min(max, Math.max(1, next)))
                        }
                      }}
                    />
                  </label>
                  <button type="button" className="k-store-textbutton k-small" onClick={() => setCartQuantity(line.sku, 0)}>
                    REMOVE
                  </button>
                </>
              ) : (
                <span className="k-small">QTY {line.quantity}</span>
              )}
            </span>
            <span className="k-store-line-total">{formatMoney(line.lineTotal)}</span>
          </li>
        )
      })}
    </ul>
  )
}

export function CountrySelect({
  countries,
  value,
  onChange,
  name = 'country',
  required = false,
}: {
  countries: string[]
  value: string
  onChange: (value: string) => void
  name?: string
  required?: boolean
}) {
  return (
    <label className="k-store-field">
      <span className="k-small">SHIP TO</span>
      <select name={name} value={value} required={required} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose a country</option>
        {countries.map((code) => (
          <option key={code} value={code}>
            {countryName(code)}
          </option>
        ))}
      </select>
    </label>
  )
}

export function ShippingChoices({
  quote,
  selected,
  onSelect,
  selectable,
}: {
  quote: CartQuote
  selected?: string
  onSelect?: (id: string) => void
  selectable: boolean
}) {
  if (quote.shippingOptions.length === 0) {
    const reason = quote.shippingUnavailableReason ?? (quote.country ? 'no_verified_rate' : 'no_country')
    return (
      <div className="k-store-shipping-none">
        <p className="k-body">{SHIPPING_UNAVAILABLE_LABEL[reason]}</p>
        {reason !== 'no_country' && (
          <p>
            <Link href="/parts/sourcing" prefetch={false} className="k-link-action k-small">
              ASK FOR A SHIPPING QUOTE
            </Link>
          </p>
        )}
      </div>
    )
  }
  return (
    <fieldset className="k-store-fieldset">
      <legend className="k-small">SHIPPING TO {quote.country ? countryName(quote.country).toUpperCase() : ''}</legend>
      {quote.shippingOptions.map((option: ShippingOption) => (
        <label key={option.id} className="k-store-ship">
          {selectable && (
            <input
              type="radio"
              name="shippingOptionId"
              value={option.id}
              checked={selected === option.id}
              onChange={() => onSelect?.(option.id)}
              required
            />
          )}
          <span className="k-store-ship-body">
            <span className="k-action">
              {CARRIER_LABEL[option.carrier]} - {option.serviceName}
            </span>
            <span className="k-small">
              {option.minDays !== undefined && option.maxDays !== undefined
                ? `ESTIMATED ${option.minDays}-${option.maxDays} DAYS IN TRANSIT AFTER DISPATCH · `
                : ''}
              {option.tracked ? 'TRACKED' : 'UNTRACKED'} · {option.incoterm}
            </span>
            <span className="k-small k-store-ship-incoterm">{INCOTERM_DETAIL[option.incoterm]}</span>
          </span>
          <span className="k-store-ship-price">{formatMoney(option.price)}</span>
        </label>
      ))}
    </fieldset>
  )
}

export function CustomsDisclosure({ text, handlingDays }: { text?: string; handlingDays: number }) {
  return (
    <div className="k-store-notice">
      <p className="k-small k-store-notice-title">CUSTOMS, DUTIES AND DISPATCH</p>
      <div className="k-store-notice-body">
        {text ? (
          <p>{text}</p>
        ) : (
          <p>
            International orders may be charged import duties, taxes and brokerage fees by the destination country. Unless
            a shipping option says DDP, these are not included in the price and are payable by the recipient.
          </p>
        )}
        {handlingDays > 0 && (
          <p>
            Expected dispatch: within {handlingDays} business {handlingDays === 1 ? 'day' : 'days'} of payment, before
            transit time.
          </p>
        )}
      </div>
    </div>
  )
}

export function Totals({ quote, shipping }: { quote: CartQuote; shipping?: ShippingOption }) {
  const total = shipping
    ? { amount: quote.subtotal.amount + shipping.price.amount, currency: quote.subtotal.currency }
    : undefined
  return (
    <dl className="k-store-totals">
      <div>
        <dt className="k-small">SUBTOTAL</dt>
        <dd>{formatMoney(quote.subtotal)}</dd>
      </div>
      <div>
        <dt className="k-small">SHIPPING</dt>
        <dd>{shipping ? formatMoney(shipping.price) : <span className="k-small">CHOOSE AN OPTION</span>}</dd>
      </div>
      {total && (
        <div className="k-store-totals-grand">
          <dt className="k-small">TOTAL</dt>
          <dd>{formatMoney(total)}</dd>
        </div>
      )}
    </dl>
  )
}
