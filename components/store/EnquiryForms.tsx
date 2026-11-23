'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

import { downscaleImage, elapsedSince, postStore } from '@/lib/store/browser'
import { countryName } from '@/lib/store/countries'

/**
 * The two enquiry forms: rare-part sourcing and custom builds.
 *
 * Both are requests for a human to reply, not purchases, and the confirmation
 * says exactly that. Both carry the honeypot and timing fields every public
 * form here carries.
 */

function useFormTiming() {
  const started = useRef(0)
  useEffect(() => {
    started.current = performance.now()
  }, [])
  return () => elapsedSince(started.current)
}

function Honeypot() {
  return (
    <label className="k-store-honeypot" aria-hidden="true">
      Website
      <input type="text" name="website" tabIndex={-1} autoComplete="off" />
    </label>
  )
}

function CountryField({ name, label, countries }: { name: string; label: string; countries: string[] }) {
  return (
    <label className="k-store-field">
      <span className="k-small">{label}</span>
      <select name={name} required defaultValue="">
        <option value="" disabled>
          Choose a country
        </option>
        {countries.map((code) => (
          <option key={code} value={code}>
            {countryName(code)}
          </option>
        ))}
      </select>
    </label>
  )
}

function useSubmit(path: string) {
  const elapsed = useFormTiming()
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})

  async function send(payload: Record<string, unknown>) {
    setState('sending')
    setMessage(null)
    setFields({})
    const result = await postStore(path, { ...payload, elapsedMs: elapsed() })
    if (result.error) {
      setState('idle')
      setMessage(result.error.message)
      setFields(result.error.fields ?? {})
      return
    }
    setState('sent')
  }
  return { state, message, fields, send, setMessage, setState }
}

