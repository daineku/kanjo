import type { Metadata } from 'next'

import { CartView } from '@/components/store/CartView'
import { StoreSection, StoreUnavailable } from '@/components/store/StoreChrome'
import { PRIVATE_ROBOTS, STORE_NAME } from '@/lib/seo/store'
import { loadStorePage } from '@/lib/store/page'

export const metadata: Metadata = { title: `Cart - ${STORE_NAME}`, robots: PRIVATE_ROBOTS }

export default async function CartPage() {
  const { catalog } = await loadStorePage()
  if (!catalog) return <StoreUnavailable />
  return (
    <StoreSection id="cart" level={1} eyebrow="THE KANJO PARTS" heading="CART">
      <CartView settings={catalog.settings} />
    </StoreSection>
  )
}
