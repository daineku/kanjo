import { Reveal } from '@/components/motion/Reveal'
import { EmptyNotice, Section } from '@/components/kanjo/Section'
import { TikTokEmbed } from '@/components/tiktok/TikTokEmbed'
import { real } from '@/lib/content/placeholder'
import type { ImageRef, LoaderConfig, SiteSettings, TikTokConfig } from '@/lib/content/types'
import { tikTokHandle, tikTokProfileUrl } from '@/lib/tiktok/profile'

/**
 * Recent TikTok videos, via the official Creator Profile Embed — behind a
 * site-owned preview that does not depend on TikTok answering.
 *
 * ── THE SERVER'S JOB: VALIDATE, AND CHOOSE THE PREVIEW ──────────────────────
 *
 * It reduces the configured profile URL to a handle, rebuilds the canonical
 * URL from that handle, picks the preview artwork, and hands all of it to the
 * client island. Nothing else crosses the boundary — see
 * components/tiktok/TikTokEmbed.tsx for why that matters and what the module
 * does with it.
 *
 * The preview is content: `config.preview` when the owner has uploaded one
 * (an authorised snapshot of the real profile, say), otherwise the site's
 * default social image — genuine artwork that already exists for the same
 * purpose. There is no hardcoded path, and nothing is fabricated: the block
 * says "official profile" and links to it; it never pretends to be a feed.
 *
 * ── NO CREDENTIALS, BY DESIGN ───────────────────────────────────────────────
 *
 * The creator embed needs no TikTok developer app, no Login Kit review and no
 * `video.list` authorisation, because the profile is public and it is ours.
 * The upgrade path to custom-styled cards is documented in docs/TIKTOK.md; it
 * is a `mode` change plus an adapter, not a rewrite of this section.
 *
 * Nothing is scraped, nothing is proxied, and no TikTok video is downloaded or
 * re-hosted.
 */

export function TikTokSection({
  id,
  config,
  loader,
  settings,
}: {
  id: string
  config: TikTokConfig
  /**
   * The embed must not fetch TikTok's script while the loader is still
   * running — see components/tiktok/TikTokEmbed.tsx. This is how it knows
   * whether there is a loader to wait for.
   */
  loader: LoaderConfig
  /** For the default preview artwork, when the section has none of its own. */
  settings: SiteSettings
}) {
  const header = {
    eyebrow: real(config.eyebrow),
    heading: real(config.heading),
    standfirst: real(config.standfirst),
    ornament: config.ornament,
  }

  const handle = tikTokHandle(config.profileUrl)

  if (!handle) {
    if (config.fallback === 'hide') return null
    return (
      <Section id={id} header={header} width="wide">
        <EmptyNotice>NO TIKTOK PROFILE CONFIGURED</EmptyNotice>
      </Section>
    )
  }

  const profileUrl = tikTokProfileUrl(handle)
  const ctaLabel = real(config.ctaLabel) ?? 'EXPLORE THE KANJO ON TIKTOK'
  const preview: ImageRef | undefined = config.preview ?? settings.seo.defaultSocialImage

  if (!preview) {
    // No artwork anywhere in the content layer: the module cannot be the
    // finished block it is meant to be, so it says what is missing rather than
    // drawing an empty plate — and still offers the real profile.
    if (config.fallback === 'hide') return null
    return (
      <Section id={id} header={header} width="wide">
        <EmptyNotice>NO TIKTOK PREVIEW ARTWORK CONFIGURED</EmptyNotice>
        <p style={{ marginTop: 'var(--k-space-lg)', marginBottom: 0 }}>
          <a className="k-link-action" href={profileUrl} target="_blank" rel="noopener noreferrer">
            {ctaLabel}
          </a>
        </p>
      </Section>
    )
  }

  return (
    <Section id={id} header={header} width="wide">
      {/* A small travel distance and no clip: the module's height changes
          when the embed is revealed, and animating a box whose height is about
          to change under it is how a reveal ends up fighting the thing it is
          revealing. */}
      <Reveal className="k-tiktok-reveal" distance={16}>
        <TikTokEmbed
          handle={handle}
          profileUrl={profileUrl}
          ctaLabel={ctaLabel}
          preview={preview}
          embedLoading={config.embedLoading ?? 'auto'}
          waitForLoader={loader.enabled}
        />
      </Reveal>
    </Section>
  )
}
