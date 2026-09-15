import { Section } from '@/components/kanjo/Section'
import type { LegalDocument } from '@/lib/content/types'
import { formatDate } from '@/lib/format'
import { renderRichText } from '@/lib/richText'

/**
 * A legal page: Privacy, Terms.
 *
 * The body is the site's Markdown subset, through the same renderer every
 * article uses — headings, paragraphs, lists, emphasis and links, and nothing
 * else. It is admin-editable and it cannot carry HTML or script, which is the
 * property a page like this most needs.
 *
 * "Last updated" is the date the EDITOR states in content, not a build or
 * modification time: on a legal page that date is a claim, and it should
 * change when the meaning changes, not when a typo does.
 */
export function LegalPage({ id, document }: { id: string; document: LegalDocument }) {
  return (
    <Section
      id={id}
      headingLevel={1}
      header={{
        eyebrow: document.updatedAt ? `LAST UPDATED ${formatDate(document.updatedAt).toUpperCase()}` : undefined,
        heading: document.title,
      }}
    >
      <div className="k-body k-prose k-rt">{renderRichText(document.body)}</div>
    </Section>
  )
}
