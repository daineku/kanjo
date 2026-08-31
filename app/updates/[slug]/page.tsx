import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Frame } from '@/components/kanjo/Frame'
import { resolveContentSource } from '@/lib/content/source'
import { formatDate } from '@/lib/format'
import { buildArticleMetadata } from '@/lib/seo/metadata'
import { ArticleStructuredData } from '@/lib/seo/structuredData'
import { renderRichText } from '@/lib/richText'

/**
 * One development update.
 *
 * `generateStaticParams` means every article is prerendered and its URL works on
 * a direct hit and on a refresh, with no server round trip. Daineku's model page
 * is `force-dynamic`, which re-queries the database on every request and shows a
 * loading animation while it does — right for a database-backed catalogue,
 * unnecessary for content that only changes at build time.
 */

type Props = { params: Promise<{ slug: string }> }

export async function generateStaticParams() {
  const source = await resolveContentSource()
  const slugs = await source.listArticleSlugs()
  return slugs.map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const source = await resolveContentSource()
  const [settings, article] = await Promise.all([
    source.getSiteSettings(),
    source.getArticle(slug),
  ])

  // No metadata for a page that will 404 — otherwise the not-found page
  // inherits the title of an article that does not exist.
  if (!article) return {}

  return buildArticleMetadata(settings, article)
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params
  const source = await resolveContentSource()
  const [settings, article] = await Promise.all([
    source.getSiteSettings(),
    source.getArticle(slug),
  ])

  if (!article) notFound()

  const body = renderRichText(article.body)

  return (
    <>
      <ArticleStructuredData settings={settings} article={article} />

      <article className="k-section">
        <div className="k-shell">
          <div className="k-reading">
            <p style={{ margin: 0 }}>
              <Link
                className="k-small"
                href="/updates"
                prefetch={false}
                style={{ color: 'var(--k-text-secondary)', textDecoration: 'none' }}
              >
                {/* Guillemet rather than an arrow: Iceland has no U+2190, and
                    the canon's own idiom for a key or an action is bracketed
                    ASCII ("WRITE TO DISK [ENTER]"), not arrow glyphs. */}
                &laquo; UPDATES
              </Link>
            </p>

            <header
              style={{
                marginTop: 'var(--k-space-lg)',
                borderLeft: 'var(--k-divider-width) solid var(--k-positive)',
                paddingLeft: 'clamp(16px, 2vw, 24px)',
              }}
            >
              <h1 className="k-section-title">{article.title}</h1>

              <p className="k-small" style={{ marginTop: 'var(--k-space-md)' }}>
                <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
                {article.author && (
                  <span style={{ color: 'var(--k-text-tertiary)' }}> — {article.author}</span>
                )}
                {article.updatedAt && article.updatedAt !== article.publishedAt && (
                  <span style={{ color: 'var(--k-text-tertiary)' }}>
                    {' '}
                    — updated{' '}
                    <time dateTime={article.updatedAt}>{formatDate(article.updatedAt)}</time>
                  </span>
                )}
              </p>

              {article.tags.length > 0 && (
                <ul
                  style={{
                    listStyle: 'none',
                    margin: 0,
                    marginTop: 'var(--k-space-md)',
                    padding: 0,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 'var(--k-space-md)',
                  }}
                >
                  {article.tags.map((tag) => (
                    <li key={tag} className="k-small" style={{ color: 'var(--k-text-tertiary)' }}>
                      {tag}
                    </li>
                  ))}
                </ul>
              )}
            </header>

            {article.cover && (
              <Frame
                ratio={`${article.cover.width} / ${article.cover.height}`}
                className="k-article-cover"
              >
                <Image
                  src={article.cover.src}
                  alt={article.cover.alt}
                  width={article.cover.width}
                  height={article.cover.height}
                  priority
                  sizes="(max-width: 930px) 100vw, 930px"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </Frame>
            )}

            {body && (
              <div
                className="k-body k-prose k-rt"
                style={{ marginTop: 'clamp(32px, 4vw, 56px)' }}
              >
                {body}
              </div>
            )}

            {article.externalSource && (
              <p
                className="k-small"
                style={{
                  marginTop: 'clamp(32px, 4vw, 56px)',
                  paddingTop: 'var(--k-space-lg)',
                  borderTop: 'var(--k-thin-width) solid var(--k-divider)',
                  color: 'var(--k-text-secondary)',
                }}
              >
                ALSO POSTED ON{' '}
                <a
                  href={article.externalSource.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--k-positive-bright)' }}
                >
                  {article.externalSource.label}
                </a>
              </p>
            )}
          </div>
        </div>
      </article>
    </>
  )
}
