import type { MetadataRoute } from 'next'

import { resolveContentSource } from '@/lib/content/source'
import { shouldNoIndex } from '@/lib/runtime/mode'
import { siteOrigin } from '@/lib/seo/metadata'

/**
 * robots.txt.
 *
 * Daineku has none, so its sitemap is only discoverable by submission. This
 * points at the sitemap, and refuses the whole site on any deployment that is
 * not production — so a preview cannot compete with the real site in an index.
 *
 * The decision is `shouldNoIndex()` rather than a bare environment read: every
 * Vercel preview is covered automatically, without anyone having to remember to
 * set a variable on each one. See lib/runtime/mode.ts.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const source = await resolveContentSource()
  const settings = await source.getSiteSettings()
  const origin = siteOrigin(settings)

  if (shouldNoIndex()) {
    return { rules: [{ userAgent: '*', disallow: '/' }] }
  }

  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  }
}
