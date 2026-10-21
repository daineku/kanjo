/**
 * Motion checks: no loader, the reveals, and the failure modes that this kind
 * of animation work introduces.
 *
 * NOT wired into `npm run check`, and playwright is deliberately NOT a
 * dependency — it would add ~100MB of browser download to every install. Run it
 * against a PRODUCTION build:
 *
 *   npm run build && npm start &
 *   cd /tmp && npm init -y && npm i playwright && npx playwright install chromium --only-shell
 *   BASE=http://localhost:3000 node <path-to>/check-motion.mjs
 *
 * WHAT IT IS ACTUALLY LOOKING FOR, and why each one is here:
 *
 *  1. STUCK-INVISIBLE CONTENT. The characteristic failure of a JS-driven reveal
 *     is an element left at opacity 0 because the animation that was supposed to
 *     bring it back never ran — under reduced motion, after a failed hydration,
 *     or because a ScrollTrigger never fired. Checked at every width, and
 *     separately under `reducedMotion: 'reduce'`, which is the case most likely
 *     to regress.
 *
 *  2. THERE IS NO LOADER. The page is usable at first paint: no overlay, no
 *     scroll lock, no inert root, and the hero image is in the HTML — including
 *     when fonts hang so `load` never fires.
 *
 *  3. SCROLLTRIGGER ACCUMULATION. Client-side navigation away and back must not
 *     leave the previous page's triggers behind. A page that gathers a trigger
 *     per visit degrades by the fourth one and nobody notices until it is slow.
 *
 *  4. REQUEST LOOPS AND DUPLICATES, which the Daineku handoff records as a
 *     recurring defect — and which an animation that re-mounts media would
 *     reintroduce.
 */

import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:3517'
const WIDTHS = [1920, 1440, 1024, 768, 430, 393, 375, 360]

/**
 * Hosts the TikTok creator embed reaches, and the one allowed third party.
 *
 * The embed IS a third-party script — that is what it is — and once its iframe
 * is on the page it talks to a spread of ByteDance hosts for its own analytics
 * and assets. None of that is ours, none of it is under our control, and none
 * of it can be fixed by us.
 *
 * It is allowlisted BY HOST rather than the checks being deleted, so the
 * assertions that matter survive: no Google or YouTube host until somebody
 * presses PLAY, and no request loop in OUR components.
 */
const TIKTOK_HOSTS =
  /(^|\.)tiktok\.com$|(^|\.)tiktokv\.com$|(^|\.)tiktokcdn\.com$|(^|\.)tiktokcdn-[a-z0-9-]+\.com$|(^|\.)ttwstatic\.com$|(^|\.)byteoversea\.com$|(^|\.)ibyteimg\.com$|(^|\.)ipstatp\.com$|(^|\.)bytedance\.com$/

/**
 * True for console output that a third-party iframe caused.
 *
 * Measured with the TikTok embed live: a steady stream of CORS failures and a
 * 403 against `mon.tiktokv.com` (their analytics endpoint), all originating
 * inside a cross-origin frame — plus one permissions-policy warning the browser
 * reports against the TOP document because TikTok's injected iframe declares
 * `allow="accelerometer"` and we do not delegate it. Delegating a motion sensor
 * to a third party to silence a warning is a worse trade than the warning.
 *
 * Collecting all of that would make these checks impossible to pass, and a
 * check that can never pass is a check nobody reads — which is how a real error
 * in our own document would slip through.
 */
function isThirdPartyNoise(message) {
  const frameUrl = message.location?.()?.url ?? ''
  if (frameUrl) {
    try {
      if (TIKTOK_HOSTS.test(new URL(frameUrl).host)) return true
    } catch {
      /* not a URL we can attribute; fall through to the text checks */
    }
  }
  return /Permissions policy violation: accelerometer/.test(message.text())
}

const results = []
function check(name, pass, detail) {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()

/** Every element the site animates, and whether any of them ended up invisible. */
const INVISIBLE_PROBE = () => {
  const selectors = [
    '.k-post-row',
    '.k-post-list',
    '.k-video-meta',
    '.k-social-link',
    '.k-reveal',
    '.k-section',
  ]
  const stuck = []
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      // On a phone the channel rail is fixed over the hero and withdraws, by
      // design, once the hero has scrolled away (`data-hero-visible="false"`
      // in production-tuning.css). That is the rail doing its job, not a
      // reveal that failed, so it is excluded only in that state — a rail
      // hidden while the hero IS visible would still be reported.
      if (
        selector === '.k-social-link' &&
        element.closest('.k-social-cluster')?.getAttribute('data-hero-visible') === 'false'
      ) {
        continue
      }
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      if (Number(style.opacity) < 0.95 || style.visibility === 'hidden') {

        stuck.push({
          selector,
          opacity: style.opacity,
          visibility: style.visibility,
          text: (element.textContent ?? '').trim().slice(0, 40),
          top: Math.round(rect.top),
        })
      }
    }
  }
  return stuck
}

