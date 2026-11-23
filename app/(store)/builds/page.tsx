import type { Metadata } from 'next'

import { BuildInquiryForm } from '@/components/store/EnquiryForms'
import { Notice, StoreSection } from '@/components/store/StoreChrome'
import { storePageMetadata } from '@/lib/seo/store'
import { knownCountries } from '@/lib/store/countries'
import { loadStorePage } from '@/lib/store/page'

/**
 * /builds — custom vehicle projects, by enquiry and quotation only.
 *
 * Nothing here is for sale, and the page says so. It makes no promise about
 * import eligibility, registration or shipping cost to any country: those
 * depend on the vehicle and the destination's rules and are answered per
 * project, in writing, before anything is agreed.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await loadStorePage()
  return storePageMetadata(settings, {
    title: 'Custom Honda Builds from Thailand',
    description:
      'Custom Honda Civic and Integra builds, planned with you and built in Thailand. Enquiry and quotation service.',
    path: '/builds',
  })
}

export default async function BuildsPage() {
  await loadStorePage()
  return (
    <>
      <section className="k-store-hero" aria-labelledby="builds-title">
        <div className="k-shell">
          <p className="k-small" style={{ color: 'var(--k-accent)' }}>
            THE KANJO CUSTOM BUILDS
          </p>
          <h1 id="builds-title" className="k-hero-title k-store-hero-title">
            BUILT IN THAILAND. DRIVEN WORLDWIDE.
          </h1>
          <p className="k-body k-store-standfirst">
            Honda builds in the spirit of the Kanjo: planned around how you will drive the car, put together in
            Thailand, and quoted line by line.
          </p>
        </div>
      </section>

      <StoreSection
        id="how"
        eyebrow="HOW IT WORKS"
        heading="AN ENQUIRY, THEN A QUOTATION"
        standfirst={
          <ol className="k-store-steps">
            <li>Tell us the chassis, the budget, how you will use the car and where it will live.</li>
            <li>We reply to discuss the project, and what is and is not realistic for your destination.</li>
            <li>If it makes sense for both sides, you receive a written quotation. Nothing is agreed before that.</li>
          </ol>
        }
      >
        <Notice tone="warning" title="IMPORTANT">
          <p>
            Whether a vehicle can be imported, registered and driven on the road depends on its age, its specification and
            the destination country&apos;s rules. We do not promise import eligibility, road registration or a shipping
            price until they have been checked for a specific car and destination.
          </p>
        </Notice>
      </StoreSection>

      <StoreSection id="enquire" eyebrow="START" heading="REQUEST A QUOTATION">
        <BuildInquiryForm countries={knownCountries()} />
      </StoreSection>
    </>
  )
}
