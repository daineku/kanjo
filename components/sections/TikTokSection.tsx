import { Reveal } from '@/components/motion/Reveal'
import { EmptyNotice, Section } from '@/components/kanjo/Section'
import { TikTokEmbed } from '@/components/tiktok/TikTokEmbed'
import { real } from '@/lib/content/placeholder'
import type { TikTokConfig } from '@/lib/content/types'
import { tikTokHandle, tikTokProfileUrl } from '@/lib/tiktok/profile'

/**
 * Recent TikTok videos, via the official Creator Profile Embed — or, whenever
 * TikTok does not prove it rendered, one link to the real profile.
 *
 * The server's job is to reduce the configured profile URL to a validated
 * handle and rebuild the canonical URL from it. Nothing else crosses the
 * boundary — see components/tiktok/TikTokEmbed.tsx for why that matters and
 * what the module does with it.
 *
 * The creator embed needs no TikTok developer app, no Login Kit review and no
 * `video.list` authorisation, because the profile is public and it is ours.
 * Nothing is scraped, nothing is proxied, and no TikTok video is downloaded or
 * re-hosted.
 */

export function TikTokSection({
  id,
  config,
}: {
  id: string
  config: TikTokConfig
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

  return (
    <Section id={id} header={header} width="wide">
      {/* A small travel distance: the module's height changes if the embed is
          revealed, and a reveal should not fight the box it is revealing. */}
      <Reveal className="k-tiktok-reveal" distance={16}>
        <TikTokEmbed
          handle={handle}
          profileUrl={tikTokProfileUrl(handle)}
        />
      </Reveal>
    </Section>
  )
}
