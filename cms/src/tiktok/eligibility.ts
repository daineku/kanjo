/**
 * What has to be true, outside this codebase, before TikTok Shop can be used.
 *
 * Shown on the ops screen as a checklist. These are facts about TikTok's
 * programme, researched 2026-11-23, each labelled with how well it was
 * verified. They are deliberately not softened: the most important one is that
 * a Thai TikTok Shop does not reach US, UK or EU buyers.
 */

export type EligibilityItem = {
  id: string;
  title: string;
  detail: string;
  /** verified = read on an official page; snippet = official page via search snippet only; unverified = confirm with TikTok. */
  confidence: 'verified' | 'snippet' | 'unverified';
  source?: string;
  /** True when this must be confirmed by the merchant before relying on it. */
  action: string;
};

export const TIKTOK_ELIGIBILITY: EligibilityItem[] = [
  {
    id: 'thai-seller',
    title: 'A TikTok Shop Thailand seller account is required',
    detail:
      'Individual sellers must be Thai citizens aged 20+, with a Thai national ID and a bank account in the same name. Corporate sellers must be incorporated in Thailand, with Ministry of Commerce registration documents and a business bank account in the entity name.',
    confidence: 'verified',
    source: 'https://seller-th.tiktok.com/university/essay?knowledge_id=10008415&lang=en',
    action: 'The Thai operating partner registers (or already holds) the seller account.',
  },
  {
    id: 'thai-buyers-only',
    title: 'A Thai shop sells to buyers in Thailand only',
    detail:
      'No official programme was found that lets a Thailand-registered seller sell to TikTok Shop buyers in the US, UK or EU. Cross-border selling is documented for mainland China and Hong Kong entities. Selling on TikTok Shop US/UK/EU would need a local entity in that market. Website orders are unaffected: thekanjo.com ships internationally on its own checkout.',
    confidence: 'unverified',
    source: 'https://partner.tiktokshop.com/docv2/page/6746be6cebbeff030f7c5805',
    action: 'Confirm with a TikTok Shop Thailand account manager whether any Thai-origin cross-border programme exists.',
  },
  {
    id: 'used-parts',
    title: 'Used parts are very likely not listable',
    detail:
      'TikTok Shop Thailand allows pre-owned goods only in a fixed list of categories (watches, bags, fashion accessories, phones/electronics, clothing/footwear); automotive is not on it. TikTok Shop US prohibits used, refurbished, salvaged or previously-installed automotive parts outright. This integration refuses to push any product whose condition is not new / new-old-stock.',
    confidence: 'snippet',
    source: 'https://seller-th.tiktok.com/university/essay?knowledge_id=1531423806867201&lang=en',
    action: 'Confirm the pre-owned policy on the full Seller University page before planning used-part listings.',
  },
  {
    id: 'restricted-category',
    title: 'Automotive is a restricted category in Thailand',
    detail:
      '“Automotive & Motorcycle Products” needs category qualification. The page names motorcycles, motorcycle parts and helmets and asks for a TIS standard number and certification mark; car parts are not named explicitly. Category rules also add required attributes per category.',
    confidence: 'verified',
    source: 'https://seller-th.tiktok.com/university/essay?knowledge_id=1532032698156801&lang=en',
    action: 'Apply for the category in Seller Center and read “Get Category Rules” for each mapped category.',
  },
  {
    id: 'brand-qualification',
    title: 'Branded parts may need Brand Qualification',
    detail:
      'Some brands are locked in the brand selector until authorization documents are submitted, and individual sellers may be barred from them (a corporate account is then required). There is no public list, so whether Honda, Spoon, Mugen or others are gated is unknown. Shop names may not contain brand names without written authorization.',
    confidence: 'verified',
    source: 'https://seller-th.tiktok.com/university/essay?knowledge_id=8504200913520401&lang=en',
    action: 'Check each brand in the Seller Center brand selector; gather authorization letters where required.',
  },
  {
    id: 'developer-app',
    title: 'A Partner Center app must be created and authorized',
    detail:
      'Create a Custom app for your own shop in the GLOBAL Partner Center (partner.tiktokshop.com — the US one is separate), enable the API, and register the redirect URL and webhook URL shown on this screen. A seller’s own custom app usually needs no app review, but onboarding or security checks may still apply.',
    confidence: 'snippet',
    source: 'https://partner.tiktokshop.com/docv2/page/create-your-app',
    action: 'Create the app, then set TIKTOK_SHOP_APP_KEY, TIKTOK_SHOP_APP_SECRET and TIKTOK_SHOP_SERVICE_ID on the CMS server.',
  },
  {
    id: 'currency',
    title: 'Listings are priced in the shop currency',
    detail:
      'A Thai shop lists in THB. The website catalogue may be priced in another currency, and prices are never converted automatically: a product is only pushed when it is priced in the shop currency or carries an explicit TikTok price.',
    confidence: 'verified',
    action: 'Decide TikTok prices per product before enabling product sync.',
  },
  {
    id: 'api-confirmation',
    title: 'API details to confirm against a sandbox shop',
    detail:
      'The request-signing algorithm, the API base host, exact rate limits, the refresh-token lifetime and the paths of the newer endpoint versions (edit product 202509, order detail 202507, mark-as-shipped 202610) could not be read from the official documentation, which renders client-side. The implementation follows the open-source SDKs and is unit-tested, but has never called a real shop.',
    confidence: 'unverified',
    source: 'https://partner.tiktokshop.com/docv2/page/sign-your-api-request',
    action: 'Run the first authorization and one product push against a sandbox shop and review the job log.',
  },
];
