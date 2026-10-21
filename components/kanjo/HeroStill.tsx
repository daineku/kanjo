import { getImageProps } from 'next/image'

import type { ImageRef } from '@/lib/content/types'
import { DESKTOP_HERO_MEDIA_QUERY, MOBILE_HERO_MEDIA_QUERY } from '@/lib/media/mobileHeroVideo'

/**
 * The hero's still, art-directed: one image for the desktop crop, another for
 * the phone, and only ONE of them ever requested.
 *
 * ── WHY `<picture>` AND NOT TWO `<Image>`s ──────────────────────────────────
 *
 * The obvious version renders both stills with `priority` and hides one with
 * CSS. That fetches both: `display: none` does not stop an `<img>` request,
 * and `priority` emits a `<link rel="preload">` per image with no media
 * condition, so a phone would preload the 6336px desktop frame it never shows
 * and a desktop would preload the phone poster. On the phone that is the one
 * download that competes with the poster for the first paint.
 *
 * `<picture>` lets the browser choose BEFORE it fetches. The `<source>` carries
 * the phone poster under the phone media query; the `<img>` carries the
 * desktop still. Both sets of attributes come from `getImageProps`, so the
 * optimizer URLs, the `srcset`, the `sizes` and the `fill` styles are exactly
 * what `<Image>` would have rendered — the desktop `<img>` is byte-for-byte the
 * markup the approved desktop page already ships.
 *
 * The preloads are then written by hand, one per breakpoint, each with the
 * `media` attribute React's `preload()` does not support, so each viewport
 * preloads only its own image and the hero's LCP candidate is requested from
 * the HTML, before any script runs.
 */
export function HeroStill({
  desktop,
  mobile,
  quality,
}: {
  desktop: ImageRef
  mobile: ImageRef
  /** Passed through for the desktop still only, as the hero always has. */
  quality?: number
}) {
  // `priority` makes the <img> eager; `fetchPriority: 'high'` puts the hero
  // ahead of every other image the parser finds. It is the page's LCP element.
  const common = { alt: '', fill: true, sizes: '100vw', priority: true, fetchPriority: 'high' } as const

  const { props: desktopProps } = getImageProps({ ...common, src: desktop.src, quality })
  const { props: mobileProps } = getImageProps({ ...common, src: mobile.src })

  return (
    <>
      {/* React hoists these into <head>. `media` is the whole point: without
          it the two preloads would both fire on every viewport. */}
      <link
        rel="preload"
        as="image"
        media={DESKTOP_HERO_MEDIA_QUERY}
        imageSrcSet={desktopProps.srcSet}
        imageSizes={desktopProps.sizes}
        fetchPriority="high"
      />
      <link
        rel="preload"
        as="image"
        media={MOBILE_HERO_MEDIA_QUERY}
        imageSrcSet={mobileProps.srcSet}
        imageSizes={mobileProps.sizes}
        fetchPriority="high"
      />
      {/* `display: contents` in the stylesheet, so the <picture> is not a box
          and the <img> keeps positioning against the hero's crop. */}
      <picture className="k-hero-picture">
        {/* No `type`: the optimizer answers these URLs as AVIF or WebP by
            Accept header, so naming one here would be a guess. */}
        <source media={MOBILE_HERO_MEDIA_QUERY} srcSet={mobileProps.srcSet} sizes={mobileProps.sizes} />
        {/* A plain <img> whose attributes ARE next/image's, via getImageProps. */}
        <img {...desktopProps} alt="" className="k-hero-img" />
      </picture>
    </>
  )
}
