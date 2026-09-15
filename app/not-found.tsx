import Link from 'next/link'

import { Section } from '@/components/kanjo/Section'

/**
 * 404.
 *
 * Uses the same section wrapper and type roles as every other page, so a wrong
 * URL still looks like the site rather than like a framework default.
 */
export default function NotFound() {
  return (
    <Section
      headingLevel={1}
      header={{
        eyebrow: 'ERROR 404',
        heading: 'NOT FOUND',
        standfirst: 'That address does not exist on this site.',
      }}
      labelledBy="notfound-heading"
    >
      <p style={{ margin: 0 }}>
        <Link
          className="k-action"
          href="/"
          prefetch={false}
          style={{
            color: 'var(--k-accent-bright)',
            textDecoration: 'none',
            borderLeft: 'var(--k-divider-width) solid var(--k-accent)',
            paddingLeft: 'var(--k-space-md)',
          }}
        >
          RETURN TO THE START
        </Link>
      </p>
    </Section>
  )
}
