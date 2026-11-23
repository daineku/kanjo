import { isCountryCode } from '@/lib/store/countries'
import { EMAIL_PATTERN, forward, prepare, spamFields, storeError, text, uploadedImages } from '@/lib/store/http'

const PREFERENCES = ['oem', 'aftermarket', 'either'] as const

/** POST /api/store/sourcing-requests — a request to find a specific part. An enquiry, not an order. */
export async function POST(request: Request) {
  const prepared = await prepare(request)
  if (!prepared.ok) return prepared.response
  const { body, ip } = prepared

  const fields: Record<string, string> = {}
  const fullName = text(body.fullName, 120)
  const email = text(body.email, 254)
  const country = text(body.country, 2)
  const vehicle = text(body.vehicle, 200)
  const requestedPart = text(body.requestedPart, 1000)
  const preference = text(body.preference, 20) ?? 'either'

  if (!fullName) fields.fullName = 'Enter your name.'
  if (!email || !EMAIL_PATTERN.test(email)) fields.email = 'Enter a valid email address.'
  if (!isCountryCode(country)) fields.country = 'Choose a country.'
  if (!vehicle) fields.vehicle = 'Tell us which vehicle the part is for.'
  if (!requestedPart) fields.requestedPart = 'Describe the part you are looking for.'
  if (!(PREFERENCES as readonly string[]).includes(preference)) fields.preference = 'Choose a preference.'
  if (Object.keys(fields).length > 0 || !isCountryCode(country)) {
    return storeError(400, 'validation_failed', 'Some details are missing or invalid.', fields)
  }

  const [referenceImage] = uploadedImages(body.referenceImage ? [body.referenceImage] : [], 1)
  return forward(
    '/sourcing-requests',
    {
      fullName,
      email,
      country: country.toUpperCase(),
      vehicle,
      requestedPart,
      preference,
      budget: text(body.budget, 80),
      notes: text(body.notes, 4000),
      ...(referenceImage ? { referenceImage } : {}),
      ...spamFields(body),
    },
    ip,
  )
}
