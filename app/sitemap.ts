import type { MetadataRoute } from 'next'

import { resolveContentSource } from '@/lib/content/source'
import { siteOrigin } from '@/lib/seo/metadata'

/**
 * sitemap.xml.
 *
 * Built from the content source rather than from a storage client, so it cannot
 * disagree with what the site actually renders — Daineku's sitemap queries
 * Supabase directly with its own filters, which is a second definition of "what
 * is published" and a second thing to keep in step.
 *
 * `lastModified` is the article's own updatedAt when it has one, and its publish
 * date otherwise. It is never `new Date()`: a sitemap that claims every page
 * changed at the moment of the build is a sitemap a crawler learns to ignore.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const source = await resolveContentSource()
  const [settings, articles] = await Promise.all([
    source.getSiteSettings(),
    source.listArticles(),
  ])
  const origin = siteOrigin(settings)

  const newestUpdate = articles[0]?.updatedAt ?? articles[0]?.publishedAt

  return [
    {
      url: origin,
      changeFrequency: 'weekly',
      priority: 1,
      ...(newestUpdate ? { lastModified: newestUpdate } : {}),
    },
    {
      url: `${origin}/updates`,
      changeFrequency: 'weekly',
      priority: 0.7,
      ...(newestUpdate ? { lastModified: newestUpdate } : {}),
    },
    ...articles.map((article) => ({
      url: `${origin}/updates/${article.slug}`,
      lastModified: article.updatedAt ?? article.publishedAt,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
    // The legal pages. `lastModified` is the date the editor states on the
    // page, for the same reason as above: it should move when the meaning
    // does, not on every build.
    ...(['privacy', 'terms'] as const).map((key) => ({
      url: `${origin}/${key}`,
      changeFrequency: 'yearly' as const,
      priority: 0.3,
      ...(settings.legal[key].updatedAt ? { lastModified: settings.legal[key].updatedAt } : {}),
    })),
  ]
}
