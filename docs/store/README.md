# The Kanjo Parts — system overview

The store is two applications in one repository:

| | Where | Runs on | Role |
|---|---|---|---|
| **Website** | repo root (Next.js 15) | Vercel, as today | Storefront pages, cart, checkout initiation, SEO. Holds no customer data. |
| **CMS + commerce backend** | `cms/` (Strapi 5 CE) | a Node host (see [DEPLOYMENT.md](DEPLOYMENT.md)) | Admin for everything; orders, stock, payments, reviews, imports, TikTok Shop. |

```
browser ──► thekanjo.com (Next.js)
              │  server-side only, Bearer STORE_CMS_TOKEN
              ▼
            cms.thekanjo.com/api/storefront/*  (Strapi custom API)
              │                       ▲
              ▼                       │ signed webhooks
            PostgreSQL            Stripe / TikTok Shop
```

**The store is off until it is configured.** With no `STORE_CMS_URL` +
`STORE_CMS_TOKEN` on Vercel, every store route 404s, PARTS is absent from the
nav and sitemap, and the homepage is byte-for-byte what it was. With the CMS
connected but no Stripe keys, the store is a browsable catalogue with a
wishlist-style cart and no payment button.

## Why this shape

- **Strapi is the one admin** (catalogue, suppliers, imports, orders, reviews,
  enquiries, shipping, TikTok, analytics). The existing `/admin` on the
  website stays what it was: the homepage content editor.
- **Commerce logic lives in the CMS process** (`cms/src/commerce/`), next to
  the database, so stock moves in single SQL statements inside transactions.
  The website never computes a price or a total that is charged.
- **No generic Strapi REST endpoints exist for store data.** The content types
  have schemas but no routes; the only API is `/api/storefront/*`, which
  requires the server token and returns hand-built allowlisted shapes
  (`cms/src/commerce/catalog.ts`). Cost prices, suppliers, source URLs, emails
  and addresses have no path to a browser.
- **Separate database schema.** Strapi's tables live in their own Postgres
  schema (`kanjo_store`) in the existing Supabase project, apart from
  `public.thekanjo_site` and anything of Daineku's. Strapi's schema sync only
  ever touches its own schema.

## Data ownership — one authoritative home per entity

| Domain | Content types | Owner / writer |
|---|---|---|
| Editorial & product content | `product`, `category`, `brand`, `vehicle-make`, `vehicle`, `store-page`, `redirect` | Owner, in the admin |
| Availability & inventory | `inventory-item` (one row per SKU), `inventory-movement` (ledger) | Counters: system. On-hand: owner/partner. Ledger: system only |
| Customers & orders | `order` (+ `order.line-item` snapshots, `order.address`), `order-event` | Created by checkout/import; fulfilment fields by partner |
| Payments & refunds | `order` payment fields, `refund`, `payment-event` (webhook log) | Processor events only; refunds created by owner |
| Shipping & fulfilment | `shipping-zone`, `shipping-rate`, order shipping fields | Owner (rates, verified); partner (tracking) |
| Marketplace | `tiktok-connection`, `tiktok-listing`, `tiktok-sync-job` | System, via the TikTok admin page |
| Reviews & moderation | `review`, `review-report` | Customers submit; owner moderates |
| Sourcing | `supplier`, `import-batch`, `import-item` | Owner |
| Enquiries | `sourcing-request`, `build-inquiry` | Customers submit; owner/partner answer |
| Analytics | computed on demand from orders (`cms/src/commerce/analytics.ts`) | — |
| Audit | `audit-log` | System only |

Stock is **not** a product field: products use Draft & Publish (two rows that
publishing rewrites), so stock lives in `inventory-item`, which has none.

## Key rules, and where they are enforced

| Rule | Enforced in |
|---|---|
| Prices, stock and shipping are recomputed server-side at quote and checkout | `cms/src/commerce/cart.ts`, `checkout.ts` |
| Two checkouts cannot both take the last unit | conditional `UPDATE … WHERE on_hand - reserved >= q` in `inventory.ts` |
| An order is paid only by a signed processor event, exactly once | `checkout.ts` `handlePaymentEvent` (event-id unique + conditional status update) |
| Order lines, totals and payment ids are immutable from the admin | `guards.ts` |
| Order status follows the state machine; `shipped` needs tracking | `orders.ts` `transitionProblem`, `guards.ts` |
| Publishing requires review approval, real copy, weight, HS code, cleared image rights, evidence for "genuine" | `validation.ts` |
| Shipping is quoted only from rates marked **verified** | `cart.ts` |
| "Verified purchase" only from a shipped/delivered, non-test order | `reviews.ts`, `guards.ts` |
| Sample products are never served in production, never sellable, never indexed | `catalog.ts`, `checkout.ts`, storefront |
| Ledgers (payment events, order events, stock movements, audit) are append-only | `guards.ts` |

## Documents

- [OPERATIONS.md](OPERATIONS.md) — daily use: products, stock, imports, orders, refunds, reviews, shipping, roles
- [INTEGRATIONS.md](INTEGRATIONS.md) — Stripe and TikTok Shop setup
- [DEPLOYMENT.md](DEPLOYMENT.md) — hosting, environment variables, release, rollback, troubleshooting
- [PARTNER_ACTIONS.md](PARTNER_ACTIONS.md) — exactly what the Thai operating partner must do
- [COMPLIANCE.md](COMPLIANCE.md) — export, import-tax, product-safety and privacy requirements to review
