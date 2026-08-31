import Image from 'next/image'

import { WedgeCard } from '@/components/kanjo/WedgeCard'
import type { HeroConfig, LinkBlock, SiteSettings } from '@/lib/content/types'

/**
 * The hero.
 *
 * THE BACKGROUND MODEL IS THE CANON'S, not a hero-image convention. The game
 * layers background media, then a treatment, then the UI
 * (Responsive/background_layers.json), with the explicit note that "black
 * visible in Figma screenshots is generally a presentation placeholder, not
 * mandatory production content" and that a blackout applies "only when a UX
 * state explicitly declares it". So `background.kind` selects a provider and
 * `background.treatment` is that middle layer — and with no media configured
 * the hero is the canon background colour, which is exactly what every
 * reference screenshot shows. No gradient mesh, no parallax.
 *
 * The actions are the game's own menu cards, at the canon card width, in a
 * strip. That is the composition the main menu uses, and it is why this reads
 * as entering a menu rather than as a marketing page.
 */

const TREATMENT_SCRIM: Record<NonNullable<HeroConfig['background']>['treatment'], string> = {
  transparent: 'transparent',
  // The canon states scrim at 0.72 (Tokens/opacity.json). 'dim' is the lighter
  // step below it; 'blackout' is opaque, and the canon's own rule is that it is
  // used only where a state declares it.
  dim: 'rgb(0 0 3 / 0.45)',
  strong_dim: 'rgb(0 0 3 / 0.72)',
  blackout: 'var(--k-background)',
}

export function HeroSection({
  config,
  settings,
  links,
}: {
  config: HeroConfig
  settings: SiteSettings
  links: LinkBlock[]
}) {
  const background = config.background ?? { kind: 'none' as const, treatment: 'transparent' as const }
  const hasMedia = background.kind !== 'none'

  const eyebrow =
    config.eyebrow === 'status' ? settings.status.label : config.eyebrow
  const eyebrowDetail = config.eyebrow === 'status' ? settings.status.detail : undefined
  const eyebrowEmphasis = config.eyebrow === 'status' ? settings.status.emphasis : false

  const actions = config.actionIds
    .map((id) => links.find((link) => link.id === id))
    .filter((link): link is LinkBlock => Boolean(link))

  return (
    <section className="k-hero" aria-labelledby="hero-title">
      {hasMedia && background.kind === 'image' && background.image && (
        <Image
          src={background.image.src}
          alt={background.image.alt}
          fill
          priority
          sizes="100vw"
          style={{ objectFit: 'cover', zIndex: 0 }}
        />
      )}

      {hasMedia && background.kind === 'video' && background.videoSrc && (
        // Muted, looping, inline and poster-backed. `preload="none"` keeps it
        // off the critical path — the poster carries the first paint.
        <video
          src={background.videoSrc}
          poster={background.poster?.src}
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            zIndex: 0,
          }}
        />
      )}

      {hasMedia && background.treatment !== 'transparent' && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            background: TREATMENT_SCRIM[background.treatment],
            zIndex: 1,
          }}
        />
      )}

      <div
        className="k-shell"
        style={{
          position: 'relative',
          zIndex: 2,
          paddingBlock: 'clamp(48px, 6vw, 96px)',
          width: '100%',
        }}
      >
        <div style={{ maxWidth: 'var(--k-content)' }}>
          {eyebrow && (
            <p
              className="k-small k-reveal"
              style={{
                color: eyebrowEmphasis ? 'var(--k-positive)' : 'var(--k-text-secondary)',
                marginBottom: 'var(--k-space-lg)',
                display: 'inline-block',
                borderLeft: 'var(--k-divider-width) solid var(--k-positive)',
                paddingLeft: 'var(--k-space-md)',
              }}
            >
              {eyebrow}
              {eyebrowDetail && (
                <span style={{ color: 'var(--k-text-tertiary)' }}> — {eyebrowDetail}</span>
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

          {config.subtitle && (
            <p
              className="k-nav-title k-reveal"
              style={{
                marginTop: 'var(--k-space-md)',
                color: 'var(--k-text-secondary)',
                ['--k-reveal-delay' as string]: '80ms',
              }}
            >
              {config.subtitle}
            </p>
          )}

          {config.description && (
            <p
              className="k-body k-reveal"
              style={{
                marginTop: 'var(--k-space-lg)',
                marginBottom: 0,
                maxWidth: '58ch',
                color: 'var(--k-text-secondary)',
                ['--k-reveal-delay' as string]: '120ms',
              }}
            >
              {config.description}
            </p>
          )}

          {actions.length > 0 && (
            <ul
              className="k-strip k-reveal"
              style={{
                listStyle: 'none',
                margin: 0,
                marginTop: 'clamp(28px, 3vw, 44px)',
                padding: 0,
                // The strip must be able to be narrower than its cards for its
                // own overflow-x to engage; without this the cards push the
                // whole page wide at phone widths.
                maxWidth: '100%',
                ['--k-reveal-delay' as string]: '160ms',
              }}
            >
              {actions.map((action) => (
                <li key={action.id}>
                  <WedgeCard
                    variant="card"
                    title={action.label}
                    subtitle={action.description}
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

          {config.platformNote && (
            <p
              className="k-small"
              style={{ marginTop: 'var(--k-space-lg)', color: 'var(--k-text-tertiary)' }}
            >
              {config.platformNote}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
