'use client'

import Link from 'next/link'
import { useState } from 'react'

import { sortCountries } from '@/lib/store/countries'
import type { StoreSettingsPublic } from '@/lib/store/types'

import { CartLines, CountrySelect, CustomsDisclosure, ShippingChoices, Totals } from './CartParts'
import { useCartQuote } from './useCartQuote'

/**
 * The cart page body.
 *
 * Lines, prices and stock come from the backend's quote of the stored SKUs;
 * the shipping estimate is the backend's verified rates for the chosen
 * country, or an honest "no confirmed rate" with a way to ask.
 */
export function CartView({ settings }: { settings: StoreSettingsPublic }) {
  const countries = sortCountries(settings.shippingCountries)
  const [country, setCountry] = useState('')
  const { items, quote, error, loading } = useCartQuote(country)

  if (items === null) {
    return <p className="k-small k-store-placeholder">LOADING CART</p>
  }

  if (items.length === 0) {
    return (
      <div className="k-store-empty">
        <p className="k-body">Your cart is empty.</p>
        <p>
          <Link href="/parts" prefetch={false} className="k-link-action k-small">
            BROWSE PARTS
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="k-store-cart">
      {error && (
        <p className="k-small k-store-error" role="alert">
          {error}
        </p>
      )}
      {!quote ? (
        <p className="k-small k-store-placeholder">{loading ? 'CHECKING PRICES AND STOCK' : 'CART UNAVAILABLE'}</p>
      ) : (
        <>
          <CartLines quote={quote} editable />
          {quote.removedSkus.length > 0 && (
            <p className="k-small k-store-line-issue">
              {quote.removedSkus.length} {quote.removedSkus.length === 1 ? 'item is' : 'items are'} no longer in the
              catalogue and {quote.removedSkus.length === 1 ? 'was' : 'were'} removed.
            </p>
          )}

          <div className="k-store-cart-side">
            {countries.length > 0 ? (
              <CountrySelect countries={countries} value={country} onChange={setCountry} />
            ) : (
              <p className="k-small">SHIPPING DESTINATIONS ARE BEING CONFIRMED. ASK US FOR A QUOTE.</p>
            )}
            {country && <ShippingChoices quote={quote} selectable={false} />}
            <Totals quote={quote} />
            <CustomsDisclosure text={quote.customsDisclosure ?? settings.customsDisclosure} handlingDays={quote.handlingDays} />

            {!quote.checkoutEnabled ? (
              <div className="k-store-notice" data-tone="warning">
                <p className="k-small k-store-notice-title">ONLINE ORDERING IS NOT OPEN YET</p>
                <div className="k-store-notice-body">
                  <p>
                    {settings.checkoutDisabledMessage ??
                      'You can browse the catalogue and keep a cart on this device. Payment is not available yet.'}
                  </p>
                  <p>
                    <Link href="/parts/sourcing" prefetch={false} className="k-link-action k-small">
                      ENQUIRE ABOUT THESE PARTS
                    </Link>
                  </p>
                </div>
              </div>
            ) : quote.canCheckout ? (
              <Link href="/checkout" prefetch={false} className="k-store-button k-store-button--block">
                CONTINUE TO CHECKOUT
              </Link>
            ) : (
              <p className="k-small k-store-line-issue">
                Resolve the items marked above to continue. Items that cannot be ordered can be removed.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
