'use client'

import { useEffect, useRef, useState } from 'react'

import { mimeFor } from '@/lib/media'
import { whenStageReady } from '@/lib/motion/stage'

/**
 * The hero's background loop, mounted only when motion is welcome — and, when
 * asked, only on the viewports that show it.
 *
 * WHY THIS IS A CLIENT COMPONENT RATHER THAN CSS. The first version hid the
 * video with `@media (prefers-reduced-motion: reduce) { display: none }`, which
 * does stop the motion — measured, the layer computes to `display: none` and
 * nothing plays. But the browser still issued the request for the file:
 * measured, 1 video request under `reducedMotion: 'reduce'`, identical to
 * `no-preference`. So a visitor who has asked for less motion was downloading a
 * multi-megabyte loop they would never see, which is a real data cost and
 * exactly what "respect reduced-motion / data considerations" rules out.
 *
 * A `matchMedia` gate is the only way to not ask for the file at all. The trade
 * is one small client component; what makes that cheap here is that the POSTER
 * is server-rendered by the hero and always present, so:
 *
 *   - the first paint is the poster, from the server HTML, with no layout shift
 *   - the loop fades in over it after hydration, if motion is allowed
 *   - a reduced-motion visitor keeps the poster and issues no video request
 *   - the loop never competes with the poster for LCP
 *
 * It also honours a preference CHANGE while the page is open, because a
 * `matchMedia` listener is nearly free once the object exists.
 *
 * ── THE VIEWPORT GATE ───────────────────────────────────────────────────────
 *
 * `media` is the same idea applied to the viewport. The phone hero's footage is
 * a 3 MB file that the desktop page never shows, and `display: none` on an
 * autoplaying <video> does not stop the download any more than it did for
 * reduced motion. So below the breakpoint the element exists; above it, it
 * does not, and a desktop visitor issues no request. Rotating a tablet across
 * the breakpoint mounts or unmounts it live.
 *
 * ── WHAT THE VISITOR SEES ───────────────────────────────────────────────────
 *
 * The element is transparent until its first frame is actually playing
 * (`data-ready`), so the server-rendered poster underneath is the only thing on
 * screen until the real footage can replace it — no black rectangle while the
 * file arrives, no flash at the swap. Because the poster is frame 0 of the
 * loop, the swap itself is invisible.
 *
 * If the browser refuses autoplay (iOS Low Power Mode, a data-saver policy) or
 * the file fails, the element is removed and the poster stays: a complete hero
 * either way, and never iOS's greyed play glyph over a frozen first frame.
 *
 * Offscreen, it pauses. An IntersectionObserver on the element itself stops
 * playback once the hero has scrolled away and resumes it on the way back —
 * decoding a 30 fps loop under a page the visitor is reading is battery spent
 * on nothing.
 *
 * ── WHEN THE FILE IS ASKED FOR ──────────────────────────────────────────────
 *
 * Not at hydration. Measured under Lighthouse's slow-4G simulation, a loop that
 * starts downloading the moment the island mounts shares the connection with
 * the script chunks the page is still fetching, hydration lands late, the
 * loader (which waits for hydration) lifts late, and the first screen is
 * reported at 9.6 s. So the element is created only once the stage is the
 * visitor's — the loader has handed over (lib/motion/stage.ts) and the window
 * has loaded — which is also the first moment the footage could be seen. Until
 * then the poster IS the hero, and since the poster is frame 0, starting a few
 * seconds later costs nothing visible. The brief's order, exactly: HTML, poster,
 * links, then the footage.
 */

export function HeroVideo({
  sources,
  poster,
  media,
  waitForLoader = false,
}: {
  /** Local paths in preference order. MIME types are derived from extensions. */
  sources: string[]
  poster?: string
  /**
   * A media query the viewport must match for the element to exist at all,
   * e.g. `(max-width: 767px)`. Omit to mount at every width.
   */
  media?: string
  /** Whether there is a loader whose hand-over to wait for. */
  waitForLoader?: boolean
}) {
  // Starts false so the server render and the first client render agree: no
  // video element, no hydration mismatch. It flips only if motion is allowed
  // (and the viewport matches, when a query is given).
  const [active, setActive] = useState(false)
  const [stageReady, setStageReady] = useState(false)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    let cancelled = false
    const loaded =
      document.readyState === 'complete'
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            window.addEventListener('load', () => resolve(), { once: true })
            // A third-party resource that never finishes must not hold the
            // footage back for good; `whenStageReady` has the same backstop.
            setTimeout(resolve, 8_000)
          })
    void Promise.all([whenStageReady(waitForLoader), loaded]).then(() => {
      if (!cancelled) setStageReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [waitForLoader])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      setActive(true)
      return
    }
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const viewport = media ? window.matchMedia(media) : null
    const apply = () => setActive(!motion.matches && (viewport ? viewport.matches : true))
    apply()
    motion.addEventListener('change', apply)
    viewport?.addEventListener('change', apply)
    return () => {
      motion.removeEventListener('change', apply)
      viewport?.removeEventListener('change', apply)
    }
  }, [media])

  const mounted = active && stageReady && !failed

  useEffect(() => {
    const video = videoRef.current
    if (!mounted || !video) return

    // The explicit attempt is what surfaces an autoplay refusal: the attribute
    // alone fails silently and leaves a frozen frame. Only a refusal counts as
    // failure — an AbortError here is our own pause() below interrupting a
    // pending play(), which is routine.
    const attempt = () =>
      video.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'NotAllowedError') setFailed(true)
      })

    let observer: IntersectionObserver | undefined
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry) return
          if (entry.isIntersecting) void attempt()
          else video.pause()
        },
        { threshold: 0 },
      )
      observer.observe(video)
    } else {
      void attempt()
    }

    return () => observer?.disconnect()
  }, [mounted])

  if (!mounted || sources.length === 0) return null

  return (
    <span className="k-hero-video-layer">
      <video
        ref={videoRef}
        className="k-hero-video"
        data-ready={ready ? 'true' : 'false'}
        // The poster is also set here so that if the loop is slow the element
        // shows the same frame as the layer beneath it rather than going black.
        poster={poster}
        autoPlay
        muted
        loop
        playsInline
        // The element only exists for a visitor who is about to watch it, so
        // let the browser start fetching as soon as it mounts. Browsers that
        // ignore the hint for autoplaying media fetch on the play() attempt
        // above, which is immediate.
        preload="auto"
        tabIndex={-1}
        disablePictureInPicture
        onPlaying={() => setReady(true)}
        onError={() => setFailed(true)}
      >
        {sources.map((source) => (
          <source key={source} src={source} type={mimeFor(source)} />
        ))}
      </video>
    </span>
  )
}
