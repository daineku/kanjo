import type { Metadata } from 'next'

import './globals.css'
import './production-tuning.css'
import { KanjoLoader } from '@/components/loader/KanjoLoader'
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
 * ── THE LOADER'S CONTRACT ───────────────────────────────────────────────────
 *
 * `data-loader="pending"` is set HERE, on the server, when the loader is
 * enabled. It locks scrolling (app/globals.css) and gates the social cluster's
 * entrance. The loader flips it to "done" when the highway masks away.
 *
 * The <noscript> block below is the escape hatch that makes that safe: with
 * JavaScript disabled nothing would ever flip the attribute, so the page would
 * be locked behind a highway that never moves. The style unlocks the document
 * and removes the loader entirely — a no-JavaScript visitor simply arrives at
 * the site.
 */

export async function generateMetadata(): Promise<Metadata> {
  const source = await resolveContentSource()
  const settings = await source.getSiteSettings()
  return buildRootMetadata(settings)
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const source = await resolveContentSource()
  const [settings, loader] = await Promise.all([
    source.getSiteSettings(),
    source.getLoaderConfig(),
  ])

  const loaderActive = loader.enabled

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
    <html lang="en" data-loader={loaderActive ? 'pending' : undefined}>
      <body>
        {loaderActive && (
          <noscript>
            <style>
              {`html[data-loader='pending']{overflow:visible}` +
                `html[data-loader='pending'] .k-loader{display:none}`}
            </style>
          </noscript>
        )}

        <a className="k-skip-link" href="#main">
          Skip to content
        </a>

        {loaderActive && <KanjoLoader config={loader} />}

        {/* The loader marks this `inert` while it is up, so nothing behind an
            opaque overlay is focusable. It is set from the client, so a visitor
            without JavaScript — who never sees the loader — is never handed an
            inert page. */}
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
