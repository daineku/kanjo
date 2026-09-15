import Link from 'next/link'

import { MediaPlate } from '@/components/kanjo/MediaPlate'
import { ScreenshotGrid } from '@/components/kanjo/ScreenshotGrid'
import { EmptyNotice, Section } from '@/components/kanjo/Section'
import { VideoEmbed } from '@/components/kanjo/VideoEmbed'
import { WedgeCard } from '@/components/kanjo/WedgeCard'
import { youTubeId, youTubeThumbnail } from '@/lib/media'
import { isPlaceholder, real, realRows } from '@/lib/content/placeholder'
import type {
  ArticleSummary,
  FeaturesConfig,
  IntroConfig,
  LinkBlock,
  LinksConfig,
  MediaConfig,
  MediaItem,
  SectionHeader,
  SiteSettings,
  SocialConfig,
  StatusConfig,
  UpdatesConfig,
  Video,
  VideoConfig,
} from '@/lib/content/types'
import { formatDate } from '@/lib/format'
import { renderRichText } from '@/lib/richText'

/**
 * The landing page's content sections.
 *
 * Every one is a server component, takes its data as a prop, and fetches
 * nothing. That is the rule that keeps the Daineku media failures from
 * recurring: a section that cannot fetch cannot refetch on hover, on re-render,
 * or once per relayout.
 *
 * Two rules added by the acceptance pass:
 *
 * 1. NO PLACEHOLDER AND NO DEVELOPER INSTRUCTION EVER RENDERS. Optional copy
 *    goes through `real()` / `isPlaceholder()` and is omitted when unwritten.
 *    Empty states say what a VISITOR needs to know ("no footage published yet"),
 *    never what an editor needs to do ("add an entry to content/videos.json") —
 *    that belongs in docs/CONTENT_REQUIRED.md.
 *
 * 2. EVERY MEDIA SURFACE IS A PLATE AT ITS REAL ASPECT RATIO, filled or not, so
 *    a pending section already shows how large the real footage will be.
 */

function cleanHeader(header: SectionHeader): SectionHeader {
  return {
    eyebrow: real(header.eyebrow),
    heading: real(header.heading),
    standfirst: real(header.standfirst),
    ornament: header.ornament,
  }
}

// ── Intro ────────────────────────────────────────────────────────────────────

export function IntroSection({ id, config }: { id: string; config: IntroConfig }) {
  // Placeholder paragraphs are dropped from the body, so a partly-written
  // section renders the part that is written instead of publishing a note to
  // the owner. Splitting on the blank line keeps whole paragraphs intact.
  const body = config.body
    .split(/\n\s*\n/)
    .filter((paragraph) => !isPlaceholder(paragraph))
    .join('\n\n')

  const rendered = renderRichText(body)
  const blocks = config.blocks ?? []

  return (
    <Section id={id} header={cleanHeader(config)}>
      {rendered ? <div className="k-body k-prose k-rt">{rendered}</div> : null}

      {/* Ordered blocks after the body: text, or a video through the same
          click-to-load facade the main video section uses. A block whose id
          is not a YouTube id renders nothing rather than an empty frame. */}
      {blocks.map((block, index) => {
        if (block.type === 'text') {
          const text = renderRichText(
            block.body
              .split(/\n\s*\n/)
              .filter((paragraph) => !isPlaceholder(paragraph))
              .join('\n\n'),
          )
          return text ? (
            <div key={index} className="k-body k-prose k-rt k-intro-block">
              {text}
            </div>
          ) : null
        }
        const videoId = youTubeId(block.video)
        if (!videoId) return null
        return (
          <div key={index} className="k-intro-block k-intro-block--video">
            <VideoEmbed
              ratio={block.aspectRatio?.trim() || '16 / 9'}
              video={{
                id: `${id}-block-${index}`,
                provider: 'youtube',
                ref: videoId,
                title: block.title ?? 'Video',
                poster: { src: youTubeThumbnail(videoId), alt: '', width: 480, height: 360 },
                featured: false,
                published: true,
                order: index,
              }}
            />
            {block.title && <p className="k-item-title k-intro-block-title">{block.title}</p>}
          </div>
        )
      })}
    </Section>
  )
}

// ── Video ────────────────────────────────────────────────────────────────────

