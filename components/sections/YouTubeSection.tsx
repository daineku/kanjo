import { ClipReveal } from '@/components/motion/ClipReveal'
import { Reveal } from '@/components/motion/Reveal'
import { EmptyNotice, Section } from '@/components/kanjo/Section'
import { VideoEmbed } from '@/components/kanjo/VideoEmbed'
import { real } from '@/lib/content/placeholder'
import type { YouTubeConfig } from '@/lib/content/types'
import { youTubeId, youTubeThumbnail } from '@/lib/media'

/**
 * The homepage's one video.
 *
 * ── NO PLAYER LIBRARY, AND NO IFRAME UNTIL IT IS ASKED FOR ──────────────────
 *
 * The block renders a poster and a button. YouTube's iframe — roughly a
 * megabyte of third-party JavaScript, and cookies set on mount whether or not
 * anybody watches — is not created until the visitor presses PLAY. The facade
 * itself is `VideoEmbed`, which the site already uses for local clips, so there
 * is ONE play affordance in this codebase rather than two that drift apart. A
 * third-party React player package would add a dependency to do worse than the
 * native iframe does for free.
 *
 * ── THE ID IS NORMALISED ON THE SERVER ──────────────────────────────────────
 *
 * `config.video` accepts a bare id or any YouTube URL; `youTubeId` reduces it to
 * the eleven characters and discards everything else, so a pasted watch URL
 * cannot carry a playlist, a start offset or a share token into the embed. The
 * embed URL itself is composed by VideoEmbed against youtube-nocookie.com.
 *
 * ── AND THE POSTER IS FETCHED BY US, NOT BY THE BROWSER ─────────────────────
 *
 * With no poster configured the still is YouTube's own thumbnail — but routed
 * through `next/image`, so OUR server fetches it and the visitor's browser
 * contacts no Google host at all until they press play. That is what lets this
 * block keep the page's default state free of third-party requests.
 *
 * ── MOTION ──────────────────────────────────────────────────────────────────
 *
 * One clip-path band reveal on entry, once, then the element is handed back to
 * the browser untouched. The player is never distorted while it plays. See
 * components/motion/ClipReveal.tsx.
 */

export function YouTubeSection({ id, config }: { id: string; config: YouTubeConfig }) {
  const videoId = youTubeId(config.video)
  const description = real(config.description)
  const ratio = config.aspectRatio?.trim() || '16 / 9'

  const header = {
    eyebrow: real(config.eyebrow),
    heading: real(config.heading),
    standfirst: real(config.standfirst),
  }

  if (!videoId) {
    // An enabled block with nothing to play says so, rather than rendering an
    // empty frame or silently vanishing — the same rule the rest of the site
    // follows for an enabled section with no content.
    return (
      <Section id={id} header={header} width="wide">
        <EmptyNotice>NO VIDEO CONFIGURED</EmptyNotice>
      </Section>
    )
  }

  const poster = config.poster ?? {
    src: youTubeThumbnail(videoId),
    alt: '',
    // YouTube's `hqdefault` is 480x360. Stated so the box is reserved at the
    // right size before anything loads; the frame's own aspect-ratio is what
    // actually governs the layout, so nothing shifts either way.
    width: 480,
    height: 360,
  }

  return (
    <Section id={id} header={header} width="wide">
      <ClipReveal>
        <VideoEmbed
          ratio={ratio}
          sizes="(max-width: 1440px) 100vw, 1440px"
          video={{
            id,
            provider: 'youtube',
            ref: videoId,
            title: config.title,
            description,
            poster,
            featured: true,
            published: true,
            order: 0,
          }}
        />
      </ClipReveal>

      {(config.title || description) && (
        <Reveal stagger={0.06} distance={18} className="k-video-meta">
          {config.title && <p className="k-item-title">{config.title}</p>}
          {description && (
            <p className="k-body" style={{ color: 'var(--k-text-secondary)', margin: 0 }}>
              {description}
            </p>
          )}
        </Reveal>
      )}
    </Section>
  )
}
