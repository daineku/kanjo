'use client'

import Image from 'next/image'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ImageRef } from '@/lib/content/types'
import { whenStageReady } from '@/lib/motion/stage'
import { readTikTokRenderSignal } from '@/lib/tiktok/signal'

const EMBED_SRC = 'https://www.tiktok.com/embed.js'

/**
 * The ceiling on waiting for TikTok, from the moment the embed is asked for.
 * Past it the module settles on its own preview — it does not keep listening,
 * because a feed that appears under a visitor who has moved on is a layout
 * shift, not an enhancement.
 */
const RENDER_TIMEOUT_MS = 12_000

/**
 * How long a loaded iframe gets to prove it rendered. The embedded application
 * posts its height within a moment of running; the one-line provider error
 * ("overload-protect triggered") never runs anything, so after its `load` the
 * silence is the answer. Measured against TikTok's 503: load fires in well
 * under a second, so this is what makes a rate-limited visit settle quickly
 * rather than after the full ceiling.
 */
const SILENCE_AFTER_LOAD_MS = 4_000

/**
 * How many times the official embed may be asked for per mount, in total. One
 * automatic attempt plus one the visitor asks for explicitly; in manual mode,
 * two explicit asks. Never a loop, never a timer.
 */
const MAX_ATTEMPTS = 2

/** The creator card is laid out at this width inside TikTok's own application. */
const PROVIDER_NATIVE_WIDTH = 720

type Phase = 'preview' | 'loading' | 'live' | 'unavailable'

type TikTokEmbedRuntime = {
  lib?: {
    render?: (embeds: Element[]) => unknown
  }
}

function tikTokRuntime(): TikTokEmbedRuntime | undefined {
  return (window as Window & { tiktokEmbed?: TikTokEmbedRuntime }).tiktokEmbed
}

/**
 * Asks TikTok to render ONE blockquote, without re-downloading or re-executing
 * `embed.js` when its runtime is already resident.
 *
 * `embed.js` is a bootstrap: it loads TikTok's library and installs a global
 * `tiktokEmbed.lib.render()`. On the first mount the script is appended and
 * its own first-run scan finds the blockquote. On a later mount — a client-side
 * navigation back to the homepage — the runtime is asked to render the new
 * blockquote directly, which is the only re-scan mechanism TikTok offers and
 * costs no network request at all.
 *
 * Resolves to false when nothing could be asked: the script failed to load
 * (blocked, offline) or the runtime threw. The caller treats that as
 * "unavailable" at once rather than waiting out the ceiling.
 */
function askProviderToRender(blockquote: HTMLElement): Promise<boolean> {
  const lib = tikTokRuntime()?.lib
  if (lib && typeof lib.render === 'function') {
    try {
      // Called AS A METHOD: `render` is async and reaches for `this` on a
      // later tick, so a detached reference throws "reading
      // 'addPreConnectInstruction' of undefined" inside the promise.
      return Promise.resolve(lib.render([blockquote]))
        .then(() => true)
        .catch(() => false)
    } catch {
      // A provider-runtime failure is not answered by re-injecting the script:
      // that is exactly the retry storm this integration must avoid.
      return Promise.resolve(false)
    }
  }

  // At most one script tag, ever. A previous tag that FAILED is removed before
  // a new one is appended, so an explicit retry after an outage can succeed;
  // a previous tag that loaded is left alone, because its runtime is what the
  // branch above uses.
  const existing = document.querySelector<HTMLScriptElement>('script[data-tiktok-embed]')
  if (existing) {
    if (existing.dataset.tiktokEmbed === 'failed') existing.remove()
    else return Promise.resolve(true)
  }

  return new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = EMBED_SRC
    script.async = true
    script.dataset.tiktokEmbed = 'loading'
    script.onload = () => {
      script.dataset.tiktokEmbed = 'loaded'
      resolve(true)
    }
    script.onerror = () => {
      script.dataset.tiktokEmbed = 'failed'
      resolve(false)
    }
    document.head.appendChild(script)
  })
}

