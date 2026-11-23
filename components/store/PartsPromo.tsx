import Link from 'next/link'

import { getCatalog } from '@/lib/store/client'
import { realProducts } from '@/lib/store/filter'
import { storeEnabled } from '@/lib/store/server'

import './entry.css'

/**
 * The homepage's one line about the store.
 *
 * Deliberately small: the homepage is the game's title screen, and the store
 * is a branch off it, not a replacement for it. It renders NOTHING unless the
 * store is switched on AND the catalogue holds at least one real (non-sample)
 * published product — so the homepage never advertises an empty shop or a
 * development catalogue.
 *
 * It reads the same cached catalogue fetch every store page uses, with a short
 * timeout and no throw, so it cannot slow or break the homepage: a failure is
 * simply no promo.
 */
export async function PartsPromo() {
  if (!storeEnabled()) return null
  const catalog = await getCatalog()
  if (!catalog || realProducts(catalog).length === 0) return null

  return (
    <section className="k-section k-store-promo" aria-labelledby="parts-promo-heading">
      <div className="k-shell">
        <div className="k-store-promo-inner">
          <div>
            <p className="k-small" style={{ color: 'var(--k-accent)' }}>
              THE KANJO PARTS
            </p>
            <h2 id="parts-promo-heading" className="k-store-h2">
              RARE JDM PARTS. CUSTOM COMPONENTS.
            </h2>
            <p className="k-body k-store-standfirst">
              Honda parts and custom-made components, sourced in Asia and shipped from Thailand.
            </p>
          </div>
          <Link href="/parts" prefetch={false} className="k-store-button">
            BROWSE PARTS
          </Link>
        </div>
      </div>
    </section>
  )
}
