import { ClipReveal } from '@/components/motion/ClipReveal'
import { Reveal } from '@/components/motion/Reveal'
import { EmptyNotice, Section } from '@/components/kanjo/Section'
import { VideoEmbed } from '@/components/kanjo/VideoEmbed'
import { real } from '@/lib/content/placeholder'
import type { ImageRef, YouTubeConfig, YouTubeFeed } from '@/lib/content/types'
import { youTubeId, youTubeThumbnail } from '@/lib/media'
import { youTubeChannelUrl, youTubeHandle } from '@/lib/youtube/channel'

/**
 * The homepage's video: the channel's LATEST public upload.
 *
 * ── HOW THE VIDEO IS CHOSEN ─────────────────────────────────────────────────
 *
 * `mode: 'latest'` — the id comes from `content.youtube`, resolved server-side
 * before this component runs (`@thekanjo` → channel → uploads playlist →
 * newest public item; see lib/youtube). A new upload appears here within one
 * revalidation window with NO content edit and NO deploy.
 *
 * `mode: 'pinned'` — the id comes from `config.video`, for when a specific
 * video should stay put regardless of what has been uploaded since.
 *
 * `config.video` is ALSO the fallback for 'latest': if the API key is missing
 * or Google is unreachable but a video was pinned earlier, that one still
 * plays rather than the block collapsing to a button.
 *
 * ── NO PLAYER LIBRARY, AND NO IFRAME UNTIL IT IS ASKED FOR ──────────────────
 *
 * The block renders a poster and a button. YouTube's iframe — roughly a
 * megabyte of third-party JavaScript, and cookies set on mount whether or not
 * anybody watches — is not created until the visitor presses PLAY. The facade
 * is `VideoEmbed`, the same one the site uses for local clips, so there is ONE
 * play affordance in this codebase rather than two that drift apart.
 *
 * ── AND THE POSTER IS FETCHED BY US, NOT BY THE BROWSER ─────────────────────
 *
 * Whether it comes from the API response or from YouTube's thumbnail host, the
 * still is routed through `next/image`, so OUR server fetches it and the
 * visitor's browser contacts no Google host at all until they press play. That
 * is what keeps the page's default state free of third-party requests.
 */

export function YouTubeSection({
  id,
  config,
  feed,
}: {
  id: string
  config: YouTubeConfig
  feed: YouTubeFeed
}) {
  const header = {
    eyebrow: real(config.eyebrow),
    heading: real(config.heading),
    standfirst: real(config.standfirst),
    ornament: config.ornament,
  }

  const ratio = config.aspectRatio?.trim() || '16 / 9'
  const handle = youTubeHandle(config.channelUrl)
  const channelUrl = handle ? youTubeChannelUrl(handle) : null

  /**
   * The video to play, and where its metadata comes from.
   *
   * A pinned id always wins in 'pinned' mode. In 'latest' mode the feed wins
   * when it resolved, and the pinned id is the safety net.
   */
  const pinnedId = config.video ? youTubeId(config.video) : null
  const live = config.mode === 'latest' && feed.status === 'ok' ? feed.video : undefined
  const videoId = config.mode === 'pinned' ? pinnedId : (live?.id ?? pinnedId)

  // Configured copy overrides the API's, so an editor can always take control
  // of the caption without pinning the video itself.
  const title = real(config.title) ?? live?.title ?? ''
  const description = real(config.description) ?? real(live?.description)

  if (!videoId) {
    // Nothing to play: no key, no uploads, a failed request, or simply not
    // configured yet. `feed.detail` is deliberately not rendered — an API error
    // message is a server-log line, not site copy.
    if (config.fallback === 'hide') return null

    return (
      <Section id={id} header={header} width="wide">
        <Reveal stagger={0.08} distance={20}>
          {channelUrl ? (
            <p style={{ margin: 0 }}>
              <a
                className="k-link-action"
                href={channelUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {config.ctaLabel}
              </a>
            </p>
          ) : (
            <EmptyNotice>NO YOUTUBE CHANNEL CONFIGURED</EmptyNotice>
          )}
        </Reveal>
      </Section>
    )
  }

  /**
   * The still.
   *
   * Preference order: an editor's override, then the thumbnail the API
   * returned (which is already the best size YouTube offered for this upload),
   * then the derived `hqdefault` URL — which exists for every video, unlike
   * `maxresdefault`.
   */
  const poster: ImageRef = config.poster ??
    live?.poster ?? {
      src: youTubeThumbnail(videoId),
      alt: '',
      // hqdefault is always 480x360. The frame's own aspect-ratio governs the
      // layout, so the box is reserved correctly either way.
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
            // The accessible name of the play button. A title is not guaranteed
            // — a pinned id with no configured caption has none — so fall back
            // to something that still says what the button does.
            title: title || 'Latest video',
            description,
            poster,
            featured: true,
            published: true,
            order: 0,
          }}
        />
      </ClipReveal>

      {(title || description || channelUrl) && (
        <Reveal stagger={0.06} distance={18} className="k-video-meta">
          {title && <p className="k-item-title">{title}</p>}
          {description && (
            <p className="k-body" style={{ color: 'var(--k-text-secondary)', margin: 0 }}>
              {description}
            </p>
          )}
          {channelUrl && (
            <p style={{ margin: 0 }}>
              <a
                className="k-link-action"
                href={channelUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {config.ctaLabel}
              </a>
            </p>
          )}
        </Reveal>
      )}
    </Section>
  )
}
