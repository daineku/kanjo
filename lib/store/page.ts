import 'server-only'

import { notFound } from 'next/navigation'

import { resolveContentSource } from '@/lib/content/source'
import type { SiteSettings } from '@/lib/content/types'

import { getCatalog } from './client'
import { storeEnabled } from './server'
import type { Catalog } from './types'

/**
 * What every store page starts with: the site settings and the catalogue.
 *
 * `catalog` is null when the backend cannot be reached; the page then renders
 * <StoreUnavailable/> instead of throwing. A store that is switched OFF is a
 * 404 here as well as in the layout, because `generateMetadata` runs
 * independently of the layout and must not describe a page that does not
 * exist.
 */
export async function loadStorePage(): Promise<{ settings: SiteSettings; catalog: Catalog | null }> {
  if (!storeEnabled()) notFound()
  const source = await resolveContentSource()
  const [settings, catalog] = await Promise.all([source.getSiteSettings(), getCatalog()])
  return { settings, catalog }
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>
