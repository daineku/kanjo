# Integrations: Stripe and TikTok Shop

Both are **fully implemented and switched off**. Neither has been connected to
a real account. Nothing below has been tested against live Stripe or TikTok
servers; see "What has been verified" in each section.

---

## Stripe (Checkout + webhooks)

### How it works

1. Customer reviews cart → `/checkout` posts SKUs, quantities, address and a
   shipping-option id to the website, which forwards them to the CMS.
2. The CMS re-quotes from the database, reserves stock in one transaction,
   creates the order (status *pending payment*) with immutable line snapshots,
   and creates a **Stripe Checkout Session** with `price_data` built from its
   own records, `expires_at` = end of the reservation, and an idempotency key
   per order. The secret key never leaves the CMS.
3. Customer pays on Stripe's hosted page and returns to
   `/checkout/success?ref=…` — a courtesy page; **it does not mark anything
   paid**.
4. Stripe calls `POST https://cms.thekanjo.com/api/storefront/payments/webhook/stripe`.
   The CMS verifies the signature over the raw body, records the event id
   (unique), and:
   - `checkout.session.completed` (paid) / `checkout.session.async_payment_succeeded` → order *paid*, stock committed, exactly once; amount and currency must match the order or it is flagged, not fulfilled.
   - `checkout.session.completed` with `payment_status=unpaid` → noted as delayed payment; not fulfilled.
   - `checkout.session.async_payment_failed` / `checkout.session.expired` → order *cancelled*, stock released.
   - `refund.created` / `refund.updated` / `refund.failed` → refund recorded once (including refunds made in the Stripe dashboard).
   - `charge.updated` → actual Stripe fee recorded (`balance_transaction.fee`, settlement currency).
   - `charge.dispute.created` → order history + audit log.
5. A cron sweep cancels expired reservations if a webhook is lost.

Checkout is offered only when **both** Store settings → *Checkout enabled* is
on **and** valid keys are configured. A `sk_test_` key on production is refused
unless `KANJO_ALLOW_TEST_PAYMENTS=true` (use that on staging only); every test
order is flagged `isTest`, labelled TEST MODE on the site and excluded from
analytics.

### Thailand-specific facts (from Stripe's own support pages)

- Stripe accepts Thai companies, partnerships, sole proprietors and
  individuals; it needs a Thai business address and a **THB** bank account.
- The account can charge in USD/EUR/GBP/…; **payouts settle in THB**, so
  foreign-currency sales are converted by Stripe (conversion fee applies).
- PromptPay works only for THB sessions; the store currency setting decides.
- Fees are reported in THB; the analytics keep them in THB.

### Setup — done by the Thai merchant (see PARTNER_ACTIONS.md)

1. Create/activate the Stripe account in the merchant's legal name.
2. **Developers → API keys**: create a **restricted key** with write access to
   *Checkout Sessions*, *Refunds* and read access to *PaymentIntents*,
   *Charges*, *Balance transactions* (or use the secret key).
