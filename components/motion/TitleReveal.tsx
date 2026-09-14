'use client'

import { Fragment, useRef } from 'react'

import { gsap, useGSAP } from '@/lib/motion/gsap'
import { readMotionPolicy } from '@/lib/motion/policy'
import { whenStageReady } from '@/lib/motion/stage'

/**
 * THE KANJO arriving. The site's primary identity moment.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
 *
 * The reference's `AnimatedTitle` takes a string containing `<br />` and `<b>`
 * tags, splits it, and writes each word into the DOM with
 * `dangerouslySetInnerHTML`. That makes the title a MARKUP CHANNEL: any title
 * that reaches it — and on this site the title is admin-editable content — is
 * parsed as HTML. It is also how the reference gets its per-character font
 * swap, which is a Zentry typeface trick and not ours.
 *
 * Here the title is a STRING. It is split on whitespace in JavaScript and each
 * word becomes a text node inside a span. There is no HTML parsing anywhere in
 * the path from the content file to the screen, so the worst an editor can do
 * with the title field is write a strange title.
 *
 * ── THE EFFECT ──────────────────────────────────────────────────────────────
 *
 * A masked vertical reveal: each word sits in an `overflow: hidden` box and
 * rises into it, with a small stagger, a slight perspective tilt, and a tracking
 * that settles from open to the canon's own. It runs for about half a second.
 * The brief's constraint is that the visitor must not wait through a second
 * long animation after the loader, so this is fast and it overlaps the loader's
 * dissolve rather than following it.
 *
 * ── THE CUE ─────────────────────────────────────────────────────────────────
 *
 * `whenStageReady` — see lib/motion/stage.ts. The loader calls `markStageReady`
 * as it begins to fade, so the title rises through the last of the dissolve.
 * With no loader configured the promise resolves immediately.
 *
 * ── AND IF ANY OF THAT FAILS ────────────────────────────────────────────────
 *
 * The words are plain text in the server-rendered HTML, fully visible, with no
 * opacity in the stylesheet. They are hidden only by `gsap.set` in a layout
 * effect, which runs before the first paint and only when motion is welcome.
 * Reduced motion, failed hydration and a crawler all see a finished title.
 */

export function TitleReveal({
  text,
  className,
  id,
  /** False when the loader is off: there is then no cue to wait for. */
  waitForLoader,
  /** The admin's `titleRevealEnabled`. Off, the title is simply present. */
  enabled,
}: {
  text: string
  className?: string
  id?: string
  waitForLoader: boolean
  enabled: boolean
}) {
  const root = useRef<HTMLHeadingElement>(null)
  const words = text.split(/\s+/).filter(Boolean)

  useGSAP(
    () => {
      const element = root.current
      if (!element || !enabled) return

      const policy = readMotionPolicy()
      if (!policy.animate) return

      const inners = element.querySelectorAll<HTMLElement>('.k-word-in')
      if (inners.length === 0) return

      let cancelled = false

      // Hidden BEFORE the first paint, and only on the branch that is certainly
      // going to animate it back. Under the loader this happens behind an opaque
      // overlay, so there is nothing to see even in theory.
      gsap.set(inners, {
        yPercent: 118,
        // `opacity`, not `autoAlpha`: autoAlpha's `visibility: hidden` would
        // take the site's own name out of the accessibility tree for the
        // duration of the loader. Opacity leaves the h1 readable to anything
        // that is not looking at pixels.
        opacity: 0,
        // The "small perspective correction" — a few degrees, from below, so the
        // words rotate up onto the plane rather than sliding flat. Any more and
        // it stops being a game title and starts being a slide transition.
        rotateX: -32,
        transformOrigin: '50% 100% -12px',
      })
      gsap.set(element, { perspective: 620 })

      void whenStageReady(waitForLoader).then(() => {
        if (cancelled) return

        gsap
          .timeline({
            onComplete: () => {
              // Release the compositing hints and the perspective context. The
              // title is static for the rest of the page's life.
              gsap.set(inners, { clearProps: 'all' })
              gsap.set(element, { clearProps: 'perspective,letterSpacing' })
            },
          })
          .to(inners, {
            yPercent: 0,
            opacity: 1,
            rotateX: 0,
            duration: 0.72,
            ease: 'power3.out',
            stagger: 0.075,
          })
          // Tracking settles from slightly open to the canon's own value. It is
          // the quietest part of the effect and the one that makes it read as
          // typography arriving rather than as boxes moving.
          .fromTo(
            element,
            { letterSpacing: '0.22em' },
            { letterSpacing: '', duration: 0.9, ease: 'power2.out' },
            0,
          )
      })

      return () => {
        cancelled = true
      }
    },
    { scope: root },
  )

  return (
    <h1 ref={root} id={id} className={className}>
      {words.map((word, index) => (
        // The separating space is a real text node OUTSIDE the masked box. Put
        // it inside and `overflow: hidden` eats it, which welds the words
        // together the moment the line wraps — and it would still be missing
        // from anything the visitor copies.
        <Fragment key={`${word}-${index}`}>
          <span className="k-word">
            <span className="k-word-in">{word}</span>
          </span>
          {index < words.length - 1 ? ' ' : null}
        </Fragment>
      ))}
    </h1>
  )
}
