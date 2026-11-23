import { EMAIL_PATTERN, forward, prepare, spamFields, storeError, text, uploadedImages } from '@/lib/store/http'

/**
 * POST /api/store/reviews
 *
 * Submits a review for moderation. Nothing submitted here is published by this
 * request: the backend stores it as `pending`, and only a moderator's approval
 * makes it visible or lets it count toward a rating. Whether it carries a
 * "verified purchase" label is decided by the backend against a real order —
 * the form cannot ask for it.
 */
export async function POST(request: Request) {
  const prepared = await prepare(request)
  if (!prepared.ok) return prepared.response
  const { body, ip } = prepared

  const fields: Record<string, string> = {}
  const productSlug = text(body.productSlug, 120)
  const rating = Number(body.rating)
  const reviewBody = text(body.body, 4000)
  const authorName = text(body.authorName, 60)
  const email = text(body.email, 254)

  if (!productSlug) fields.productSlug = 'Missing product.'
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) fields.rating = 'Choose a rating from 1 to 5.'
  if (!reviewBody || reviewBody.length < 10) fields.body = 'Write at least a sentence.'
  if (!authorName) fields.authorName = 'Enter the name to show with the review.'
  if (!email || !EMAIL_PATTERN.test(email)) fields.email = 'Enter a valid email address.'
  if (Object.keys(fields).length > 0) {
    return storeError(400, 'validation_failed', 'Some details are missing or invalid.', fields)
  }

  return forward(
    '/reviews',
    {
      productSlug,
      rating,
      title: text(body.title, 120),
      body: reviewBody,
      authorName,
      email,
      orderReference: text(body.orderReference, 40),
      photos: uploadedImages(body.photos, 3),
      ...spamFields(body),
    },
    ip,
  )
}
