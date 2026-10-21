import type { Metadata } from 'next'

import './globals.css'
import './production-tuning.css'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { SocialCluster } from '@/components/layout/SocialCluster'
import { resolveContentSource } from '@/lib/content/source'
import { buildRootMetadata } from '@/lib/seo/metadata'

/**
 * The root layout.
 *
 * Footer, chrome and metadata all come from the content source on the SERVER,
 * so the site title, the channels and the footer are in the initial HTML — a
 * crawler and a first paint both see the real thing.
 *
 * ── WHY THERE IS NO HEADER HERE ANY MORE ────────────────────────────────────
 *
 * The homepage is a title screen, not a document, and a persistent nav bar on
 * top of it is the conventional-marketing-template reflex the product direction
 * moved away from. The header now belongs to the READING routes, where a
 * visitor genuinely needs to move between documents — see app/updates/layout.tsx
 * — and whether it appears at all is `settings.chrome`, not a hardcoded rule.
 * The homepage renders it itself when `chrome.headerOnHome` is set, so the
 * decision is configuration rather than a layout edit either way.
 *
 * ── NO LOADER ───────────────────────────────────────────────────────────────
 *
 * There used to be a full-screen branded loader here, rendered by this layout,
 * with a server-set `data-loader` attribute that locked scrolling and made the
 * page inert until it lifted. It is gone: the server-rendered page IS the first
 * screen, with the hero still in the first paint and nothing to wait for. The
 * loader's settings remain in the content model (and the admin) so that stored
 * content keeps validating, but nothing on the public site reads them.
 */

export async function generateMetadata(): Promise<Metadata> {
  const source = await resolveContentSource()
  const settings = await source.getSiteSettings()
  return buildRootMetadata(settings)
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const source = await resolveContentSource()
  const settings = await source.getSiteSettings()

  /**
   * How many channels the cluster will actually draw.
   *
   * It is published to CSS because the hero has to clear the rail, and how much
   * clearance that needs depends on how many channels are live — a flat padding
   * is either too much when none are configured or too little when three are.
   * See "Keeping the hero clear of the rail" in app/globals.css.
   */
  const liveChannels = settings.social.filter((link) => link.url.trim() !== '').length
  const showCluster = settings.chrome.socialCluster && liveChannels > 0

  return (
    <html lang="en">
      <head>
        {/* The two faces on every first screen — the display family for the
            title and headings, the technical face for every label — fetched
            alongside the stylesheet rather than after it. Iceberg is not
            preloaded: it is the alternate face and has no above-the-fold use. */}
        <link
          rel="preload"
          href="/fonts/BigShouldersDisplay-VF.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/Iceland-Regular.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <a className="k-skip-link" href="#main">
          Skip to content
        </a>

        <div
          id="app-root"
          data-social-cluster={showCluster || undefined}
          style={{ ['--k-social-count' as string]: liveChannels }}
        >
          {showCluster && <SocialCluster links={settings.social} />}
          <main id="main">{children}</main>
          <SiteFooter settings={settings} />
        </div>
      </body>
    </html>
  )
}
