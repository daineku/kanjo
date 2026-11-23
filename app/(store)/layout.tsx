import { notFound } from 'next/navigation'

import { SiteHeader } from '@/components/layout/SiteHeader'
import { resolveContentSource } from '@/lib/content/source'
import { storeEnabled } from '@/lib/store/server'

import '../store.css'

/**
 * Chrome for every THE KANJO PARTS route.
 *
 * A route GROUP, so the URLs stay /parts, /cart, /checkout, /orders, /builds
 * and /policies while sharing one layout, one stylesheet and one switch.
 *
 * THE SWITCH: without a store backend configured (lib/store/config.ts) every
 * route under here is a 404 — the store's code can be deployed long before the
 * store exists, and nothing a visitor can reach changes.
 *
 * These are document pages, so they carry the site header (with PARTS and
 * CART in it); the homepage stays the headerless title screen.
 */
export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  if (!storeEnabled()) notFound()

  const source = await resolveContentSource()
  const settings = await source.getSiteSettings()

  return (
    <>
      <SiteHeader settings={settings} />
      <div className="k-store">{children}</div>
    </>
  )
}
