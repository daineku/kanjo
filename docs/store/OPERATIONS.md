# Operating the store

All of this happens in the Strapi admin (`https://cms.thekanjo.com/admin`).

## Roles

| Role | Who | Can |
|---|---|---|
| **Super Admin** (built in) | Owner / platform administrator | Everything, including users, API tokens, settings, analytics, imports, TikTok, refunds |
| **Fulfillment Partner** (`cms/src/commerce/roles.ts`) | Thai operating partner's staff | Orders (fulfilment fields only — status, carrier, tracking, dates, actual shipping cost, notes; no customer email, no payment ids), stock counts, product weight/dimensions/HS code/handling days, read shipping rates, answer sourcing and build enquiries |

The partner role is re-applied from code at every boot; edit the file, not the
role screen. Invite people under **Settings → Administration panel → Users**.
Admin sign-in is Strapi's email + password; turn on a password manager and do
not share accounts (the audit log records who did what).

## Categories and vehicles

Seeded once into an empty database (8 top-level categories, 42 sub-categories;
Honda Civic EF/EG/EK/EP3 and Integra DC2). Rename, reorder (`sortOrder`), hide
(`hidden`) or add freely. A category with products or sub-categories cannot
be deleted — move them or hide it.

Add another make/model: create a **Vehicle make**, then a **Vehicle** with
chassis code and production years. Storefront filters pick it up automatically.

## Creating a product

1. **Content Manager → Product → Create.** Fill name, SKU, category, brand,
   product type, **authenticity** and **condition** honestly:
   *genuine OEM*, *genuine aftermarket*, *third-party replacement*,
   *replica / reproduction*, *custom made*, or *unverified*. The label is shown
   prominently on the product page.
2. **Description in your own words** (≥ 80 characters) and a short description.
   Never paste a supplier's text.
3. **Price** in the store currency (settings), optional discount price, **cost
   price** (admin-only; feeds the profit *estimate*). No price = "price on
   request" (enquiry only).
4. **Availability mode**:
   - *In stock* — sold from counted stock (see below).
   - *Made to order* — sold without stock; uses the made-to-order handling time.
   - *Source on demand* — sold without stock **only while** the supplier was
     verified within the configured window (default 30 days). Needs a supplier
     and "Last verified at".
   - *Out of stock / coming soon / discontinued* — shown, not sold.
5. **Fulfilment**: weight in grams (required to sell — shipping is by weight),
   dimensions, **HS code** (required for international), shipping class,
   restricted countries.
6. **Fitment**: one row per vehicle with status *confirmed*, *conditional* or
   *unverified*, optional year range, engine, body style, market, installation
   notes. Tick **Universal fit** only for genuinely universal items. Fitment is
   never inferred from the title.
7. **Images**: your own photos, or licensed ones — then set **Image rights**.
   Images with rights "not cleared" are never shown and block publishing.
8. **Variants** (optional): each with its own SKU, label, colour/size/material/
   finish, optional vehicle, price and image.
9. Set **Review status**: *draft → ready for review → approved*. Only
   *approved* can be published. Use *archived* to withdraw without deleting.
10. **Publish.** If anything is missing the admin lists every problem. On first
    publish an inventory record is created per SKU with **0 on hand**.

Renaming a slug: add the old slug to **Previous slugs** and the old URL
redirects permanently. For anything else (a discontinued line → its
replacement) create a **Redirect** entry.

## Stock

**Content Manager → Inventory item**, one per SKU. Edit **On hand** after a
count or delivery; the change is written to the movement ledger with your name.
`Reserved` is units held by open checkouts and cannot be edited. **Marketplace
buffer** holds units back from TikTok Shop so a web sale and a TikTok sale
cannot both take the last unit. Low-stock threshold drives the "low stock"
label and analytics alerts.

## Supplier imports (Kanjo Ops → Imports)

Pipeline: supplier → CSV/feed → normalise → duplicate check → **human review**
→ draft product → you finish and publish.

1. Create the **Supplier** (platform, access method, **content rights**).
2. Fill `cms/templates/supplier-import-template.csv` (see the README beside it).
3. Kanjo Ops → Imports: choose the supplier, upload. Each row is validated and
   checked for duplicates (same supplier reference, same source URL, same SKU,
   similar names).
