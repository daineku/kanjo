import { Reveal } from '@/components/motion/Reveal'
import { EmptyNotice, Section } from '@/components/kanjo/Section'
import { TikTokEmbed } from '@/components/tiktok/TikTokEmbed'
import { real } from '@/lib/content/placeholder'
import type { LoaderConfig, TikTokConfig } from '@/lib/content/types'
import { tikTokHandle, tikTokProfileUrl } from '@/lib/tiktok/profile'

/**
 * Recent TikTok videos, via the official Creator Profile Embed.
 *
 * ── THE SERVER'S ONLY JOB HERE IS VALIDATION ────────────────────────────────
 *
 * It reduces the configured profile URL to a handle, rebuilds the canonical
 * URL from that handle, and hands both to the client island. Nothing else
 * crosses the boundary — see components/tiktok/TikTokEmbed.tsx for why that
 * matters and what the embed does with them.
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
}: {
  id: string
  config: TikTokConfig
  /**
   * The embed must not fetch TikTok's script while the loader is still
   * running — see components/tiktok/TikTokEmbed.tsx. This is how it knows
   * whether there is a loader to wait for.
   */
  loader: LoaderConfig
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

  return (
    <Section id={id} header={header} width="wide">
      {/* A small travel distance and no clip: the embed is a third-party iframe
          that resizes itself as it loads, and animating a box whose height is
          about to change under it is how a reveal ends up fighting the thing it
          is revealing. */}
      <Reveal className="k-tiktok-reveal" distance={16}>
        <TikTokEmbed
          handle={handle}
          profileUrl={profileUrl}
          waitForLoader={loader.enabled}
        />
      </Reveal>
    </Section>
  )
}
