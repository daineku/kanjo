'use client'

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

/**
 * The one place GSAP is configured, and the one place its plugins are
 * registered.
 *
 * WHY A MODULE RATHER THAN A `registerPlugin` CALL PER COMPONENT. The reference
 * implementation calls `gsap.registerPlugin(ScrollTrigger)` at the top of four
 * separate files. That is harmless in a Vite SPA with one bundle; in Next it
 * means four client components each pulling GSAP into their own chunk boundary
 * and each re-running registration on import. Registering once, here, means one
 * shared chunk and one source of truth for the defaults below.
 *
 * `'use client'` is on the module, so importing it from a server component is a
 * build error rather than a runtime surprise.
 */

/**
 * ── THE `typeof window` GUARD IS NOT DEFENSIVE, IT IS REQUIRED ──────────────
 *
 * `'use client'` marks the boundary of the CLIENT BUNDLE; it does not stop the
 * module from executing on the server. Next still renders client components to
 * HTML during the build, so everything at this module's top level runs in Node
 * first. `ScrollTrigger.config()` reads the document while it does it, and the
 * measured result of not guarding it was a hard build failure:
 *
 *   TypeError: Cannot read properties of undefined (reading 'length')
 *   Export encountered an error on /updates/page
 *
 * Registration and defaults are set inside the same guard, so the browser gets
 * them exactly once — on the first import of this module — and the server does
 * no GSAP setup at all.
 */
if (typeof window !== 'undefined') {
  gsap.registerPlugin(useGSAP, ScrollTrigger)

  /**
   * Project-wide defaults.
   *
   * The canon's motion budget (UI_Canon/Tokens/motion.json) tops out at 160ms
   * for interface transitions, with `cubic-bezier(0, 0, 0.58, 1)` as its
   * ease-out — which is exactly `power1.out`. A cinematic entrance may run
   * longer than an interface transition, but it inherits the same curve, so the
   * site's motion reads as one hand.
   */
  gsap.defaults({ ease: 'power1.out', duration: 0.6 })

  /**
   * ScrollTrigger recalculates on settled events rather than on every resize.
   *
   * Mobile browsers fire resize continuously while the URL bar collapses.
   * Without this, each of those frames triggers a full refresh — a layout read
   * of every trigger on the page — during the exact scroll that caused it.
   */
  ScrollTrigger.config({ autoRefreshEvents: 'visibilitychange,DOMContentLoaded,load' })
}

export { gsap, ScrollTrigger, useGSAP }
