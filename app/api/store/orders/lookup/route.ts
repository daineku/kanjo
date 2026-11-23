import { forward, prepare, storeError, text } from '@/lib/store/http'

/**
 * POST /api/store/orders/lookup
 *
 * An order is shown to whoever holds its access token, or to whoever knows
 * both its reference and the email it was placed with. Both travel in the POST
 * body, not in a URL that would end up in a log. The backend rate-limits per
 * visitor and answers a wrong credential and an unknown order identically.
 */
export async function POST(request: Request) {
  const prepared = await prepare(request)
  if (!prepared.ok) return prepared.response

  const reference = text(prepared.body.reference, 40)
  const token = text(prepared.body.token, 200)
  const email = text(prepared.body.email, 254)
  if (!reference || !/^[A-Za-z0-9-]{4,40}$/.test(reference)) {
    return storeError(400, 'validation_failed', 'Enter the order reference.', {
      reference: 'Enter the order reference.',
    })
  }
  if (!token && !email) {
    return storeError(400, 'validation_failed', 'Enter the email the order was placed with.', {
      email: 'Enter the email the order was placed with.',
    })
  }

  return forward(
    '/orders/lookup',
    { reference: reference.toUpperCase(), ...(token ? { token } : { email }) },
    prepared.ip,
  )
}
