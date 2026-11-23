/**
 * THE KANJO PARTS — the storefront contract.
 *
 * Every shape the Next.js site receives from the commerce backend (the Strapi
 * app in /cms, its `storefront` API) is declared here and nowhere else. The CMS
 * serialises to exactly these shapes through an explicit allowlist
 * (cms/src/commerce/serialize.ts), so a field that is not in this file — a cost
 * price, a supplier, a source URL, a customer email — has no route to a browser.
 *
 * ── MONEY IS INTEGER MINOR UNITS ────────────────────────────────────────────
 *
 * Every amount is an integer number of the currency's minor unit (cents, pence,
 * satang) next to an ISO 4217 code. No float ever represents a price on this
 * side of the boundary. `formatMoney` in lib/store/money.ts is the only place
 * an amount becomes a string.
 *
 * ── NOTHING HERE IS TRUSTED ON THE WAY BACK ─────────────────────────────────
 *
 * The browser sends SKUs and quantities. It never sends a price, a total or a
 * shipping cost: the backend recomputes all of them from its own records.
 */

export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'THB' | 'CAD'

export type Money = {
  amount: number
  currency: CurrencyCode
}

export type StoreImage = {
  url: string
  width: number
  height: number
  alt: string
}

// ── Catalogue ───────────────────────────────────────────────────────────────

export type StoreCategory = {
  id: string
  slug: string
  name: string
  description?: string
  /** Slug of the parent category; absent on a top-level category. */
  parentSlug?: string
  sortOrder: number
  /** Published, purchasable-or-browsable products in this category AND its children. */
  productCount: number
  seoTitle?: string
  seoDescription?: string
}

export type StoreBrand = {
  slug: string
  name: string
  productCount: number
}

export type StoreVehicle = {
  id: string
  slug: string
  /** e.g. "Honda Civic EG (1991–1995)" */
  label: string
  make: string
  makeSlug: string
  model: string
  generation?: string
  chassisCode: string
  yearFrom: number
  /** Absent means "still in production / open-ended". */
  yearTo?: number
  bodyStyles: string[]
  engines: string[]
  marketNotes?: string
}

export const AUTHENTICITY = [
  'genuine_oem',
  'genuine_aftermarket',
  'third_party_replacement',
  'replica_reproduction',
  'custom_made',
  'unverified',
] as const
export type Authenticity = (typeof AUTHENTICITY)[number]

export const CONDITIONS = [
  'new',
  'new_old_stock',
  'used_excellent',
  'used_good',
  'used_fair',
  'refurbished',
] as const
export type ProductCondition = (typeof CONDITIONS)[number]

/**
 * What a visitor can do with a product right now. Computed by the backend from
 * the product's availability mode AND the live inventory record — never from a
 * product description, and never optimistic:
 *
 *   in_stock          tracked stock, at least one unit not reserved
 *   low_stock         as above, at or under the low-stock threshold
 *   made_to_order     manufactured after purchase; purchasable without stock
 *   source_on_demand  sourced after purchase; purchasable ONLY while the
 *                     supplier verification is fresh, otherwise `on_request`
 *   on_request        not purchasable online; the page offers an enquiry
 *   out_of_stock, coming_soon, discontinued   not purchasable
 */
export const AVAILABILITY_STATES = [
  'in_stock',
  'low_stock',
  'made_to_order',
  'source_on_demand',
  'on_request',
  'out_of_stock',
  'coming_soon',
  'discontinued',
] as const
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number]

export type FitmentStatus = 'confirmed' | 'conditional' | 'unverified'

export type ProductFitment = {
  vehicleId: string
  vehicleSlug: string
  vehicleLabel: string
  make: string
  model: string
  chassisCode: string
  status: FitmentStatus
  /** Narrower than the vehicle's own range when the part only fits some years. */
  yearFrom: number
  yearTo?: number
  engine?: string
  bodyStyle?: string
  market?: string
  installationRequirements?: string
  notes?: string
}

export type ProductVariant = {
  sku: string
  label: string
  color?: string
  size?: string
  material?: string
  finish?: string
  vehicleLabel?: string
  price: Money
  /** The undiscounted price, present only when a discount is active. */
  compareAtPrice?: Money
  availability: AvailabilityState
  purchasable: boolean
  /** Units a single order may take. Absent when not stock-limited. */
  maxQuantity?: number
  image?: StoreImage
}

