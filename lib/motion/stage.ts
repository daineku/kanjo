'use client'

/**
 * The handshake between the loader and the page underneath it.
 *
 * THE PROBLEM THIS SOLVES. The brief's sequence ends "highway masks away → THE
 * KANJO appears → homepage becomes interactive". That is ONE title moment, not
 * two: a title inside the loader followed by a second title in the hero would
 * make the visitor watch the same word arrive twice, and it is explicitly not
 * wanted ("do not make the user wait through another long title animation after
 * the loader"). So the hero owns the title, and the loader tells it when to
 * play.
 *
 * WHY A MODULE SINGLETON RATHER THAN CONTEXT. A React context would force a
 * client provider around the whole tree, which is precisely the "giant use
 * client homepage" the brief rules out — the hero title island and the loader
 * are siblings that never need to share a render. A module-level promise is
 * shared by every importer in the same bundle, costs no re-render, and works
 * whichever of the two mounts first.
 *
 * THE SAFETY PROPERTY THAT MATTERS: `whenStageReady` ALWAYS RESOLVES. It
 * resolves when the loader finishes, or on its own timeout if the loader never
 * reports — a crashed loader must not leave the page's content permanently
 * mid-animation. Combined with the reveal components' rule that content starts
 * VISIBLE and is only hidden by JavaScript about to animate it, there is no
 * path to an element stuck at opacity 0.
 */

/** The ceiling on waiting for the loader, whatever it says its own maximum is. */
const HARD_TIMEOUT_MS = 12_000

let resolveReady: (() => void) | null = null
let readyPromise: Promise<void> | null = null

function ensurePromise(): Promise<void> {
  readyPromise ??= new Promise<void>((resolve) => {
    resolveReady = resolve
    // The backstop. If nothing ever calls markStageReady — the loader threw, or
    // was removed by an extension — the page still comes alive.
    setTimeout(resolve, HARD_TIMEOUT_MS)
  })
  return readyPromise
}

/** Called once by the loader when the highway has masked away. */
export function markStageReady(): void {
  ensurePromise()
  resolveReady?.()
  resolveReady = null
}

/**
 * Resolves when the stage is the visitor's.
 *
 * `waitForLoader: false` resolves on the next microtask — the caller is on a
 * page with no loader, so there is nothing to wait for.
 */
export function whenStageReady(waitForLoader: boolean): Promise<void> {
  if (!waitForLoader) return Promise.resolve()
  return ensurePromise()
}
