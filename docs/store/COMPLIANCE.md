# Compliance requirements to review

**Not legal advice.** A summary of requirements identified in November 2026
research, for the merchant and their advisers to confirm. Sources are in the
linked official pages; status as of research date.

| Area | Requirement | Store support |
|---|---|---|
| **Thailand — export** | VAT zero-rating of exports needs the seller as named exporter on the customs entry (Revenue Dept. Order Por. 97/2543). Postal/courier export formalities to be confirmed with Thai Customs and the carrier. | HS code, country of origin, weight and value captured on every order line |
| **Thailand — PDPA** | Applies to a Thai controller regardless of customer location: lawful basis, privacy notice, data-subject rights, breach notification. | Draft privacy notice; minimal data (no card data; IP stored only as a salted hash); customer order view shows no address/email |
| **United States** | De minimis ($800) duty exemption **suspended** for all countries (CBP rules effective 24 Jun / 24 Jul 2026); every parcel needs entry; ordinary duty plus Section 232 rates on certain auto parts. Duty follows country of **origin**. | DAP disclosure at checkout; DDP flag per rate; origin per line |
| **European Union / Ireland** | Import VAT from €0; IOSS for ≤ €150; temporary **€3 per-item customs duty** on low-value parcels from 1 Jul 2026. **GPSR** (Reg. 2023/988): EU responsible person, and manufacturer/contact/warnings on listings for consumer products. | Customs disclosure text; Contact page placeholder for the responsible person; product specs/notes fields for warnings |
| **United Kingdom** | Consignments ≤ £135 to consumers: seller charges UK VAT at checkout and must be UK-VAT registered. | Don't enable the UK zone until registered |
| **Canada** | Postal and non-US/Mexico courier imports: duty and tax above **CAD 20**. CARM applies to commercial importers of record (relevant only if shipping DDP). | DAP disclosure |
| **GDPR / UK GDPR** | Apply when offering goods to EU/UK residents; representative may be required (Art. 27). | Same minimisation as PDPA |
| **Consumer protection** | EU/UK 14-day cancellation for distance sales (exceptions for goods made to specification). US/CA state/provincial rules. | Returns policy draft; made-to-order flagged per product |
| **Product safety / legality** | Emissions-defeat parts, airbags and seat-belt components are restricted or prohibited in several markets and on marketplaces. Replica parts must never be represented as genuine (trademark law). | Authenticity label mandatory; "genuine" requires evidence to publish; restricted countries per product |
| **Marketplace rules** | TikTok Shop TH: automotive is restricted; used car parts likely not supported. TikTok Shop US: used parts prohibited. | Listing refusals in `cms/src/tiktok/mapper.ts` |
| **Card payments** | PCI DSS scope minimised by Stripe-hosted Checkout (SAQ A). | No card data touches our servers |
