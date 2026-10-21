'use client'

import { useEffect, useRef, useState } from 'react'

import { mimeFor } from '@/lib/media'

/**
 * The phone hero's footage, as progressive enhancement over a poster.
 *
 * ── THE POSTER IS THE HERO ──────────────────────────────────────────────────
 *
 * The first frame of this loop is server-rendered by the hero as an ordinary
 * <img> (components/kanjo/HeroStill.tsx). It needs no JavaScript, no hydration
 * and no network event to appear, and it is what a visitor sees for as long as
 * this component has nothing better to show. Everything below can fail, be
 * skipped or be refused, and the hero is still complete.
 *
 * ── WHEN THE FILE IS ASKED FOR ──────────────────────────────────────────────
 *
 * Not while the page is loading. The element does not exist until:
 *
 *   1. the window has fired `load` — the poster, fonts, CSS and scripts are in —
 *      AND the browser has reported its first contentful paint (on a small,
 *      fast page `load` can come first, which would let the video start before
 *      anything is on screen);
 *   2. the browser has an idle moment after that (`requestIdleCallback`, with a
 *      short timeout so a busy main thread cannot postpone it indefinitely);
 *   3. the tab is visible and the hero is actually on screen;
 *   4. the visitor has not asked for less motion or less data, and the
 *      connection is not clearly too slow for a 3 MB background.
 *
 * Measured under Lighthouse's slow-4G simulation, a loop requested at hydration
 * shares the connection with the page's own scripts and pushed the first screen
 * to 9.6 s. Requested after `load`, it competes with nothing.
 *
 * ── WHEN IT IS SHOWN ────────────────────────────────────────────────────────
 *
 * Only once a decoded frame is on screen: `canplay`, then `play()`, then
 * `requestVideoFrameCallback` — the browser's own confirmation that a frame has
 * been presented — or, where that API is missing, the first `timeupdate` with
 * time actually advancing. Then the element fades in over the poster. Because
 * the poster IS frame 0, the fade is invisible except as motion beginning.
 *
 * ── WHEN IT GIVES UP ────────────────────────────────────────────────────────
 *
 * A refused autoplay (iOS Low Power Mode, a data-saver policy) or a failed file
 * unmounts the element for the life of the page — no retry loop, no browser
 * play button over a frozen frame. The poster stays.
 *
 * ── WHILE IT PLAYS ──────────────────────────────────────────────────────────
 *
 * It pauses when the hero leaves the viewport or the tab is hidden, and resumes
 * only when both are true again. Every asynchronous callback checks that it
 * still belongs to the mounted element, so a late promise cannot restart a
 * video that has since been paused or removed.
 */

type NetworkInformation = { saveData?: boolean; effectiveType?: string }

/** True when the visitor or the connection says a background video is unwelcome. */
function constrained(): boolean {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection
  if (!connection) return false // Safari and Firefox: no signal, so no penalty.
  if (connection.saveData) return true
  return connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g'
}

/** Resolves once the browser reports its first contentful paint. */
function afterFirstPaint(then: () => void) {
  const painted = () => performance.getEntriesByName('first-contentful-paint').length > 0
  if (painted() || typeof PerformanceObserver !== 'function') return then()
  try {
    const observer = new PerformanceObserver(() => {
      if (!painted()) return
      observer.disconnect()
      then()
    })
    observer.observe({ type: 'paint', buffered: true })
  } catch {
    then() // no paint timing: fall back to load + idle alone
  }
}

/**
 * Runs `then` once the page is visually ready: the first contentful paint has
 * happened AND the window has loaded, followed by an idle period. On a small,
 * fast page `load` can fire before the first paint, so `load` alone would let
 * the video start before anything is on screen.
 */
function afterVisuallyReady(signal: { cancelled: boolean }, then: () => void) {
  const idle = () => {
    if (signal.cancelled) return
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => !signal.cancelled && then(), { timeout: 1500 })
    } else {
      setTimeout(() => !signal.cancelled && then(), 200)
    }
  }
  const loaded = () => afterFirstPaint(idle)
  if (document.readyState === 'complete') loaded()
  else window.addEventListener('load', loaded, { once: true })
}

