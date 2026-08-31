import Image from 'next/image'
import Link from 'next/link'

import type { SiteSettings } from '@/lib/content/types'

import { NavStrip } from './NavStrip'

/**
 * The site header, as an extension of the game's menu.
 *
 * THREE DEPARTURES FROM DAINEKU'S HEADER, EACH FOR A REASON.
 *
 * 1. IT IS A SERVER COMPONENT AND TAKES ITS SETTINGS AS A PROP. Daineku's
 *    `components/Header.tsx` is `'use client'` and fetches
 *    `/api/site-settings` and `/api/brands` from a `useEffect`, so the site
 *    title renders blank on first paint and fills in a moment later, and the
 *    nav is invisible to a crawler. Here the settings come from the content
 *    source on the server, so the header is in the initial HTML — which the
 *    brief requires for the site to be indexable rather than a JS shell. Only
 *    the small NavStrip is a client component, and only so it can read the
 *    pathname; it is still server-rendered.
 *
 * 2. THERE IS NO HAMBURGER DRAWER. The game's own navigation is a
 *    horizontally-scrolling strip (Components/bottom_navigation_strip.json:
 *    clipped viewport, ~4 items visible at the reference width). That is both
 *    the game's answer and a better one for a phone than a generic drawer, so
 *    the narrow layout keeps the same strip and lets it scroll.
 *
 * 3. THE ACTIVE ITEM TAKES THE CANON'S SELECTION TREATMENT — the green band and
 *    green left rule — rather than a text-colour swap.
 *
 * The header is deliberately NOT sticky. A translucent bar following the
 * visitor down a dark page is the generic-marketing reflex, and the game's menu
 * does not follow the player around.
 */

export function SiteHeader({ settings }: { settings: SiteSettings }) {
  return (
    <header
      style={{
        borderBottom: 'var(--k-thin-width) solid var(--k-divider)',
        background: 'var(--k-background)',
      }}
    >
      <div
        className="k-shell"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--k-space-lg)',
          minHeight: 'var(--k-touch-target-min)',
          paddingBlock: 'var(--k-space-md)',
          flexWrap: 'wrap',
        }}
      >
        <Link
          href="/"
          prefetch={false}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--k-space-md)',
            textDecoration: 'none',
            color: 'var(--k-text-primary)',
            flex: '0 0 auto',
          }}
        >
          {settings.wordmark ? (
            <Image
              src={settings.wordmark.src}
              alt={settings.wordmark.alt || settings.title}
              width={settings.wordmark.width}
              height={settings.wordmark.height}
              priority
              style={{ height: 24, width: 'auto' }}
            />
          ) : (
            <span
              className="k-display"
              style={{
                fontSize: 'clamp(18px, 1vw + 14px, 22px)',
                letterSpacing: '1.8px',
                lineHeight: 1,
              }}
            >
              {settings.title}
            </span>
          )}
        </Link>

        <NavStrip items={settings.nav} />
      </div>
    </header>
  )
}
