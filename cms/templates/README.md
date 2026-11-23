# Supplier import template

`supplier-import-template.csv` is the format the **Imports** screen in the CMS
admin (THE KANJO OPS → Imports) accepts. Save as **CSV, comma-delimited, UTF-8**.
The two `SAMPLE-` rows are examples: delete them before importing real data.

Only import data you are entitled to use: a supplier's own export, a price list
they sent you, or details you recorded yourself. Do not paste in a scraped
marketplace catalogue.

| Column | Required | Notes |
|---|---|---|
| `supplier_reference` | yes | The supplier's own id for the item. A re-import matches on supplier + reference. |
| `source_url` | recommended | The listing you found it on. Tracking parameters are stripped. Kept private. |
| `name` | yes | Working name, max 140 chars. You will rewrite it before publishing. |
| `sku` | no | Your SKU. If empty, one is derived: `<SUPPLIERCODE>-<REFERENCE>`. |
| `brand` | no | Matched to an existing brand by slug or name; unmatched brands are noted, not created. |
| `category` | no | Category slug (e.g. `front-lips`) or exact name. |
| `source_price` | no | `1250`, `1,250.00`, `฿1250`, `12,50` — what the supplier charges you. Kept private. |
| `source_currency` | with a price | `THB`, `USD`, `EUR`, `GBP` or `CAD`. |
| `availability` | no | `available`, `limited`, `unavailable` or `unknown`. |
| `weight` | no | `1.8 kg`, `350 g`, `2 lb`, `12 oz`; a bare number is grams. |
| `condition` | no | `new`, `new_old_stock`, `used_excellent`, `used_good`, `used_fair`, `refurbished` (`used` → `used_good`). |
| `authenticity` | no | Recorded as a **note only**. Every imported item starts `unverified`; the reviewer sets the real value. |
| `country_of_origin` | no | Two-letter ISO code (`JP`, `TH`). |
| `margin_percent` | no | Used only to write a **suggested** price into the private provenance note. |
| `description` | no | The supplier's text. Stored privately for reference; **never published**. |
| `notes` | no | Anything for the reviewer. |

Column aliases are accepted (`title` for `name`, `price` for `source_price`,
`url` for `source_url`, `item_id` for `supplier_reference`, …).

## What happens to a row

1. **Normalised and checked.** Rows with errors are `invalid` and cannot be approved.
2. **Duplicate check** against the catalogue and the rest of the file:
   same supplier reference, same source URL or same SKU is an exact duplicate
   (blocked); a very similar name is a warning.
3. **You approve or reject** each valid row.
4. **Promote** turns approved rows into **draft** products: no public price, no
   images, no public description, authenticity `unverified`, availability
   `out of stock`, image rights `not cleared`.
5. Before the product can be published, someone writes original copy, sets the
   price, adds photographs we have the rights to, states authenticity and
   fitment, and sets the review status to **approved**.

**Re-verify** (same screen) takes a fresh file from the same supplier and
updates only the private fields — last verified time, source price and
supplier availability. It never changes a public price or publishes anything.
