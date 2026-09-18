'use client'

import Image from 'next/image'
import { useState } from 'react'

import type { Video } from '@/lib/content/types'
import { mimeFor } from '@/lib/media'

import { Frame, PendingSlot } from './Frame'

/**
 * A click-to-play video facade.
 *
 * WHY A FACADE RATHER THAN AN IFRAME. A YouTube embed costs somewhere around a
 * megabyte of third-party JavaScript and sets cookies the moment it mounts, on
 * every visit, whether or not anybody presses play. The facade is the poster
 * plus one button; the provider is only contacted once the visitor has asked
 * for the video. That is the "preload only where justified" and "controlled
 * autoplay" requirement, and it also means the landing page ships no
 * third-party request at all in its default state.
 *
 * THE EMBED URL IS COMPOSED HERE, FROM A BARE ID. `Video.ref` is an id, not a
 * URL, so a pasted `watch?v=...&list=...&t=...` cannot smuggle a playlist, an
 * autoplay parameter or a tracking string into the page. An id that does not
 * look like an id renders as an error state rather than as a malformed iframe.
 *
 * The only state is "has the visitor pressed play". Nothing observes scroll,
 * nothing cycles, nothing refetches — the Daineku handoff records image-request
 * storms from exactly that kind of ambient behaviour.
 */

const YOUTUBE_ID = /^[\w-]{6,20}$/
const VIMEO_ID = /^\d{6,12}$/

function embedUrl(video: Video, autoplay = true): string | null {
  switch (video.provider) {
    case 'youtube':
      if (!YOUTUBE_ID.test(video.ref)) return null
      // youtube-nocookie, autoplay once the visitor has asked, no related
      // videos from other channels, and the JS API left off.
      return `https://www.youtube-nocookie.com/embed/${video.ref}?${autoplay ? 'autoplay=1&' : ''}rel=0&modestbranding=1`
    case 'vimeo':
      if (!VIMEO_ID.test(video.ref)) return null
      return `https://player.vimeo.com/video/${video.ref}?${autoplay ? 'autoplay=1&' : ''}dnt=1`
    case 'file':
      // Validated by localSources() instead: a local clip may offer several
      // encodings, so there is no single URL to return.
      return video.ref
    default:
      return null
  }
}

/**
 * Local sources in preference order, `sources` first and `ref` last.
 *
 * Listing a WebM ahead of the MP4 means a browser that supports it takes the
 * smaller file, and everything else falls through to the MP4 in `ref`. A
 * single-source entry needs no `sources` at all.
 */
function localSources(video: Video): string[] {
  return [...(video.sources ?? []), video.ref]
    .filter((source): source is string => Boolean(source?.trim()))
    .filter((source, index, all) => all.indexOf(source) === index)
}

export function VideoEmbed({
  video,
  priority = false,
  ratio = '16 / 9',
  sizes = '(max-width: 930px) 100vw, 930px',
  embedImmediately = false,
}: {
  video: Video
  /** Only ever true for a single above-the-fold poster. */
  priority?: boolean
  ratio?: string
  /**
   * The poster's `sizes`. Defaulted to the reading column because that is where
   * most videos sit, but the homepage's YouTube block runs to the wide track —
   * and a `sizes` that understates the box makes `next/image` pick a source too
   * small for it, which on a full-width still is visibly soft.
   */
  sizes?: string
  /**
   * Mount the provider player immediately instead of showing the poster/PLAY
   * facade. Used for the homepage feature video, where the YouTube player
   * itself is part of the composition.
   */
  embedImmediately?: boolean
}) {
  const [playing, setPlaying] = useState(false)
  const url = embedUrl(video, !embedImmediately)

  if (!url) {
    return (
      <PendingSlot
        ratio={ratio}
        label="VIDEO UNAVAILABLE"
        detail={`"${video.ref}" is not a valid ${video.provider} id`}
      />
    )
  }

  if (embedImmediately && video.provider !== 'file') {
    return (
      <Frame ratio={ratio}>
        <iframe
          src={url}
          title={video.title}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
        />
      </Frame>
    )
  }

  if (!video.poster) {
    // A poster is required by the type's own comment, and the reason is here: a
    // facade without one is a blank rectangle with no way in.
    return (
      <PendingSlot ratio={ratio} label="POSTER MISSING" detail={video.title} />
    )
  }

  if (playing) {
    if (video.provider === 'file') {
      return (
        <Frame ratio={ratio}>
          {/*
           * A local clip needs no player library — the native element already
           * has controls, fullscreen, keyboard handling, captions support and
           * Picture-in-Picture, all of which a JS player reimplements worse.
           *
           * `autoPlay` is honest here: the visitor pressed PLAY, so this is a
           * gesture-initiated playback and the browser allows sound. It is NOT
           * muted, deliberately — muting a clip somebody asked to watch would
           * hide the engine note, which for this game is most of the point. If a
           * browser refuses the autoplay anyway, the poster stays with visible
           * controls, which is a clean degradation rather than a blank frame.
           *
           * `preload="metadata"` gets duration and the first frames without
           * pulling the whole file; the element only mounts after a click, so
           * nothing is fetched on page load at all.
           */}
          <video
            poster={video.poster.src}
            controls
            autoPlay
            playsInline
            preload="metadata"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          >
            {localSources(video).map((source) => (
              <source key={source} src={source} type={mimeFor(source)} />
            ))}
          </video>
        </Frame>
      )
    }

    return (
      <Frame ratio={ratio}>
        <iframe
          src={url}
          title={video.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
        />
      </Frame>
    )
  }

  return (
    <Frame ratio={ratio}>
      <button
        type="button"
        onClick={() => setPlaying(true)}
        aria-label={`Play video: ${video.title}`}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          padding: 0,
          border: 0,
          background: 'transparent',
          cursor: 'pointer',
          display: 'block',
        }}
      >
        <Image
          src={video.poster.src}
          alt=""
          width={video.poster.width}
          height={video.poster.height}
          priority={priority}
          loading={priority ? undefined : 'lazy'}
          sizes={sizes}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            // The canon's scrim opacity, Tokens/opacity.json.
            background: `rgb(0 0 3 / 0.35)`,
            transition: 'background var(--k-motion-focus) var(--k-ease-out)',
          }}
        >
          <span
            className="k-action"
            style={{
              padding: 'var(--k-space-sm) var(--k-space-lg)',
              color: 'var(--k-text-primary)',
              background: 'rgb(0 0 3 / 0.72)',
              borderLeft: 'var(--k-divider-width) solid var(--k-accent)',
            }}
          >
            PLAY
          </span>
        </span>
      </button>
    </Frame>
  )
}
