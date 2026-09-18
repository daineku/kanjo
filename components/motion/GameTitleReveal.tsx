'use client'

import { Fragment, useRef } from 'react'

import { gsap, useGSAP } from '@/lib/motion/gsap'

/**
 * Section-title entrance adapted from the reference repositories' AnimatedTitle.
 *
 * Reference motion:
 *   translate3d(10px, 51px, -60px)
 *   rotateY(60deg) rotateX(-40deg)
 *   opacity 0 -> 1
 *   per-word stagger
 *
 * The Kanjo keeps that 3D word-arrival language, but applies the hidden start
 * state in a layout effect instead of CSS. That preserves the finished heading
 * for crawlers, failed hydration and reduced-motion visitors.
 */
export function GameTitleReveal({
  text,
  id,
  level = 2,
  className,
  style,
}: {
  text: string
  id?: string
  level?: 1 | 2
  className?: string
  style?: React.CSSProperties
}) {
  const root = useRef<HTMLHeadingElement>(null)
  const Heading = level === 1 ? 'h1' : 'h2'
  const lines = text.split('\n')

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

          const words = Array.from(
            element.querySelectorAll<HTMLElement>('.k-game-title-word'),
          )
          if (words.length === 0) return

          // Same gaming-title geometry as the reference, slightly restrained on
          // phones so the perspective does not dominate a narrow two-line title.
          gsap.set(words, {
            opacity: 0,
            x: narrow ? 6 : 10,
            y: narrow ? 30 : 44,
            z: narrow ? -38 : -60,
            rotateY: narrow ? 36 : 58,
            rotateX: narrow ? -28 : -38,
            transformOrigin: narrow ? '50% 50% -90px' : '50% 50% -140px',
          })
          gsap.set(element, { perspective: narrow ? 560 : 760 })

          gsap.to(words, {
            opacity: 1,
            x: 0,
            y: 0,
            z: 0,
            rotateY: 0,
            rotateX: 0,
            duration: narrow ? 0.62 : 0.72,
            ease: 'power2.inOut',
            stagger: narrow ? 0.028 : 0.035,
            onStart: () => {
              for (const word of words) word.style.willChange = 'transform, opacity'
            },
            onComplete: () => {
              for (const word of words) {
                word.style.willChange = ''
                gsap.set(word, { clearProps: 'transform,opacity,transformOrigin' })
              }
              gsap.set(element, { clearProps: 'perspective' })
            },
            scrollTrigger: {
              trigger: element,
              // The reference starts as the title enters from the bottom of the
              // viewport. Settle it a little earlier for The Kanjo's compact
              // sections, then dispose after one play.
              start: 'top 90%',
              once: true,
            },
          })
        },
      )

      return () => mm.revert()
    },
    { scope: root },
  )

  return (
    <Heading ref={root} id={id} className={className} style={style}>
      {lines.map((line, lineIndex) => {
        const words = line.split(/\s+/).filter(Boolean)
        return (
          <Fragment key={`${line}-${lineIndex}`}>
            <span className="k-game-title-line">
              {words.map((word, wordIndex) => (
                <Fragment key={`${word}-${wordIndex}`}>
                  <span className="k-game-title-word">{word}</span>
                  {wordIndex < words.length - 1 ? ' ' : null}
                </Fragment>
              ))}
            </span>
          </Fragment>
        )
      })}
    </Heading>
  )
}
