import Image from 'next/image'
import type { CSSProperties } from 'react'

import { HeroVideo } from '@/components/kanjo/HeroVideo'
import { WedgeCard } from '@/components/kanjo/WedgeCard'
import { TitleReveal } from '@/components/motion/TitleReveal'
import { isPlaceholder } from '@/lib/content/placeholder'
import type { HeroConfig, LinkBlock, LoaderConfig, SiteSettings } from '@/lib/content/types'

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
 * `preload="none"`, and is not rendered at all under prefers-reduced-motion —
 * see HeroVideo, which explains why that needs a matchMedia gate rather than a
 * CSS media query. The poster is a server-rendered layer of its own, so the
 * reduced-motion hero is complete and issues no video request.
 */

export function HeroSection({
  config,
  settings,
  links,
  loader,
}: {
  config: HeroConfig
  settings: SiteSettings
  links: LinkBlock[]
  /**
   * The hero owns THE KANJO's arrival, and the loader only supplies the cue —
   * see components/motion/TitleReveal.tsx for why the title is not inside the
   * loader. This is how the hero knows whether there is a cue to wait for.
   */
  loader: LoaderConfig
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

  /**
   * Video sources in preference order, `videoSources` first and the `videoSrc`
   * shorthand last, de-duplicated. A WebM listed before the MP4 wins on any
   * browser that supports it; everything else falls through to the MP4.
   */
  const videoSources = [...(background.videoSources ?? []), background.videoSrc]
    .filter((source): source is string => Boolean(source?.trim()))
    .filter((source, index, all) => all.indexOf(source) === index)

  // 'video' with no source is a misconfiguration, not a state — treat it as no
  // media so the hero renders its neutral field instead of an empty element.
  const hasMedia =
    (background.kind === 'image' && Boolean(background.image)) ||
    (background.kind === 'video' && videoSources.length > 0)

  return (
    <section className="k-hero" data-media={hasMedia} aria-labelledby="hero-title">
      {/* ── Layer 0: world media ─────────────────────────────────────────── */}
      <div
        className="k-hero-media"
        aria-hidden="true"
        // Framing, as two CSS variables the stylesheet applies at the right
        // breakpoint. `object-position` is the whole of the crop control: the
        // hero is the one surface that crops media to an arbitrary box, and a
        // capture with the car framed low needs 'center 70%' rather than a
        // centre crop that cuts it off.
        style={
          {
            '--k-hero-object-position': background.objectPosition ?? 'center',
            '--k-hero-object-position-mobile':
              background.mobileObjectPosition ?? background.objectPosition ?? 'center',
          } as CSSProperties
        }
      >
        {background.kind === 'image' && background.image && (
          <>
            <Image
              className={background.mobileImage ? 'k-hero-img k-hero-img--desktop' : 'k-hero-img'}
              src={background.image.src}
              alt=""
              fill
              priority
              sizes="100vw"
            />
            {background.mobileImage && (
              <Image
                className="k-hero-img k-hero-img--mobile"
                src={background.mobileImage.src}
                alt=""
                fill
                priority
                sizes="100vw"
              />
            )}
          </>
        )}

        {background.kind === 'video' && videoSources.length > 0 && (
          <>
            {/*
             * THE POSTER IS ITS OWN LAYER, ALWAYS RENDERED.
             *
             * It is the first paint, the fallback when the loop cannot play, and
             * — critically — what shows under prefers-reduced-motion, where the
             * video element is never rendered. Relying on the `<video poster>`
             * attribute alone would leave bare background in that case, and
             * would also make the first paint wait for a client component.
             *
             * Both layers are absolutely positioned in the same box, so there is
             * no layout shift when the video paints over the poster.
             */}
            {background.poster && (
              <Image
                className="k-hero-img"
                src={background.poster.src}
                alt=""
                fill
                priority
                sizes="100vw"
              />
            )}

            {/*
             * The loop mounts only when motion is welcome — see HeroVideo for
             * why that needs a matchMedia gate rather than a CSS media query.
             * Short version: hiding it with CSS stops the motion but the browser
             * still downloads the file, measured at 1 request under reduced
             * motion. The poster above is the server-rendered first paint, so a
             * reduced-motion visitor gets a complete hero and no video request.
             */}
            <HeroVideo sources={videoSources} poster={background.poster?.src} />
          </>
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

            {/* The identity moment. A string, split into words in JavaScript —
                never parsed as HTML, unlike the reference implementation this
                effect is adapted from. */}
            <TitleReveal
              id="hero-title"
              className="k-hero-title"
              text={config.title}
              waitForLoader={loader.enabled}
              enabled={loader.titleRevealEnabled}
            />

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
