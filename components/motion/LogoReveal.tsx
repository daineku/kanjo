'use client'

import Image from 'next/image'
import { useRef } from 'react'

import type { ImageRef } from '@/lib/content/types'
import { gsap, useGSAP } from '@/lib/motion/gsap'
import { readMotionPolicy } from '@/lib/motion/policy'
import { whenStageReady } from '@/lib/motion/stage'

/**
 * The supplied logo arriving. The site's identity moment when the hero uses
 * the logo artwork rather than set type.
 *
 * ── THE H1 IS THE LOGO ──────────────────────────────────────────────────────
 *
 * The heading element wraps the image, and the image's alt is the site's name.
 * That is what keeps "THE KANJO" the page's accessible H1: a screen reader
 * announces the heading with the alt as its text, a crawler indexes the alt as
 * the heading, and nothing depends on the artwork having loaded. There is no
 * visually-hidden duplicate — an H1 with an image child is the semantic form
 * the specification describes, and a second hidden heading would be announced
 * twice.
 *
 * ── THE EFFECT ──────────────────────────────────────────────────────────────
 *
 * A masked wipe from the left along the logo's own speed lines, with a small
 * settle in scale. The clip is an `inset()` on the same element, so it is one
 * property on one layer; it runs once, then every animated property is cleared
 * and the browser is handed a plain image.
 *
 * ── AND IF ANY OF THAT FAILS ────────────────────────────────────────────────
 *
 * The image is in the server-rendered HTML, fully visible, with no clip in the
 * stylesheet. It is hidden only by `gsap.set` in a layout effect, and only when
 * motion is welcome and the reveal is enabled. Reduced motion, failed
 * hydration and a crawler all get the finished logo. Same rule as every reveal
 * on this site.
 */

export function LogoReveal({
  logo,
  title,
  id,
  waitForLoader,
  enabled,
}: {
  logo: ImageRef
  /** The site's name — the H1's text, via the image's alt. */
  title: string
  id?: string
  waitForLoader: boolean
  enabled: boolean
}) {
  const root = useRef<HTMLHeadingElement>(null)

  useGSAP(
    () => {
      const element = root.current
      if (!element || !enabled) return
      if (!readMotionPolicy().animate) return

      const image = element.querySelector<HTMLElement>('.k-hero-logo')
      if (!image) return

      let cancelled = false

      // Hidden before the first paint, and only on the branch that is certainly
      // going to bring it back. `opacity`, not `autoAlpha` — see Reveal.tsx.
      gsap.set(image, {
        clipPath: 'inset(0% 100% 0% 0%)',
        opacity: 0,
        scale: 1.04,
        transformOrigin: '0% 50%',
      })

      void whenStageReady(waitForLoader).then(() => {
        if (cancelled) return
        gsap
          .timeline({
            onComplete: () => gsap.set(image, { clearProps: 'all' }),
          })
          .to(image, {
            clipPath: 'inset(0% 0% 0% 0%)',
            opacity: 1,
            duration: 0.78,
            ease: 'power3.out',
          })
          .to(image, { scale: 1, duration: 0.9, ease: 'power2.out' }, 0)
      })

      return () => {
        cancelled = true
      }
    },
    { scope: root },
  )

  return (
    <h1 ref={root} id={id} className="k-hero-identity">
      <Image
        className="k-hero-logo"
        src={logo.src}
        alt={title}
        width={logo.width}
        height={logo.height}
        // The identity is the first thing on the page and it is above the fold
        // at every width; it should not wait behind anything.
        priority
        sizes="(max-width: 767px) 29vw, (max-width: 1024px) 24vw, 205px"
      />
    </h1>
  )
}
