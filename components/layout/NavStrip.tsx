'use client'

import { usePathname } from 'next/navigation'

import { WedgeCard } from '@/components/kanjo/WedgeCard'
import type { NavItem } from '@/lib/content/types'

/**
 * The navigation items, and the only client component in the header.
 *
 * It exists solely to read `usePathname()` so the current item can take the
 * canon's selection treatment. Everything else about the header stays on the
 * server. This is still server-rendered into the initial HTML — a client
 * component is not a client-only component — so the nav is in the document for
 * a crawler and paints with the page, unlike Daineku's header, which fetches
 * its nav from an effect and renders blank until that resolves.
 *
 * The strip scrolls horizontally when it does not fit, which is the game's own
 * overflow behaviour for this component (Components/bottom_navigation_strip.json
 * declares a clipped horizontal viewport, and Responsive/layout_rules.md states
 * that content viewports scroll before typography shrinks). No drawer, no
 * toggle, no focus trap.
 */

export function NavStrip({ items }: { items: NavItem[] }) {
  const pathname = usePathname()
  if (items.length === 0) return null

  return (
    <nav aria-label="Primary" style={{ flex: '1 1 auto', minWidth: 0 }}>
      <ul
        className="k-strip"
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          gap: 'var(--k-space-sm)',
          justifyContent: 'flex-end',
        }}
      >
        {items.map((item) => {
          const active = isActive(item.href, pathname)
          return (
            <li key={`${item.label}-${item.href}`}>
              <WedgeCard
                variant="nav"
                title={item.label}
                href={item.href}
                external={item.external}
                selected={active}
                current={active}
              />
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/**
 * Whether a nav href is the current page.
 *
 * A fragment link into the landing page ('/#media') is active on the landing
 * page, because that is where it points. Daineku's header tests
 * `pathname === link.href`, which would leave every fragment item permanently
 * unselected — and the selected treatment is most of what makes this read as
 * the game's menu.
 */
export function isActive(href: string, pathname: string): boolean {
  if (/^https?:/i.test(href)) return false

  const [path = ''] = href.split('#')
  const target = path === '' ? '/' : path.replace(/\/+$/, '') || '/'

  if (target === '/') return pathname === '/'
  return pathname === target || pathname.startsWith(`${target}/`)
}
