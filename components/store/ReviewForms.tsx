'use client'

import { useRef, useState } from 'react'

import { downscaleImage, elapsedSince, postStore } from '@/lib/store/browser'

/**
 * Writing a review, and reporting one.
 *
 * A submitted review is held for moderation and says so; nothing a visitor
 * types appears on the page until a moderator approves it. The "verified
 * purchase" label is the backend's decision against a real order — the order
 * reference field here only lets it look.
 */
export function ReviewForm({ productSlug }: { productSlug: string }) {
  const started = useRef(0)
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})

  if (status === 'sent') {
    return (
      <p className="k-small k-store-buy-added" role="status">
        THANK YOU. YOUR REVIEW HAS BEEN SUBMITTED AND WILL APPEAR ONCE IT HAS BEEN MODERATED.
      </p>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        className="k-store-button k-store-button--quiet"
        onClick={() => {
          started.current = performance.now()
          setOpen(true)
        }}
      >
        WRITE A REVIEW
      </button>
    )
  }

  async function submit(form: HTMLFormElement) {
    const data = new FormData(form)
    const value = (name: string) => String(data.get(name) ?? '').trim()
    setStatus('sending')
    setMessage(null)
    setFields({})

    const files = (data.getAll('photos') as File[]).filter((file) => file instanceof File && file.size > 0).slice(0, 3)
    let photos: Awaited<ReturnType<typeof downscaleImage>>[] = []
    try {
      photos = await Promise.all(files.map((file) => downscaleImage(file)))
    } catch {
      setStatus('idle')
      setMessage('One of the photos could not be read. Use JPEG, PNG or WebP.')
      return
    }

    const result = await postStore('/api/store/reviews', {
      productSlug,
      rating: Number(value('rating')),
      title: value('title') || undefined,
      body: value('body'),
      authorName: value('authorName'),
      email: value('email'),
      orderReference: value('orderReference') || undefined,
      photos,
      website: value('website'),
      elapsedMs: elapsedSince(started.current),
    })
    if (result.error) {
      setStatus('idle')
      setMessage(result.error.message)
      setFields(result.error.fields ?? {})
      return
    }
    setStatus('sent')
  }

  return (
    <form
      className="k-store-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (status !== 'sending') void submit(event.currentTarget)
      }}
    >
      <fieldset className="k-store-fieldset k-store-fieldset--row">
        <legend className="k-small">RATING</legend>
        {[1, 2, 3, 4, 5].map((value) => (
          <label key={value} className="k-store-check">
            <input type="radio" name="rating" value={value} required />
            <span>{value}</span>
          </label>
        ))}
      </fieldset>
      {fields.rating && <p className="k-small k-store-field-error">{fields.rating}</p>}
      <label className="k-store-field">
        <span className="k-small">TITLE (OPTIONAL)</span>
        <input name="title" maxLength={120} />
      </label>
      <label className="k-store-field">
        <span className="k-small">YOUR REVIEW</span>
        <textarea name="body" rows={5} required minLength={10} maxLength={4000} />
        {fields.body && <span className="k-small k-store-field-error">{fields.body}</span>}
      </label>
      <div className="k-store-field-row">
        <label className="k-store-field">
          <span className="k-small">NAME TO SHOW</span>
          <input name="authorName" required maxLength={60} autoComplete="nickname" />
        </label>
        <label className="k-store-field">
          <span className="k-small">EMAIL (NOT SHOWN)</span>
          <input type="email" name="email" required maxLength={254} autoComplete="email" />
        </label>
      </div>
      <label className="k-store-field">
        <span className="k-small">ORDER REFERENCE (OPTIONAL, FOR A VERIFIED PURCHASE LABEL)</span>
        <input name="orderReference" maxLength={40} />
      </label>
      <label className="k-store-field">
        <span className="k-small">PHOTOS (OPTIONAL, UP TO 3)</span>
        <input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple />
      </label>
      {/* Honeypot: hidden from people, filled in by naive bots. */}
      <label className="k-store-honeypot" aria-hidden="true">
        Website
        <input type="text" name="website" tabIndex={-1} autoComplete="off" />
      </label>
      {message && (
        <p className="k-small k-store-error" role="alert">
          {message}
        </p>
      )}
      <button type="submit" className="k-store-button" disabled={status === 'sending'}>
        {status === 'sending' ? 'SUBMITTING' : 'SUBMIT REVIEW'}
      </button>
      <p className="k-small k-store-fineprint">
        Reviews are moderated before they appear. Your email is used only to check for a matching order and is never
        shown.
      </p>
    </form>
  )
}

export function ReportReview({ reviewId }: { reviewId: string }) {
  const [state, setState] = useState<'idle' | 'open' | 'sent'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  if (state === 'sent') return <span className="k-small">REPORTED. THANK YOU.</span>
  if (state === 'idle') {
    return (
      <button type="button" className="k-store-textbutton k-small" onClick={() => setState('open')}>
        REPORT
      </button>
    )
  }
  return (
    <form
      className="k-store-report"
      onSubmit={async (event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const result = await postStore(`/api/store/reviews/${encodeURIComponent(reviewId)}/report`, {
          reason: String(data.get('reason') ?? 'other'),
          detail: String(data.get('detail') ?? '').trim() || undefined,
        })
        if (result.error) setMessage(result.error.message)
        else setState('sent')
      }}
    >
      <label className="k-store-field">
        <span className="k-small">REASON</span>
        <select name="reason" defaultValue="spam">
          <option value="spam">Spam</option>
          <option value="offensive">Offensive</option>
          <option value="fake">Not a genuine review</option>
          <option value="off_topic">Off topic</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label className="k-store-field">
        <span className="k-small">DETAIL (OPTIONAL)</span>
        <input name="detail" maxLength={1000} />
      </label>
      {message && <p className="k-small k-store-error">{message}</p>}
      <button type="submit" className="k-store-button k-store-button--quiet">
        SEND REPORT
      </button>
    </form>
  )
}