/**
 * TikTok's official Creator Profile Embed, inside a module the site owns.
 *
 * ── THE PROBLEM, STATED PRECISELY ───────────────────────────────────────────
 *
 * The embed is a cross-origin iframe on `https://www.tiktok.com`. TikTok's
 * anonymous embed ingress rate-limits aggressively and answers
 * `503 overload-protect triggered` as a one-line text document. The iframe's
 * `load` event fires for that document exactly as it does for a real profile,
 * TikTok's own library reveals the iframe on `load`, and the parent page cannot
 * read the iframe's status or text — so the visitor was left looking at a
 * provider error in the middle of the homepage. See lib/tiktok/signal.ts for
 * what the parent page CAN observe, and why it is a heuristic.
 *
 * ── THE DESIGN: PREVIEW FIRST, EMBED AS PROOF-OF-RENDER ENHANCEMENT ─────────
 *
 * Four states, one DOM:
 *
 *   preview      Server-rendered. The site-owned preview (editable artwork,
 *                the real handle, the direct profile link). Complete on its
 *                own; what a crawler, a no-JavaScript visitor and a visitor
 *                with TikTok blocked all see.
 *   loading      The official embed has been asked for. It renders into a
 *                wrapper that is in the page's layout but invisible and inert,
 *                UNDER the preview, so whatever TikTok puts there is never on
 *                screen. The preview carries a quiet status line.
 *   live         TikTok's library posted the render signal for OUR blockquote.
 *                The embed is revealed and the preview fades under it.
 *   unavailable  No signal within the ceiling, the script was blocked, or the
 *                runtime threw. The preview stays; the hidden wrapper is
 *                dropped; one explicit retry is offered.
 *
 * The iframe's `load` event is deliberately NOT a reveal condition.
 *
 * ── LOADING POLICY ──────────────────────────────────────────────────────────
 *
 * 'auto' asks exactly once, after BOTH gates: the loader has finished (an
 * IntersectionObserver answers "is it near the viewport", which is not "is the
 * page ready for it") and the section is within 120px of the viewport. One
 * observer, disconnected the moment it fires; no scroll listener, no polling,
 * no timer-driven retry. 'manual' never contacts TikTok until a visitor asks.
 *
 * ── THE MARKUP IS BUILT HERE, FROM A VALIDATED HANDLE ───────────────────────
 *
 * The blockquote's `cite` and `data-unique-id` derive from the profile handle,
 * which comes from admin-editable content and is validated by
 * `lib/tiktok/profile.ts#tikTokHandle` on the server. There is no
 * `dangerouslySetInnerHTML` here and no HTML from any API; the only thing that
 * crosses the boundary is a handle matching `[A-Za-z0-9_.]{2,24}`.
 */

