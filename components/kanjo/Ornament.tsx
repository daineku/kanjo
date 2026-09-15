import Image from 'next/image'

/**
 * The two supplied brand ornaments.
 *
 * Both are the owner's artwork, prepared by scripts/prepare-brand-assets.mjs
 * (trimmed; green accents remapped to the theme's red; the divider's black
 * strokes flipped to light so they read on a dark ground). They are decoration
 * — `alt=""` and `aria-hidden` — and they are used sparingly: content chooses
 * where they go through `SectionHeader.ornament`, and the intent is once each.
 *
 * Rendered through next/image so the 2000px sources are served at the width
 * they are actually shown, not at full size.
 */

const ART = {
  divider: {
    src: '/media/brand/divider.png',
    width: 2136,
    height: 257,
    className: 'k-ornament k-ornament--divider',
    sizes: '(max-width: 767px) 92vw, 720px',
  },
  badge: {
    src: '/media/brand/section-badge.png',
    width: 2042,
    height: 251,
    className: 'k-ornament k-ornament--badge',
    sizes: '(max-width: 767px) 80vw, 440px',
  },
} as const

export function Ornament({ kind }: { kind: 'divider' | 'badge' }) {
  const art = ART[kind]
  return (
    <div className={art.className} aria-hidden="true">
      <Image src={art.src} alt="" width={art.width} height={art.height} sizes={art.sizes} />
    </div>
  )
}
