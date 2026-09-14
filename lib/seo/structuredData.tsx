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

  /**
   * THE PUBLISHER'S `url` IS THE PUBLISHER'S OWN SITE, NOT THIS ONE.
   *
   * The first version emitted `url: origin` on the Organization node, which
   * asserted that the publisher's website IS thekanjo.com. It is not: The
   * Kanjo is the game's site and daineku.com is the studio's. Getting this
   * wrong in JSON-LD is not cosmetic — `url` on an Organization is how a
   * crawler resolves the entity, so it would merge two identities into one.
   *
   * The canonical URL for this site stays `origin` (see buildRootMetadata);
   * daineku.com never becomes canonical for The Kanjo.
   *
   * Only the name and the URL are stated. Nothing about legal identity,
   * address or registration was supplied, so nothing is emitted — a false
   * claim in a format built to be trusted is worse than a missing one.
   */
  const publisherName = settings.publisher?.name?.trim()
  const publisherUrl = settings.publisher?.url?.trim()
  const hasPublisher = Boolean(publisherName && publisherUrl)
  const publisherRef = hasPublisher ? { '@id': `${origin}/#publisher` } : undefined

  const graph: Record<string, unknown>[] = [
    {
      '@type': 'WebSite',
      '@id': `${origin}/#website`,
      name: settings.title,
      url: origin,
      description: settings.seo.description,
      ...(publisherRef ? { publisher: publisherRef } : {}),
    },
  ]

  if (hasPublisher) {
    graph.push({
      '@type': 'Organization',
      '@id': `${origin}/#publisher`,
      name: publisherName,
      url: publisherUrl,
    })
  }

  // The Kanjo's own channels belong to the GAME, not to the studio — putting
  // them in `sameAs` on the publisher would claim that @the_kanjo is Daineku's
  // TikTok account. They hang off the VideoGame node below instead.
  const sameAs = settings.social.map((link) => link.url.trim()).filter((url) => url !== '')

  const game = settings.seo.game
  if (game) {
    graph.push({
      '@type': 'VideoGame',
      '@id': `${origin}/#game`,
      name: game.name ?? settings.title,
      url: origin,
      description: settings.seo.description,
      ...(publisherRef ? { publisher: publisherRef } : {}),
      // The game's own channels. Only URLs that actually exist — an unannounced
      // Steam page contributes nothing rather than an empty string.
      ...(sameAs.length > 0 ? { sameAs } : {}),
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

  /**
   * The publisher is INLINE here, not an `@id` reference.
   *
   * An article page emits only this one node — the Organization lives in the
   * landing page's graph — so `{'@id': origin + '/#organization'}` was a
   * reference to a node that is not in this document. A dangling `@id` is not a
   * harmless no-op: a consumer either drops the publisher or has to go and
   * fetch another page to resolve it. Stating the two fields costs nothing.
   */
  const publisherName = settings.publisher?.name?.trim()
  const publisherUrl = settings.publisher?.url?.trim()
  const publisher =
    publisherName && publisherUrl
      ? {
          publisher: {
            '@type': 'Organization',
            '@id': `${origin}/#publisher`,
            name: publisherName,
            url: publisherUrl,
          },
        }
      : {}

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
        ...publisher,
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
