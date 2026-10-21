'use client'

import { useEffect, useRef, useState } from 'react'

import { readTikTokRenderSignal } from '@/lib/tiktok/signal'

const EMBED_SRC = 'https://www.tiktok.com/embed.js'

/** The block's one link. Fixed copy: it names the account, not a feature. */
const PROFILE_LINK_LABEL = 'Open @TheKanjo on TikTok'

/**
 * The ceiling on waiting for TikTok, from the moment the embed is asked for.
 * Past it the module settles on the link and stops listening: a feed that
 * appears under a visitor who has moved on is a layout shift, not an
 * enhancement.
 */
const RENDER_TIMEOUT_MS = 8_000

/**
 * How long a loaded iframe gets to prove it rendered. The embedded application
 * posts its height within a moment of running; the one-line provider error
 * ("overload-protect triggered") runs nothing, so after its `load` the silence
 * is the answer.
 */
const SILENCE_AFTER_LOAD_MS = 3_500

/** The creator card is laid out at this width inside TikTok's own application. */
const PROVIDER_NATIVE_WIDTH = 720

type Phase = 'loading' | 'live' | 'fallback'

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
 * blockquote directly, which costs no network request at all.
 *
 * Resolves to false when nothing could be asked: the script failed to load
 * (blocked, offline) or the runtime threw. The caller falls back at once.
 */