// ── 1. No loader, and the page it renders ─────────────────────────────────────
for (const width of WIDTHS) {
  const context = await browser.newContext({
    viewport: { width, height: width <= 430 ? 844 : 900 },
    reducedMotion: 'no-preference',
    hasTouch: width <= 430,
    isMobile: width <= 430,
  })
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    if (isThirdPartyNoise(m)) return
    consoleErrors.push(m.text().slice(0, 160))
  })
  page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 160)))

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })

  // No loader: the first screen is the page itself, usable from the HTML.
  const early = await page.evaluate(() => ({
    loader: !!document.querySelector('.k-loader'),
    locked: getComputedStyle(document.documentElement).overflow === 'hidden',
    inert: document.getElementById('app-root')?.hasAttribute('inert') ?? false,
    hero: !!document.querySelector('.k-hero-media img'),
  }))
  check(
    `${width}: no loader, no lock, hero in the first paint`,
    !early.loader && !early.locked && !early.inert && early.hero,
    JSON.stringify(early),
  )

  // Scroll the whole page so every ScrollTrigger fires, then look for anything
  // left invisible.
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.6
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y)
      await new Promise((r) => requestAnimationFrame(r))
    }
    window.scrollTo(0, document.body.scrollHeight)
  })
  await page.waitForTimeout(1200)

  const stuck = await page.evaluate(INVISIBLE_PROBE)
  check(`${width}: nothing left invisible after scrolling`, stuck.length === 0, JSON.stringify(stuck.slice(0, 3)))

  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }))
  check(
    `${width}: no horizontal overflow`,
    overflow.scroll <= overflow.inner + 1,
    `${overflow.scroll} vs ${overflow.inner}`,
  )

  check(`${width}: no console errors`, consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))
  await context.close()
}

// ── 2. Reduced motion ────────────────────────────────────────────────────────
{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(500)
  const stuck = await page.evaluate(INVISIBLE_PROBE)
  check('reduced: NOTHING is stuck at opacity 0', stuck.length === 0, JSON.stringify(stuck.slice(0, 4)))

  const title = await page.evaluate(() => {
    const el = document.querySelector('#hero-title')
    if (!el) return null
    // The identity is either set type or the logo artwork; both must name the game.
    const text = el.textContent?.trim() || el.querySelector('img')?.getAttribute('alt') || ''
    return { text, opacity: getComputedStyle(el).opacity }
  })
  check('reduced: the title is present and opaque', title?.opacity === '1' && !!title?.text, JSON.stringify(title))
  await context.close()
}

// ── 3. Usable even when `load` never fires ──────────────────────────────────
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  // Hang the font requests so `document.fonts.ready` and `load` cannot settle.
  await page.route('**/fonts/**', () => {
    /* never fulfilled, never aborted */
  })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  const usable = await page.evaluate(() => ({
    locked: getComputedStyle(document.documentElement).overflow === 'hidden',
    inert: document.getElementById('app-root')?.hasAttribute('inert') ?? false,
    hero: !!document.querySelector('.k-hero-media img'),
  }))
  check('fonts hung: the page is usable and the hero is there', !usable.locked && !usable.inert && usable.hero)
  await context.close()
}