3. **Developers → Webhooks → Add endpoint**:
   `https://cms.thekanjo.com/api/storefront/payments/webhook/stripe`, events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`,
   `refund.created`, `refund.updated`, `refund.failed`, `charge.updated`,
   `charge.dispute.created`. Set the endpoint API version to the one the
   installed `stripe` package pins (`cms/node_modules/stripe` → `apiVersion`).
4. Enter `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` **directly** in the
   CMS host's secret settings. Never in chat, email or the repository.
5. First do all of this with **test-mode** keys on a staging CMS
   (`KANJO_ALLOW_TEST_PAYMENTS=true`) and run the validation below. Then
   repeat with live keys on production and switch on *Checkout enabled*.

### Validation before going live (test mode, staging)

- [ ] Card `4242 4242 4242 4242` → order *paid*, stock decremented once.
- [ ] Resend the same event from the Stripe dashboard → "duplicate", no change.
- [ ] Abandon a checkout → after expiry the order is *cancelled*, stock back.
- [ ] Partial refund from the admin → Stripe shows it; order *partially refunded*.
- [ ] Full refund from the Stripe dashboard → order *refunded* in the admin.
- [ ] `stripe listen --forward-to …` or dashboard "Send test webhook" with a wrong secret → 400.
- [ ] After `charge.updated`, the order shows the actual fee in THB.

### What has been verified

- Signature verification with the **real Stripe SDK verifier** against
  generated headers, including tampered bodies (`cms/tests/units.test.js`).
- Event normalisation for every handled type.
- The whole order/stock/refund/idempotency path end to end against a real
  Strapi + database with the **mock** provider (`cms/tests/commerce.e2e.test.js`).
- **Not verified:** a real request to Stripe's API. That needs the merchant's
  test keys.

---

## TikTok Shop

### What is true today (researched November 2026 — confirm in Seller Center)

- **A Thai TikTok Shop sells to buyers in Thailand only.** We found no
  programme that lets a Thailand-registered seller sell to US/UK/EU TikTok Shop
  buyers; cross-border selling is documented for mainland-China/Hong Kong
  entities. Selling on TikTok Shop US/UK/EU would need a seller entity in that
  market. **Do not assume the Thai shop reaches international customers.**
- Seller: Thai individual (citizen, 20+) or Thai-registered company. Some
  brands need **Brand Qualification** (corporate accounts).
- "Automotive & Motorcycle" is a **restricted category** in TikTok Shop TH;
  pre-owned goods are allowed only for listed categories that do not include
  car parts — **used parts are likely not listable**. TikTok Shop US prohibits
  used/refurbished automotive parts outright.
- Integration needs a **custom app** in the *global* Partner Center
  (partner.tiktokshop.com) and the seller's authorisation.

These facts are also shown as a checklist on **Kanjo Ops → TikTok**.

### What is built (`cms/src/tiktok/`, Kanjo Ops → TikTok)

- Connection status; OAuth authorise link with a signed, expiring `state`;
  code → token exchange (`grant_type=authorized_code`); token refresh;
  authorised-shop lookup (`shop_cipher`). Tokens are stored only AES-256-GCM
  encrypted.
- API 202309 request signing; typed client with timeouts and 429 back-off.
- Mappings: product/variant ↔ TikTok product/SKU (`tiktok-listing`), category
  via `category.tiktokCategoryId`, price (must be in the shop currency — set
  `tiktokPrice`/`tiktokCurrency` on the listing for a THB shop), stock.
- Job queue with dedupe, exponential back-off, `dead` after max attempts,
  manual retry/resync, per-listing error log.
- Order import (polling + webhooks) → `importMarketplaceOrder`, idempotent per
  TikTok order id; cancellation returns stock.
- Tracking push when a TikTok order is marked shipped.
- Webhook receiver `POST /api/kanjo-ops/tiktok/webhook` with signature
  verification and notification-id dedupe.
- Refuses to list samples, used parts, unverified authenticity or uncleared
  images.
- **Manual fallback**: CSV export of listing data for Seller Center bulk upload
  (map the columns onto TikTok's current template).

**Stock authority: the website's `inventory-item` is the single source of
truth.** TikTok is pushed `on hand − reserved − marketplace buffer`; a TikTok
order decrements our stock on import; if that would go below zero the order is
still recorded (the sale happened), stock goes to 0, and a **conflict** is
logged on the order, the listing and the audit log for a person to resolve.
Raise the marketplace buffer on scarce items to make conflicts rarer.

### Setup — when the shop exists

1. Seller opens TikTok Shop Thailand and passes verification (and Brand
   Qualification if listing branded goods).
2. In Partner Center (global), create a **custom app** for that seller; set
   redirect URL `https://cms.thekanjo.com/api/kanjo-ops/tiktok/oauth/callback`
   and webhook URL `https://cms.thekanjo.com/api/kanjo-ops/tiktok/webhook`;
   enable Product, Order, Fulfillment, Logistics, Authorization APIs.
3. Set `TIKTOK_SHOP_APP_KEY`, `TIKTOK_SHOP_APP_SECRET`, `TIKTOK_SHOP_SERVICE_ID`
   and `TIKTOK_TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`) on the CMS host.
4. Kanjo Ops → TikTok → **Authorise**; the seller signs in and approves.
5. Map categories (`tiktokCategoryId`), set `TIKTOK_SHIPPING_PROVIDER_MAP`, then
   switch on *sync products*, *sync inventory*, *import orders* one at a time.

### What has been verified

Signing and webhook verification against independently computed vectors,
crypto round-trips, job back-off/dedupe, mappers and refusals, the OAuth state,
and the HTTP routes on a running CMS (`cms/tests/tiktok.test.js`). **Not
verified:** any call to a real TikTok shop. Endpoint paths default to the 202309
versions; newer versions exist for some endpoints (overridable by env) and
must be checked in a sandbox shop first.
