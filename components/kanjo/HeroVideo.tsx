'use client'

import { useEffect, useState } from 'react'

import { mimeFor } from '@/lib/media'

/**
 * The hero's background loop, mounted only when motion is welcome.
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
 */

export function HeroVideo({
  sources,
  poster,
}: {
  /** Local paths in preference order. MIME types are derived from extensions. */
  sources: string[]
  poster?: string
}) {
  // Starts false so the server render and the first client render agree: no
  // video element, no hydration mismatch. It flips only if motion is allowed.
  const [motionAllowed, setMotionAllowed] = useState(false)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      setMotionAllowed(true)
      return
    }
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setMotionAllowed(!query.matches)
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [])

  if (!motionAllowed || sources.length === 0) return null

  return (
    <span className="k-hero-video-layer">
      <video
        className="k-hero-video"
        // The poster is also set here so that if the loop is slow the element
        // shows the same frame as the layer beneath it rather than going black.
        poster={poster}
        autoPlay
        muted
        loop
        playsInline
        // No fetch until playback is attempted, which is immediately after this
        // mounts — and never at all for a reduced-motion visitor, since the
        // element does not exist for them.
        preload="none"
        tabIndex={-1}
        disablePictureInPicture
      >
        {sources.map((source) => (
          <source key={source} src={source} type={mimeFor(source)} />
        ))}
      </video>
    </span>
  )
}
