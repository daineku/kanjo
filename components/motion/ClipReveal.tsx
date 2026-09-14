'use client'

import { useRef, type ReactNode } from 'react'

import { gsap, useGSAP } from '@/lib/motion/gsap'

/**
 * A clip-path reveal for a media frame.
 *
 * ── WHAT WAS ADOPTED FROM THE REFERENCE, AND WHAT WAS NOT ───────────────────
 *
 * The reference's hero animates `#video-frame` between two `polygon()`
 * clip-paths on a SCRUBBED ScrollTrigger, so the video's own shape is distorted
 * continuously as the visitor scrolls, and the effect also animates
 * `borderRadius` alongside it.
 *
 * The technique is adopted. The scrub is not, and neither is the polygon.
 *
 *   - NO SCRUB. Continuously re-clipping a playing video means the compositor
 *     re-rasterises the frame on every scroll tick, for as long as the element
 *     is on screen. The brief's requirement is the opposite: the container
 *     enters through a restrained reveal, and once visible "video playback
 *     itself must remain normal". So this plays ONCE, then disposes, and the
 *     frame is left with no clip-path at all — not `inset(0)`, none: an element
 *     with a clip-path stays on its own compositing path forever.
 *
 *   - INSET, NOT POLYGON. A parallelogram slicing across a 16:9 video crops the
 *     footage and reads as a design flourish applied to someone else's picture.
 *     A horizontal band opening from the centre is the game's own screen-wipe
 *     language, and it never hides a pixel of the final frame.
 *
 *   - ANIMATABLE SHAPE. Both keyframes are `inset()` with the same number of
 *     arguments, which is what lets the browser interpolate at all — mixed
 *     shape functions fall back to a hard swap.
 */

export function ClipReveal({
  children,
  className,
}: {
  children: ReactNode
  className?: string
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
          narrow: '(max-width: 767px)',
        },
        (context) => {
          const { motion, narrow } = context.conditions as {
            motion: boolean
            narrow: boolean
          }
          if (!motion) return

          // A phone gets the simpler reveal the brief asks for: the band opens,
          // but without the accompanying scale, which is the expensive half and
          // the half that reads as fussy in a 390px column.
          // `opacity`, NOT `autoAlpha`. autoAlpha sets `visibility: hidden` at
          // zero, which removes everything inside from the tab order — and what
          // is inside this one is the video's PLAY button. Measured with
          // autoAlpha: a keyboard visitor tabbing down the homepage never
          // reached it, because an unfocusable block can never be scrolled to by
          // tabbing and so never reveals. See components/motion/Reveal.tsx.
          const from = narrow
            ? { clipPath: 'inset(32% 0% 32% 0%)', opacity: 0 }
            : { clipPath: 'inset(44% 0% 44% 0%)', opacity: 0, scale: 1.04 }

          gsap.set(element, from)

          gsap.to(element, {
            clipPath: 'inset(0% 0% 0% 0%)',
            opacity: 1,
            scale: 1,
            duration: narrow ? 0.62 : 0.88,
            ease: 'power3.out',
            onComplete: () => {
              // Hand the element back to the browser completely. An element
              // that keeps a clip-path keeps its own compositing layer, and a
              // playing video on its own layer for no reason is exactly the
              // cost this reveal was supposed to avoid.
              gsap.set(element, { clearProps: 'clipPath,transform,willChange' })
            },
            scrollTrigger: { trigger: element, start: 'top 85%', once: true },
          })
        },
      )

      // Focus moving into the frame reveals it at once, whatever the scroll
      // position — the clip is removed too, so the control is not half-masked.
      const onFocus = () => {
        gsap.to(element, {
          clipPath: 'inset(0% 0% 0% 0%)',
          opacity: 1,
          scale: 1,
          duration: 0.2,
          overwrite: 'auto',
        })
      }
      element.addEventListener('focusin', onFocus)

      return () => {
        element.removeEventListener('focusin', onFocus)
        mm.revert()
      }
    },
    { scope: root },
  )

  return (
    <div ref={root} className={className}>
      {children}
    </div>
  )
}
