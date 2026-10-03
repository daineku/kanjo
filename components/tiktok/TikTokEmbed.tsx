'use client'

import { useEffect, useRef } from 'react'

import { whenStageReady } from '@/lib/motion/stage'

const EMBED_SRC = 'https://www.tiktok.com/embed.js'

type TikTokEmbedRuntime = {
  lib?: {
    render?: (embeds: Element[]) => void
  }
}

function tikTokRuntime(): TikTokEmbedRuntime | undefined {
  return (window as Window & { tiktokEmbed?: TikTokEmbedRuntime }).tiktokEmbed
}

/**
 * Initializes exactly one TikTok embed without re-downloading/re-executing
 * embed.js on every client-side remount.
 *
 * TikTok's script installs a global `tiktokEmbed.lib.render()` runtime. It is
 * not documented in the public Creator Embed guide, so this path is guarded:
 * if the runtime exists, we ask it to render only this blockquote; if it does
 * not exist yet, we append embed.js once and let its normal first-load scan do
 * the work.
 *
 * This matters for TikTok's "overload-protect triggered" failure. That message
 * is returned by TikTok's own anonymous web ingress, not by this application.
 * We cannot control TikTok's server-side protection, but repeatedly deleting
 * and re-executing embed.js on SPA remounts creates avoidable provider traffic.
 * Keeping the script resident removes that amplification.
 */
function initializeEmbed(element: HTMLElement): void {
  const blockquote = element.querySelector('blockquote.tiktok-embed')
  if (!(blockquote instanceof HTMLElement)) return

  const render = tikTokRuntime()?.lib?.render
  if (typeof render === 'function') {
    try {
      render([blockquote])
    } catch {
      // Do not respond to a provider-runtime failure by re-injecting the script:
      // that is exactly the retry storm this integration must avoid.
    }
    return
  }

  const existing = document.querySelector<HTMLScriptElement>(
    `script[src="${EMBED_SRC}"], script[data-tiktok-embed]`,
  )
  if (existing) return

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
 * The `<section>` inside the blockquote is a silent layout placeholder until
 * TikTok's script replaces it. The public page deliberately does not flash a
 * temporary FOLLOW button before the creator embed appears; the surrounding
 * REAL BUILDS section already explains what the module is.
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
 * It is requested AT MOST ONCE PER MOUNT. embed.js itself stays resident for
 * the page lifetime; a later client-side remount uses TikTok's existing runtime
 * instead of deleting and re-executing the provider script.
 */

export function TikTokEmbed({
  handle,
  profileUrl,
  waitForLoader,
}: {
  /** Already validated server-side. `[A-Za-z0-9_.]{2,24}`, no `@`. */
  handle: string
  /** Canonical, rebuilt from the validated handle. */
  profileUrl: string
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
      initializeEmbed(element)
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
        // Load only when the section is actually close to view. The Creator
        // Profile widget can request up to ten recent videos, so a large preload
        // margin needlessly hits TikTok for visitors who never reach this part.
        { rootMargin: '120px 0px' },
      )
      observer.observe(element)
    })

    return () => {
      cancelled = true
      observer?.disconnect()
    }
  }, [waitForLoader])

  useEffect(() => {
    const element = root.current
    if (!element) return

    let mutationObserver: MutationObserver | null = null
    let hostResizeObserver: ResizeObserver | null = null
    let providerResizeObserver: ResizeObserver | null = null
    let observedProvider: HTMLElement | null = null
    let frame = 0
    let lastHostWidth = 0

    const fitProviderSurface = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const host = root.current
        if (!host) return

        const iframe = host.querySelector('iframe')
        if (!(iframe instanceof HTMLIFrameElement)) return

        const providerSurface =
          (iframe.closest('blockquote') as HTMLElement | null) ??
          (iframe.parentElement as HTMLElement | null)

        if (!providerSurface || providerSurface === host) return

        providerSurface.classList.add('k-tiktok-provider-surface')

        const targetWidth = host.clientWidth
        if (targetWidth <= 0) return

        const nativeWidth = Math.min(720, targetWidth)
        const scale = targetWidth / nativeWidth
        const nativeWidthPx = `${nativeWidth}px`
        const scaleValue = `scale(${scale})`

        // Avoid rewriting the same inline styles on every observer delivery.
        // TikTok's own iframe can resize as its profile data/videos settle, so
        // this function may legitimately run more than once.
        if (providerSurface.style.width !== nativeWidthPx) {
          providerSurface.style.setProperty('width', nativeWidthPx, 'important')
          providerSurface.style.setProperty('max-width', nativeWidthPx, 'important')
          providerSurface.style.setProperty('min-width', nativeWidthPx, 'important')
        }
        providerSurface.style.setProperty('margin', '0', 'important')
        providerSurface.style.setProperty('transform-origin', 'top left', 'important')
        if (providerSurface.style.transform !== scaleValue) {
          providerSurface.style.setProperty('transform', scaleValue, 'important')
        }

        iframe.style.setProperty('width', '100%', 'important')
        iframe.style.setProperty('max-width', '100%', 'important')
        iframe.style.setProperty('min-width', '100%', 'important')
        iframe.style.setProperty('margin', '0', 'important')
        iframe.loading = 'lazy'

        const nativeHeight = providerSurface.offsetHeight
        if (nativeHeight > 0) {
          const nextHeight = `${Math.ceil(nativeHeight * scale)}px`
          if (host.style.height !== nextHeight) host.style.height = nextHeight
        }

        // IMPORTANT: observe the provider with ONE persistent observer.
        // The previous implementation disconnected and created a brand-new
        // ResizeObserver on every fit. Per the ResizeObserver spec, observing a
        // rendered non-zero element itself schedules a notification, so that
        // pattern could self-trigger forever: fit -> observe -> callback -> fit.
        // Keeping one observer removes that loop while still responding when
        // TikTok genuinely changes the card's native height.
        if (typeof ResizeObserver === 'function' && observedProvider !== providerSurface) {
          if (!providerResizeObserver) {
            providerResizeObserver = new ResizeObserver(() => fitProviderSurface())
          }
          if (observedProvider) providerResizeObserver.unobserve(observedProvider)
          observedProvider = providerSurface
          providerResizeObserver.observe(providerSurface)
        }
      })
    }

    mutationObserver = new MutationObserver(() => fitProviderSurface())
    mutationObserver.observe(element, { childList: true, subtree: true })

    if (typeof ResizeObserver === 'function') {
      hostResizeObserver = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width ?? element.clientWidth
        // Our own reserved-height write should not schedule another fit.
        if (Math.abs(width - lastHostWidth) < 0.5) return
        lastHostWidth = width
        fitProviderSurface()
      })
      lastHostWidth = element.clientWidth
      hostResizeObserver.observe(element)
    }

    fitProviderSurface()

    return () => {
      cancelAnimationFrame(frame)
      mutationObserver?.disconnect()
      hostResizeObserver?.disconnect()
      providerResizeObserver?.disconnect()
    }
  }, [])

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
        data-embed-from="oembed"
        suppressHydrationWarning
      >
        <section className="k-tiktok-placeholder" aria-hidden="true" />
      </blockquote>
    </div>
  )
}
