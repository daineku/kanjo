'use client'

import { useRef, type ReactNode } from 'react'

import { gsap, useGSAP } from '@/lib/motion/gsap'

/**
 * The hero's media layer: a restrained parallax as the visitor scrolls away.
 *
 * ── NO ENTRANCE ─────────────────────────────────────────────────────────────
 *
 * This island used to open with a clip-path mask and a scale settle, timed to
 * the loader's hand-over. With the loader gone that entrance would hide the
 * server-rendered image at hydration and wipe it back in — a visible flash of
 * the hero disappearing, and a later LCP. So the media is simply there from
 * the first paint, and nothing here touches it until the visitor scrolls.
 *
 * ── THE PARALLAX ────────────────────────────────────────────────────────────
 *
 * The ONE scrubbed animation on the site, kept cheap on purpose: a single
 * ScrollTrigger on the hero, animating `y` only, with no pin. A scrub on
 * transform is compositor work; a pin is layout work and scroll hijacking on a
 * phone, which is why there is none. Fine pointer and wide viewport only: on a
 * phone a moving background under a moving page reads as judder. Reduced
 * motion turns it off. `gsap.matchMedia()` reverts it if either changes.
 */

export function HeroMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const element = root.current
      if (!element) return

      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference) and (pointer: fine) and (min-width: 768px)', () => {
        gsap.to(element, {
          yPercent: 12,
          ease: 'none',
          scrollTrigger: {
            trigger: element.parentElement ?? element,
            start: 'top top',
            end: 'bottom top',
            scrub: 0.6,
          },
        })
      })

      return () => mm.revert()
    },
    { scope: root },
  )

  return (
    <div ref={root} className="k-hero-media-motion">
      {children}
    </div>
  )
}
