import { renderSection } from '@/components/sections/registry'
import { resolveContentSource } from '@/lib/content/source'
import { SiteStructuredData } from '@/lib/seo/structuredData'

/**
 * The landing page.
 *
 * This is the whole of it: fetch the bundle once, map the configured sections.
 * Order, visibility and copy are content decisions, so a change to the page's
 * composition never touches this file.
 *
 * It is a SERVER component with no `force-dynamic`, so the page is prerendered
 * at build time and served as static HTML with the copy in it. Daineku's
 * homepage is the opposite — `'use client'`, an empty shell that fetches
 * `/api/photos` on mount behind a loading spinner — which is exactly the "only a
 * visual JavaScript shell" state the brief rules out.
 */

export default async function HomePage() {
  const source = await resolveContentSource()
  const content = await source.getLandingContent()

  return (
    <>
      <SiteStructuredData settings={content.settings} />
      {content.sections.map((section) => renderSection(section, content))}
    </>
  )
}
