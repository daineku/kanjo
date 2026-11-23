import type { MetadataRoute } from 'next'

import { resolveContentSource } from '@/lib/content/source'
import { siteOrigin } from '@/lib/seo/metadata'
import { getCatalog, getStorePages } from '@/lib/store/client'
import { realProductCount } from '@/lib/store/filter'
import { storeEnabled } from '@/lib/store/server'

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
    ...(await storeEntries(origin)),
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

/**
 * THE KANJO PARTS, when the store exists and its backend answered.
 *
 * Only pages worth indexing: categories that hold products, real (non-sample)
 * products, and policies the merchant has signed off. Never the cart,
 * checkout, order or search pages, and never a filtered view. A backend
 * failure contributes nothing rather than failing the sitemap.
 */
async function storeEntries(origin: string): Promise<MetadataRoute.Sitemap> {
  if (!storeEnabled()) return []
  const [catalog, pages] = await Promise.all([getCatalog(), getStorePages()])
  if (!catalog) return []

  const products = catalog.products.filter((product) => !product.isSample)
  const newest = products.map((product) => product.updatedAt).sort().at(-1)

  return [
    ...(products.length > 0
      ? [{ url: `${origin}/parts`, changeFrequency: 'daily' as const, priority: 0.8, ...(newest ? { lastModified: newest } : {}) }]
      : []),
    { url: `${origin}/parts/sourcing`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${origin}/builds`, changeFrequency: 'monthly', priority: 0.5 },
    ...catalog.categories
      .filter((category) => realProductCount(catalog, category.slug) > 0)
      .map((category) => ({
        url: `${origin}/parts/category/${category.slug}`,
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      })),
    ...products.map((product) => ({
      url: `${origin}/parts/${product.slug}`,
      lastModified: product.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    ...(pages ?? [])
      .filter((page) => page.legalReviewed)
      .map((page) => ({
        url: `${origin}/policies/${page.slug}`,
        lastModified: page.updatedAt,
        changeFrequency: 'yearly' as const,
        priority: 0.3,
      })),
  ]
}
