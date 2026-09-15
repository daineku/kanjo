import { Reveal } from '@/components/motion/Reveal'
import { EmptyNotice, Section } from '@/components/kanjo/Section'
import { real } from '@/lib/content/placeholder'
import type { PatreonConfig, PatreonFeed, PatreonPost } from '@/lib/content/types'
import { formatDate } from '@/lib/format'

/**
 * PATREON / DEVELOPMENT LOG.
 *
 * ── WHAT IS RENDERED, AND WHAT IS NOT ───────────────────────────────────────
 *
 * Title, date, public/locked state, a short excerpt, and a way in. That is the
 * whole of it, and it is not a limitation — it is the rule.
 *
 * MEMBERS-ONLY POSTS ARE LISTED HERE ON PURPOSE (`showLockedPosts`, which ships
 * `true`): a locked post is promotion for the tier that unlocks it, so it shows
 * its title, its date, a MEMBERS marker, Patreon's own public teaser if the
 * creator wrote one, and an UNLOCK ON PATREON action. What it never shows is its
 * body.
 *
 * That guarantee is not this component's to keep. The excerpt reaching it has
 * already been gated by lib/patreon/posts.ts, which derives an excerpt from post
 * content ONLY when Patreon marks the post public, and lets `teaser_text` — the
 * teaser Patreon itself shows to non-members — through for a locked one. There
 * is no field on `PatreonPost` that could carry a locked body, so this component
 * could not publish paid writing even if it tried to. See lib/content/types.ts.
 *
 * The site never iframes the creator page and never scrapes Patreon's HTML: the
 * data comes from the official API v2 `campaigns.posts` endpoint, server-side.
 *
 * ── THE UNCONFIGURED STATE IS THE NORMAL STATE ──────────────────────────────
 *
 * A fresh clone has no Patreon token, and the section must be complete without
 * one. `fallback: 'cta'` keeps the block, its copy and the button; `'hide'`
 * renders nothing. Neither path shows an error, a spinner or an empty feed — a
 * third party being unreachable is not news the visitor can act on.
 *
 * ── MOTION ──────────────────────────────────────────────────────────────────
 *
 * Rows reveal on scroll with a small stagger, once. The hover treatment is the
 * canon's selection rule moving to red — CSS only, no pointer tracking, no
 * tilt — and it carries no information a touch visitor would miss: the date,
 * the state and the excerpt are all on screen without hovering anything.
 */

export function PatreonSection({
  id,
  config,
  feed,
}: {
  id: string
  config: PatreonConfig
  feed: PatreonFeed
}) {
  const header = {
    eyebrow: real(config.eyebrow),
    heading: real(config.heading),
    standfirst: real(config.standfirst),
    ornament: config.ornament,
  }

  const campaignUrl = config.campaignUrl.trim()
  const posts = config.showLockedPosts
    ? feed.posts
    : feed.posts.filter((post) => post.isPublic)
  const visible = posts.slice(0, Math.max(0, config.limit))

  // No feed: either the whole block goes, or it keeps its copy and its way in.
  // `feed.detail` is deliberately not rendered — an API error message is a
  // server-log line, not site copy.
  if (visible.length === 0) {
    if (config.fallback === 'hide') return null

    return (
      <Section id={id} header={header}>
        <Reveal stagger={0.08} distance={20}>
          {real(config.fallbackDescription) && (
            <p className="k-body" style={{ marginTop: 0, color: 'var(--k-text-secondary)' }}>
              {config.fallbackDescription}
            </p>
          )}
          {campaignUrl ? (
            <p style={{ margin: 0 }}>
              <PatreonCta href={campaignUrl} label={config.ctaLabel} />
            </p>
          ) : (
            <EmptyNotice>PATREON PAGE NOT CONFIGURED</EmptyNotice>
          )}
        </Reveal>
      </Section>
    )
  }

  return (
    <Section id={id} header={header}>
      <Reveal as="ul" className="k-post-list" stagger={0.09} distance={26}>
        {visible.map((post) => (
          <li key={post.id}>
            <PatreonRow post={post} />
          </li>
        ))}
      </Reveal>

      {campaignUrl && (
        <Reveal distance={16}>
          <p style={{ marginTop: 'clamp(28px, 3vw, 44px)', marginBottom: 0 }}>
            <PatreonCta href={campaignUrl} label={config.ctaLabel} />
          </p>
        </Reveal>
      )}
    </Section>
  )
}

function PatreonRow({ post }: { post: PatreonPost }) {
  return (
    <a
      className="k-post-row"
      href={post.url}
      target="_blank"
      rel="noopener noreferrer"
      data-locked={!post.isPublic}
    >
      <span className="k-post-meta">
        {/* Patreon returns a full ISO timestamp; formatDate takes a calendar
            date, and the time of day is not information a devlog entry needs. */}
        <time className="k-small" dateTime={post.publishedAt}>
          {formatDate(post.publishedAt.slice(0, 10))}
        </time>
        {!post.isPublic && <span className="k-post-lock k-small">MEMBERS</span>}
      </span>

      <span className="k-item-title k-post-title">{post.title}</span>

      {/* A locked post with no teaser simply has no excerpt line. The action
          below already says what the row leads to, so an invented sentence in
          its place would be filler standing where the creator wrote nothing. */}
      {post.excerpt && <span className="k-body k-post-excerpt">{post.excerpt}</span>}

      {/* The action, said plainly, because "MEMBERS" alone does not tell a
          visitor what clicking does. A span rather than a nested link: the whole
          row is already the anchor, and an <a> inside an <a> is invalid markup
          that browsers recover from unpredictably. It is NOT aria-hidden — it is
          real information, and as part of the anchor's text it is also what
          gives the link an accessible name that ends in its own purpose. */}
      <span className="k-post-action k-small">
        {post.isPublic ? 'VIEW ON PATREON' : 'UNLOCK ON PATREON'}
      </span>
    </a>
  )
}

function PatreonCta({ href, label }: { href: string; label: string }) {
  return (
    <a className="k-link-action" href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  )
}
