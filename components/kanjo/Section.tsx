import Image from 'next/image'
import type { ReactNode } from 'react'

import { GameTitleReveal } from '@/components/motion/GameTitleReveal'
import type { SectionHeader } from '@/lib/content/types'

/**
 * The one section wrapper, and the one section heading treatment.
 *
 * Daineku's handoff states this as a rule for content blocks ("use the Section +
 * SectionLabel pattern"), and it is worth carrying over for the same reason: a
 * page whose every block invents its own spacing and heading loses the visual
 * rhythm that the deliberate whitespace is there to create.
 *
 * The eyebrow is the canon's `smallLabel` role, the heading is a display
 * extension one rank under the hero, and the standfirst is `body`.
 */

export function Section({
  id,
  header,
  children,
  width = 'reading',
  labelledBy,
  headingLevel = 2,
}: {
  id?: string
  header?: SectionHeader
  children: ReactNode
  /** 'reading' is the canon's ~930px column; 'wide' is for media grids. */
  width?: 'reading' | 'wide'
  /** Overrides the generated heading id for aria-labelledby. */
  labelledBy?: string
  /**
   * 2 on the landing page, where the hero owns the h1. 1 when the section IS
   * the page — the updates index and the 404 both need a real h1, and the first
   * version of this component hardcoded h2, which left those two pages with no
   * top-level heading at all.
   */
  headingLevel?: 1 | 2
}) {
  const headingId = labelledBy ?? (id ? `${id}-heading` : undefined)
  const hasHeading = Boolean(header?.heading)

  return (
    <section
      id={id}
      className="k-section"
      aria-labelledby={hasHeading ? headingId : undefined}
      aria-label={!hasHeading && id ? id : undefined}
    >
      <div className="k-shell">
        <div className="k-brand-separator" aria-hidden="true">
          <Image
            src="/media/brand/micro-mark.png"
            alt=""
            width={1785}
            height={194}
            sizes="(max-width: 767px) 44vw, 210px"
          />
        </div>
        <div className={width === 'reading' ? 'k-reading' : undefined}>
          {(header?.eyebrow || header?.heading || header?.standfirst) && (
            <header style={{ marginBottom: 'clamp(28px, 3vw, 48px)' }}>
              {header.eyebrow && (
                <p className="k-small" style={{ color: 'var(--k-accent)' }}>
                  {header.eyebrow}
                </p>
              )}
              {header.heading && (
                <GameTitleReveal
                  id={headingId}
                  level={headingLevel}
                  className="k-section-title"
                  style={{ marginTop: header.eyebrow ? 'var(--k-space-md)' : 0 }}
                  text={header.heading}
                />
              )}
              {header.standfirst && (
                <p
                  className="k-body"
                  style={{
                    marginTop: 'var(--k-space-md)',
                    marginBottom: 0,
                    color: 'var(--k-text-secondary)',
                    maxWidth: '62ch',
                  }}
                >
                  {header.standfirst}
                </p>
              )}
            </header>
          )}
          {children}
        </div>
      </div>
    </section>
  )
}

/**
 * The empty state for a block whose content layer has no entries.
 *
 * The Daineku handoff's rule is that a block returns null when it has no data.
 * That is right for a model page assembled from optional blocks, and wrong for a
 * landing page whose author has explicitly enabled a section — silently
 * vanishing makes the site look complete when it is not. So an enabled section
 * with no content says what is missing, in the canon's disabled text colour.
 */
export function EmptyNotice({ children }: { children: ReactNode }) {
  return (
    <p
      className="k-small"
      style={{
        color: 'var(--k-text-tertiary)',
        borderTop: 'var(--k-thin-width) solid var(--k-divider)',
        paddingTop: 'var(--k-space-lg)',
        margin: 0,
      }}
    >
      {children}
    </p>
  )
}
