'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { writeCart } from '@/lib/store/browser'

/**
 * The page the payment provider returns the customer to.
 *
 * Arriving here is NOT proof of payment — the provider's webhook to the
 * backend is. So the copy says the order was received and that confirmation
 * follows, and the order page shows the backend's real status. On success the
 * local cart is cleared; on cancellation it is left intact.
 */
export function CheckoutReturn({ outcome }: { outcome: 'success' | 'cancelled' }) {
  const [reference, setReference] = useState<string | null>(null)

  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref')
    if (ref && /^[A-Za-z0-9-]{4,40}$/.test(ref)) setReference(ref.toUpperCase())
    if (outcome === 'success') writeCart([])
  }, [outcome])

  if (outcome === 'cancelled') {
    return (
      <div className="k-store-form">
        <p className="k-body">Payment was not completed and you have not been charged. Your cart is still saved.</p>
        <p>
          <Link href="/cart" prefetch={false} className="k-store-button">
            BACK TO CART
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="k-store-form">
      <p className="k-body">
        Thank you. Your order has been received. Payment confirmation can take a moment; the order page shows its
        current status.
      </p>
      {reference && (
        <>
          <p className="k-small">ORDER REFERENCE {reference}</p>
          <p>
            <Link href={`/orders/${reference}`} prefetch={false} className="k-store-button">
              VIEW ORDER STATUS
            </Link>
          </p>
        </>
      )}
      <p>
        <Link href="/parts" prefetch={false} className="k-link-action k-small">
          CONTINUE BROWSING
        </Link>
      </p>
    </div>
  )
}
