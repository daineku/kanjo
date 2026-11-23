'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { CART_EVENT, cartCount, readCart } from '@/lib/store/browser'

import './entry.css'

/**
 * CART, with a count, in the header.
 *
 * The count is read from storage after hydration, so the server HTML says
 * "CART" and the number appears once the browser knows it — no hydration
 * mismatch, and no layout shift because the badge has a reserved width.
 */
export function CartLink() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    const update = () => setCount(cartCount(readCart()))
    update()
    window.addEventListener(CART_EVENT, update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener(CART_EVENT, update)
      window.removeEventListener('storage', update)
    }
  }, [])

  return (
    <Link href="/cart" prefetch={false} className="k-store-cartlink k-small" aria-label={count ? `Cart, ${count} items` : 'Cart'}>
      CART
      <span className="k-store-cartlink-count" aria-hidden="true">
        {count ? count : ''}
      </span>
    </Link>
  )
}
