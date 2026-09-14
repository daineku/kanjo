'use client'

/**
 * The site's responsive motion policy, in one place.
 *
 * Three axes, and they are independent:
 *
 *   reduced  — the visitor asked for less motion. A HARD stop on storytelling
 *              motion: no loops, no parallax, no scrub, no exceptions.
 *   coarse   — a touch screen. Hover is never the only way to reveal anything,
 *              pointer effects are off entirely, travel distances shrink.
 *   narrow   — phone width. Fewer simultaneous animated layers; no long pins.
 *
 * ── WHY THIS IS A PLAIN FUNCTION AND NOT A HOOK ─────────────────────────────
 *
 * Because it is read inside `useGSAP`, which runs in a LAYOUT effect — before
 * the browser paints. A hook would have to return a conservative value on the
 * first render and widen on the second, which means the first painted frame
 * shows the un-animated state and the animation's own `from` values land one
 * frame later. That is a visible flash on every reveal. Reading synchronously
 * before paint means the element is put into its start state and painted once.
 *
 * Components that must survive a preference CHANGE while the page is open use
 * `gsap.matchMedia()` instead, which re-runs and reverts on its own. This is for
 * the one-shot decisions (the loader) where that cannot happen in practice.
 */

export type MotionPolicy = {
  reduced: boolean
  coarse: boolean
  narrow: boolean
  /** May this element run a storytelling animation at all? */
  animate: boolean
  /** Multiplier for parallax and travel distances. 0 when motion is reduced. */
  distance: number
}

/** Matches the hero/section narrow breakpoint used throughout app/globals.css. */
export const NARROW_QUERY = '(max-width: 767px)'

/**
 * The conservative answer: everything off.
 *
 * Used on the server and wherever the environment cannot report a preference.
 * An environment that cannot tell us whether motion is welcome is not an
 * environment that has consented to it.
 */
const STILL: MotionPolicy = {
  reduced: true,
  coarse: false,
  narrow: false,
  animate: false,
  distance: 0,
}

export function readMotionPolicy(): MotionPolicy {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return STILL
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const narrow = window.matchMedia(NARROW_QUERY).matches

  return {
    reduced,
    coarse,
    narrow,
    animate: !reduced,
    // A phone moves less. The travel that reads as depth on a 1920 stage reads
    // as a jolt in a 390px column, and it costs the same compositing work on
    // hardware with a fraction of the budget.
    distance: reduced ? 0 : narrow || coarse ? 0.55 : 1,
  }
}
