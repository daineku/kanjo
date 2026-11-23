'use client'

import Link from 'next/link'
import { useState } from 'react'

import { postStore, rememberOrderToken } from '@/lib/store/browser'
import { sortCountries } from '@/lib/store/countries'
import type { CartQuote, CheckoutResponse, StoreSettingsPublic } from '@/lib/store/types'

import { CartLines, CountrySelect, CustomsDisclosure, ShippingChoices, Totals } from './CartParts'
import { useCartQuote } from './useCartQuote'

/**
 * Checkout: address, shipping choice, terms — then the processor's hosted page.
 *
 * Card details are never entered on this site. The form posts SKUs, an address
 * and a shipping option ID; the backend prices everything again, creates the
 * order and returns the processor's URL. The order's access token is kept on
 * this device (localStorage, keyed by reference) so the confirmation page can
 * show the order without putting the token in a URL.
 */
export function CheckoutForm({ settings }: { settings: StoreSettingsPublic }) {
  const countries = sortCountries(settings.shippingCountries)
  const [country, setCountry] = useState(countries.length === 1 ? countries[0]! : '')
  const [shippingId, setShippingId] = useState<string>('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { items, quote, error, setQuote } = useCartQuote(country)

  if (items === null) return <p className="k-small k-store-placeholder">LOADING CART</p>

  if (items.length === 0) {
    return (
      <div className="k-store-empty">
        <p className="k-body">Your cart is empty.</p>
        <Link href="/parts" prefetch={false} className="k-link-action k-small">
          BROWSE PARTS
        </Link>
      </div>
    )
  }

  if (!settings.checkoutEnabled) {
    return (
      <div className="k-store-notice" data-tone="warning">
        <p className="k-small k-store-notice-title">ONLINE ORDERING IS NOT OPEN YET</p>
        <div className="k-store-notice-body">
          <p>{settings.checkoutDisabledMessage ?? 'Payment is not available yet. Your cart is saved on this device.'}</p>
          <Link href="/cart" prefetch={false} className="k-link-action k-small">
            BACK TO CART
          </Link>
        </div>
      </div>
    )
  }

  const shipping = quote?.shippingOptions.find((option) => option.id === shippingId)

  async function submit(form: HTMLFormElement) {
    const data = new FormData(form)
    const value = (name: string) => String(data.get(name) ?? '').trim()
    setSubmitting(true)
    setMessage(null)
    setFields({})

    const result = await postStore<CheckoutResponse>('/api/store/checkout', {
      items,
      email: value('email'),
      address: {
        name: value('name'),
        line1: value('line1'),
        line2: value('line2') || undefined,
        city: value('city'),
        region: value('region') || undefined,
        postalCode: value('postalCode') || undefined,
        country,
        phone: value('phone') || undefined,
      },
      shippingOptionId: shippingId,
      customerNote: value('customerNote') || undefined,
      acceptTerms: data.get('acceptTerms') === 'on',
    })

    if (result.error || !result.data?.checkoutUrl) {
      setSubmitting(false)
      setMessage(result.error?.message ?? 'Checkout could not be started.')
      if (result.error?.fields) setFields(result.error.fields)
      const changed = (result.data as { error?: { quote?: CartQuote } } | null)?.error?.quote
      if (changed) setQuote(changed)
      return
    }

    rememberOrderToken(result.data.reference, result.data.accessToken)
    window.location.assign(result.data.checkoutUrl)
  }

  const err = (name: string) =>
    fields[name] ? (
      <span className="k-small k-store-field-error" id={`err-${name}`}>
        {fields[name]}
      </span>
    ) : null

  return (
    <form
      className="k-store-checkout"
      onSubmit={(event) => {
        event.preventDefault()
        if (!submitting) void submit(event.currentTarget)
      }}
      noValidate
    >
      {settings.paymentTestMode && (
        <div className="k-store-notice" data-tone="warning" role="note">
          <p className="k-small k-store-notice-title">TEST MODE</p>
          <div className="k-store-notice-body">
            <p>Payments are in test mode. No real payment will be taken and no order will be fulfilled.</p>
          </div>
        </div>
      )}

      <div className="k-store-checkout-grid">
        <div className="k-store-checkout-main">
          <fieldset className="k-store-fieldset">
            <legend className="k-small">CONTACT</legend>
            <label className="k-store-field">
              <span className="k-small">EMAIL</span>
              <input type="email" name="email" autoComplete="email" required maxLength={254} aria-describedby={fields.email ? 'err-email' : undefined} />
              {err('email')}
            </label>
          </fieldset>

          <fieldset className="k-store-fieldset">
            <legend className="k-small">SHIPPING ADDRESS</legend>
            {countries.length > 0 ? (
              <CountrySelect
                countries={countries}
                value={country}
                required
                onChange={(next) => {
                  setCountry(next)
                  setShippingId('')
                }}
              />
            ) : (
              <p className="k-small">No shipping destinations are confirmed yet.</p>
            )}
            {err('address.country')}
            <label className="k-store-field">
              <span className="k-small">FULL NAME</span>
              <input name="name" autoComplete="shipping name" required maxLength={120} />
              {err('address.name')}
            </label>
            <label className="k-store-field">
              <span className="k-small">ADDRESS LINE 1</span>
              <input name="line1" autoComplete="shipping address-line1" required maxLength={160} />
              {err('address.line1')}
            </label>
            <label className="k-store-field">
              <span className="k-small">ADDRESS LINE 2 (OPTIONAL)</span>
              <input name="line2" autoComplete="shipping address-line2" maxLength={160} />
            </label>
            <div className="k-store-field-row">
              <label className="k-store-field">
                <span className="k-small">CITY</span>
                <input name="city" autoComplete="shipping address-level2" required maxLength={100} />
                {err('address.city')}
              </label>
              <label className="k-store-field">
                <span className="k-small">STATE / REGION</span>
                <input name="region" autoComplete="shipping address-level1" maxLength={100} />
              </label>
              <label className="k-store-field">
                <span className="k-small">POSTCODE</span>
                <input name="postalCode" autoComplete="shipping postal-code" maxLength={20} />
              </label>
            </div>
            <label className="k-store-field">
              <span className="k-small">PHONE (FOR THE CARRIER)</span>
              <input name="phone" type="tel" autoComplete="shipping tel" maxLength={40} />
            </label>
          </fieldset>

          {quote && country && (
            <>
              <ShippingChoices quote={quote} selectable selected={shippingId} onSelect={setShippingId} />
              {err('shippingOptionId')}
            </>
          )}

          <label className="k-store-field">
            <span className="k-small">ORDER NOTE (OPTIONAL)</span>
            <textarea name="customerNote" rows={3} maxLength={1000} />
          </label>
        </div>

        <aside className="k-store-checkout-side" aria-label="Order summary">
          {error && (
            <p className="k-small k-store-error" role="alert">
              {error}
            </p>
          )}
          {quote ? (
            <>
              <CartLines quote={quote} editable={false} />
              <Totals quote={quote} shipping={shipping} />
              <CustomsDisclosure text={quote.customsDisclosure ?? settings.customsDisclosure} handlingDays={quote.handlingDays} />
            </>
          ) : (
            <p className="k-small k-store-placeholder">CHECKING PRICES AND STOCK</p>
          )}

          <label className="k-store-check">
            <input type="checkbox" name="acceptTerms" required />
            <span>
              I accept the{' '}
              <Link href="/policies/terms-of-sale" prefetch={false} target="_blank">
                Terms of Sale
              </Link>
              ,{' '}
              <Link href="/policies/shipping" prefetch={false} target="_blank">
                Shipping Policy
              </Link>{' '}
              and{' '}
              <Link href="/policies/returns" prefetch={false} target="_blank">
                Returns Policy
              </Link>
              , and understand that import duties and taxes may be payable on delivery.
            </span>
          </label>
          {err('acceptTerms')}

          {message && (
            <p className="k-small k-store-error" role="alert">
              {message}
            </p>
          )}

          <button
            type="submit"
            className="k-store-button k-store-button--block"
            disabled={submitting || !quote?.canCheckout || !shipping}
          >
            {submitting ? 'STARTING SECURE PAYMENT' : 'CONTINUE TO SECURE PAYMENT'}
          </button>
          {quote && !quote.canCheckout && (
            <p className="k-small k-store-line-issue">
              Some items cannot be ordered as they are.{' '}
              <Link href="/cart" prefetch={false}>
                Review your cart
              </Link>
              .
            </p>
          )}
          {quote?.canCheckout && !shipping && <p className="k-small">Choose a destination and a shipping option to continue.</p>}
          <p className="k-small k-store-fineprint">
            Payment is taken on the payment provider&apos;s secure page. Card details are never entered on or stored by
            this site.
          </p>
        </aside>
      </div>
    </form>
  )
}
