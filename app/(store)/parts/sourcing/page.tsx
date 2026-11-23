import type { Metadata } from 'next'

import { SourcingForm } from '@/components/store/EnquiryForms'
import { Breadcrumbs, StoreSection } from '@/components/store/StoreChrome'
import { STORE_NAME, storePageMetadata } from '@/lib/seo/store'
import { knownCountries } from '@/lib/store/countries'
import { loadStorePage } from '@/lib/store/page'

/**
 * /parts/sourcing — the rare-parts request form.
 *
 * Works even when the catalogue cannot be loaded: it needs nothing from it.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await loadStorePage()
  return storePageMetadata(settings, {
    title: 'Rare JDM Parts Sourcing',
    description:
      'Looking for a discontinued or hard-to-find Honda or JDM part? Tell us the car and the part and we will look for it in Thailand and across Asia.',
    path: '/parts/sourcing',
  })
}

export default async function SourcingPage() {
  const { settings } = await loadStorePage()
  return (
    <>
      <div className="k-shell">
        <Breadcrumbs
          settings={settings}
          crumbs={[
            { name: 'Parts', path: '/parts' },
            { name: 'Sourcing', path: '/parts/sourcing' },
          ]}
        />
      </div>
      <StoreSection
        id="sourcing"
        level={1}
        eyebrow={STORE_NAME}
        heading="RARE PARTS SOURCING"
        standfirst={
          <>
            <p>
              Discontinued trim, used originals, limited-production parts: tell us what you need and for which car. We
              search through suppliers, workshops and private sellers in Thailand and across Asia.
            </p>
            <p>
              A request is free and is not an order. If we find the part we will reply with what it is, its condition,
              its provenance and a price including shipping options to you, and you decide.
            </p>
          </>
        }
      >
        <SourcingForm countries={knownCountries()} />
      </StoreSection>
    </>
  )
}
