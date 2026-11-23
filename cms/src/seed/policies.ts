/**
 * Draft commerce policies.
 *
 * THESE ARE NOT LEGAL TEXTS. They are structured drafts that say what each
 * policy must cover, with the facts only the merchant can supply left as
 * bracketed fields. The storefront renders every page whose `legalReviewed`
 * is false under a "DRAFT — PENDING MERCHANT AND LEGAL REVIEW" banner and
 * keeps it out of search indexes. Nothing here should be read as a promise
 * until a person has replaced the brackets and signed it off.
 */

const NOTE =
  '> **Draft for merchant and legal review.** Bracketed items must be completed by the merchant. Nothing on this page is a commitment until it has been reviewed and signed off.\n\n';

export const POLICY_DRAFTS = [
  {
    title: 'Terms of Sale',
    slug: 'terms-of-sale',
    body:
      NOTE +
      '## Who you are buying from\n\nParts sold on The Kanjo Parts are sold by [MERCHANT LEGAL NAME], [REGISTERED ADDRESS, THAILAND], [COMPANY REGISTRATION NUMBER].\n\n' +
      '## Orders and prices\n\nPrices are shown in [STORE CURRENCY] and include [VAT TREATMENT — TO BE CONFIRMED]. An order is accepted when payment is confirmed. Prices and availability are confirmed by our server at checkout; if anything changed while you were shopping, you are shown the new figure before you pay.\n\n' +
      '## Product descriptions and authenticity\n\nEvery product states whether it is a genuine OEM part, a genuine aftermarket part, a third-party replacement, a replica or reproduction, or a custom-made part. Used parts are described with their condition. [MERCHANT TO CONFIRM how authenticity is verified and what happens if a part is not as described.]\n\n' +
      '## Fitment\n\nCompatibility is listed per vehicle with a status: confirmed, conditional or unverified. Conditional and unverified fitment may need modification or professional installation. [MERCHANT TO STATE liability position for fitment.]\n\n' +
      '## Made-to-order and sourced parts\n\n[MERCHANT TO STATE cancellation rights for made-to-order and sourced-on-demand items, consistent with the consumer law of each destination market.]\n\n' +
      '## Governing law\n\n[TO BE DETERMINED WITH COUNSEL. Note: consumers in the EU, UK and elsewhere keep the protections of their own law regardless of the governing-law clause.]\n',
  },
  {
    title: 'Shipping Policy',
    slug: 'shipping',
    body:
      NOTE +
      '## Where we ship\n\nWe only offer checkout to destinations with a confirmed carrier rate. If your country is not listed at checkout, send a sourcing request and we will quote by email.\n\n' +
      '## Carriers and handling time\n\nParcels ship from Thailand with [CARRIERS — e.g. Thailand Post, DHL, FedEx]. Handling time before dispatch is shown on each product: in-stock items, sourced-on-demand items and made-to-order items have different handling times.\n\n' +
      '## Customs, duties and taxes\n\nUnless a shipping option is marked DDP, orders ship DAP: import duties, taxes and brokerage fees are payable by the recipient on delivery. [MERCHANT TO CONFIRM whether any DDP service is offered, and for which countries.]\n\n' +
      '- **United States:** the de minimis duty exemption is currently suspended; every parcel requires customs entry and duty may apply.\n' +
      '- **European Union / Ireland:** import VAT applies from the first euro; low-value parcels currently also attract a flat per-item customs duty. [MERCHANT TO CONFIRM IOSS registration status.]\n' +
      '- **United Kingdom:** for consignments of £135 or less, UK VAT must be charged at the point of sale by a UK-VAT-registered seller. [MERCHANT TO CONFIRM UK VAT registration before shipping to the UK.]\n' +
      '- **Canada:** postal and non-US/Mexico courier imports above CAD 20 are subject to duty and tax.\n\n' +
      '## Restricted items\n\nSome parts cannot be shipped to some countries (for example emissions-related components). Such items are blocked at checkout for those destinations.\n\n' +
      '## Lost or damaged parcels\n\n[MERCHANT TO STATE the claims process and insurance.]\n',
  },
  {
    title: 'Returns & Refunds',
    slug: 'returns',
    body:
      NOTE +
      '## Your statutory rights\n\nNothing in this policy limits the rights you have under the consumer law of your country.\n\n' +
      '## Returns window\n\n[MERCHANT TO STATE the returns window and conditions. Note: EU and UK distance-selling rules give consumers a 14-day cancellation right for most goods, with exceptions for goods made to the consumer\'s specification.]\n\n' +
      '## Items that cannot be returned\n\n[MERCHANT TO LIST — e.g. made-to-order 3D-printed parts made to your specification; installed parts; electrical parts once fitted — subject to statutory rights.]\n\n' +
      '## Return shipping\n\n[MERCHANT TO STATE who pays return shipping and customs on returns to Thailand.]\n\n' +
      '## How refunds are paid\n\nRefunds are made to the original payment method. [MERCHANT TO STATE timeframe.]\n',
  },
  {
    title: 'Store Privacy Notice',
    slug: 'privacy',
    body:
      NOTE +
      '## Controller\n\n[MERCHANT LEGAL NAME, ADDRESS, CONTACT EMAIL]. [EU REPRESENTATIVE and UK REPRESENTATIVE details, if required — see the compliance notes.]\n\n' +
      '## What we collect, and why\n\n- **Orders:** name, email, shipping address, phone (optional) — to fulfil and support your order, and for tax and customs records.\n- **Payments:** handled by Stripe. We never see or store your card number.\n- **Reviews:** your email (never shown) to prevent duplicates and to check for a qualifying order; the name you choose to show.\n- **Sourcing and build enquiries:** the details you send, to answer you.\n- **Abuse prevention:** a one-way hash of your IP address on reviews and enquiries.\n\n' +
      '## Cookies\n\nThe store keeps your cart in your browser\'s local storage. It sets no advertising or analytics cookies. Stripe sets cookies on its own checkout page.\n\n' +
      '## Sharing\n\nWith Stripe (payment), carriers and customs brokers (delivery), and [MARKETPLACE, e.g. TikTok Shop, for orders placed there]. [MERCHANT TO CONFIRM hosting providers and their locations for international-transfer disclosures.]\n\n' +
      '## Retention\n\n[MERCHANT TO STATE — e.g. order records kept for the period required by Thai tax law.]\n\n' +
      '## Your rights\n\nUnder the Thai PDPA, the EU/UK GDPR and other laws you may have the right to access, correct, delete or port your data. Contact [EMAIL].\n',
  },
  {
    title: 'Contact',
    slug: 'contact',
    body:
      NOTE +
      '## The Kanjo Parts\n\nOperated by [MERCHANT LEGAL NAME], [ADDRESS], Thailand.\n\nEmail: [SUPPORT EMAIL]\n\nFor an order, include your order reference (it starts with KJ-).\n\n' +
      '[EU RESPONSIBLE PERSON under the General Product Safety Regulation, if selling consumer products into the EU: NAME, ADDRESS, EMAIL.]\n',
  },
];