4. Approve or reject rows. **Promote** turns approved rows into **draft**
   products with no public price, no images, no public description,
   authenticity *unverified*, availability *out of stock*. The supplier's
   description and a suggested price (source price × margin) are kept in the
   private Provenance field for reference only.
5. Finish each draft as in "Creating a product".

Re-verification: upload a fresh supplier CSV in re-verify mode to update the
private source price, supplier availability and "last verified" — public price
and publication never change automatically.

**Shopee Thailand and other marketplaces**: there is no scraper, on purpose.
Use an authorised partner API/feed (adapter stubs are in
`cms/src/importer/adapters.ts`) or a CSV you are entitled to use. Never
republish a seller's photos or text without permission.

## Shipping

**Shipping zones** are seeded (TH, US, CA, GB, IE, EU-27), all **disabled and
with no rates**. To start shipping somewhere:

1. Get the carrier's current tariff for your account (Thailand Post, DHL, FedEx).
2. Create **Shipping rates** for the zone: carrier, service, weight band
   (min/max grams), price **in the store currency**, incoterm (DAP unless you
   have a DDP service and pay duties), transit days, excluded shipping classes.
3. Tick **Verified** and fill **Verified source** (tariff name/date or quote
   reference). Unverified rates are never shown to customers.
4. Enable the zone.

The storefront only offers countries with at least one verified rate. Other
countries see "send a sourcing request" instead of a made-up price.

Handling times (in-stock / sourced / made-to-order) and the customs
disclosure text are in **Store settings**.

## Orders

Status flow: *pending payment → paid → processing ⇄ awaiting supplier ⇄
manufacturing → ready to ship → shipped → delivered*. *Cancelled* (unpaid,
automatic) and *refunded* (full refund) are terminal.

- *Paid* is set only by Stripe (web orders). *Manual*-channel orders can be
  marked paid by hand.
- *Shipped* needs a tracking number (or carrier "manual").
- Enter **Shipping cost (actual)** after posting — it feeds profit reporting.
- Every change is recorded in the order's events with who made it.
- Line items, prices, totals and payment ids cannot be edited.
- Paid orders cannot be deleted.

Unpaid checkouts hold stock for the reservation window (default 45 minutes)
and are released automatically.

## Refunds

**Content Manager → Refund → Create**: choose the order, amount, reason,
whether to **restock**. Saving sends the refund to Stripe first; if Stripe
refuses, nothing is recorded as refunded. A full refund moves the order to
*refunded*. Refunds made in the Stripe dashboard are picked up by webhook and
recorded automatically. TikTok orders are refunded in TikTok Seller Center;
record the refund here for reporting.

## Reviews

New reviews arrive as **pending** and are invisible until you set *approved*.
*Verified purchase* is set automatically when the reviewer's email has a
shipped or delivered order for that product; you cannot tick it otherwise.
Add a reply in **Admin reply**. Three abuse reports from different visitors
return a review to *pending*. There is no seed data for reviews, and there
must never be.

## Sourcing requests and build inquiries

Arrive with status *new*. Work them through *in review → quoted → won /
declined / closed* and keep notes in **Internal notes**. Reply by email.
Build inquiries are quotations only — no promises about import eligibility,
registration or shipping until verified for that destination.

## Policy pages

Terms of Sale, Shipping, Returns & Refunds, Store Privacy Notice and Contact
are seeded as **drafts with bracketed fields**. They show a DRAFT banner and
are not indexed until **Legal reviewed** is ticked with a name in **Legal
reviewed by**. Do not tick it until a lawyer or the merchant has approved the
final text.

## Analytics (Kanjo Ops → Analytics)

Revenue, refunds and net revenue are **actual**. Payment fees are **actual**
when Stripe has reported them (in THB, the settlement currency — shown
separately, never subtracted from USD revenue). Product cost is an
**estimate** from cost price at time of sale. Shipping cost is **actual** only
where entered. "Estimated operating profit" states which inputs are missing.
Test-mode orders are excluded by default. The Stripe reconciliation table
lists every paid web order with its PaymentIntent id to match against the
Stripe balance report.

## Sample catalogue (development only)

`cd cms && npm run seed:samples` creates eight products named "SAMPLE …"
(`isSample`), visible only when the CMS runs with
`KANJO_ALLOW_SAMPLE_CATALOG=true`; never purchasable, never indexed.
`npm run seed:samples -- --remove` deletes them. The script refuses to run in
production.