export function HeroVideo({
  sources,
  media,
}: {
  /** Local paths in preference order. MIME types are derived from extensions. */
  sources: string[]
  /**
   * A media query the viewport must match for the element to exist at all,
   * e.g. `(max-width: 767px)`. Desktop visitors never request the file.
   */
  media?: string
}) {
  const [mounted, setMounted] = useState(false)
  const [presented, setPresented] = useState(false)
  // Set once and never cleared: a refusal or a failure ends the enhancement.
  const [gaveUp, setGaveUp] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  // ── Phase 3: decide whether, and when, to mount ──────────────────────────
  useEffect(() => {
    if (gaveUp || sources.length === 0) return
    const signal = { cancelled: false }
    const viewport = media ? window.matchMedia(media) : null
    let observer: IntersectionObserver | undefined

    const decide = () => {
      if (signal.cancelled) return
      if (viewport && !viewport.matches) return
      if (constrained()) return
      const host = document.querySelector('.k-hero-media')
      if (!host || typeof IntersectionObserver !== 'function') {
        if (document.visibilityState === 'visible') setMounted(true)
        return
      }
      // Mount only when the hero is actually in view, in a visible tab. A
      // visitor who has already scrolled past it by `load` never pays for it.
      observer = new IntersectionObserver(([entry]) => {
        if (entry?.isIntersecting && document.visibilityState === 'visible') {
          observer?.disconnect()
          if (!signal.cancelled) setMounted(true)
        }
      })
      observer.observe(host)
    }

    afterVisuallyReady(signal, decide)

    // Rotating a tablet out of the phone layout removes the loop; rotating it
    // back re-runs the decision rather than mounting unconditionally.
    const onViewport = () => {
      if (viewport && !viewport.matches) {
        setMounted(false)
        setPresented(false)
      } else if (document.readyState === 'complete') {
        decide()
      }
    }
    viewport?.addEventListener('change', onViewport)

    return () => {
      signal.cancelled = true
      observer?.disconnect()
      viewport?.removeEventListener('change', onViewport)
    }
  }, [media, gaveUp, sources.length])

  // ── Phases 3–4: play once ready, confirm a frame, keep it honest ─────────
  useEffect(() => {
    const video = videoRef.current
    if (!mounted || !video) return

    let alive = true
    let inView = true
    let frameHandle: number | undefined

    const giveUp = () => {
      if (!alive) return
      alive = false
      setMounted(false)
      setPresented(false)
      setGaveUp(true)
    }

    const confirmFrame = () => {
      if (!alive) return
      if (typeof video.requestVideoFrameCallback === 'function') {
        frameHandle = video.requestVideoFrameCallback(() => alive && setPresented(true))
        return
      }
      // Fallback: time advancing means frames are being presented.
      const start = video.currentTime
      const onTime = () => {
        if (!alive) return
        if (video.currentTime > start) {
          video.removeEventListener('timeupdate', onTime)
          setPresented(true)
        }
      }
      video.addEventListener('timeupdate', onTime)
    }

    const shouldPlay = () => alive && inView && document.visibilityState === 'visible'

    // A single in-flight attempt at a time; a second call while one is pending
    // simply waits on the same promise.
    let pending: Promise<void> | null = null
    const attempt = () => {
      if (!shouldPlay() || pending || !video.paused) return
      pending = video
        .play()
        .then(() => {
          pending = null
          if (!alive) return
          if (!shouldPlay()) video.pause() // conditions changed while starting
          else confirmFrame()
        })
        .catch((error: unknown) => {
          pending = null
          // NotAllowedError is a refusal: stop for good. AbortError is our own
          // pause() interrupting a pending play(), which is routine.
          if (error instanceof DOMException && error.name === 'NotAllowedError') giveUp()
        })
    }

    const onCanPlay = () => attempt()
    const onError = () => giveUp()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') video.pause()
      else attempt()
    }

    video.addEventListener('canplay', onCanPlay, { once: true })
    video.addEventListener('error', onError)
    // <source> failures fire on the source element, not the video.
    video.querySelectorAll('source').forEach((source) => source.addEventListener('error', onError))
    document.addEventListener('visibilitychange', onVisibility)

    let observer: IntersectionObserver | undefined
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(([entry]) => {
        if (!entry || !alive) return
        inView = entry.isIntersecting
        if (inView) attempt()
        else video.pause()
      })
      observer.observe(video)
    }

    // Already buffered (fast cache): `canplay` may have fired before we listened.
    if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) attempt()

    return () => {
      alive = false
      observer?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      video.removeEventListener('canplay', onCanPlay)
      video.removeEventListener('error', onError)
      if (frameHandle !== undefined) video.cancelVideoFrameCallback?.(frameHandle)
      video.pause()
    }
  }, [mounted])

  if (!mounted || gaveUp) return null

  return (
    <span className="k-hero-video-layer">
      <video
        ref={videoRef}
        className="k-hero-video"
        data-ready={presented ? 'true' : 'false'}
        // No `poster` attribute: the server-rendered still beneath is the
        // poster, and a second one here would be a duplicate request.
        muted
        loop
        playsInline
        // The element exists only after `load`, so fetching now competes with
        // nothing. Playback is started explicitly once `canplay` fires, which
        // is what lets a refusal be detected rather than leaving a still frame.
        preload="auto"
        tabIndex={-1}
        disablePictureInPicture
        aria-hidden="true"
      >
        {sources.map((source) => (
          <source key={source} src={source} type={mimeFor(source)} />
        ))}
      </video>
    </span>
  )
}
