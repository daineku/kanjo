'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { addToCart } from '@/lib/store/browser'
import { AVAILABILITY_LABEL } from '@/lib/store/labels'
import { formatMoney } from '@/lib/store/money'
import type { AvailabilityState, Money } from '@/lib/store/types'

export type BuyOption = {
  sku: string
  label: string
  price?: Money
  compareAtPrice?: Money
  availability: AvailabilityState
  purchasable: boolean
  maxQuantity?: number
}

/**
 * Variant choice, quantity, and ADD TO CART.
 *
 * Adds a SKU and a quantity to local storage — nothing else. The price shown
 * here is the catalogue's, for orientation; the price charged is computed by
 * the backend at the cart and again at checkout.
 *
 * When checkout is switched off store-wide the button still works and says
 * what it does ("SAVE TO CART"), and the cart explains that ordering is not
 * open yet — a button that silently does nothing is what this avoids.
 */
export function AddToCart({
  options,
  checkoutEnabled,
  isSample,
}: {
  options: BuyOption[]
  checkoutEnabled: boolean
  isSample: boolean
}) {
  const firstBuyable = options.find((option) => option.purchasable) ?? options[0]
  const [sku, setSku] = useState(firstBuyable?.sku ?? '')
  const [quantity, setQuantity] = useState(1)
  const [added, setAdded] = useState(false)

  const selected = useMemo(() => options.find((option) => option.sku === sku) ?? options[0], [options, sku])
  if (!selected) return null

  const max = Math.min(99, selected.maxQuantity ?? 99)
  const canAdd = selected.purchasable && Boolean(selected.price) && !isSample

  return (
    <form
      className="k-store-buy"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canAdd) return
        addToCart(selected.sku, quantity, max)
        setAdded(true)
      }}
    >
      {options.length > 1 && (
        <label className="k-store-field">
          <span className="k-small">OPTION</span>
          <select
            value={sku}
            onChange={(event) => {
              setSku(event.target.value)
              setQuantity(1)
              setAdded(false)
            }}
          >
            {options.map((option) => (
              <option key={option.sku} value={option.sku}>
                {option.label}
                {option.price ? ` - ${formatMoney(option.price)}` : ''}
                {option.purchasable ? '' : ` (${AVAILABILITY_LABEL[option.availability].toLowerCase()})`}
              </option>
            ))}
          </select>
        </label>
      )}

      {options.length > 1 && selected.price && (
        <p className="k-store-price k-store-price--md">
          <span className="k-store-price-value">{formatMoney(selected.price)}</span>
          <span className="k-small"> SKU {selected.sku}</span>
        </p>
      )}

      {canAdd ? (
        <div className="k-store-buy-row">
          <label className="k-store-field k-store-field--narrow">
            <span className="k-small">QTY</span>
            <input
              type="number"
              min={1}
              max={max}
              value={quantity}
              inputMode="numeric"
              onChange={(event) => {
                const next = Math.floor(Number(event.target.value))
                setQuantity(Number.isFinite(next) ? Math.min(max, Math.max(1, next)) : 1)
                setAdded(false)
              }}
            />
          </label>
          <button type="submit" className="k-store-button">
            {checkoutEnabled ? 'ADD TO CART' : 'SAVE TO CART'}
          </button>
        </div>
      ) : (
        <p className="k-small k-store-buy-unavailable">
          {isSample
            ? 'SAMPLE PRODUCT - NOT FOR SALE'
            : !selected.price
              ? 'NO ONLINE PRICE - ASK US FOR A QUOTE'
              : `${AVAILABILITY_LABEL[selected.availability]} - NOT AVAILABLE TO ORDER ONLINE`}
        </p>
      )}

      {!canAdd && !isSample && (
        <Link href="/parts/sourcing" prefetch={false} className="k-link-action k-small">
          REQUEST THIS PART
        </Link>
      )}

      {added && (
        <p className="k-small k-store-buy-added" role="status">
          ADDED.{' '}
          <Link href="/cart" prefetch={false}>
            VIEW CART
          </Link>
          {!checkoutEnabled && ' Online ordering is not open yet; your cart is saved on this device.'}
        </p>
      )}
    </form>
  )
}
