import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { OrderView } from '@/components/store/OrderView'
import { StoreSection } from '@/components/store/StoreChrome'
import { PRIVATE_ROBOTS, STORE_NAME } from '@/lib/seo/store'
import { loadStorePage, type SearchParams } from '@/lib/store/page'

export const metadata: Metadata = {
  title: `Order status - ${STORE_NAME}`,
  robots: PRIVATE_ROBOTS,
  // The URL may carry a one-time `?t=` token; never send it onward as a referrer.
  referrer: 'no-referrer',
}

/**
 * /orders/[reference] — the server renders only the shell. The order itself is
 * fetched by the browser with the token or email that proves access, so no
 * customer data is ever in a cached HTML response.
 */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>
  searchParams: SearchParams
}) {
  await loadStorePage()
  const [{ reference }, raw] = await Promise.all([params, searchParams])
  if (!/^[A-Za-z0-9-]{4,40}$/.test(reference)) notFound()
  const t = Array.isArray(raw.t) ? raw.t[0] : raw.t
  const token = t && /^[A-Za-z0-9_-]{16,200}$/.test(t) ? t : undefined

  return (
    <StoreSection id="order" level={1} eyebrow="ORDER" heading={reference.toUpperCase()}>
      <OrderView reference={reference.toUpperCase()} linkToken={token} />
    </StoreSection>
  )
}