export function TikTokEmbed({
  handle,
  profileUrl,
  ctaLabel,
  preview,
  embedLoading,
  waitForLoader,
}: {
  /** Already validated server-side. `[A-Za-z0-9_.]{2,24}`, no `@`. */
  handle: string
  /** Canonical, rebuilt from the validated handle. */
  profileUrl: string
  ctaLabel: string
  /** Site-owned artwork or an authorised snapshot. Never a fabricated feed. */
  preview: ImageRef
  embedLoading: 'auto' | 'manual'
  /** False when the loader is off: there is then nothing to wait for. */
  waitForLoader: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const providerRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<Phase>('preview')
  /**
   * Which attempt the current blockquote belongs to. It keys the blockquote,
   * so a retry mounts a FRESH one: TikTok's library assigns an id and appends
   * an iframe to whatever it rendered into, and asking it to render into the
   * same node again would stack a second iframe under the first.
   */
  const [attempt, setAttempt] = useState(0)
  const phaseRef = useRef<Phase>('preview')
  phaseRef.current = phase

  const request = useCallback(() => {
    if (phaseRef.current === 'loading' || phaseRef.current === 'live') return
    setAttempt((count) => (count >= MAX_ATTEMPTS ? count : count + 1))
  }, [])

  // ── Automatic loading: both gates, one observer, one latch ─────────────────
  useEffect(() => {
    if (embedLoading !== 'auto') return
    const element = root.current
    if (!element) return

    let observer: IntersectionObserver | null = null
    let cancelled = false

    void whenStageReady(waitForLoader).then(() => {
      if (cancelled) return

      // No IntersectionObserver (an old browser, a test harness): ask rather
      // than leave the enhancement permanently off. The preview is complete
      // either way.
      if (typeof IntersectionObserver !== 'function') {
        request()
        return
      }

      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return
          // Disconnect FIRST. The request is idempotent, but an observer left
          // attached to a block this tall would fire for the page's life.
          observer?.disconnect()
          request()
        },
        // Close to view only. The creator card can pull up to ten videos'
        // worth of thumbnails, so a generous preload margin hits TikTok for
        // visitors who never reach this part of the page.
        { rootMargin: '120px 0px' },
      )
      observer.observe(element)
    })

    return () => {
      cancelled = true
      observer?.disconnect()
    }
  }, [embedLoading, waitForLoader, request])

  // ── One attempt: ask, listen, bound the wait, fit the result ───────────────
  useEffect(() => {
    if (attempt === 0) return
    const host = root.current
    const provider = providerRef.current
    const blockquote = provider?.querySelector<HTMLElement>('blockquote.tiktok-embed')
    if (!host || !provider || !blockquote) return

    let settled = false
    let ceiling: ReturnType<typeof setTimeout> | null = null
    let silence: ReturnType<typeof setTimeout> | null = null
    let frame = 0
    let iframe: HTMLIFrameElement | null = null
    let lastHostWidth = host.clientWidth
    let reportedHeight = 0
    let mutations: MutationObserver | null = null
    let hostResize: ResizeObserver | null = null

    setPhase('loading')

    const clearTimers = () => {
      if (ceiling) clearTimeout(ceiling)
      if (silence) clearTimeout(silence)
      ceiling = null
      silence = null
    }

    const giveUp = () => {
      if (settled) return
      settled = true
      clearTimers()
      window.removeEventListener('message', onMessage)
      setPhase('unavailable')
    }

    /**
     * Keeps TikTok's 720px card on the module's own canvas.
     *
     * The card lays itself out at its native width inside the iframe and
     * reports that height; the blockquote is held at the native width and
     * scaled to the host with a transform, and the wrapper's height is set to
     * the scaled result because a transform does not change layout. Width and
     * transform are written only when they change, so a ResizeObserver delivery
     * cannot schedule another one. Runs only while there is an iframe to fit.
     */
    const fit = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!iframe || !iframe.isConnected) return
        const targetWidth = host.clientWidth
        if (targetWidth <= 0) return

        const nativeWidth = Math.min(PROVIDER_NATIVE_WIDTH, targetWidth)
        const scale = targetWidth / nativeWidth
        const widthPx = `${nativeWidth}px`
        const transform = scale === 1 ? '' : `scale(${scale})`

        blockquote.classList.add('k-tiktok-provider-surface')
        if (blockquote.style.width !== widthPx) {
          blockquote.style.setProperty('width', widthPx, 'important')
          blockquote.style.setProperty('max-width', widthPx, 'important')
          blockquote.style.setProperty('min-width', widthPx, 'important')
        }
        if (blockquote.style.transform !== transform) {
          blockquote.style.transform = transform
        }
        if (reportedHeight > 0) {
          const heightPx = `${Math.ceil(reportedHeight)}px`
          if (iframe.style.height !== heightPx) iframe.style.height = heightPx
        }

        const nativeHeight = blockquote.offsetHeight
        const nextHeight = nativeHeight > 0 ? `${Math.ceil(nativeHeight * scale)}px` : ''
        if (provider.style.height !== nextHeight) provider.style.height = nextHeight
      })
    }

    const onMessage = (event: MessageEvent) => {
      const signal = readTikTokRenderSignal(event.origin, event.data)
      if (!signal || !blockquote.id || signal.id !== blockquote.id) return
      if (!settled) {
        settled = true
        clearTimers()
        setPhase('live')
      }
      // TikTok's own listener applies the height to the iframe. It is applied
      // here as well, because that listener's `onload` resets the height to
      // 100% if the signal arrives before the frame's load event — and then
      // nothing else would ever size it.
      reportedHeight = signal.height
      fit()
    }

    const onIframeLoad = () => {
      // Loaded is not rendered. A real profile posts its height almost at once;
      // a provider error posts nothing, and this is how long the silence is
      // allowed to last before the module stops waiting.
      if (settled) return
      if (silence) clearTimeout(silence)
      silence = setTimeout(giveUp, SILENCE_AFTER_LOAD_MS)
      fit()
    }

    // The library appends the iframe when it renders; watch for it so the
    // load listener and the fit can attach to the real element.
    mutations = new MutationObserver(() => {
      const found = blockquote.querySelector('iframe')
      if (!(found instanceof HTMLIFrameElement) || found === iframe) return
      iframe = found
      iframe.addEventListener('load', onIframeLoad)
      fit()
    })
    mutations.observe(blockquote, { childList: true, subtree: true })

    if (typeof ResizeObserver === 'function') {
      hostResize = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width ?? host.clientWidth
        // Height writes of our own must not schedule another fit.
        if (Math.abs(width - lastHostWidth) < 0.5) return
        lastHostWidth = width
        fit()
      })
      hostResize.observe(host)
    }

    window.addEventListener('message', onMessage)
    ceiling = setTimeout(giveUp, RENDER_TIMEOUT_MS)

    void askProviderToRender(blockquote).then((asked) => {
      if (!asked) giveUp()
    })

    return () => {
      settled = true
      clearTimers()
      cancelAnimationFrame(frame)
      window.removeEventListener('message', onMessage)
      iframe?.removeEventListener('load', onIframeLoad)
      mutations?.disconnect()
      hostResize?.disconnect()
    }
  }, [attempt])

  const canAsk = attempt < MAX_ATTEMPTS
  const live = phase === 'live'
  const loading = phase === 'loading'

  return (
    <div className="k-tiktok" data-state={phase} ref={root}>
      {/*
        THE PREVIEW. In the server-rendered HTML, under the embed while it
        loads, and what remains if the embed never proves itself. It is a
        finished piece of the page, not a placeholder: the artwork is the
        site's own, the handle is the real account, and the link is the real
        profile.
      */}
      <div className="k-tiktok-preview" aria-hidden={live || undefined} inert={live || undefined}>
        <Image
          className="k-tiktok-preview-img"
          src={preview.src}
          alt={preview.alt}
          fill
          sizes="(max-width: 767px) 100vw, 1180px"
          // Night artwork: a notch above the default so the tail lights and the
          // dark paint keep their gradients. See docs/MEDIA_WORKFLOW.md.
          quality={85}
          loading="lazy"
        />
        <span className="k-tiktok-preview-scrim" aria-hidden="true" />

        <div className="k-tiktok-preview-ui">
          <p className="k-tiktok-preview-identity">
            <TikTokGlyph />
            <span className="k-small k-tiktok-preview-handle">@{handle}</span>
            <span className="k-small k-tiktok-preview-kicker">OFFICIAL PROFILE</span>
          </p>

          <div className="k-tiktok-preview-actions">
            <a
              className="k-link-action k-tiktok-preview-cta"
              href={profileUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {ctaLabel}
              <span className="k-tiktok-preview-arrow" aria-hidden="true">
                {' '}
                ↗
              </span>
            </a>

            {loading && (
              <span className="k-small k-tiktok-status" role="status">
                CONNECTING TO TIKTOK
              </span>
            )}

            {/* The explicit, bounded ask. In manual mode it is how the feed is
                requested at all; in auto mode it appears once the automatic
                attempt has settled on unavailable, for one more try. */}
            {!loading && canAsk && (phase === 'unavailable' || embedLoading === 'manual') && (
              <button type="button" className="k-small k-tiktok-text-action" onClick={request}>
                {phase === 'unavailable' ? 'TRY THE LIVE FEED AGAIN' : 'VIEW THE LIVE FEED'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/*
        THE PROVIDER WRAPPER. Absolutely positioned under the preview and inert
        until TikTok has proven it rendered; in flow and visible afterwards;
        dropped from layout once the module has settled on unavailable. The
        embedded document is never on screen in any state but `live`.

        `suppressHydrationWarning` is on the blockquote because TikTok's script
        mutates this subtree — the one place in this codebase where the DOM is
        expected to diverge from React's idea of it.
      */}
      <div
        className="k-tiktok-provider"
        ref={providerRef}
        aria-hidden={!live || undefined}
        inert={!live || undefined}
      >
        <blockquote
          key={attempt}
          className="tiktok-embed"
          cite={profileUrl}
          data-unique-id={handle}
          data-embed-type="creator"
          data-embed-from="oembed"
          suppressHydrationWarning
        >
          <section className="k-tiktok-placeholder" aria-hidden="true" />
        </blockquote>
      </div>

      {/* With the embed live the direct path moves below it, where every other
          block on the page keeps its channel action. */}
      {live && (
        <p className="k-tiktok-direct">
          <a className="k-link-action" href={profileUrl} target="_blank" rel="noopener noreferrer">
            {ctaLabel}
            <span className="k-tiktok-preview-arrow" aria-hidden="true">
              {' '}
              ↗
            </span>
          </a>
        </p>
      )}
    </div>
  )
}

/** TikTok's note mark, as a plain inline vector. Decorative: the handle beside it is the text. */
function TikTokGlyph() {
  return (
    <svg className="k-tiktok-glyph" viewBox="0 0 45 52" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M33.086 0h-8.879v35.42c0 4.22-3.414 7.687-7.664 7.687s-7.664-3.467-7.664-7.687c0-4.145 3.339-7.536 7.436-7.687v-8.893C7.285 18.991 0 26.301 0 35.42 0 44.615 7.437 52 16.619 52s16.619-7.461 16.619-16.58V17.258c3.339 2.412 7.437 3.843 11.762 3.919v-8.893c-6.678-.226-11.914-5.652-11.914-12.284Z"
      />
    </svg>
  )
}
