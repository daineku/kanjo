import Link from 'next/link'
import type { ReactNode } from 'react'

import type { SiteSettings } from '@/lib/content/types'
import { BreadcrumbStructuredData, type Crumb } from '@/lib/seo/store'

/**
 * Store page furniture: breadcrumbs, the page head, notices, and the calm
 * "unavailable" state.
 */

export function Breadcrumbs({ settings, crumbs }: { settings: SiteSettings; crumbs: Crumb[] }) {
  return (
    <>
      <BreadcrumbStructuredData settings={settings} crumbs={crumbs} />
      <nav aria-label="Breadcrumb" className="k-store-crumbs">
        <ol>
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1
            return (
              <li key={crumb.path} className="k-small">
                {last ? (
                  <span aria-current="page">{crumb.name}</span>
                ) : (
                  <Link href={crumb.path} prefetch={false}>
                    {crumb.name}
                  </Link>
                )}
              </li>
            )
          })}
        </ol>
      </nav>
    </>
  )
}

/** The store's section wrapper: the site's shell and spine, without the title animation. */
export function StoreSection({
  id,
  eyebrow,
  heading,
  standfirst,
  level = 2,
  action,
  children,
  className = '',
}: {
  id?: string
  eyebrow?: string
  heading?: string
  standfirst?: ReactNode
  level?: 1 | 2
  action?: { label: string; href: string }
  children?: ReactNode
  className?: string
}) {
  const Heading = level === 1 ? 'h1' : 'h2'
  const headingId = id ? `${id}-heading` : undefined
  return (
    <section id={id} className={`k-store-section ${className}`.trim()} aria-labelledby={heading ? headingId : undefined}>
      <div className="k-shell">
        {(eyebrow || heading || action) && (
          <header className="k-store-section-head">
            <div>
              {eyebrow && (
                <p className="k-small" style={{ color: 'var(--k-accent)' }}>
                  {eyebrow}
                </p>
              )}
              {heading && (
                <Heading id={headingId} className={level === 1 ? 'k-section-title' : 'k-store-h2'}>
                  {heading}
                </Heading>
              )}
              {standfirst && <div className="k-body k-store-standfirst">{standfirst}</div>}
            </div>
            {action && (
              <Link href={action.href} prefetch={false} className="k-link-action k-small">
                {action.label}
              </Link>
            )}
          </header>
        )}
        {children}
      </div>
    </section>
  )
}

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning'
  title?: string
  children?: ReactNode
}) {
  return (
    <div className="k-store-notice" data-tone={tone} role={tone === 'warning' ? 'note' : undefined}>
      {title && <p className="k-small k-store-notice-title">{title}</p>}
      {children && <div className="k-store-notice-body">{children}</div>}
    </div>
  )
}

/** What a visitor sees when the commerce backend cannot be reached. */
export function StoreUnavailable({ level = 1 }: { level?: 1 | 2 }) {
  return (
    <StoreSection
      level={level}
      eyebrow="THE KANJO PARTS"
      heading="CATALOGUE TEMPORARILY UNAVAILABLE"
      standfirst={<p>The parts catalogue could not be loaded just now. Please try again in a few minutes.</p>}
    >
      <p>
        <Link href="/" prefetch={false} className="k-link-action k-small">
          BACK TO THE KANJO
        </Link>
      </p>
    </StoreSection>
  )
}

export function SampleCatalogNotice() {
  return (
    <div className="k-shell">
      <Notice tone="warning" title="DEVELOPMENT SAMPLE CATALOGUE">
        <p>
          Products marked SAMPLE are illustrative development data. They are not real merchandise, are not for sale and
          will not be shipped.
        </p>
      </Notice>
    </div>
  )
}
