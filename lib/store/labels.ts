import type {
  Authenticity,
  AvailabilityState,
  CartLineIssue,
  CartQuote,
  FitmentStatus,
  OrderStatus,
  PaymentStatus,
  ProductCondition,
  ShippingOption,
} from './types'

/**
 * Display copy for every enumerated value the store shows.
 *
 * Kept in one module so the same value never reads two ways on two pages, and
 * so the wording of the claims that matter — what is genuine, what is a
 * replica, what is merely unverified — is reviewed in one place.
 */

export const AUTHENTICITY_LABEL: Record<Authenticity, string> = {
  genuine_oem: 'GENUINE OEM',
  genuine_aftermarket: 'GENUINE AFTERMARKET',
  third_party_replacement: 'THIRD-PARTY REPLACEMENT',
  replica_reproduction: 'REPLICA / REPRODUCTION',
  custom_made: 'CUSTOM MADE',
  unverified: 'AUTHENTICITY UNVERIFIED',
}

export const AUTHENTICITY_DETAIL: Record<Authenticity, string> = {
  genuine_oem: 'An original part made by or for the vehicle manufacturer.',
  genuine_aftermarket: 'An authentic part made by the named aftermarket brand.',
  third_party_replacement:
    'A replacement part made by a third party. It is not made by the vehicle manufacturer or by an aftermarket brand named in the title.',
  replica_reproduction:
    'A replica or reproduction. It is not made by the original brand and is not sold as genuine.',
  custom_made: 'Designed and made to order by The Kanjo. Not an OEM or branded aftermarket part.',
  unverified: 'The origin of this part has not been verified. It is not represented as genuine.',
}

export const CONDITION_LABEL: Record<ProductCondition, string> = {
  new: 'NEW',
  new_old_stock: 'NEW OLD STOCK',
  used_excellent: 'USED - EXCELLENT',
  used_good: 'USED - GOOD',
  used_fair: 'USED - FAIR',
  refurbished: 'REFURBISHED',
}

export const AVAILABILITY_LABEL: Record<AvailabilityState, string> = {
  in_stock: 'IN STOCK',
  low_stock: 'LOW STOCK',
  made_to_order: 'MADE TO ORDER',
  source_on_demand: 'SOURCED TO ORDER',
  on_request: 'AVAILABLE ON REQUEST',
  out_of_stock: 'OUT OF STOCK',
  coming_soon: 'COMING SOON',
  discontinued: 'DISCONTINUED',
}

export const FITMENT_LABEL: Record<FitmentStatus | 'universal', string> = {
  confirmed: 'CONFIRMED FIT',
  conditional: 'CONDITIONAL FIT',
  unverified: 'FIT UNVERIFIED',
  universal: 'UNIVERSAL',
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: 'PENDING PAYMENT',
  paid: 'PAID',
  processing: 'PROCESSING',
  awaiting_supplier: 'AWAITING SUPPLIER',
  manufacturing: 'MANUFACTURING',
  ready_to_ship: 'READY TO SHIP',
  shipped: 'SHIPPED',
  delivered: 'DELIVERED',
  cancelled: 'CANCELLED',
  refunded: 'REFUNDED',
}

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  unpaid: 'UNPAID',
  pending: 'PAYMENT PENDING',
  paid: 'PAID',
  partially_refunded: 'PARTIALLY REFUNDED',
  refunded: 'REFUNDED',
  failed: 'PAYMENT FAILED',
}

export const CARRIER_LABEL: Record<ShippingOption['carrier'], string> = {
  thailand_post: 'Thailand Post',
  dhl: 'DHL',
  fedex: 'FedEx',
  manual: 'Carrier confirmed at dispatch',
}

export const INCOTERM_DETAIL: Record<'DAP' | 'DDP', string> = {
  DAP: 'DAP - import duties and taxes are NOT included and are payable by the recipient.',
  DDP: 'DDP - import duties and taxes are included in the price shown.',
}

export const CART_ISSUE_LABEL: Record<CartLineIssue, string> = {
  unknown_sku: 'This item is no longer in the catalogue.',
  not_purchasable: 'This item cannot be bought online at the moment.',
  out_of_stock: 'This item is out of stock.',
  quantity_reduced: 'The quantity was reduced to what is available.',
  price_unavailable: 'This item has no online price at the moment.',
  not_shippable_to_country: 'This item cannot be shipped to the selected country.',
}

export const SHIPPING_UNAVAILABLE_LABEL: Record<
  NonNullable<CartQuote['shippingUnavailableReason']>,
  string
> = {
  no_country: 'Choose a destination country to see shipping options.',
  country_not_served: 'We do not have a confirmed shipping service to that country yet.',
  no_verified_rate: 'There is no confirmed carrier rate for this order to that country yet.',
  weight_unknown:
    'One of these items has no confirmed shipping weight, so a rate cannot be quoted online.',
  restricted_item: 'One of these items has shipping restrictions and needs a manual quote.',
}
