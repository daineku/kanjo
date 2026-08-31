import type { ReactNode } from 'react'

/**
 * The canon's framed slot.
 *
 * `UI_Canon/Assets/Vectors/profile_frame_corner_*.svg` is a 9x9 L-shape with a
 * 2px stroke in accent red, and the reference screenshots place all four around
 * an image slot — both a filled one (profile_select) and an empty one
 * (new_profile). It is the game's own way of saying "content goes here", which
 * makes it the right treatment for media this site does not have yet.
 *
 * `ratio` reserves the slot's space before anything loads. That is the whole of
 * not shifting layout, and it is why the prop is required rather than optional.
 */

export function Frame({
  ratio,
  children,
  className = '',
}: {
  /** CSS aspect-ratio, e.g. '16 / 9'. */
  ratio: string
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={`k-frame ${className}`.trim()}
      style={{ aspectRatio: ratio, position: 'relative', overflow: 'hidden' }}
    >
      {/* Carries the other two corners. The parent's ::before/::after are the
          top-left and bottom-right, so a second element is needed for the pair
          on the opposite diagonal. It is decorative and empty. */}
      <span className="k-frame-corners" aria-hidden="true" />
      {children}
    </div>
  )
}

/**
 * A framed slot with nothing in it, and a label saying so.
 *
 * Used wherever the content layer legitimately has no entries. It is the honest
 * alternative to shipping a fabricated screenshot, and it looks like the game
 * rather than like a broken image.
 */
export function PendingSlot({
  ratio,
  label,
  detail,
}: {
  ratio: string
  label: string
  detail?: string
}) {
  return (
    <Frame ratio={ratio}>
      <span
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--k-space-sm)',
          padding: 'var(--k-space-lg)',
          textAlign: 'center',
        }}
      >
        <span className="k-small" style={{ color: 'var(--k-accent)' }}>
          {label}
        </span>
        {detail && (
          <span className="k-small" style={{ color: 'var(--k-text-tertiary)' }}>
            {detail}
          </span>
        )}
      </span>
    </Frame>
  )
}