export type ProductSummary = {
  id: string
  slug: string
  sku: string
  name: string
  brand?: string
  brandSlug?: string
  categorySlug?: string
  categoryName?: string
  productType: 'part' | 'accessory' | 'custom_3d_print' | 'merchandise'
  authenticity: Authenticity
  condition: ProductCondition
  shortDescription?: string
  /** Lowest purchasable variant price, or the product price. Absent = "price on request". */
  price?: Money
  compareAtPrice?: Money
  /** True when variants have different prices, so the card says "from". */
  priceVaries: boolean
  availability: AvailabilityState
  purchasable: boolean
  image?: StoreImage
  featured: boolean
  madeToOrder: boolean
  universalFit: boolean
  /** Compact fitment for filtering: one entry per fitment row. */
  fitments: Pick<ProductFitment, 'vehicleId' | 'vehicleSlug' | 'chassisCode' | 'status' | 'yearFrom' | 'yearTo'>[]
  tags: string[]
  publishedAt: string
  updatedAt: string
  /** Units sold, used only for the "popular" sort. Never displayed. */
  popularity: number
  /** Present only when at least one APPROVED review exists. */
  rating?: { average: number; count: number }
  /**
   * A development sample. The backend only ever returns these when it was
   * started with KANJO_ALLOW_SAMPLE_CATALOG=true; the site marks them visibly,
   * keeps them out of the index and never emits product structured data.
   */
  isSample: boolean
}

export type ProductDetail = ProductSummary & {
  manufacturer?: string
  /** Markdown subset, rendered by lib/richText — never HTML. */
  description?: string
  specifications: { label: string; value: string }[]
  gallery: StoreImage[]
  videoUrl?: string
  variants: ProductVariant[]
  fitmentDetails: ProductFitment[]
  countryOfOrigin?: string
  weightGrams?: number
  dimensionsMm?: { length?: number; width?: number; height?: number }
  shippingClass: 'standard' | 'bulky' | 'oversized' | 'fragile' | 'restricted'
  internationalShipping: boolean
  /** Business days before dispatch, for this product's fulfilment mode. */
  handlingDays: number
  maxQuantity?: number
  seoTitle?: string
  seoDescription?: string
  canonicalUrl?: string
  noIndex: boolean
  relatedSlugs: string[]
}

export type StoreSettingsPublic = {
  currency: CurrencyCode
  /**
   * True only when the owner has switched checkout on AND the backend holds
   * working payment credentials. When false the store is a browse-only
   * catalogue and `checkoutDisabledMessage` says why, in the owner's words.
   */
  checkoutEnabled: boolean
  checkoutDisabledMessage?: string
  /** True when payments run against a processor's TEST mode. */
  paymentTestMode: boolean
  reviewsEnabled: boolean
  customsDisclosure?: string
  supportEmail?: string
  /** ISO 3166-1 alpha-2 codes with at least one VERIFIED, enabled rate. */
  shippingCountries: string[]
  handlingDays: { inStock: number; sourced: number; madeToOrder: number }
  /** True when the backend is serving explicitly-marked sample products. */
  sampleCatalog: boolean
}

export type Catalog = {
  generatedAt: string
  settings: StoreSettingsPublic
  categories: StoreCategory[]
  brands: StoreBrand[]
  vehicles: StoreVehicle[]
  products: ProductSummary[]
}

// ── Reviews ─────────────────────────────────────────────────────────────────

export type StoreReview = {
  id: string
  rating: 1 | 2 | 3 | 4 | 5
  title?: string
  body: string
  authorName: string
  /** ISO date-time the review was submitted. */
  submittedAt: string
  /** True only when a paid, delivered-or-shipped order for this product was matched. */
  verifiedPurchase: boolean
  photos: StoreImage[]
  adminReply?: { body: string; repliedAt?: string }
}

export type ReviewSummary = {
  average: number
  count: number
  /** Index 0 = one star … index 4 = five stars. */
  distribution: [number, number, number, number, number]
}

