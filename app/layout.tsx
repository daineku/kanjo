import type { Metadata } from 'next'

import './globals.css'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { SiteHeader } from '@/components/layout/SiteHeader'
import { resolveContentSource } from '@/lib/content/source'
import { buildRootMetadata } from '@/lib/seo/metadata'

/**
 * The root layout.
 *
 * Header, footer and metadata all come from the content source on the SERVER,
 * so the site title, the nav and the footer are in the initial HTML. Daineku's
 * root layout hardcodes a title ("JDM Builds", still the scaffold's value) and
 * its header fetches settings from a client effect; the whole point of doing it
 * here is that a crawler and a first paint both see the real thing.
 *
 * Fonts are self-hosted from /public/fonts and declared in globals.css, so
 * there is no render-blocking request to a font CDN. Daineku loads Manrope from
 * Google Fonts twice — once via `<link>` in the layout and again via `@import`
 * at the top of globals.css.
 */

export async function generateMetadata(): Promise<Metadata> {
  const source = await resolveContentSource()
  const settings = await source.getSiteSettings()
  return buildRootMetadata(settings)
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const source = await resolveContentSource()
  const settings = await source.getSiteSettings()

  return (
    <html lang="en">
      <body>
        <a className="k-skip-link" href="#main">
          Skip to content
        </a>
        <SiteHeader settings={settings} />
        <main id="main">{children}</main>
        <SiteFooter settings={settings} />
      </body>
    </html>
  )
}