function askProviderToRender(blockquote: HTMLElement): Promise<boolean> {
  const lib = tikTokRuntime()?.lib
  if (lib && typeof lib.render === 'function') {
    try {
      // Called AS A METHOD: `render` is async and reaches for `this` on a
      // later tick, so a detached reference throws inside the promise.
      return Promise.resolve(lib.render([blockquote]))
        .then(() => true)
        .catch(() => false)
    } catch {
      return Promise.resolve(false)
    }
  }

  // At most one script tag per page life. One that failed stays failed for
  // that life: a later mount falls back without asking TikTok again.
  const existing = document.querySelector<HTMLScriptElement>('script[data-tiktok-embed]')
  if (existing) return Promise.resolve(existing.dataset.tiktokEmbed !== 'failed')

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
 * TikTok's official Creator Profile Embed, with exactly two visible outcomes:
 * the real embed, or one link to the real profile.
 *
 * The embed is a cross-origin iframe on `https://www.tiktok.com`. TikTok's
 * anonymous embed ingress rate-limits and answers `503 overload-protect
 * triggered` as a one-line document; the iframe's `load` event fires for it
 * exactly as for a real profile, TikTok's library reveals the iframe on that
 * `load`, and the parent page cannot read the iframe's status or text. So
 * `load` is NOT a success condition here. See lib/tiktok/signal.ts for what
 * the parent page CAN observe, and why it is a heuristic.
 *
 *   loading   Server-rendered. On screen: the profile link, nothing else.
 *             Underneath, clipped to the link's own box: the official embed,
 *             invisible, inert and out of the tab order.
 *   live      TikTok's application posted its render signal, from OUR iframe,
 *             naming OUR blockquote. The embed is revealed; the link goes.
 *   fallback  Script blocked, runtime threw, silence after `load`, or the
 *             ceiling passed. The provider is removed from the DOM; the link
 *             stays. No retry, automatic or otherwise.
 *
 * A crawler, a visitor without JavaScript and a visitor TikTok has
 * rate-limited all see the same complete block: the heading and the link.
 *
 * The embed is asked for once per mount, after the window's `load` event (so
 * TikTok's script never competes with the hero) and when the section is within
 * 120px of the viewport. One observer,
 * disconnected the moment it fires; no polling, no timer-driven retry.
 *
 * The blockquote's `cite` and `data-unique-id` derive from a handle validated
 * on the server by `lib/tiktok/profile.ts#tikTokHandle`. There is no
 * `dangerouslySetInnerHTML` here and no HTML from any API.
 */
export function TikTokEmbed({
  handle,
  profileUrl,
}: {
  /** Already validated server-side. `[A-Za-z0-9_.]{2,24}`, no `@`. */
  handle: string
  /** Canonical, rebuilt from the validated handle. */
  profileUrl: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const providerRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [asked, setAsked] = useState(false)

  // ── When to ask: after `load`, near the viewport, once ────────────────────
  useEffect(() => {
    const element = root.current
    if (!element) return

    let observer: IntersectionObserver | null = null
    let cancelled = false

    const watch = () => {
      if (cancelled) return
      if (typeof IntersectionObserver !== 'function') {
        setAsked(true)
        return
      }
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return
          observer?.disconnect()
          setAsked(true)
        },
        // Close to view only: the creator card pulls a page of thumbnails,
        // and a generous margin hits TikTok for visitors who never get here.
        { rootMargin: '120px 0px' },
      )
      observer.observe(element)
    }

    if (document.readyState === 'complete') watch()
    else window.addEventListener('load', watch, { once: true })

    return () => {
      cancelled = true
      window.removeEventListener('load', watch)
      observer?.disconnect()
    }
  }, [])

  // ── The one attempt: ask, listen, bound the wait, fit the result ──────────
  useEffect(() => {
    if (!asked) return
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
    let hostResize: ResizeObserver | null = null

    const clearTimers = () => {
      if (ceiling) clearTimeout(ceiling)
      if (silence) clearTimeout(silence)
      ceiling = null
      silence = null
    }

    /**
     * TikTok's creator iframe lays out its content at 720px. Keep that native
     * width at every breakpoint: scale DOWN on narrow viewports, never UP on
     * desktop. Previously min(720, hostWidth) changed the native width on
     * phones and made the 720px card grow across the desktop column. Combined
     * with the blockquote's auto margin and top-left transform origin, that
     * displaced the visible embed to the right of the section heading.
     * The wrapper is centred independently at max 720px in CSS; we reserve
     * the scaled height here because transforms do not affect layout.
     */
    const fit = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!iframe || !iframe.isConnected) return
        const availableWidth = host.clientWidth
        if (availableWidth <= 0) return

        const displayWidth = Math.min(availableWidth, PROVIDER_NATIVE_WIDTH)
        const scale = displayWidth / PROVIDER_NATIVE_WIDTH
        const widthPx = `${PROVIDER_NATIVE_WIDTH}px`
        const transform = scale === 1 ? '' : `scale(${scale})`

        blockquote.classList.add('k-tiktok-provider-surface')
        if (blockquote.style.width !== widthPx) {
          blockquote.style.setProperty('width', widthPx, 'important')
          blockquote.style.setProperty('max-width', widthPx, 'important')
          blockquote.style.setProperty('min-width', widthPx, 'important')
        }
        if (blockquote.style.transform !== transform) blockquote.style.transform = transform
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
      // From OUR iframe's window, naming OUR blockquote. An unrelated message,
      // or one from a frame left over by an earlier mount, is not success.
      if (!iframe || event.source !== iframe.contentWindow) return
      const signal = readTikTokRenderSignal(event.origin, event.data)
      if (!signal || !blockquote.id || signal.id !== blockquote.id) return
      if (!settled) {
        settled = true
        clearTimers()
        setPhase('live')
      }
      // TikTok's own listener sizes the iframe too, but its `onload` resets
      // the height if the signal arrived first; applied here as well.
      reportedHeight = signal.height
      fit()
    }

    const onIframeLoad = () => {
      // Loaded is not rendered: from here, silence means the provider error.
      if (settled) return
      if (silence) clearTimeout(silence)
      silence = setTimeout(fallBack, SILENCE_AFTER_LOAD_MS)
    }

    // The library appends the iframe when it renders; watch for it so the
    // load listener, the source check and the fit attach to the real element.
    const mutations = new MutationObserver(() => {
      const found = blockquote.querySelector('iframe')
      if (!(found instanceof HTMLIFrameElement) || found === iframe) return
      iframe?.removeEventListener('load', onIframeLoad)
      iframe = found
      iframe.addEventListener('load', onIframeLoad)
      fit()
    })
    mutations.observe(blockquote, { childList: true, subtree: true })

    if (typeof ResizeObserver === 'function') {
      hostResize = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width ?? host.clientWidth
        if (Math.abs(width - lastHostWidth) < 0.5) return
        lastHostWidth = width
        fit()
      })
      hostResize.observe(host)
    }

    const teardown = () => {
      clearTimers()
      cancelAnimationFrame(frame)
      window.removeEventListener('message', onMessage)
      iframe?.removeEventListener('load', onIframeLoad)
      mutations.disconnect()
      hostResize?.disconnect()
    }

    function fallBack() {
      if (settled) return
      settled = true
      teardown()
      setPhase('fallback')
    }

    window.addEventListener('message', onMessage)
    ceiling = setTimeout(fallBack, RENDER_TIMEOUT_MS)

    void askProviderToRender(blockquote).then((ok) => {
      if (!ok) fallBack()
    })

    return () => {
      settled = true
      teardown()
    }
  }, [asked])

  const live = phase === 'live'

  return (
    <div className="k-tiktok" data-state={phase} ref={root}>
      {!live && (
        <a className="k-tiktok-link" href={profileUrl} target="_blank" rel="noopener noreferrer">
          <span className="k-tiktok-link-label">{PROFILE_LINK_LABEL}</span>
          <span className="k-tiktok-link-arrow" aria-hidden="true">
            ↗
          </span>
        </a>
      )}

      {/*
        The provider. Clipped to the link's box, invisible and inert until
        TikTok has proven it rendered; in flow once live; removed from the DOM
        on fallback, so nothing of it — not its size, not its focusable frame —
        survives a failure.

        `suppressHydrationWarning` on the blockquote: TikTok's script mutates
        this subtree, the one place the DOM is expected to diverge from React.
      */}
      {phase !== 'fallback' && (
        <div
          className="k-tiktok-provider"
          ref={providerRef}
          aria-hidden={!live || undefined}
          inert={!live || undefined}
        >
          <blockquote
            className="tiktok-embed"
            cite={profileUrl}
            data-unique-id={handle}
            data-embed-type="creator"
            data-embed-from="oembed"
            suppressHydrationWarning
          >
            <section aria-hidden="true" />
          </blockquote>
        </div>
      )}
    </div>
  )
}
