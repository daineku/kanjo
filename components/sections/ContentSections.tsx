import Image from 'next/image'
import Link from 'next/link'

import { Frame, PendingSlot } from '@/components/kanjo/Frame'
import { EmptyNotice, Section } from '@/components/kanjo/Section'
import { WedgeCard } from '@/components/kanjo/WedgeCard'
import { VideoEmbed } from '@/components/kanjo/VideoEmbed'
import type {
  ArticleSummary,
  FeaturesConfig,
  IntroConfig,
  LinkBlock,
  LinksConfig,
  MediaConfig,
  MediaItem,
  SiteSettings,
  SocialConfig,
  StatusConfig,
  UpdatesConfig,
  Video,
  VideoConfig,
} from '@/lib/content/types'
import { renderRichText } from '@/lib/richText'
import { formatDate } from '@/lib/format'

/**
 * The landing page's content sections.
 *
 * Every one of them is a server component, takes its data as a prop, and
 * fetches nothing. That is the rule that keeps the Daineku media failures from
 * recurring: a section that cannot fetch cannot refetch on hover, on re-render,
 * or once per masonry relayout.
 *
 * Each also handles its own empty state rather than returning null. An enabled
 * section that silently vanishes makes an incomplete site look finished, which
 * is the opposite of useful while the content is still being written.
 */

// ── Intro ────────────────────────────────────────────────────────────────────

