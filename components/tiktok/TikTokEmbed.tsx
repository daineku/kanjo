'use client'

import { useEffect, useRef } from 'react'

import { whenStageReady } from '@/lib/motion/stage'

const EMBED_SRC = 'https://www.tiktok.com/embed.js'

/**
 * Injects TikTok's embed script, and guarantees there is never more than one.
 *
 * ── WHY THIS IS NOT `next/script` ───────────────────────────────────────────
 *
 * It was, and the behaviour was measured: `next/script` REMOVES its script
 * element when the component unmounts and re-adds it on remount. A client-side
 * navigation to /updates and back therefore produced two `embed.js` requests
 * and, more importantly, took the decision out of our hands.
 *
 * ── AND WHY RE-RUNNING IT ON A REMOUNT IS CORRECT, NOT A BUG ────────────────
 *
 * `embed.js` scans for `.tiktok-embed` elements once, when it executes. After a
 * client-side navigation React has mounted a BRAND NEW blockquote, and a script
 * that already ran will never look at it — so a visitor returning to the
 * homepage would see the CTA where the embed used to be. Re-executing is the
 * only mechanism TikTok offers for a re-scan; there is no documented public
 * re-init function.
 *
 * So the invariants this function actually holds are the ones that matter:
 *
 *   - AT MOST ONE script tag exists in the document at any moment. The previous
 *     one is removed before the new one is appended, so tags never stack.
 *   - ONE fetch per mount that needs processing. Not per scroll, not per
 *     render, not on hover, and never on a timer.
 *   - The second fetch is the same URL, so the browser serves it from cache.
 *
 * What it deliberately does NOT do is re-inject while the section is still
 * mounted — that would be the initialisation loop the brief rules out, and the
 * caller's one-way latch is what prevents it.
 */
function injectEmbedScript(): void {
  for (const previous of document.querySelectorAll('script[data-tiktok-embed]')) {
    previous.remove()
  }
  const script = document.createElement('script')
  script.src = EMBED_SRC
  script.async = true
  script.dataset.tiktokEmbed = 'true'
  document.head.appendChild(script)
}

/**
 * TikTok's official Creator Profile Embed.
 *
 * ── THE MARKUP IS BUILT HERE, FROM A VALIDATED HANDLE ───────────────────────
 *
 * TikTok's documented embed is a `<blockquote class="tiktok-embed">` carrying
 * `cite` and `data-unique-id`, which their `embed.js` finds and replaces with an
 * iframe. Both attributes derive from the profile handle, and the handle comes
 * from ADMIN-EDITABLE CONTENT — so it is validated by
 * `lib/tiktok/profile.ts#tikTokHandle` on the server (2–24 characters of
 * `[A-Za-z0-9_.]`) and this component receives only that.
 *
 * There is NO `dangerouslySetInnerHTML` anywhere in this file, and no HTML from
 * any API is inserted into the page. An admin cannot introduce a script tag
 * through this route, because there is no route: the only thing that crosses
 * the boundary is a handle matching that character class.
 *
 * ── THE FALLBACK IS THE INITIAL CONTENT, NOT AN ERROR STATE ─────────────────
 *
 * The `<section>` inside the blockquote is what a visitor sees until TikTok's
 * script replaces it — and what they keep seeing if TikTok is blocked, slow, or
 * unreachable. So it is not a spinner: it is the FOLLOW ON TIKTOK link, styled
 * like the rest of the site. There is no state in which this block is an empty
 * black rectangle waiting for something that is never coming. That is also the
 * official pattern — the blockquote's own content is the documented fallback.
 *
 * ── LOADING: TWO GATES, AND BOTH ARE NECESSARY ──────────────────────────────
 *
 * `embed.js` pulls in more bytes than the rest of this page put together, so
 * it waits for both of these:
 *
 *   1. THE LOADER HAS FINISHED. Measured without this gate: the section sits
 *      within the observer's margin of the viewport on a 1440x900 screen, so
 *      the observer fired on mount and embed.js was requested WHILE the
 *      highway was still animating — competing for bandwidth and main thread
 *      with the one animation the visitor is actually looking at. An
 *      IntersectionObserver answers "is it near the viewport", which is not the
 *      same question as "is the page ready for it".
 *
 *   2. THE SECTION IS NEAR THE VIEWPORT. One IntersectionObserver, disconnected
 *      the moment it fires. No polling, no scroll listener, no hover trigger.
 *
 * It is injected AT MOST ONCE PER MOUNT, by `injectEmbedScript` above, which
 * also guarantees only one script tag exists at a time. `loaded` is a one-way
 * latch, so no amount of scrolling, re-rendering or resizing can ask for it
 * twice while the section stays mounted.
 */

export function TikTokEmbed({
  handle,
  profileUrl,
  ctaLabel,
  waitForLoader,
}: {
  /** Already validated server-side. `[A-Za-z0-9_.]{2,24}`, no `@`. */
  handle: string
  /** Canonical, rebuilt from the validated handle. */
  profileUrl: string
  ctaLabel: string
  /** False when the loader is off: there is then nothing to wait for. */
  waitForLoader: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  /**
   * The one-way latch. A ref rather than state because nothing on screen
   * depends on it — asking for the script is a side effect, and making it a
   * state update would re-render the section for no visual reason.
   */
  const requested = useRef(false)

  useEffect(() => {
    const element = root.current
    if (!element) return

    let observer: IntersectionObserver | null = null
    let cancelled = false

    const request = () => {
      if (requested.current) return
      requested.current = true
      injectEmbedScript()
    }

    // GATE 1. `whenStageReady` always resolves — immediately when there is no
    // loader, and on its own backstop if the loader never reports — so the
    // embed can never be stranded behind a loader that failed.
    void whenStageReady(waitForLoader).then(() => {
      if (cancelled) return

      // No IntersectionObserver (an old browser, a test harness): load it
      // rather than leaving the block permanently inert. The CTA is already
      // visible, so the embed is the only thing that could be missing.
      if (typeof IntersectionObserver !== 'function') {
        request()
        return
      }

      // GATE 2.
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return
          // Disconnect FIRST. The latch is idempotent, but an observer left
          // attached to a section this tall would keep firing for the rest of
          // the page's life for no reason.
          observer?.disconnect()
          request()
        },
        // Half a screen of lead time. Enough that the embed is usually ready by
        // the time the section is read, and not so much that it counts as
        // "on load" on a short page.
        { rootMargin: '400px 0px' },
      )
      observer.observe(element)
    })

    return () => {
      cancelled = true
      observer?.disconnect()
    }
  }, [waitForLoader])

  return (
    <div className="k-tiktok" ref={root}>
      {/*
        The documented TikTok creator embed. `data-embed-type="creator"` is what
        selects the profile block rather than a single video.

        `suppressHydrationWarning` is on the blockquote because TikTok's script
        mutates this subtree — it is the one place in this codebase where the
        DOM is expected to diverge from React's idea of it, and saying so here
        is better than a console warning nobody can act on.
      */}
      <blockquote
        className="tiktok-embed"
        cite={profileUrl}
        data-unique-id={handle}
        data-embed-type="creator"
        suppressHydrationWarning
      >
        <section>
          <a
            className="k-link-action"
            href={profileUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {ctaLabel}
          </a>
        </section>
      </blockquote>
    </div>
  )
}
