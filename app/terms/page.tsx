import type { Metadata } from 'next'

import { LegalPage } from '@/components/kanjo/LegalPage'
import { SiteHeader } from '@/components/layout/SiteHeader'
import { resolveContentSource } from '@/lib/content/source'
import { buildPageMetadata } from '@/lib/seo/metadata'

/**
 * /terms — editable content, rendered as a reading page.
 *
 * The header is included when the reading routes have one, the same as
 * /updates: this is a document, not the title screen.
 */

export async function generateMetadata(): Promise<Metadata> {
  const source = await resolveContentSource()
  const settings = await source.getSiteSettings()
  return buildPageMetadata(settings, {
    title: settings.legal.terms.title,
    description: `${settings.legal.terms.title} for ${settings.title}, published by ${settings.publisher.name}.`,
    path: '/terms',
  })
}

export default async function TermsPage() {
  const source = await resolveContentSource()
  const settings = await source.getSiteSettings()
  return (
    <>
      {settings.chrome.headerOnReadingPages && <SiteHeader settings={settings} />}
      <LegalPage id="terms" document={settings.legal.terms} />
    </>
  )
}
