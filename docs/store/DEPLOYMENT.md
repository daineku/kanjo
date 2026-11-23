# Deployment, environment, rollback

## What deploys where

| Part | Host | Deploy |
|---|---|---|
| Website (repo root) | Vercel project, as today | push to `main` (existing workflow) |
| CMS (`cms/`) | any Node 22/24 host with a persistent process (see below) | from the same repository, root directory `cms` |
| Database | existing Supabase project, **new schema `kanjo_store`** | Strapi creates its tables on first boot |
| Store media | Cloudflare R2, new bucket `thekanjo-store-media` | — |

**Merging this branch changes nothing on thekanjo.com** until the three
`STORE_*` variables are set on Vercel: store routes 404, PARTS is hidden, the
homepage is unchanged.

### Why the CMS is not on Vercel

Strapi is a long-running server (admin panel, cron for reservation sweeps and
TikTok jobs, webhook endpoint). Vercel functions are not. Any host that runs
`npm start` persistently works: a small VPS (cheapest, e.g. a 2 GB instance),
Render, Railway or Fly.io. Choose one and it becomes the only new paid service;
the database and media reuse existing accounts. **This choice is the owner's**
and is listed as a blocker.

## CMS — first deployment

1. **Database schema** (Supabase → SQL editor):
   ```sql
   create schema if not exists kanjo_store;
   -- a dedicated login keeps Strapi away from public.* and Daineku's tables
   create role kanjo_cms login password '<generated>';
   grant usage, create on schema kanjo_store to kanjo_cms;
   alter role kanjo_cms set search_path = kanjo_store;
   ```
   Use the **direct** connection string or the **session** pooler (port 5432),
   not the transaction pooler.
2. **R2**: create bucket `thekanjo-store-media`, connect a public custom domain
   (e.g. `store-media.thekanjo.com`), create a bucket-scoped Object Read &
   Write token.
3. **Host**: root directory `cms`, build `npm ci && npm run build`, start
   `npm start`, Node 22 or 24, health check `/_health`. Point
   `cms.thekanjo.com` at it (Cloudflare DNS, as for the rest of the domain).
4. **Environment** — all variables in `cms/.env.example`. Production minimum:

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `PUBLIC_URL` | `https://cms.thekanjo.com` |
   | `IS_PROXIED` | `true` on most platforms |
   | `APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `JWT_SECRET`, `ENCRYPTION_KEY` | each `openssl rand -base64 32` |
   | `DATABASE_CLIENT` | `postgres` |
   | `DATABASE_URL` | the `kanjo_cms` connection string |
   | `DATABASE_SCHEMA` | `kanjo_store` |
   | `DATABASE_SSL` | `true` |
   | `DATABASE_POOL_MIN` | `0` |
   | `STOREFRONT_API_TOKEN` | `openssl rand -hex 32` (same value as `STORE_CMS_TOKEN` on Vercel) |
   | `STOREFRONT_ORIGIN` | `https://thekanjo.com` |
   | `STOREFRONT_REVALIDATE_URL` | `https://thekanjo.com/api/store/revalidate` |
   | `STOREFRONT_REVALIDATE_SECRET` | `openssl rand -hex 32` (same as `STORE_REVALIDATE_SECRET`) |
   | `R2_*` | from step 2 |

   Leave Stripe and TikTok variables **unset** until their accounts exist.
5. **First boot** seeds categories, vehicles, settings, disabled shipping zones
   and draft policies. Open `https://cms.thekanjo.com/admin`, create the owner's
   Super Admin account **immediately** (the first visitor to an empty admin
   creates it), then invite the partner with the *Fulfillment Partner* role.

## Website — enabling the store

On the existing Vercel project, **Production** environment:

| Variable | Value |
|---|---|
| `STORE_CMS_URL` | `https://cms.thekanjo.com` |
| `STORE_CMS_TOKEN` | = `STOREFRONT_API_TOKEN` |
| `STORE_REVALIDATE_SECRET` | = `STOREFRONT_REVALIDATE_SECRET` |
| `STORE_MEDIA_URL` | `https://store-media.thekanjo.com` (allows `next/image` to optimise product photos) |

Redeploy (Vercel reads variables at build time). Do this **after** at least
one real product is published, policies are reviewed, and shipping rates are
verified — before that the store renders, but has nothing to sell.

Preview deployments: leave the `STORE_*` variables unset on Preview (the store
is then off), or point them at a **staging** CMS — never the production one.

## Release checklist

- [ ] `npm run check` at the repo root (typecheck, lint, tests, build)
- [ ] `cd cms && npm run check` (typecheck, 100+ tests incl. end-to-end, admin build)
- [ ] Staging CMS + Preview site with Stripe **test** keys: run the validation list in INTEGRATIONS.md
- [ ] Lighthouse mobile on `/`, `/parts`, one product page — homepage must not regress
- [ ] Policies legally reviewed; at least one verified shipping rate; products published

## Rollback

| Problem | Action | Data effect |
|---|---|---|
| Store misbehaving on the website | Remove `STORE_CMS_URL` on Vercel → redeploy (or **Instant Rollback** to the previous deployment) | None. Store disappears; homepage unaffected |
| Need to stop taking payments now | Admin → Store settings → *Checkout enabled* off (instant). Or unset `STRIPE_SECRET_KEY` and restart | Open checkouts expire and release stock |
| Bad CMS release | Redeploy the previous commit on the CMS host | Schema: Strapi adds columns/tables but drops removed ones — **take a database backup before every CMS deploy** |
| Whole store withdrawn | Revert the merge commit on `main` | The `kanjo_store` schema remains untouched; drop it only deliberately |

Backups: enable Supabase daily backups (point-in-time recovery on paid
plans); before each CMS deploy run
`pg_dump --schema=kanjo_store "$DATABASE_URL" > kanjo_store-$(date +%F).sql`.
R2 objects are not versioned by default — enable bucket versioning if images
must be recoverable.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Store routes 404 on the site | `STORE_CMS_URL`/`STORE_CMS_TOKEN` unset, or added without a redeploy |
| "Catalogue temporarily unavailable" | CMS down, slow (>4 s), or the token differs between the two sides (CMS log shows "refusing request") |
| No countries in the cart's country list | No zone is enabled with a **verified** rate in the store currency |
| Product missing from the site | Not published, review status not *approved*, archived, or `isSample` |
| Product shows "out of stock" though marked in stock | Inventory item on hand is 0 (or all units reserved) |
| Checkout button absent | *Checkout enabled* off, Stripe keys missing, or a test key on production |
| Paid in Stripe but order still pending | Webhook not reaching the CMS: check Stripe → Webhooks → delivery attempts; check `STRIPE_WEBHOOK_SECRET`; check the *Payment event* log in the admin |
| Order flagged "AMOUNT MISMATCH" | Paid amount ≠ order total — investigate before fulfilling |
| "STOCK CONFLICT" on an order | A marketplace or late payment took units that were not available — recount and contact the customer |
| Publish refused | The admin lists every rule that failed (`cms/src/commerce/validation.ts`) |
| Admin images broken with R2 | `R2_PUBLIC_BASE_URL` host missing from CSP (set it and restart) or bucket not public |
