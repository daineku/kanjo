import Image from 'next/image'

import { WedgeCard } from '@/components/kanjo/WedgeCard'
import { isPlaceholder } from '@/lib/content/placeholder'
import type { HeroConfig, LinkBlock, SiteSettings } from '@/lib/content/types'

/**
 * The hero: media, treatment, UI. The canon's own composition.
 *
 * THE BACKGROUND IS NOT BLACK BY DESIGN. `Screens/MainMenu/layout.json` names
 * its background `reference: "figma_placeholder_black"` with
 * `mandatoryProductionBackground: false` and `defaultTreatment: {mode: "dim"}`;
 * `Responsive/background_layers.json` states that "black visible in Figma
 * screenshots is generally a presentation placeholder, not mandatory production
 * content"; `Screens/Pause/layout.json` spells the composition out as "paused
 * gameplay frame + optional treatment + UI".
 *
 * The first build reproduced the placeholder and treated it as the design. The
 * measurable result: at 1920x1080 the hero was 778px tall with 270px of empty
 * black above the title, at 768x1024 that was 359px, the first screen contained
 * zero images, and a visitor had no way to tell the site was about a game.
 *
 * So the media layer is now a real, first-class layer. With no footage yet it
 * renders a NEUTRAL field at the exact footprint real media will occupy — not a
 * fabricated screenshot, and not a void. Adding a still or a loop later is a
 * content change, not a layout change.
 *
 * Autoplay video, when configured, is muted + playsInline + poster-backed +
 * `preload="none"`, and is suppressed under prefers-reduced-motion by the CSS,
 * which leaves the poster showing.
 */

export function HeroSection({
  config,
  settings,
  links,
}: {
  config: HeroConfig
  settings: SiteSettings
  links: LinkBlock[]
}) {
  const background = config.background ?? {
    kind: 'none' as const,
    treatment: 'dim' as const,
  }

  const statusLabel = config.eyebrow === 'status' ? settings.status.label : config.eyebrow
  const statusDetail = config.eyebrow === 'status' ? settings.status.detail : undefined
  const status = isPlaceholder(statusLabel) ? undefined : statusLabel
  const statusNote = isPlaceholder(statusDetail) ? undefined : statusDetail
  const platformNote = isPlaceholder(config.platformNote) ? undefined : config.platformNote
  const subtitle = isPlaceholder(config.subtitle) ? undefined : config.subtitle
  const description = isPlaceholder(config.description) ? undefined : config.description

  /**
   * Live actions first.
   *
   * The first build used configured order, which led with a greyed "WISHLIST ON
   * STEAM / NOT YET ANNOUNCED" — the most prominent action on the page was a
   * dead one. Unavailable actions stay visible, because the canon keeps a locked
   * row visible so a player learns what to aim for, but they no longer take the
   * primary slot.
   */
  const actions = config.actionIds
    .map((id) => links.find((link) => link.id === id))
    .filter((link): link is LinkBlock => Boolean(link))
    .sort((a, b) => Number(b.available) - Number(a.available))

  const hasMedia = background.kind !== 'none'

  return (
    <section className="k-hero" data-media={hasMedia} aria-labelledby="hero-title">
      {/* ── Layer 0: world media ─────────────────────────────────────────── */}
      <div className="k-hero-media" aria-hidden="true">
        {background.kind === 'image' && background.image && (
          <Image
            src={background.image.src}
            alt=""
            fill
            priority
            sizes="100vw"
            style={{ objectFit: 'cover' }}
          />
        )}

        {background.kind === 'video' && background.videoSrc && (
          <video
            className="k-hero-video"
            src={background.videoSrc}
            poster={background.poster?.src}
            autoPlay
            muted
            loop
            playsInline
            preload="none"
            tabIndex={-1}
          />
        )}

        {/* No media yet. A neutral field at the hero's own footprint — nothing
            is fabricated, and no registration brackets: on a full-bleed layer
            they land at the viewport corners and read as a HUD overlay rather
            than as a media slot. Brackets stay on bounded plates. */}
        {!hasMedia && <span className="k-hero-plate" />}
      </div>

      {/* ── Layer 1: background treatment ────────────────────────────────── */}
      <div
        className="k-hero-treatment"
        data-mode={hasMedia ? background.treatment : 'transparent'}
        aria-hidden="true"
      />

      {/* ── Layer 2: the UI group ────────────────────────────────────────── */}
      <div className="k-hero-ui">
        <div className="k-shell">
          <div style={{ maxWidth: 'var(--k-content)' }}>
            {status && (
              <p className="k-hero-status k-reveal">
                <span className="k-small" style={{ color: 'var(--k-positive)' }}>
                  {status}
                </span>
                {statusNote && (
                  <span className="k-small" style={{ color: 'var(--k-text-tertiary)' }}>
                    {statusNote}
                  </span>
                )}
              </p>
            )}

            <h1
              id="hero-title"
              className="k-hero-title k-reveal"
              style={{ ['--k-reveal-delay' as string]: '40ms' }}
            >
              {config.title}
            </h1>

            {subtitle && (
              <p
                className="k-nav-title k-reveal"
                style={{
                  marginTop: 'var(--k-space-md)',
                  color: 'var(--k-text-secondary)',
                  ['--k-reveal-delay' as string]: '80ms',
                }}
              >
                {subtitle}
              </p>
            )}

            {description && (
              <p
                className="k-body k-reveal"
                style={{
                  marginTop: 'var(--k-space-lg)',
                  marginBottom: 0,
                  maxWidth: '52ch',
                  ['--k-reveal-delay' as string]: '120ms',
                }}
              >
                {description}
              </p>
            )}

            {actions.length > 0 && (
              <ul
                className="k-hero-actions k-reveal"
                style={{ ['--k-reveal-delay' as string]: '160ms' }}
              >
                {actions.map((action) => (
                  <li key={action.id}>
                    <WedgeCard
                      variant="card"
                      title={action.label}
                      subtitle={
                        isPlaceholder(action.description) ? undefined : action.description
                      }
                      href={action.href || undefined}
                      external={action.external}
                      selected={action.available && action.intent === 'primary'}
                      disabled={!action.available}
                      disabledReason={action.unavailableReason}
                    />
                  </li>
                ))}
              </ul>
            )}

            {platformNote && (
              <p
                className="k-small"
                style={{ marginTop: 'var(--k-space-lg)', color: 'var(--k-text-tertiary)' }}
              >
                {platformNote}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