export function VideoSection({
  id,
  config,
  videos,
}: {
  id: string
  config: VideoConfig
  videos: Video[]
}) {
  const selected =
    config.videoIds.length > 0
      ? config.videoIds
          .map((videoId) => videos.find((video) => video.id === videoId))
          .filter((video): video is Video => Boolean(video))
      : videos

  return (
    // WIDE, not the reading column. This is the site's single most important
    // media surface and the first build constrained it to 930px, which made the
    // featured video narrower than the text beside it.
    <Section id={id} header={cleanHeader(config)} width="wide">
      {selected.length === 0 ? (
        <MediaPlate
          ratio="16 / 9"
          label="NO FOOTAGE PUBLISHED YET"
          detail="Gameplay and cinematic clips will appear here"
        />
      ) : config.layout === 'featured' ? (
        selected.slice(0, 1).map((video) => (
          <figure key={video.id} style={{ margin: 0 }}>
            <VideoEmbed video={video} priority />
            <figcaption style={{ marginTop: 'var(--k-space-md)' }}>
              <p className="k-item-title">{video.title}</p>
              {real(video.description) && (
                <p
                  className="k-body"
                  style={{
                    marginTop: 'var(--k-space-sm)',
                    marginBottom: 0,
                    color: 'var(--k-text-secondary)',
                    maxWidth: '62ch',
                  }}
                >
                  {video.description}
                </p>
              )}
            </figcaption>
          </figure>
        ))
      ) : (
        <ul className="k-grid k-grid--wide">
          {selected.map((video) => (
            <li key={video.id}>
              <VideoEmbed video={video} />
              <p className="k-item-title" style={{ marginTop: 'var(--k-space-md)' }}>
                {video.title}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

// ── Media ────────────────────────────────────────────────────────────────────

export function MediaSection({
  id,
  config,
  media,
}: {
  id: string
  config: MediaConfig
  media: MediaItem[]
}) {
  const pool = config.group ? media.filter((item) => item.group === config.group) : media
  const selected =
    config.mediaIds.length > 0
      ? config.mediaIds
          .map((mediaId) => pool.find((item) => item.id === mediaId))
          .filter((item): item is MediaItem => Boolean(item))
      : pool
  const shown = config.limit ? selected.slice(0, config.limit) : selected

  return (
    <Section id={id} header={cleanHeader(config)} width="wide">
      {shown.length === 0 ? (
        <ul className="k-grid k-grid--media">
          {/* Three plates at 16:9 — the shape a real screenshot set will take,
              so the layout is already correct when captures land. Only the first
              carries the label; three copies of the same notice is noise. */}
          {[0, 1, 2].map((slot) => (
            <li key={slot}>
              <MediaPlate
                ratio="16 / 9"
                label={slot === 0 ? 'NO SCREENSHOTS PUBLISHED YET' : undefined}
                detail={slot === 0 ? 'Captures from the night loop will appear here' : undefined}
              />
            </li>
          ))}
        </ul>
      ) : (
        /**
         * A plain CSS grid, plus the viewer it opens.
         *
         * No masonry library, no JS relayout, no `imagesLoaded`, no auto-cycle,
         * no hover-triggered fetch — each is recorded in Daineku's handoff as a
         * source of duplicate requests or layout flashes. Space comes from each
         * image's own declared intrinsic dimensions, so nothing shifts as
         * images arrive.
         *
         * It is a client component because opening a screenshot needs state. It
         * is still server-rendered into the initial HTML and ships no
         * dependency — the viewer is this project's own code.
         */
        <ScreenshotGrid items={shown} />
      )}
    </Section>
  )
}

// ── Status ───────────────────────────────────────────────────────────────────

/**
 * The development-status strip.
 *
 * Rows whose value is a placeholder are dropped rather than printed, so this
 * shrinks to what is actually known. The first build rendered four rows of
 * which three said "PLACEHOLDER" or "NOT ANNOUNCED", spending 601px to tell a
 * visitor nothing. If every row is unknown the whole section renders nothing.
 */
export function StatusSection({ id, config }: { id: string; config: StatusConfig }) {
  const rows = realRows(config.rows)
  if (rows.length === 0) return null

  return (
    <Section id={id} header={cleanHeader(config)}>
      <dl className="k-rows">
        {rows.map((row) => (
          <div key={row.label} className="k-row">
            <dt className="k-small">{row.label}</dt>
            <dd
              className="k-action"
              style={{
                margin: 0,
                textAlign: 'right',
                color: row.emphasis ? 'var(--k-accent)' : 'var(--k-text-primary)',
              }}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  )
}

// ── Features ─────────────────────────────────────────────────────────────────

export function FeaturesSection({ id, config }: { id: string; config: FeaturesConfig }) {
  // An item whose description is unwritten contributes a title and nothing
  // else, which reads as a broken list — so it is dropped until it says
  // something. No items, no section.
  const items = config.items.filter((item) => !isPlaceholder(item.description))
  if (items.length === 0) return null

  return (
    <Section id={id} header={cleanHeader(config)} width="wide">
      <ul className="k-grid k-grid--features">
        {items.map((item) => (
          <li key={item.id}>
            <div className="k-spine">
              <h3 className="k-item-title">{item.title}</h3>
              <p
                className="k-body"
                style={{ marginTop: 'var(--k-space-sm)', marginBottom: 0 }}
              >
                {item.description}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ── Updates ──────────────────────────────────────────────────────────────────

export function UpdatesSection({
  id,
  config,
  updates,
}: {
  id: string
  config: UpdatesConfig
  updates: ArticleSummary[]
}) {
  const shown = updates.slice(0, Math.max(0, config.limit))

  return (
    <Section id={id} header={cleanHeader(config)}>
      {shown.length === 0 ? (
        <EmptyNotice>NO UPDATES PUBLISHED YET</EmptyNotice>
      ) : (
        <>
          <ul className="k-grid k-grid--rows">
            {shown.map((article) => (
              <li key={article.slug}>
                <ArticleRow article={article} />
              </li>
            ))}
          </ul>
          {updates.length > shown.length && (
            <p style={{ marginTop: 'clamp(24px, 3vw, 40px)', marginBottom: 0 }}>
              <Link className="k-action k-link-action" href={config.indexHref} prefetch={false}>
                ALL UPDATES
              </Link>
            </p>
          )}
        </>
      )}
    </Section>
  )
}

/**
 * One article in a list.
 *
 * Exported because the updates index renders the same row — two nearly
 * identical article treatments drifting apart is how a list stops matching its
 * own index page.
 */
export function ArticleRow({ article }: { article: ArticleSummary }) {
  return (
    <WedgeCard title={article.title} href={`/updates/${article.slug}`}>
      <p className="k-small" style={{ marginTop: 'var(--k-space-sm)' }}>
        <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
        {real(article.author) && (
          <span style={{ color: 'var(--k-text-tertiary)' }}> — {article.author}</span>
        )}
      </p>
      {real(article.excerpt) && (
        <p
          className="k-body"
          style={{ marginTop: 'var(--k-space-md)', marginBottom: 0, maxWidth: '62ch' }}
        >
          {article.excerpt}
        </p>
      )}
    </WedgeCard>
  )
}

// ── Links ────────────────────────────────────────────────────────────────────

export function LinksSection({
  id,
  config,
  links,
  settings,
}: {
  id: string
  config: LinksConfig
  links: LinkBlock[]
  settings: SiteSettings
}) {
  const selected = config.linkIds
    .map((linkId) => links.find((link) => link.id === linkId))
    .filter((link): link is LinkBlock => Boolean(link))
    .sort((a, b) => Number(b.available) - Number(a.available))

  // Social channels are merged in here rather than living in their own section.
  // Measured, the separate SOCIAL section spent 365px to say "no channels are
  // live yet" immediately below a section that already listed where to follow
  // the project — two sections answering one question.
  const socials = settings.social.filter((link) => link.url.trim() !== '')

  if (selected.length === 0 && socials.length === 0) return null

  return (
    <Section id={id} header={cleanHeader(config)} width="wide">
      {selected.length > 0 && (
        <ul className="k-grid k-grid--cards">
          {selected.map((link) => (
            <li key={link.id}>
              <WedgeCard
                title={link.label}
                subtitle={isPlaceholder(link.description) ? undefined : link.description}
                href={link.href || undefined}
                external={link.external}
                selected={link.available && link.intent === 'primary'}
                disabled={!link.available}
                disabledReason={link.unavailableReason}
              />
            </li>
          ))}
        </ul>
      )}

      {socials.length > 0 && (
        <ul
          className="k-inline-links"
          style={{ marginTop: selected.length > 0 ? 'clamp(28px, 3vw, 44px)' : 0 }}
        >
          {socials.map((link) => (
            <li key={link.id}>
              <a
                className="k-small k-inline-link"
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

// ── Social ───────────────────────────────────────────────────────────────────

/**
 * Kept for content compatibility, and renders nothing when no channel is live.
 *
 * The social links now surface inside `LinksSection`, which is where a visitor
 * looks for "where do I follow this". A dedicated section that says "no channels
 * are live yet" is an empty room on the tour.
 */
export function SocialSection({
  id,
  config,
  settings,
}: {
  id: string
  config: SocialConfig
  settings: SiteSettings
}) {
  const live = settings.social.filter((link) => link.url.trim() !== '')
  if (live.length === 0) return null

  return (
    <Section id={id} header={cleanHeader(config)} width="wide">
      <ul className="k-grid k-grid--tight">
        {live.map((link) => (
          <li key={link.id}>
            <WedgeCard title={link.label} subtitle={real(link.handle)} href={link.url} external />
          </li>
        ))}
      </ul>
    </Section>
  )
}
