# Actions for the Thai operating partner

Everything the code cannot do. In order. Secrets are typed **directly into the
hosting dashboards** — never sent by chat or email, never committed.

## 1. Legal and tax (before any sale)

- [ ] Confirm the selling entity (company or individual), its registered
      address, and registration number for the Terms of Sale and Contact page.
- [ ] With an accountant: Thai VAT treatment of exports (zero-rating needs the
      seller named as exporter on the customs entry) and invoices.
- [ ] Decide per destination whether to register for **UK VAT** (required to
      sell ≤ £135 consignments to UK consumers), **EU IOSS** (needs an EU
      intermediary), and whether any DDP service will be offered.
- [ ] If selling consumer products into the EU: appoint an **EU responsible
      person** (GPSR) and add their details to the Contact page.
- [ ] Decide on EU/UK GDPR representatives with counsel.
- [ ] Have counsel complete and approve the five draft policy pages, then tick
      **Legal reviewed** with the reviewer's name.

## 2. Stripe

- [ ] Open/activate a Stripe account in the selling entity's name (Thai address,
      THB bank account, DBD affidavit for a company).
- [ ] Create **test** API keys and the webhook endpoint (INTEGRATIONS.md →
      Stripe → Setup). Enter them on the **staging** CMS. Run the validation
      checklist with the developer.
- [ ] Repeat with **live** keys on the production CMS.
- [ ] In the admin: Store settings → *Checkout enabled* on.

## 3. Shipping

- [ ] Get current rate cards for the account with Thailand Post / DHL / FedEx.
- [ ] Enter rates per zone and weight band in the store currency; tick
      **Verified** with the source; enable the zone.
- [ ] Confirm which parts cannot ship where (batteries, fluids, airbags,
      emissions components) and set restricted countries / shipping classes.

## 4. Catalogue and stock

- [ ] Photograph stock (own photos) or obtain written image licences.
- [ ] Create products (OPERATIONS.md), honest authenticity and condition labels,
      evidence for "genuine" in Provenance, HS codes and weights.
- [ ] Count stock and enter **On hand** for each SKU.
- [ ] For Shopee/marketplace suppliers: obtain permission to reuse images/text,
      or don't. Record it on the Supplier (*content rights*).

## 5. TikTok Shop (optional, Thailand buyers only)

- [ ] Open TikTok Shop Thailand; pass verification; Brand Qualification for
      branded items; confirm with a TikTok account manager whether automotive
      parts (and used parts) are listable.
- [ ] Create a custom app in Partner Center; set the app variables on the CMS
      host; authorise from Kanjo Ops → TikTok.

## 6. Admin accounts

- [ ] Owner creates the Super Admin on first boot, enables a password manager.
- [ ] Partner staff are invited with the **Fulfillment Partner** role — one
      account per person.