// ── 4. Client-side navigation: the case where GSAP state actually leaks ──────
//
// `page.goto` is a full page load, which throws every JavaScript object away and
// therefore cannot demonstrate accumulation at all. The case that can is a
// CLIENT-SIDE navigation: the root layout survives it, the page's components
// unmount and remount, and a component that fails to revert its GSAP context
// leaves its ScrollTriggers attached to the old, detached elements.
//
// The instance count is not observable from here — GSAP is not on `window`, and
// putting it there to make a test easier would ship a global to every visitor.
// So this measures the CONSEQUENCES, which is what would actually be noticed:
// content must still reveal, scroll work must not grow, and nothing may error.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    if (isThirdPartyNoise(m)) return
    errors.push(m.text().slice(0, 160))
  })

  await page.goto(BASE, { waitUntil: 'load' })

  /** Wall-clock cost of 30 scroll frames — it grows if triggers pile up. */
  const scrollCost = () =>
    page.evaluate(async () => {
      const start = performance.now()
      for (let i = 0; i < 30; i += 1) {
        window.scrollTo(0, (i % 10) * 120)
        await new Promise((r) => requestAnimationFrame(r))
      }
      window.scrollTo(0, 0)
      return performance.now() - start
    })

  const before = await scrollCost()

  for (let i = 0; i < 3; i += 1) {
    // The footer's in-site links are the legal pages; /updates left the footer
    // when the homepage's development log became the Patreon block.
    await page.click('footer a[href="/privacy"]')
    await page.waitForURL('**/privacy', { timeout: 10000 })

    await page.waitForTimeout(300)
    await page.goBack()
    await page.waitForURL(BASE + '/', { timeout: 10000 })
    await page.waitForTimeout(500)
  }

  const stuck = await page.evaluate(INVISIBLE_PROBE)
  check('client nav: content still reveals after 3 round trips', stuck.length === 0, JSON.stringify(stuck.slice(0, 3)))

  const after = await scrollCost()
  check(
    'client nav: scroll cost does not grow',
    after < before * 2 + 60,
    `${before.toFixed(0)}ms then ${after.toFixed(0)}ms`,
  )
  check('client nav: no errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  await context.close()
}

// ── 5. Requests: no third party by default, no duplicates, no loops ──────────
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const asked = new Map()
  const thirdParty = new Set()
  page.on('request', (request) => {
    const url = request.url()
    asked.set(url, (asked.get(url) ?? 0) + 1)
    const host = new URL(url).host
    if (!url.startsWith(BASE) && !url.startsWith('data:') && !url.startsWith('blob:')) {
      thirdParty.add(host)
    }
  })
  await page.goto(BASE, { waitUntil: 'load' })
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(2500)

  /**
   * FIRST-PARTY ONLY, and that is the point of the check rather than a
   * weakening of it.
   *
   * What this guards against is the Daineku history recorded in
   * scripts/check-media-requests.mjs: a component asking for the same image
   * over and over. Those are all first-party URLs. TikTok's iframe batches its
   * own analytics to `mcs-sg.tiktokv.com` several times per page — measured at
   * 4 and 8 repeats — which is their design, not our regression, and counting
   * it would bury the signal this check exists for.
   */
  const duplicates = [...asked.entries()]
    .filter(([url]) => url.startsWith(BASE))
    .filter(([, n]) => n > 1)
  check(
    'no first-party URL is requested twice',
    duplicates.length === 0,
    duplicates.map(([u, n]) => `${u.slice(-50)}×${n}`).join(', '),
  )

  /**
   * TIKTOK IS THE ONE ALLOWED THIRD PARTY, AND ONLY ON SCROLL.
   *
   * The official creator embed is a third-party script by definition — that is
   * what it is — and it loads when its section approaches the viewport, which
   * this test's full-page scroll triggers. So it is allowlisted BY HOST rather
   * than the check being deleted, which keeps the assertion that actually
   * matters: no Google or YouTube host is contacted until somebody presses
   * PLAY, and nothing else reaches out at all.
   */
  const unexpected = [...thirdParty].filter((host) => !TIKTOK_HOSTS.test(host))
  check(
    'no third-party request except the TikTok embed, which is the point of it',
    unexpected.length === 0,
    unexpected.join(', '),
  )
  check(
    'no Google or YouTube host before the visitor presses play',
    [...thirdParty].every((host) => !/google|youtube|ytimg|ggpht/i.test(host)),
    [...thirdParty].filter((h) => /google|youtube|ytimg|ggpht/i.test(h)).join(', '),
  )
  // The retired loader's vehicles must not be fetched at all.
  const loaderRequests = [...asked.keys()].filter((u) => decodeURIComponent(u).includes('/media/loader/'))
  check('no loader asset is requested', loaderRequests.length === 0, loaderRequests.join(', '))
  await context.close()
}

await browser.close()

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length > 0) {
  console.log('FAILURES:')
  for (const f of failed) console.log(`  ${f.name}${f.detail ? ` — ${f.detail}` : ''}`)
  process.exitCode = 1
}
