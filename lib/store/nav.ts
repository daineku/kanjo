import type { NavItem, SiteSettings } from '@/lib/content/types'

/**
 * PARTS, in the navigation — added in code, on purpose.
 *
 * The site's nav and footer links are CONTENT: in production they live in the
 * Supabase document, not in this repository. Adding PARTS there would make the
 * link's existence depend on somebody editing a row at the right moment, and
 * would leave it pointing at a 404 on any deployment without a store backend.
 *
 * So the link follows the same switch as the store itself (lib/store/config):
 * present exactly when the store is, absent otherwise, with nothing to keep in
 * step. An editor who has already added a PARTS item by hand keeps theirs —
 * nothing is duplicated.
 *
 * Pure: takes the flag as an argument, so it is usable from a test.
 */

const PARTS: NavItem = { label: 'PARTS', href: '/parts', visible: true }
const POLICIES: NavItem = { label: 'STORE POLICIES', href: '/policies', visible: true }

const has = (items: NavItem[], href: string) =>
  items.some((item) => item.href.replace(/\/+$/, '') === href)

export function withStoreNav(settings: SiteSettings, storeEnabled: boolean): SiteSettings {
  if (!storeEnabled) return settings

  const nav = has(settings.nav, PARTS.href) ? settings.nav : [PARTS, ...settings.nav]
  const footerLinks = [
    ...(has(settings.footer.links, PARTS.href) ? [] : [PARTS]),
    ...settings.footer.links,
    ...(has(settings.footer.links, POLICIES.href) ? [] : [POLICIES]),
  ]

  return { ...settings, nav, footer: { ...settings.footer, links: footerLinks } }
}