function Errors({ message, fields }: { message: string | null; fields: Record<string, string> }) {
  const list = Object.values(fields)
  if (!message && list.length === 0) return null
  return (
    <div className="k-small k-store-error" role="alert">
      {message && <p>{message}</p>}
      {list.length > 0 && (
        <ul>
          {list.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Sent({ children }: { children: ReactNode }) {
  return (
    <div className="k-store-notice" role="status">
      <p className="k-small k-store-notice-title">REQUEST RECEIVED</p>
      <div className="k-store-notice-body">{children}</div>
    </div>
  )
}

export function SourcingForm({ countries }: { countries: string[] }) {
  const { state, message, fields, send, setMessage, setState } = useSubmit('/api/store/sourcing-requests')

  if (state === 'sent') {
    return (
      <Sent>
        <p>Thank you. We will reply by email once we have looked into it. This is not an order and nothing has been charged.</p>
      </Sent>
    )
  }

  return (
    <form
      className="k-store-form"
      onSubmit={async (event) => {
        event.preventDefault()
        if (state === 'sending') return
        const data = new FormData(event.currentTarget)
        const value = (name: string) => String(data.get(name) ?? '').trim()
        let referenceImage
        const file = data.get('referenceImage')
        if (file instanceof File && file.size > 0) {
          try {
            referenceImage = await downscaleImage(file)
          } catch {
            setMessage('The reference image could not be read. Use JPEG, PNG or WebP.')
            setState('idle')
            return
          }
        }
        await send({
          fullName: value('fullName'),
          email: value('email'),
          country: value('country'),
          vehicle: value('vehicle'),
          requestedPart: value('requestedPart'),
          preference: value('preference') || 'either',
          budget: value('budget') || undefined,
          notes: value('notes') || undefined,
          referenceImage,
          website: value('website'),
        })
      }}
    >
      <div className="k-store-field-row">
        <label className="k-store-field">
          <span className="k-small">FULL NAME</span>
          <input name="fullName" required maxLength={120} autoComplete="name" />
        </label>
        <label className="k-store-field">
          <span className="k-small">EMAIL</span>
          <input type="email" name="email" required maxLength={254} autoComplete="email" />
        </label>
      </div>
      <CountryField name="country" label="YOUR COUNTRY" countries={countries} />
      <label className="k-store-field">
        <span className="k-small">VEHICLE (MAKE, MODEL, CHASSIS, YEAR)</span>
        <input name="vehicle" required maxLength={200} placeholder="Honda Civic EG6 1993" />
      </label>
      <label className="k-store-field">
        <span className="k-small">PART YOU ARE LOOKING FOR</span>
        <textarea name="requestedPart" rows={3} required maxLength={1000} placeholder="Part name, OEM part number if known" />
      </label>
      <div className="k-store-field-row">
        <label className="k-store-field">
          <span className="k-small">PREFERENCE</span>
          <select name="preference" defaultValue="either">
            <option value="either">OEM or aftermarket</option>
            <option value="oem">Genuine OEM only</option>
            <option value="aftermarket">Aftermarket</option>
          </select>
        </label>
        <label className="k-store-field">
          <span className="k-small">BUDGET (OPTIONAL)</span>
          <input name="budget" maxLength={80} placeholder="e.g. up to USD 300" />
        </label>
      </div>
      <label className="k-store-field">
        <span className="k-small">ANYTHING ELSE (OPTIONAL)</span>
        <textarea name="notes" rows={4} maxLength={4000} />
      </label>
      <label className="k-store-field">
        <span className="k-small">REFERENCE PHOTO (OPTIONAL)</span>
        <input type="file" name="referenceImage" accept="image/jpeg,image/png,image/webp" />
      </label>
      <Honeypot />
      <Errors message={message} fields={fields} />
      <button type="submit" className="k-store-button" disabled={state === 'sending'}>
        {state === 'sending' ? 'SENDING' : 'SEND REQUEST'}
      </button>
      <p className="k-small k-store-fineprint">
        We use these details only to reply to this request. Sending it does not create an order or a commitment.
      </p>
    </form>
  )
}

export function BuildInquiryForm({ countries }: { countries: string[] }) {
  const { state, message, fields, send } = useSubmit('/api/store/build-inquiries')

  if (state === 'sent') {
    return (
      <Sent>
        <p>
          Thank you. We will reply by email to discuss the project. Nothing has been agreed or charged, and any quotation
          will state what is and is not included.
        </p>
      </Sent>
    )
  }

  return (
    <form
      className="k-store-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (state === 'sending') return
        const data = new FormData(event.currentTarget)
        const value = (name: string) => String(data.get(name) ?? '').trim()
        void send({
          fullName: value('fullName'),
          email: value('email'),
          phone: value('phone') || undefined,
          destinationCountry: value('destinationCountry'),
          preferredChassis: value('preferredChassis'),
          budgetRange: value('budgetRange'),
          intendedUse: value('intendedUse') || 'street',
          desiredModifications: value('desiredModifications') || undefined,
          website: value('website'),
        })
      }}
    >
      <div className="k-store-field-row">
        <label className="k-store-field">
          <span className="k-small">FULL NAME</span>
          <input name="fullName" required maxLength={120} autoComplete="name" />
        </label>
        <label className="k-store-field">
          <span className="k-small">EMAIL</span>
          <input type="email" name="email" required maxLength={254} autoComplete="email" />
        </label>
      </div>
      <label className="k-store-field">
        <span className="k-small">PHONE (OPTIONAL)</span>
        <input type="tel" name="phone" maxLength={40} autoComplete="tel" />
      </label>
      <CountryField name="destinationCountry" label="DESTINATION COUNTRY" countries={countries} />
      <div className="k-store-field-row">
        <label className="k-store-field">
          <span className="k-small">PREFERRED CHASSIS</span>
          <input name="preferredChassis" required maxLength={120} placeholder="e.g. Civic EK9" />
        </label>
        <label className="k-store-field">
          <span className="k-small">BUDGET RANGE</span>
          <input name="budgetRange" required maxLength={80} placeholder="e.g. USD 15,000-25,000" />
        </label>
      </div>
      <label className="k-store-field">
        <span className="k-small">INTENDED USE</span>
        <select name="intendedUse" defaultValue="street">
          <option value="street">Street</option>
          <option value="track">Track</option>
          <option value="show">Show</option>
          <option value="collection">Collection</option>
          <option value="mixed">Mixed</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label className="k-store-field">
        <span className="k-small">DESIRED MODIFICATIONS (OPTIONAL)</span>
        <textarea name="desiredModifications" rows={5} maxLength={4000} />
      </label>
      <Honeypot />
      <Errors message={message} fields={fields} />
      <button type="submit" className="k-store-button" disabled={state === 'sending'}>
        {state === 'sending' ? 'SENDING' : 'REQUEST A QUOTATION'}
      </button>
    </form>
  )
}
