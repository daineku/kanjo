'use client'

import { useCallback, useEffect, useState } from 'react'

import { CART_EVENT, postStore, readCart } from '@/lib/store/browser'
import type { CartItemInput, CartQuote } from '@/lib/store/types'

/**
 * The server's view of the visitor's cart, for a destination.
 *
 * Re-quoted whenever the cart or the country changes. Until the first quote
 * arrives `quote` is null and the UI shows a reserved, labelled block rather
 * than guessing from local data.
 */
export function useCartQuote(country: string) {
  const [items, setItems] = useState<CartItemInput[] | null>(null)
  const [quote, setQuote] = useState<CartQuote | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const update = () => setItems(readCart())
    update()
    window.addEventListener(CART_EVENT, update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener(CART_EVENT, update)
      window.removeEventListener('storage', update)
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!items) return
    if (items.length === 0) {
      setQuote(null)
      setError(null)
      return
    }
    setLoading(true)
    const result = await postStore<CartQuote>('/api/store/cart/quote', {
      items,
      ...(country ? { country } : {}),
    })
    setLoading(false)
    if (result.error || !result.data) {
      setError(result.error?.message ?? 'The cart could not be priced just now.')
      return
    }
    setError(null)
    setQuote(result.data)
  }, [items, country])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { items, quote, error, loading, refresh, setQuote }
}
