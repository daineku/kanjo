import type { Metadata } from 'next'

import type { Article, ImageRef, SiteSettings } from '@/lib/content/types'

/**
 * Metadata construction.
 *
 * Daineku's SEO is a starting point rather than a model: it has a sitemap and
 * per-model `generateMetadata`, and it has no `metadataBase`, no canonical URLs,
 * no robots.txt, no Twitter card and no structured data — and its root layout
 * title is still the scaffold's "JDM Builds" rather than the configured site
 * title. What is reused is the SHAPE (root defaults plus a per-page override
 * that falls back to content fields); what is added is everything above.
 *
 * One rule throughout: NOTHING IS INVENTED. A field with no configured value is
 * omitted, so the site never asserts a release date, a platform or a handle that
 * nobody has stated.
 */

/**
 * The site origin, used for canonical URLs and absolute social images.
 *
 * `NEXT_PUBLIC_SITE_URL` wins so a preview deployment can describe itself
 * honestly; otherwise the configured primary domain; otherwise localhost, which
 * is correct for development and never ships, because a production build that
 * has neither is a misconfiguration worth noticing.
 */
export function siteOrigin(settings: SiteSettings): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim() || settings.primaryDomain.trim()
  const origin = configured || 'http://localhost:3000'
  return origin.replace(/\/+$/, '')
}

export function absoluteUrl(settings: SiteSettings, pathname: string): string {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`
  return `${siteOrigin(settings)}${path === '/' ? '' : path}`
}

function toOgImage(settings: SiteSettings, image: ImageRef | undefined) {
  if (!image) return undefined
  return [
    {
      url: image.src.startsWith('http') ? image.src : absoluteUrl(settings, image.src),
      width: image.width,
      height: image.height,
      alt: image.alt || undefined,
    },
  ]
}

/** Root metadata: the defaults every page inherits. */
export function buildRootMetadata(settings: SiteSettings): Metadata {
  const origin = siteOrigin(settings)
  const images = toOgImage(settings, settings.seo.defaultSocialImage)

  return {
    // Without metadataBase, Next emits relative OG image URLs, which most
    // scrapers refuse. Daineku has no metadataBase at all.
    metadataBase: new URL(origin),
    title: {
      default: settings.seo.title,
      template: settings.seo.titleTemplate,
    },
    description: settings.seo.description,
    applicationName: settings.title,
    alternates: { canonical: '/' },
    openGraph: {
      type: 'website',
      siteName: settings.title,
      title: settings.seo.title,
      description: settings.seo.description,
      url: origin,
      locale: 'en_GB',
      ...(images ? { images } : {}),
    },
    twitter: {
      card: images ? 'summary_large_image' : 'summary',
      title: settings.seo.title,
      description: settings.seo.description,
      ...(settings.seo.twitterHandle ? { site: settings.seo.twitterHandle } : {}),
      ...(images ? { images: images.map((image) => image.url) } : {}),
    },
    robots: {
      // A preview deployment should not be indexed alongside production. Gated
      // on an explicit env var rather than on NODE_ENV, so a staging build is a
      // deliberate choice.
      index: process.env.NEXT_PUBLIC_NOINDEX !== 'true',
      follow: process.env.NEXT_PUBLIC_NOINDEX !== 'true',
    },
  }
}

/** Metadata for one article. */
export function buildArticleMetadata(settings: SiteSettings, article: Article): Metadata {
  const url = absoluteUrl(settings, `/updates/${article.slug}`)
  const title = article.seo?.title ?? article.title
  const description = article.seo?.description ?? article.excerpt ?? settings.seo.description
  const images =
    toOgImage(settings, article.seo?.socialImage) ??
    toOgImage(settings, article.cover) ??
    toOgImage(settings, settings.seo.defaultSocialImage)

  return {
    title,
    description,
    alternates: { canonical: `/updates/${article.slug}` },
    openGraph: {
      type: 'article',
      title,
      description,
      url,
      siteName: settings.title,
      publishedTime: article.publishedAt,
      ...(article.updatedAt ? { modifiedTime: article.updatedAt } : {}),
      ...(article.author ? { authors: [article.author] } : {}),
      ...(article.tags.length > 0 ? { tags: article.tags } : {}),
      ...(images ? { images } : {}),
    },
    twitter: {
      card: images ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(settings.seo.twitterHandle ? { site: settings.seo.twitterHandle } : {}),
      ...(images ? { images: images.map((image) => image.url) } : {}),
    },
  }
}

/** Metadata for a simple page that has no content entity of its own. */
export function buildPageMetadata(
  settings: SiteSettings,
  {
    title,
    description,
    path,
  }: { title: string; description?: string; path: string },
): Metadata {
  return {
    title,
    description: description ?? settings.seo.description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      title,
      description: description ?? settings.seo.description,
      url: absoluteUrl(settings, path),
      siteName: settings.title,
    },
  }
}
