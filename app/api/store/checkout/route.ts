import { isCountryCode } from '@/lib/store/countries'
import { EMAIL_PATTERN, cartItems, forward, prepare, storeError, storeSiteOrigin, text } from '@/lib/store/http'

/**
 * POST /api/store/checkout
 *
 * Starts a payment. Everything that determines what is charged is decided by
 * the backend from its own records: this handler forwards SKUs, quantities, an
 * address and the ID of a shipping option — never an amount.
 *
 * The return URLs are built HERE, from the configured site origin, and never
 * from the request's Host header: a payment processor will send the customer
 * to whatever it is given, and a caller chooses the Host. The backend appends
 * `?ref=<reference>` to both.
 */
export async function POST(request: Request) {
  const prepared = await prepare(request)
  if (!prepared.ok) return prepared.response
  const { body, ip } = prepared

  const items = cartItems(body.items)
  if (!items || items.length === 0) {
    return storeError(400, 'validation_failed', 'The cart is empty.', { items: 'The cart is empty.' })
  }

  const fields: Record<string, string> = {}
  const email = text(body.email, 254)
  if (!email || !EMAIL_PATTERN.test(email)) fields.email = 'Enter a valid email address.'

  const raw =
    body.address && typeof body.address === 'object' ? (body.address as Record<string, unknown>) : {}
  const country = text(raw.country, 2)
  const address = {
    name: text(raw.name, 120),
    line1: text(raw.line1, 160),
    line2: text(raw.line2, 160),
    city: text(raw.city, 100),
    region: text(raw.region, 100),
    postalCode: text(raw.postalCode, 20),
    country: isCountryCode(country) ? country.toUpperCase() : undefined,
    phone: text(raw.phone, 40),
  }
  if (!address.name) fields['address.name'] = 'Enter the recipient name.'
  if (!address.line1) fields['address.line1'] = 'Enter the street address.'
  if (!address.city) fields['address.city'] = 'Enter the city.'
  if (!address.country) fields['address.country'] = 'Choose a country.'

  const shippingOptionId = text(body.shippingOptionId, 80)
  if (!shippingOptionId) fields.shippingOptionId = 'Choose a shipping option.'
  if (body.acceptTerms !== true) fields.acceptTerms = 'You must accept the terms to continue.'

  if (Object.keys(fields).length > 0) {
    return storeError(400, 'validation_failed', 'Some details are missing or invalid.', fields)
  }

  const origin = await storeSiteOrigin(request)
  return forward(
    '/checkout',
    {
      items,
      email,
      address,
      shippingOptionId,
      customerNote: text(body.customerNote, 1000),
      acceptTerms: true,
      successUrl: `${origin}/checkout/success`,
      cancelUrl: `${origin}/checkout/cancelled`,
    },
    ip,
  )
}
