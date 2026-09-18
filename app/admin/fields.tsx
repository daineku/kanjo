import type { ReactNode } from 'react'

import type { ImageRef } from '@/lib/content/types'

/**
 * The admin's field vocabulary.
 *
 * Small, server-rendered, uncontrolled. There is no client state anywhere in
 * this admin: a form posts to a Server Action and the page re-renders with what
 * was saved. That is the entire interaction model, and it is why the admin
 * ships no JavaScript of its own at all.
 */

export function Panel({
  title,
  note,
  children,
  action,
  readOnly,
}: {
  title: string
  note?: string
  children: ReactNode
  action: (form: FormData) => Promise<void>
  readOnly: boolean
}) {
  return (
    <section className="a-panel">
      <h2>{title}</h2>
      {note && <p className="a-note">{note}</p>}
      {/* No encType. React sets multipart itself for a form whose action is a
          Server Action — declaring it logs "Cannot specify a encType or method
          for a form that specifies a function as the action" and is overridden
          anyway. File inputs in these panels still arrive as File objects. */}
      <form action={action}>
        <div className="a-grid">{children}</div>
        <div className="a-actions">
          <button type="submit" disabled={readOnly}>
            SAVE
          </button>
        </div>
      </form>
    </section>
  )
}

export function Field({
  label,
  name,
  defaultValue,
  hint,
  type = 'text',
  wide,
}: {
  label: string
  name: string
  defaultValue?: string | number
  hint?: string
  type?: 'text' | 'number' | 'url'
  wide?: boolean
}) {
  return (
    <label className={wide ? 'a-field a-field--wide' : 'a-field'}>
      <span className="a-label">{label}</span>
      <input type={type} name={name} defaultValue={defaultValue ?? ''} />
      {hint && <span className="a-hint">{hint}</span>}
    </label>
  )
}

export function TextArea({
  label,
  name,
  defaultValue,
  hint,
  rows = 5,
}: {
  label: string
  name: string
  defaultValue?: string
  hint?: string
  rows?: number
}) {
  return (
    <label className="a-field a-field--wide">
      <span className="a-label">{label}</span>
      <textarea name={name} rows={rows} defaultValue={defaultValue ?? ''} />
      {hint && <span className="a-hint">{hint}</span>}
    </label>
  )
}

export function Toggle({
  label,
  name,
  defaultChecked,
  hint,
}: {
  label: string
  name: string
  defaultChecked?: boolean
  hint?: string
}) {
  return (
    <label className="a-field a-field--toggle">
      {/* A hidden companion is NOT used here: an unchecked box being absent is
          exactly what `bool()` in actions.ts expects, and adding one would make
          "off" arrive as two values. */}
      <input type="checkbox" name={name} defaultChecked={defaultChecked} />
      <span className="a-label">{label}</span>
      {hint && <span className="a-hint">{hint}</span>}
    </label>
  )
}

export function Select({
  label,
  name,
  options,
  defaultValue,
  hint,
}: {
  label: string
  name: string
  options: readonly string[]
  defaultValue?: string
  hint?: string
}) {
  return (
    <label className="a-field">
      <span className="a-label">{label}</span>
      <select name={name} defaultValue={defaultValue}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {hint && <span className="a-hint">{hint}</span>}
    </label>
  )
}

/**
 * An image: upload a file, or type an existing media path / public URL.
 *
 * The upload wins when both are present. Locally it is filed under public/media;
 * production uses the configured media store (R2 for the live site). Dimensions
 * are read from the uploaded bytes — width/height are only for a hand-entered
 * path. See lib/content/local/imageSize.ts.
 */
export function ImageField({
  label,
  name,
  value,
  folder,
  hint,
}: {
  label: string
  name: string
  value?: ImageRef
  /** Where an upload is filed, e.g. 'loader'. */
  folder: string
  hint?: string
}) {
  return (
    <fieldset className="a-field a-field--wide a-image">
      <legend className="a-label">{label}</legend>
      {hint && <p className="a-hint">{hint}</p>}

      {value?.src && (
        <div className="a-preview">
          {/* Plain <img>: this is a dev-only tool rendering whatever path is in
              the field, including one the optimizer would refuse (SVG) or one
              that does not exist yet. A broken preview is the correct feedback.
              eslint-disable-next-line @next/next/no-img-element */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value.src} alt="" />
          <code>
            {value.src} — {value.width}×{value.height}
          </code>
        </div>
      )}

      <div className="a-grid">
        <label className="a-field a-field--wide">
          <span className="a-label">Upload</span>
          <input
            type="file"
            name={`${name}.file`}
            accept=".png,.jpg,.jpeg,.webp,.gif,.svg"
          />
          <span className="a-hint">
            Saved under {folder}/ in the configured media store (R2 in production,
            public/media locally).
          </span>
        </label>
        <Field label="Path" name={`${name}.src`} defaultValue={value?.src} wide />
        <Field
          label="Alt text"
          name={`${name}.alt`}
          defaultValue={value?.alt}
          hint="Empty is correct for a purely decorative image."
          wide
        />
        <Field label="Width" name={`${name}.width`} type="number" defaultValue={value?.width} />
        <Field label="Height" name={`${name}.height`} type="number" defaultValue={value?.height} />
      </div>
    </fieldset>
  )
}
