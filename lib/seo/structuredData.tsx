import type { Article, SiteSettings } from '@/lib/content/types'

import { absoluteUrl, siteOrigin } from './metadata'

/**
 * JSON-LD structured data.
 *
 * THE ONE RULE HERE IS THAT A FIELD IS EMITTED ONLY IF IT IS CONFIGURED.
 * Structured data is a machine-readable set of assertions about a product, so
 * inventing a `datePublished`, an `applicationCategory`, an `operatingSystem` or
 * a `genre` is not a harmless placeholder — it is a false claim in a format
 * built to be trusted. Every optional field below is conditional, and the
 * VideoGame node is omitted entirely when `seo.game` is absent.
 *
 * Emitted via a `<script type="application/ld+json">` whose content is
 * `JSON.stringify` output. That is not an HTML-injection route the way
 * `dangerouslySetInnerHTML` with author text would be: the value is serialised
 * JSON of typed fields, and `<` is escaped below so a string containing
 * "</script>" cannot close the element.
 */

function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // Escaping `<` is what makes this safe: a content string containing
      // "</script>" would otherwise terminate the block early.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, '\\u003c'),
      }}
    />
  )
}

/** WebSite + Organization for the landing page. */
export function SiteStructuredData({ settings }: { settings: SiteSettings }) {
  const origin = siteOrigin(settings)

  const graph: Record<string, unknown>[] = [
    {
      '@type': 'WebSite',
      '@id': `${origin}/#website`,
      name: settings.title,
      url: origin,
      description: settings.seo.description,
      publisher: { '@id': `${origin}/#organization` },
    },
    {
      '@type': 'Organization',
      '@id': `${origin}/#organization`,
      name: settings.footer.copyrightHolder,
      url: origin,
      // Only URLs that actually exist. An empty social entry contributes
      // nothing rather than an empty string in sameAs.
      ...(() => {
        const sameAs = settings.social
          .map((link) => link.url.trim())
          .filter((url) => url !== '')
        return sameAs.length > 0 ? { sameAs } : {}
      })(),
    },
  ]

  const game = settings.seo.game
  if (game) {
    graph.push({
      '@type': 'VideoGame',
      '@id': `${origin}/#game`,
      name: game.name ?? settings.title,
      url: origin,
      description: settings.seo.description,
      publisher: { '@id': `${origin}/#organization` },
      ...(game.genre && game.genre.length > 0 ? { genre: game.genre } : {}),
      // `platforms` and `releaseDate` are emitted ONLY when configured. Neither
      // has been announced for The Kanjo, so neither appears.
      ...(game.platforms && game.platforms.length > 0
        ? { gamePlatform: game.platforms }
        : {}),
      ...(game.releaseDate ? { datePublished: game.releaseDate } : {}),
    })
  }

  return <JsonLd data={{ '@context': 'https://schema.org', '@graph': graph }} />
}

/** BlogPosting for one article. */
export function ArticleStructuredData({
  settings,
  article,
}: {
  settings: SiteSettings
  article: Article
}) {
  const origin = siteOrigin(settings)
  const url = absoluteUrl(settings, `/updates/${article.slug}`)
  const cover = article.seo?.socialImage ?? article.cover

  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        '@id': `${url}#article`,
        headline: article.title,
        description: article.seo?.description ?? article.excerpt,
        url,
        mainEntityOfPage: url,
        datePublished: article.publishedAt,
        // dateModified is only stated when the content states it. Defaulting it
        // to the publish date would assert that nothing has ever been edited.
        ...(article.updatedAt ? { dateModified: article.updatedAt } : {}),
        ...(article.author ? { author: { '@type': 'Person', name: article.author } } : {}),
        publisher: { '@id': `${origin}/#organization` },
        ...(article.tags.length > 0 ? { keywords: article.tags.join(', ') } : {}),
        ...(cover
          ? {
              image: cover.src.startsWith('http')
                ? cover.src
                : absoluteUrl(settings, cover.src),
            }
          : {}),
        isPartOf: { '@id': `${origin}/#website` },
      }}
    />
  )
}
