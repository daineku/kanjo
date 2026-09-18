'use client'

import { useRef, useState } from 'react'

import { gsap, useGSAP } from '@/lib/motion/gsap'
import { readMotionPolicy } from '@/lib/motion/policy'
import { markStageReady } from '@/lib/motion/stage'
import type { LoaderConfig, LoaderIntensity } from '@/lib/content/types'

/**
 * THE KANJO's loader: two cars trading position on a night highway.
 *
 * ── WHY IT LOOKS LIKE THIS ──────────────────────────────────────────────────
 *
 * It is a STYLISED 2D SIDE VIEW, not a 3D scene. No Three.js, no WebGL, no
 * canvas: a dark road band, two lanes of moving dashes, two images, and a
 * couple of light streaks. Everything that moves moves with `transform` and
 * `opacity` only — the two properties a compositor can animate without asking
 * the main thread to lay anything out. On a mid-range phone that is the
 * difference between a loader and a stutter.
 *
 * ── HOW IT IS RENDERED ──────────────────────────────────────────────────────
 *
 * The markup is SERVER-RENDERED (a client component is not a client-only
 * component), so the highway is in the initial HTML and the loader is on screen
 * at first paint rather than after hydration. The two car images are plain
 * <img> for the same reason: next/image would route them through the optimizer
 * for a round trip the loader cannot afford, and they are SVG, which the
 * project's image config deliberately refuses to optimise anyway.
 *
 * ── THE CONTRACT WITH THE REST OF THE PAGE ──────────────────────────────────
 *
 * `<html data-loader="pending">` is set by the SERVER when the loader is on. It
 * locks scrolling (app/globals.css) and is what app/layout.tsx's <noscript>
 * overrides, so a visitor without JavaScript never sees a loader that cannot
 * lift. When the highway has masked away this component flips it to "done" and
 * calls `markStageReady()`, which is the hero title's cue — see lib/motion/stage.ts
 * for why the title belongs to the hero and not to the loader.
 *
 * ── WHAT "READY" MEANS ──────────────────────────────────────────────────────
 *
 * Hydration plus `document.fonts.ready`, raced against `maximumDisplayMs`. It
 * does NOT wait for the page's media: a loader that waits for every asset is a
 * loader that a slow video can hold open indefinitely. `minimumDisplayMs` is a
 * floor so a warm cache does not turn the entrance into a flicker, and the
 * maximum beats the minimum if they ever disagree.
 */

/** Seconds. One full trade of position, out and back. */
const CYCLE = 1.25

/** How far the cars travel, in vw. The stage is the viewport, so vw is the unit. */
const LANE = { aStart: 4.2, aEnd: -4.8, bStart: -4.2, bEnd: 5.2 }

type Phase = 'running' | 'gone'

/** The policy downgrade: a phone runs one intensity step below what is configured. */
function effectiveIntensity(
  configured: LoaderIntensity,
  small: boolean,
): LoaderIntensity {
  if (!small) return configured
  return configured === 'high' ? 'medium' : 'low'
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/**
 * App readiness. Two signals, both cheap, neither of which can hang forever on
 * its own — and the caller races the pair against the configured ceiling.
 */
function whenAppReady(): Promise<void> {
  const documentReady =
    document.readyState === 'complete'
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          window.addEventListener('load', () => resolve(), { once: true })
        })

  // The display face matters here: THE KANJO revealing in a fallback and
  // re-flowing to Big Shoulders a moment later is the one font swap on this site
  // that would be visible. `fonts.ready` never rejects, but guard anyway.
  const fontsReady = document.fonts?.ready
    ? document.fonts.ready.then(() => undefined).catch(() => undefined)
    : Promise.resolve()

  return Promise.all([documentReady, fontsReady]).then(() => undefined)
}