export function IntroSection({ id, config }: { id: string; config: IntroConfig }) {
  const body = renderRichText(config.body)

  return (
    <Section id={id} header={config}>
      {body ? (
        <div className="k-body k-prose k-rt">{body}</div>
      ) : (
        <EmptyNotice>NO COPY WRITTEN FOR THIS SECTION YET</EmptyNotice>
      )}
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
  // An explicit id list wins; an empty list means "everything published".
  const selected =
    config.videoIds.length > 0
      ? config.videoIds
          .map((videoId) => videos.find((video) => video.id === videoId))
          .filter((video): video is Video => Boolean(video))
      : videos

  return (
    <Section id={id} header={config}>
      {selected.length === 0 ? (
        <>
          <PendingSlot
            ratio="16 / 9"
            label="NO FOOTAGE PUBLISHED"
            detail="Add an entry to content/videos.json"
          />
          <EmptyNotice>
            No video has been published. Nothing has been substituted for one.
          </EmptyNotice>
        </>
      ) : config.layout === 'featured' ? (
        <div style={{ display: 'grid', gap: 'var(--k-space-lg)' }}>
          {selected.slice(0, 1).map((video) => (
            <figure key={video.id} style={{ margin: 0 }}>
              <VideoEmbed video={video} />
              <figcaption style={{ marginTop: 'var(--k-space-md)' }}>
                <p className="k-item-title">{video.title}</p>
                {video.description && (
                  <p
                    className="k-body"
                    style={{
                      marginTop: 'var(--k-space-sm)',
                      marginBottom: 0,
                      color: 'var(--k-text-secondary)',
                    }}
                  >
                    {video.description}
                  </p>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
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
    <Section id={id} header={config} width="wide">
      {shown.length === 0 ? (
        <>
          {/* The canon's own pending-slot treatment, three across, so the
              section has a shape and reads as deliberate rather than broken. */}
          <ul className="k-grid k-grid--media">
            {[0, 1, 2].map((slot) => (
              <li key={slot}>
                <PendingSlot ratio="16 / 9" label="SLOT EMPTY" />
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 'var(--k-space-lg)' }}>
            <EmptyNotice>
              No screenshots have been captured for this site. Nothing has been fabricated in
              their place — add entries to content/media.json.
            </EmptyNotice>
          </div>
        </>
      ) : (
        /**
         * A plain CSS grid.
         *
         * No masonry library, no JS relayout, no `imagesLoaded`, no auto-cycle,
         * no hover-triggered fetch. Every one of those is recorded in Daineku's
         * handoff as a source of duplicate image requests or layout flashes. The
         * space each image occupies comes from its own declared intrinsic
         * dimensions via `aspect-ratio`, so nothing shifts as images arrive.
         */
        <ul className="k-grid k-grid--media">
          {shown.map((item, index) => (
            <li key={item.id}>
              <figure style={{ margin: 0 }}>
                <Frame ratio={`${item.image.width} / ${item.image.height}`}>
                  <Image
                    src={item.image.src}
                    alt={item.image.alt}
                    width={item.image.width}
                    height={item.image.height}
                    // Only the first row is eager. Everything else waits for
                    // the viewport.
                    loading={index < 3 ? 'eager' : 'lazy'}
                    sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </Frame>
                {(item.title || item.caption) && (
                  <figcaption style={{ marginTop: 'var(--k-space-sm)' }}>
                    {item.title && <p className="k-small">{item.title}</p>}
                    {item.caption && (
                      <p className="k-small" style={{ color: 'var(--k-text-tertiary)' }}>
                        {item.caption}
                      </p>
                    )}
                  </figcaption>
                )}
              </figure>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

// ── Status ───────────────────────────────────────────────────────────────────

export function StatusSection({ id, config }: { id: string; config: StatusConfig }) {
  if (config.rows.length === 0) {
    return (
      <Section id={id} header={config}>
        <EmptyNotice>NO STATUS ROWS CONFIGURED</EmptyNotice>
      </Section>
    )
  }

  return (
    <Section id={id} header={config}>
      {/* A definition list, because that is what a label/value table is. The
          row treatment is the canon's settings row: label left, value right,
          a divider between. */}
      <dl style={{ margin: 0 }}>
        {config.rows.map((row, index) => (
          <div
            key={row.label}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 'var(--k-space-lg)',
              paddingBlock: 'var(--k-space-md)',
              borderTop:
                index === 0 ? 'var(--k-thin-width) solid var(--k-divider)' : undefined,
              borderBottom: 'var(--k-thin-width) solid var(--k-divider)',
            }}
          >
            <dt className="k-small" style={{ color: 'var(--k-text-secondary)' }}>
              {row.label}
            </dt>
            <dd
              className="k-action"
              style={{
                margin: 0,
                textAlign: 'right',
                color: row.emphasis ? 'var(--k-positive)' : 'var(--k-text-primary)',
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
  if (config.items.length === 0) {
    return (
      <Section id={id} header={config}>
        <EmptyNotice>NO ITEMS CONFIGURED</EmptyNotice>
      </Section>
    )
  }

  return (
    <Section id={id} header={config}>
      <ul className="k-grid k-grid--features">
        {config.items.map((item) => (
          <li key={item.id}>
            {/* The canon's left rule alone, without the band: a list entry is
                not a menu item, and using the full card here would imply every
                one of these is activatable. */}
            <div
              style={{
                borderLeft: 'var(--k-divider-width) solid var(--k-divider)',
                paddingLeft: 'var(--k-space-lg)',
              }}
            >
              <h3 className="k-item-title">{item.title}</h3>
              <p
                className="k-body"
                style={{
                  marginTop: 'var(--k-space-sm)',
                  marginBottom: 0,
                  color: 'var(--k-text-secondary)',
                }}
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
    <Section id={id} header={config}>
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
              <Link
                className="k-action"
                href={config.indexHref}
                prefetch={false}
                style={{
                  color: 'var(--k-positive-bright)',
                  textDecoration: 'none',
                  borderLeft: 'var(--k-divider-width) solid var(--k-positive)',
                  paddingLeft: 'var(--k-space-md)',
                }}
              >
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
 * Exported because the updates index renders the same row, and two nearly
 * identical article rows drifting apart is how a list stops matching its own
 * index page.
 */
export function ArticleRow({ article }: { article: ArticleSummary }) {
  return (
    <WedgeCard title={article.title} href={`/updates/${article.slug}`}>
      <p className="k-small" style={{ marginTop: 'var(--k-space-sm)' }}>
        <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
        {article.author && (
          <span style={{ color: 'var(--k-text-tertiary)' }}> — {article.author}</span>
        )}
      </p>
      {article.excerpt && (
        <p
          className="k-body"
          style={{
            marginTop: 'var(--k-space-md)',
            marginBottom: 0,
            color: 'var(--k-text-secondary)',
          }}
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
}: {
  id: string
  config: LinksConfig
  links: LinkBlock[]
}) {
  const selected = config.linkIds
    .map((linkId) => links.find((link) => link.id === linkId))
    .filter((link): link is LinkBlock => Boolean(link))

  return (
    <Section id={id} header={config} width="wide">
      {selected.length === 0 ? (
        <EmptyNotice>NO LINKS CONFIGURED</EmptyNotice>
      ) : (
        <ul className="k-grid k-grid--cards">
          {selected.map((link) => (
            <li key={link.id}>
              <WedgeCard
                title={link.label}
                subtitle={link.description}
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
    </Section>
  )
}

// ── Social ───────────────────────────────────────────────────────────────────

export function SocialSection({
  id,
  config,
  settings,
}: {
  id: string
  config: SocialConfig
  settings: SiteSettings
}) {
  // The content source has already dropped unpublished entries; an entry with no
  // URL is dropped here, because a social link that goes nowhere is worse than
  // an absent one.
  const live = settings.social.filter((link) => link.url.trim() !== '')

  return (
    <Section id={id} header={config} width="wide">
      {live.length === 0 ? (
        <EmptyNotice>
          NO CHANNELS ARE LIVE YET — no account has been invented to fill this section
        </EmptyNotice>
      ) : (
        <ul className="k-grid k-grid--tight">
          {live.map((link) => (
            <li key={link.id}>
              <WedgeCard
                variant="default"
                title={link.label}
                subtitle={link.handle}
                href={link.url}
                external
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
