import type { Metadata } from 'next'

import { ArticleRow } from '@/components/sections/ContentSections'
import { EmptyNotice, Section } from '@/components/kanjo/Section'
import { resolveContentSource } from '@/lib/content/source'
import { buildPageMetadata } from '@/lib/seo/metadata'

/**
 * The updates index.
 *
 * Renders the same `ArticleRow` the landing page's updates section does, so the
 * two cannot drift apart into two slightly different article treatments.
 */

export async function generateMetadata(): Promise<Metadata> {
  const source = await resolveContentSource()
  const settings = await source.getSiteSettings()

  return buildPageMetadata(settings, {
    title: 'Updates',
    description: `Development updates and technical write-ups from ${settings.title}.`,
    path: '/updates',
  })
}

export default async function UpdatesIndexPage() {
  const source = await resolveContentSource()
  const articles = await source.listArticles()

  return (
    <Section
      id="updates"
      header={{
        eyebrow: 'DEVLOG',
        heading: 'DEVELOPMENT UPDATES',
      }}
    >
      {articles.length === 0 ? (
        <EmptyNotice>NO UPDATES PUBLISHED YET</EmptyNotice>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gap: 'var(--k-space-md)',
          }}
        >
          {articles.map((article) => (
            <li key={article.slug}>
              <ArticleRow article={article} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
