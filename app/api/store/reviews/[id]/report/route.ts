import { forward, prepare, storeError, text } from '@/lib/store/http'

const REASONS = ['spam', 'offensive', 'fake', 'off_topic', 'other'] as const

/** POST /api/store/reviews/[id]/report — flags a published review for a moderator. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const prepared = await prepare(request)
  if (!prepared.ok) return prepared.response

  const { id } = await context.params
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return storeError(404, 'not_found', 'Unknown review.')

  const reason = text(prepared.body.reason, 20)
  if (!reason || !(REASONS as readonly string[]).includes(reason)) {
    return storeError(400, 'validation_failed', 'Choose a reason.', { reason: 'Choose a reason.' })
  }

  return forward(
    `/reviews/${encodeURIComponent(id)}/report`,
    { reason, detail: text(prepared.body.detail, 1000) },
    prepared.ip,
  )
}
