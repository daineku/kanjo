import type { Metadata } from 'next'

import { CheckoutReturn } from '@/components/store/CheckoutReturn'
import { StoreSection } from '@/components/store/StoreChrome'
import { PRIVATE_ROBOTS, STORE_NAME } from '@/lib/seo/store'
import { loadStorePage } from '@/lib/store/page'

export const metadata: Metadata = { title: `Payment cancelled - ${STORE_NAME}`, robots: PRIVATE_ROBOTS }

export default async function CheckoutCancelledPage() {
  await loadStorePage()
  return (
    <StoreSection id="checkout-cancelled" level={1} eyebrow="THE KANJO PARTS" heading="PAYMENT NOT COMPLETED">
      <CheckoutReturn outcome="cancelled" />
    </StoreSection>
  )
}
