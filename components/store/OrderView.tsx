'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { orderToken, postStore, rememberOrderToken } from '@/lib/store/browser'
import { countryName } from '@/lib/store/countries'
import { CARRIER_LABEL, INCOTERM_DETAIL, ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL } from '@/lib/store/labels'
import { formatMoney } from '@/lib/store/money'
import type { OrderPublic } from '@/lib/store/types'

/**
 * One order, for whoever can prove it is theirs.
 *
 * Proof is the access token issued at checkout (kept on this device, or carried
 * once in a `?t=` link from the confirmation email) or the email address the
 * order was placed with. Both go to the backend in a POST body. The page is
 * `noindex, nofollow` and the server renders only the shell.
 */
export function OrderView({ reference, linkToken }: { reference: string; linkToken?: string }) {
  const [order, setOrder] = useState<OrderPublic | null>(null)
  const [state, setState] = useState<'checking' | 'need-email' | 'loaded'>('checking')
  const [message, setMessage] = useState<string | null>(null)

  const lookup = useCallback(
    async (credentials: { token: string } | { email: string }) => {
      const result = await postStore<{ order: OrderPublic }>('/api/store/orders/lookup', { reference, ...credentials })
      if (result.data && !result.error && result.data.order) {
        setOrder(result.data.order)
        setState('loaded')
        if ('token' in credentials) rememberOrderToken(reference, credentials.token)
        return true
      }
      setMessage(result.error?.message ?? 'The order could not be found.')
      return false
    },
    [reference],
  )

  useEffect(() => {
    const token = linkToken ?? orderToken(reference)
    if (!token) {
      setState('need-email')
      return
    }
    // Drop the token from the address bar once read, so it does not linger in
    // history or get shared with a screenshot of the URL.
    if (linkToken) window.history.replaceState(null, '', window.location.pathname)
    void lookup({ token }).then((ok) => {
      if (!ok) setState('need-email')
    })
  }, [reference, linkToken, lookup])

  if (state === 'checking') return <p className="k-small k-store-placeholder">LOADING ORDER</p>

  if (state === 'need-email' || !order) {
    return (
      <form
        className="k-store-form"
        onSubmit={(event) => {
          event.preventDefault()
          const email = String(new FormData(event.currentTarget).get('email') ?? '').trim()
          setMessage(null)
          void lookup({ email })
        }}
      >
        <p className="k-body">Enter the email address this order was placed with.</p>
        <label className="k-store-field">
          <span className="k-small">EMAIL</span>
          <input type="email" name="email" required autoComplete="email" maxLength={254} />
        </label>
        {message && (
          <p className="k-small k-store-error" role="alert">
            {message}
          </p>
        )}
        <button type="submit" className="k-store-button">
          VIEW ORDER
        </button>
      </form>
    )
  }

  return (
    <div className="k-store-order">
      {order.isTest && (
        <div className="k-store-notice" data-tone="warning">
          <p className="k-small k-store-notice-title">TEST ORDER</p>
          <div className="k-store-notice-body">
            <p>This order was placed in payment test mode. No payment was taken and it will not be fulfilled.</p>
          </div>
        </div>
      )}
      <dl className="k-store-totals">
        <div>
          <dt className="k-small">STATUS</dt>
          <dd>{ORDER_STATUS_LABEL[order.status]}</dd>
        </div>
        <div>
          <dt className="k-small">PAYMENT</dt>
          <dd>{PAYMENT_STATUS_LABEL[order.paymentStatus]}</dd>
        </div>
        <div>
          <dt className="k-small">PLACED</dt>
          <dd>{order.placedAt.slice(0, 10)}</dd>
        </div>
      </dl>

      <ul className="k-store-lines">
        {order.items.map((item) => (
          <li key={item.sku} className="k-store-line">
            <span className="k-store-line-body">
              {item.productSlug ? (
                <Link href={`/parts/${item.productSlug}`} prefetch={false} className="k-item-title">
                  {item.productName}
                </Link>
              ) : (
                <span className="k-item-title">{item.productName}</span>
              )}
              <span className="k-small">
                {item.variantLabel ? `${item.variantLabel} · ` : ''}SKU {item.sku} · QTY {item.quantity} ·{' '}
                {formatMoney(item.unitPrice)} EACH
              </span>
            </span>
            <span className="k-store-line-total">{formatMoney(item.lineTotal)}</span>
          </li>
        ))}
      </ul>

      <dl className="k-store-totals">
        <div>
          <dt className="k-small">SUBTOTAL</dt>
          <dd>{formatMoney(order.subtotal)}</dd>
        </div>
        {order.discountTotal.amount > 0 && (
          <div>
            <dt className="k-small">DISCOUNT</dt>
            <dd>-{formatMoney(order.discountTotal)}</dd>
          </div>
        )}
        <div>
          <dt className="k-small">SHIPPING</dt>
          <dd>{formatMoney(order.shippingTotal)}</dd>
        </div>
        <div className="k-store-totals-grand">
          <dt className="k-small">TOTAL</dt>
          <dd>{formatMoney(order.total)}</dd>
        </div>
        {order.refundedTotal.amount > 0 && (
          <div>
            <dt className="k-small">REFUNDED</dt>
            <dd>{formatMoney(order.refundedTotal)}</dd>
          </div>
        )}
      </dl>

      <div className="k-store-notice">
        <p className="k-small k-store-notice-title">SHIPPING</p>
        <div className="k-store-notice-body">
          <p>
            {order.shipping.name}, {order.shipping.city}
            {order.shipping.region ? `, ${order.shipping.region}` : ''}
            {order.shipping.postalCode ? ` ${order.shipping.postalCode}` : ''}, {countryName(order.shipping.country)}
          </p>
          {order.shipping.carrier && (
            <p>
              {CARRIER_LABEL[order.shipping.carrier]}
              {order.shipping.service ? ` - ${order.shipping.service}` : ''}
            </p>
          )}
          {order.shipping.incoterm && <p>{INCOTERM_DETAIL[order.shipping.incoterm]}</p>}
          {order.shipping.trackingNumber && (
            <p>
              TRACKING:{' '}
              {order.shipping.trackingUrl && /^https:\/\//.test(order.shipping.trackingUrl) ? (
                <a href={order.shipping.trackingUrl} target="_blank" rel="noopener noreferrer">
                  {order.shipping.trackingNumber}
                </a>
              ) : (
                order.shipping.trackingNumber
              )}
            </p>
          )}
        </div>
      </div>

      {order.timeline.length > 0 && (
        <ol className="k-store-timeline">
          {order.timeline.map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              <span className="k-small">{entry.at.slice(0, 10)}</span>
              <span>
                {entry.status ? `${ORDER_STATUS_LABEL[entry.status]} - ` : ''}
                {entry.message}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