export function KanjoLoader({ config }: { config: LoaderConfig }) {
  const [phase, setPhase] = useState<Phase>('running')
  const root = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const element = root.current
      if (!element) return

      const policy = readMotionPolicy()
      const controller = new AbortController()
      const { signal } = controller
      const started = performance.now()

      // The ceiling is absolute: measured from the loader's first frame, and it
      // wins over the floor if a misconfiguration ever puts the minimum above it.
      const ceiling = started + Math.max(0, config.maximumDisplayMs)
      const floor = started + Math.max(0, config.minimumDisplayMs)

      /** Everything that repeats, so it can all be killed in one place. */
      const loops: gsap.core.Animation[] = []

      // Nothing behind the loader should be reachable while it is up. Set from
      // the client so a no-JavaScript visitor — who never sees the loader at
      // all — is never left with an inert page.
      const app = document.getElementById('app-root')
      app?.setAttribute('inert', '')

      const intensity = effectiveIntensity(config.intensity, policy.narrow || policy.coarse)

      // ── The still composition, in every case ──────────────────────────────
      // Both cars are placed by the same `set`, so the reduced-motion loader is
      // the identical picture with the motion removed rather than a second
      // layout that could drift away from this one.
      gsap.set('.k-loader-car', { xPercent: -50, yPercent: -50 })
      gsap.set('.k-loader-car--a', { x: `${LANE.aStart}vw` })
      gsap.set('.k-loader-car--b', { x: `${LANE.bStart}vw` })

      if (policy.reduced) {
        // ── REDUCED MOTION ───────────────────────────────────────────────────
        // No overtaking, no repeats, no road movement: a still frame of the same
        // highway, held briefly so the entrance still exists as a beat, then a
        // short fade straight to THE KANJO. Nothing here repeats, so there is
        // nothing to dispose beyond the fade itself.
        void (async () => {
          await wait(Math.min(600, config.minimumDisplayMs), signal)
          if (signal.aborted) return
          gsap.to(element, {
            autoAlpha: 0,
            duration: 0.18,
            ease: 'power1.out',
            onStart: finish,
            onComplete: () => setPhase('gone'),
          })
        })()
        return () => controller.abort()
      }

      // ── Motion field ───────────────────────────────────────────────────────
      // No painted road or lane strip: the loader is just the two cars and a
      // pair of fast light traces on black. That keeps the entrance graphic,
      // closer to the brand mark, and makes speed come from relative motion.
      if (intensity !== 'low') {
        // Restrained light accents. Two thin streaks, low opacity, no colour
        // beyond the canon's own — this is a night highway, not a neon city.
        loops.push(
          gsap.fromTo(
            '.k-loader-accent',
            { xPercent: 120, autoAlpha: 0 },
            {
              xPercent: -140,
              autoAlpha: 0.5,
              duration: 1.1,
              ease: 'none',
              repeat: -1,
              stagger: { each: 0.55, repeat: -1 },
            },
          ),
        )
      }

      // ── The overtake ──────────────────────────────────────────────────────
      // A yoyo timeline, so the cars trade position continuously and the loop
      // never snaps back: the return leg IS car A closing again. That is the
      // brief's choreography — B closes, B overtakes, the relative speed
      // changes, A begins catching — expressed as one seamless cycle rather
      // than as a sequence with a seam in it.
      const race = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: 'sine.inOut' } })
      race
        .to('.k-loader-car--a', { x: `${LANE.aEnd}vw`, scale: 1.025, duration: CYCLE, ease: 'power1.inOut' }, 0)
        // B is quicker into the move and eases off once it is clear, which is
        // what makes the pass read as a pass rather than as two sliding shapes.
        .to('.k-loader-car--b', { x: `${LANE.bEnd}vw`, scale: 1.02, duration: CYCLE * 0.78, ease: 'power2.inOut' }, 0)
        .to('.k-loader-car--b', { x: `${LANE.bEnd + 1.2}vw`, duration: CYCLE * 0.22, ease: 'sine.out' }, CYCLE * 0.78)
      loops.push(race)

      /** Hands the stage over. Called once, as the overlay starts to dissolve. */
      function finish() {
        document.documentElement.dataset.loader = 'done'
        app?.removeAttribute('inert')
        markStageReady()
      }

      // ── The exit ──────────────────────────────────────────────────────────
      void (async () => {
        await Promise.race([whenAppReady(), wait(ceiling - performance.now(), signal)])
        if (signal.aborted) return
        await wait(Math.min(floor, ceiling) - performance.now(), signal)
        if (signal.aborted) return

        // MOTION RESOLVES, IT DOES NOT STOP. The race timeline is killed only
        // after the outro tweens have read the cars' CURRENT positions, so both
        // continue from wherever they happen to be and accelerate away. There is
        // no snap, and no dependency on where the loop happened to be paused.
        const outro = gsap.timeline({
          onComplete: () => {
            // Dispose everything that repeats. useGSAP's context revert would
            // catch these on unmount anyway; doing it here means not one frame
            // of the loader's animation survives the transition.
            for (const loop of loops) loop.kill()
            setPhase('gone')
          },
        })

        outro
          .to('.k-loader-car--b', { x: '+=46vw', duration: 0.5, ease: 'power2.in' }, 0)
          .to('.k-loader-car--a', { x: '+=46vw', duration: 0.55, ease: 'power2.in' }, 0.05)
          // The motion accelerates with the cars rather than stopping under them.
          .to(loops, { timeScale: 3.8, duration: 0.34, ease: 'power1.in' }, 0)
          .to('.k-loader-accent', { autoAlpha: 0, duration: 0.18 }, 0.24)
          // THE KANJO's cue fires here, so the title arrives as the loader
          // dissolves rather than after a gap.
          .to(element, { autoAlpha: 0, duration: 0.42, ease: 'power1.out', onStart: finish }, 0.44)
      })()

      return () => {
        controller.abort()
        // Belt and braces: if the component is torn down mid-sequence — a fast
        // client-side navigation, a hot reload — the page must not stay locked.
        finish()
      }
    },
    { scope: root },
  )

  if (phase === 'gone') return null

  const intensity = config.intensity

  return (
    <div
      ref={root}
      className="k-loader"
      data-intensity={intensity}
      role="status"
      aria-label="Loading"
      aria-live="polite"
    >
      <div className="k-loader-stage" aria-hidden="true">
        {/* Always in the DOM, never conditionally rendered: the intensity that
            decides whether they move is a client-side measurement, and adding or
            removing nodes based on it would be a hydration mismatch. GSAP simply
            leaves them at opacity 0 when the policy says no accents. */}
        <span className="k-loader-accent k-loader-accent--1" />
        <span className="k-loader-accent k-loader-accent--2" />

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="k-loader-car k-loader-car--b"
          src={config.carB.src}
          alt=""
          width={config.carB.width}
          height={config.carB.height}
          decoding="async"
          fetchPriority="high"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="k-loader-car k-loader-car--a"
          src={config.carA.src}
          alt=""
          width={config.carA.width}
          height={config.carA.height}
          decoding="async"
          fetchPriority="high"
        />
      </div>
    </div>
  )
}