export type ProductReviews = {
  /** Absent when there are no approved reviews. */
  summary?: ReviewSummary
  reviews: StoreReview[]
}

export type ReviewSubmission = {
  productSlug: string
  rating: number
  title?: string
  body: string
  authorName: string
  email: string
  /** Lets the backend check for a qualifying order. Optional. */
  orderReference?: string
  photos?: UploadedImage[]
}

export type UploadedImage = {
  filename: string
  /** image/jpeg, image/png or image/webp. Verified against the bytes server-side. */
  contentType: string
  dataBase64: string
}

export type ReviewReport = {
  reason: 'spam' | 'offensive' | 'fake' | 'off_topic' | 'other'
  detail?: string
}

// ── Cart, shipping, checkout ────────────────────────────────────────────────

export type CartItemInput = { sku: string; quantity: number }

export type CartLineIssue =
  | 'unknown_sku'
  | 'not_purchasable'
  | 'out_of_stock'
  | 'quantity_reduced'
  | 'price_unavailable'
  | 'not_shippable_to_country'

export type CartLine = {
  sku: string
  productSlug: string
  productName: string
  variantLabel?: string
  image?: StoreImage
  /** The quantity the backend will actually sell — may be lower than requested. */
  quantity: number
  requestedQuantity: number
  unitPrice: Money
  compareAtUnitPrice?: Money
  lineTotal: Money
  availability: AvailabilityState
  maxQuantity?: number
  issues: CartLineIssue[]
  isSample: boolean
}

export type ShippingOption = {
  id: string
  carrier: 'thailand_post' | 'dhl' | 'fedex' | 'manual'
  serviceName: string
  price: Money
  /** DAP: import duties/taxes are collected from the recipient. DDP: included. */
  incoterm: 'DAP' | 'DDP'
  minDays?: number
  maxDays?: number
  tracked: boolean
}

export type CartQuote = {
  currency: CurrencyCode
  lines: CartLine[]
  /** SKUs that were sent but could not be resolved at all. */
  removedSkus: string[]
  subtotal: Money
  totalWeightGrams: number
  /** Echo of the destination the shipping options were computed for. */
  country?: string
  /**
   * Verified carrier rates for the destination. EMPTY when the destination has
   * no verified rate — the site then offers a manual quote instead of inventing
   * a number.
   */
  shippingOptions: ShippingOption[]
  shippingUnavailableReason?:
    | 'no_country'
    | 'country_not_served'
    | 'no_verified_rate'
    | 'weight_unknown'
    | 'restricted_item'
  customsDisclosure?: string
  /** Longest handling time among the lines, in business days. */
  handlingDays: number
  checkoutEnabled: boolean
  /** True when every line is sellable as quoted and the cart is not empty. */
  canCheckout: boolean
}

export type CheckoutAddress = {
  name: string
  line1: string
  line2?: string
  city: string
  region?: string
  postalCode?: string
  /** ISO 3166-1 alpha-2. */
  country: string
  phone?: string
}

export type CheckoutRequest = {
  items: CartItemInput[]
  email: string
  address: CheckoutAddress
  shippingOptionId: string
  customerNote?: string
  /** Must be true: the Terms of Sale and the customs notice were accepted. */
  acceptTerms: boolean
}

export type CheckoutResponse = {
  reference: string
  /** Opaque bearer for /orders/[reference]. Shown once; only its hash is stored. */
  accessToken: string
  /** The payment processor's hosted checkout page. */
  checkoutUrl: string
}

// ── Orders ──────────────────────────────────────────────────────────────────

export const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'processing',
  'awaiting_supplier',
  'manufacturing',
  'ready_to_ship',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export type PaymentStatus =
  | 'unpaid'
  | 'pending'
  | 'paid'
  | 'partially_refunded'
  | 'refunded'
  | 'failed'

