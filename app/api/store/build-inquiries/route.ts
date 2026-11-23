import { isCountryCode } from '@/lib/store/countries'
import { EMAIL_PATTERN, forward, prepare, spamFields, storeError, text } from '@/lib/store/http'

const USES = ['street', 'track', 'show', 'collection', 'mixed', 'other'] as const

/** POST /api/store/build-inquiries — a request for a quotation on a custom build. Not a purchase. */
export async function POST(request: Request) {
  const prepared = await prepare(request)
  if (!prepared.ok) return prepared.response
  const { body, ip } = prepared

  const fields: Record<string, string> = {}
  const fullName = text(body.fullName, 120)
  const email = text(body.email, 254)
  const destinationCountry = text(body.destinationCountry, 2)
  const preferredChassis = text(body.preferredChassis, 120)
  const budgetRange = text(body.budgetRange, 80)
  const intendedUse = text(body.intendedUse, 20) ?? 'street'

  if (!fullName) fields.fullName = 'Enter your name.'
  if (!email || !EMAIL_PATTERN.test(email)) fields.email = 'Enter a valid email address.'
  if (!isCountryCode(destinationCountry)) fields.destinationCountry = 'Choose the destination country.'
  if (!preferredChassis) fields.preferredChassis = 'Tell us which chassis you have in mind.'
  if (!budgetRange) fields.budgetRange = 'Give a budget range.'
  if (!(USES as readonly string[]).includes(intendedUse)) fields.intendedUse = 'Choose an intended use.'
  if (Object.keys(fields).length > 0 || !isCountryCode(destinationCountry)) {
    return storeError(400, 'validation_failed', 'Some details are missing or invalid.', fields)
  }

  return forward(
    '/build-inquiries',
    {
      fullName,
      email,
      phone: text(body.phone, 40),
      destinationCountry: destinationCountry.toUpperCase(),
      preferredChassis,
      budgetRange,
      intendedUse,
      desiredModifications: text(body.desiredModifications, 4000),
      ...spamFields(body),
    },
    ip,
  )
}
