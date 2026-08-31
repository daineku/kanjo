import type { MetadataRoute } from 'next'

import { resolveContentSource } from '@/lib/content/source'
import { siteOrigin } from '@/lib/seo/metadata'

/**
 * robots.txt.
 *
 * Daineku has none, so its sitemap is only discoverable by submission. This
 * points at the sitemap and refuses the whole site when NEXT_PUBLIC_NOINDEX is
 * set, so a preview deployment cannot compete with production in an index.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const source = await resolveContentSource()
  const settings = await source.getSiteSettings()
  const origin = siteOrigin(settings)

  if (process.env.NEXT_PUBLIC_NOINDEX === 'true') {
    return { rules: [{ userAgent: '*', disallow: '/' }] }
  }

  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  }
}
