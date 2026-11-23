import { isCountryCode } from '@/lib/store/countries'
import { cartItems, forward, prepare, storeError, text } from '@/lib/store/http'

/**
 * POST /api/store/cart/quote
 *
 * The browser sends SKUs, quantities and optionally a destination country. It
 * never sends a price. The backend answers with the lines it will actually
 * sell, at its own prices, against live stock, with only VERIFIED carrier
 * rates for the destination.
 */
export async function POST(request: Request) {
  const prepared = await prepare(request)
  if (!prepared.ok) return prepared.response

  const items = cartItems(prepared.body.items)
  if (!items) return storeError(400, 'validation_failed', 'items must be a list.')

  const country = text(prepared.body.country, 2)
  return forward(
    '/cart/quote',
    { items, ...(isCountryCode(country) ? { country: country.toUpperCase() } : {}) },
    prepared.ip,
  )
}
