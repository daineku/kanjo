'use client'

import { useRef, type ReactNode } from 'react'

import { gsap, useGSAP } from '@/lib/motion/gsap'

/**
 * The site's one scroll reveal.
 *
 * ── THE RULE THIS COMPONENT EXISTS TO ENFORCE ───────────────────────────────
 *
 * CONTENT STARTS VISIBLE. There is no `opacity: 0` in a stylesheet anywhere in
 * this reveal. The start state is applied by `gsap.set` inside a layout effect —
 * that is, by JavaScript, at the moment something is definitely going to animate
 * it back. So:
 *
 *   - a visitor with prefers-reduced-motion sees the finished page, because the
 *     set never runs
 *   - a visitor whose JavaScript failed sees the finished page
 *   - a crawler sees the finished page
 *   - and there is no way to end up with an element stuck at opacity 0, which
 *     is the single most common failure of this pattern
 *
 * Because the set happens in a LAYOUT effect it lands before the first paint,
 * so nothing flashes in and back out either.
 *
 * ── WHY IT WRAPS RATHER THAN BEING A HOOK ───────────────────────────────────
 *
 * `children` is a slot. A server component passes server-rendered markup
 * through it and none of that markup becomes client code — the section stays
 * server-rendered, and the only thing shipped to the browser is this wrapper.
 * That is what keeps the homepage from becoming one giant `'use client'`.
 *
 * ── SCROLLTRIGGER BUDGET ────────────────────────────────────────────────────
 *
 * One trigger per instance, `once: true`, and no scrub. A reveal that plays
 * once and disposes is a trigger the browser stops thinking about; a scrubbed
 * one is work on every scroll frame for the life of the page. The homepage uses
 * exactly three of these plus one clip reveal.
 */

export function Reveal({
  children,
  /** Stagger between direct children. 0 reveals the block as one unit. */
  stagger = 0,
  /** Travel in px at full strength. Scaled down on a phone by the policy below. */
  distance = 24,
  delay = 0,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode
  stagger?: number
  distance?: number
  delay?: number
  className?: string
  as?: 'div' | 'ul' | 'section'
}) {
  const root = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      const element = root.current
      if (!element) return

      // gsap.matchMedia() rather than a one-shot media query read: it re-runs
      // when the conditions change and REVERTS everything it created when they
      // stop matching. A visitor who turns on reduced motion mid-page gets the
      // start state undone rather than a half-played animation frozen in place.
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

          const targets = stagger > 0 ? Array.from(element.children) : [element]
          if (targets.length === 0) return

          const travel = distance * (narrow ? 0.55 : 1)

          // THE START STATE, applied here and nowhere else. See the header.
          //
          // `opacity`, NOT `autoAlpha`. GSAP's autoAlpha sets `visibility:
          // hidden` at zero, which takes the element out of the TAB ORDER and
          // out of the accessibility tree. Measured: with autoAlpha, a keyboard
          // visitor tabbing down the homepage went Skip link → TikTok → Patreon
          // → footer, SKIPPING THE VIDEO'S PLAY BUTTON entirely — because the
          // block was still hidden, so it was not focusable, so it could never
          // be scrolled to by tabbing, so it never revealed. A reveal that can
          // hide content from a keyboard is not an acceptable reveal.
          gsap.set(targets, { y: travel, opacity: 0 })

          gsap.to(targets, {
            y: 0,
            opacity: 1,
            duration: 0.62,
            delay,
            ease: 'power2.out',
            stagger,
            // will-change for the duration of the tween only. Left on
            // permanently it promotes a layer per revealed block and never
            // releases it, which on a phone is memory spent on finished work.
            onStart: () => {
              for (const target of targets) {
                ;(target as HTMLElement).style.willChange = 'transform, opacity'
              }
            },
            onComplete: () => {
              for (const target of targets) {
                ;(target as HTMLElement).style.willChange = ''
              }
            },
            scrollTrigger: {
              trigger: element,
              // Slightly inside the fold, so a block is already settled by the
              // time it is comfortably readable rather than moving under the eye.
              start: 'top 88%',
              // Fires once and disposes. No scrub, nothing left listening.
              once: true,
              // Belt to the braces above: focus moving into a block reveals it
              // immediately, whatever the scroll position. A browser scrolls a
              // focused element into view, which would fire the trigger anyway
              // — but this removes any dependence on that happening.
              onRefresh: (self) => {
                if (self.isActive) self.animation?.play()
              },
            },
          })
        },
      )

      // Focus is a reveal cue in its own right. Cheap — one listener per block,
      // removed with the context — and it closes the last gap between "visible
      // to a mouse" and "reachable by a keyboard".
      const onFocus = () => {
        gsap.to(element.children.length && stagger > 0 ? Array.from(element.children) : [element], {
          y: 0,
          opacity: 1,
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
    // @ts-expect-error — one ref type for three possible tags; the DOM node is
    // an HTMLElement in every case, which is what the effect above needs.
    <Tag ref={root} className={className}>
      {children}
    </Tag>
  )
}
