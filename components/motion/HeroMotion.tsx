'use client'

import { useRef, type ReactNode } from 'react'

import { gsap, useGSAP } from '@/lib/motion/gsap'
import { whenStageReady } from '@/lib/motion/stage'

/**
 * The hero's media layer: a cinematic settle on entry, and a restrained
 * parallax as the visitor scrolls away.
 *
 * ── WHAT WAS ADOPTED FROM THE REFERENCES, AND HOW IT WAS BOUNDED ────────────
 *
 * The reference heroes open with a clip-path on the media frame and hold a
 * scale on the footage. Adopted: the media arrives through a horizontal mask
 * and settles from 1.06 to 1, timed to the loader's hand-over so the picture
 * and the logo land together. Bounded: it plays ONCE, on `transform` and
 * `clip-path` only, and clears every property afterwards.
 *
 * The parallax is the ONE scrubbed animation on the site, and it is kept
 * cheap on purpose: a single ScrollTrigger on the hero, animating `y` only,
 * with no pin. A scrub on transform is compositor work; a pin is layout work
 * and scroll hijacking on a phone, which is why there is none.
 *
 * ── POLICY ──────────────────────────────────────────────────────────────────
 *
 * `gsap.matchMedia()` decides per condition and reverts when a condition
 * changes:
 *   - reduced motion: nothing runs; the media is simply there.
 *   - coarse pointer / narrow: the settle runs, the parallax does not — on a
 *     phone the scroll distance is the whole story and a moving background
 *     under a moving page reads as judder.
 *   - fine pointer, wide: settle and parallax.
 *
 * The media is never hidden in CSS. `gsap.set` hides it in a layout effect,
 * before paint, only on the branch that will bring it back.
 */

export function HeroMotion({
  children,
  waitForLoader,
}: {
  children: ReactNode
  waitForLoader: boolean
}) {
  const root = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const element = root.current
      if (!element) return

      const mm = gsap.matchMedia()

      mm.add(
        {
          motion: '(prefers-reduced-motion: no-preference)',
          fine: '(pointer: fine) and (min-width: 768px)',
        },
        (context) => {
          const { motion, fine } = context.conditions as { motion: boolean; fine: boolean }
          if (!motion) return

          let cancelled = false

          // Entry: a horizontal mask from the left and a settle in scale. The
          // frame is oversized before it lands so the settle never shows an
          // edge.
          gsap.set(element, { clipPath: 'inset(0% 100% 0% 0%)', scale: 1.06, opacity: 0.001 })

          void whenStageReady(waitForLoader).then(() => {
            if (cancelled) return
            gsap
              .timeline({
                onComplete: () => {
                  gsap.set(element, { clearProps: 'clipPath,opacity' })
                  if (!fine) {
                    gsap.set(element, { clearProps: 'transform' })
                    return
                  }
                  // Parallax, desktop only, after the settle so the two never
                  // fight over `y`. A quarter of the hero's height over the
                  // hero's own scroll-out; `scale` stays at 1.
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
                },
              })
              .to(element, {
                clipPath: 'inset(0% 0% 0% 0%)',
                opacity: 1,
                duration: 0.9,
                ease: 'power3.out',
              })
              .to(element, { scale: 1, duration: 1.4, ease: 'power2.out' }, 0)
          })

          return () => {
            cancelled = true
          }
        },
      )

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
