import type { Metadata } from 'next'

import { CheckoutForm } from '@/components/store/CheckoutForm'
import { StoreSection, StoreUnavailable } from '@/components/store/StoreChrome'
import { PRIVATE_ROBOTS, STORE_NAME } from '@/lib/seo/store'
import { loadStorePage } from '@/lib/store/page'

export const metadata: Metadata = { title: `Checkout - ${STORE_NAME}`, robots: PRIVATE_ROBOTS }

// Checkout must always reflect the live switch and test-mode flag.
export const dynamic = 'force-dynamic'

export default async function CheckoutPage() {
  const { catalog } = await loadStorePage()
  if (!catalog) return <StoreUnavailable />
  return (
    <StoreSection id="checkout" level={1} eyebrow="THE KANJO PARTS" heading="CHECKOUT">
      <CheckoutForm settings={catalog.settings} />
    </StoreSection>
  )
}
