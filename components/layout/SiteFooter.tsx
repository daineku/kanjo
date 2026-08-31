import Link from 'next/link'

import { real } from '@/lib/content/placeholder'
import type { SiteSettings } from '@/lib/content/types'

/**
 * The footer.
 *
 * Same philosophy as the Daineku footer the brief points at: minimal, small
 * type, dynamic site title, dynamic year. The links row is architecturally
 * present and rendered from configuration, so Terms / Privacy / Press Kit can
 * be added later by editing `content/site.json` and nothing else — but nothing
 * is forced into the first visual version, and an empty links array renders no
 * row at all.
 *
 * The year is computed at render. On a statically prerendered page that means
 * build time, which is what a copyright line wants: no hydration mismatch, no
 * client JavaScript, and it refreshes with the next deploy.
 */

export function SiteFooter({ settings }: { settings: SiteSettings }) {
  const year = new Date().getFullYear()
  const links = settings.footer.links
  const note = real(settings.footer.note)

  return (
    <footer
      style={{
        borderTop: 'var(--k-thin-width) solid var(--k-divider)',
        paddingBlock: 'clamp(32px, 4vw, 56px)',
      }}
    >
      <div
        className="k-shell"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--k-space-lg)',
        }}
      >
        <div>
          {/* No © glyph. Iceland has U+00A9 but draws it as a hollow square,
              which renders as tofu at 14px; "(C)" is uglier still. The year and
              the holder are what the notice needs. */}
          <p className="k-small" style={{ color: 'var(--k-text-secondary)' }}>
            {year} {settings.footer.copyrightHolder} — {settings.title}
          </p>
          {note && (
            <p
              className="k-small"
              style={{ color: 'var(--k-text-tertiary)', marginTop: 'var(--k-space-sm)' }}
            >
              {note}
            </p>
          )}
        </div>

        {links.length > 0 && (
          <nav aria-label="Footer">
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 'var(--k-space-lg)',
              }}
            >
              {links.map((link) => (
                <li key={`${link.label}-${link.href}`}>
                  {link.external ? (
                    <a
                      className="k-small"
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--k-text-secondary)', textDecoration: 'none' }}
                    >
                      {link.label}
                    </a>
                  ) : (
                    <Link
                      className="k-small"
                      href={link.href}
                      prefetch={false}
                      style={{ color: 'var(--k-text-secondary)', textDecoration: 'none' }}
                    >
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </footer>
  )
}
