import type { Metadata } from 'next'

import { CheckoutReturn } from '@/components/store/CheckoutReturn'
import { StoreSection } from '@/components/store/StoreChrome'
import { PRIVATE_ROBOTS, STORE_NAME } from '@/lib/seo/store'
import { loadStorePage } from '@/lib/store/page'

export const metadata: Metadata = { title: `Order received - ${STORE_NAME}`, robots: PRIVATE_ROBOTS }

export default async function CheckoutSuccessPage() {
  await loadStorePage()
  return (
    <StoreSection id="checkout-success" level={1} eyebrow="THE KANJO PARTS" heading="ORDER RECEIVED">
      <CheckoutReturn outcome="success" />
    </StoreSection>
  )
}