/** The customer's view of an order. No internal notes, no costs, no email. */
export type OrderPublic = {
  reference: string
  status: OrderStatus
  paymentStatus: PaymentStatus
  placedAt: string
  currency: CurrencyCode
  items: {
    productName: string
    productSlug?: string
    sku: string
    variantLabel?: string
    quantity: number
    unitPrice: Money
    lineTotal: Money
  }[]
  subtotal: Money
  shippingTotal: Money
  discountTotal: Money
  total: Money
  refundedTotal: Money
  shipping: {
    name: string
    city: string
    region?: string
    postalCode?: string
    country: string
    carrier?: ShippingOption['carrier']
    service?: string
    incoterm?: 'DAP' | 'DDP'
    trackingNumber?: string
    trackingUrl?: string
    shippedAt?: string
    deliveredAt?: string
  }
  /** Customer-visible milestones only (status changes, tracking). */
  timeline: { at: string; status?: OrderStatus; message: string }[]
  /** True for an order paid in a processor's test mode. */
  isTest: boolean
}

// ── Enquiries ───────────────────────────────────────────────────────────────

export type SourcingRequestInput = {
  fullName: string
  email: string
  country: string
  vehicle: string
  requestedPart: string
  preference: 'oem' | 'aftermarket' | 'either'
  budget?: string
  notes?: string
  referenceImage?: UploadedImage
}

export type BuildInquiryInput = {
  fullName: string
  email: string
  phone?: string
  destinationCountry: string
  preferredChassis: string
  budgetRange: string
  intendedUse: 'street' | 'track' | 'show' | 'collection' | 'mixed' | 'other'
  desiredModifications?: string
}

// ── Policy pages ────────────────────────────────────────────────────────────

export type StorePage = {
  slug: string
  title: string
  /** Markdown subset. */
  body: string
  /**
   * The merchant's legal sign-off. Until it is true the page renders under a
   * "DRAFT — PENDING MERCHANT AND LEGAL REVIEW" banner and is `noindex`.
   */
  legalReviewed: boolean
  effectiveDate?: string
  updatedAt: string
}

export type StoreRedirect = { fromPath: string; toPath: string; permanent: boolean }

// ── Errors ──────────────────────────────────────────────────────────────────

export const STORE_ERROR_CODES = [
  'validation_failed',
  'not_found',
  'rate_limited',
  'checkout_disabled',
  'cart_changed',
  'out_of_stock',
  'shipping_unavailable',
  'payment_provider_error',
  'spam_rejected',
  'duplicate',
  'unauthorized',
  'store_unavailable',
] as const
export type StoreErrorCode = (typeof STORE_ERROR_CODES)[number]

export type StoreErrorBody = {
  error: {
    code: StoreErrorCode
    message: string
    /** Field name → message, for `validation_failed`. */
    fields?: Record<string, string>
    /** For `cart_changed`: the fresh quote, so the UI can show what moved. */
    quote?: CartQuote
  }
}

/**
 * The storefront API, as the CMS serves it under `<STORE_CMS_URL>/api/storefront`.
 * Every request carries `Authorization: Bearer <STORE_CMS_TOKEN>`; mutating
 * requests also carry `x-kanjo-client-ip` so the backend can rate-limit per
 * visitor. The browser never calls the CMS: it calls this site's own
 * /api/store/* route handlers, which hold the token.
 *
 *   GET  /catalog                        → Catalog
 *   GET  /products/:slug                 → { product: ProductDetail }
 *                                          404 → { error, redirectTo?: string }
 *   GET  /products/:slug/reviews         → ProductReviews
 *   GET  /pages                          → { pages: StorePage[] }
 *   GET  /redirects                      → { redirects: StoreRedirect[] }
 *   POST /cart/quote   { items, country? }            → CartQuote
 *   POST /checkout     CheckoutRequest + { successUrl, cancelUrl } → CheckoutResponse
 *   POST /orders/lookup { reference, token? , email? } → { order: OrderPublic }
 *   POST /reviews      ReviewSubmission + spam fields  → { status: 'pending' }
 *   POST /reviews/:id/report  ReviewReport             → { ok: true }
 *   POST /sourcing-requests   SourcingRequestInput     → { ok: true }
 *   POST /build-inquiries     BuildInquiryInput        → { ok: true }
 *
 * Spam fields on every public form: `website` (a honeypot that must be empty)
 * and `elapsedMs` (time from render to submit; implausibly fast is rejected).
 */
export type SpamFields = { website?: string; elapsedMs?: number }
