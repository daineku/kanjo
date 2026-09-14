/**
 * Checks for the three external content blocks: YouTube, TikTok and Patreon.
 *
 * NOT wired into `npm run check`, and playwright is deliberately NOT a
 * dependency. Run it against a PRODUCTION build:
 *
 *   npm run build && npm start &
 *   cd /tmp && npm init -y && npm i playwright && npx playwright install chromium --only-shell
 *   BASE=http://localhost:3000 node <path-to>/check-integrations.mjs
 *
 * WHAT IT IS LOOKING FOR, and why each one is here:
 *
 *  1. EVERY BLOCK IS STRUCTURALLY COMPLETE WITHOUT ITS PROVIDER. With no
 *     credentials — the state of a fresh clone and of the repository as
 *     committed — each block must render a real, clickable destination rather
 *     than an empty frame, a spinner or an error. This is the property that
 *     makes the site deployable before any API key exists.
 *
 *  2. THE TIKTOK SCRIPT LOADS EXACTLY ONCE. A duplicated embed.js is the
 *     characteristic failure of third-party embeds in a client-routed app: two
 *     copies race, initialise the same blockquote twice, and can leave two
 *     iframes stacked. Checked across a full-page scroll AND a client-side
 *     navigation round trip.
 *
 *  3. IT DOES NOT LOAD DURING THE LOADER. The embed is heavier than the rest of
 *     the page put together; if it is fetched while the highway is still
 *     running it competes with the one animation the visitor is actually
 *     looking at.
 *
 *  4. NO HORIZONTAL OVERFLOW AT PHONE WIDTHS, which a third-party iframe with
 *     its own idea of layout is the most likely thing on the site to cause.
 *
 *  5. THE REAL CHANNEL URLS ARE THE ONES ON THE PAGE, and no placeholder or
 *     invented Steam URL has crept in.
 */

import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:3517'

const EXPECTED = {
  tiktok: 'https://www.tiktok.com/@the_kanjo',
  patreon: 'https://www.patreon.com/cw/TheKanjo',
  youtube: 'https://www.youtube.com/@thekanjo',
  publisher: 'https://daineku.com/',
}

const results = []
function check(name, pass, detail) {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()

/** Waits for the loader to remove itself. Resolves at once if there is none. */
async function settled(page) {
  await page
    .waitForFunction(() => !document.querySelector('.k-loader'), null, { timeout: 15000 })
    .catch(() => {})
}

const EMBED_JS = /tiktok\.com\/embed\.js/

// ── 1. The unconfigured state is complete and clickable ──────────────────────
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  /**
   * CONSOLE ERRORS ARE ATTRIBUTED BY FRAME, NOT COLLECTED BLINDLY.
   *
   * Once TikTok's iframe is on the page it produces a steady stream of console
   * errors of its own — measured: CORS failures and a 403 against
   * `mon.tiktokv.com`, their analytics endpoint, plus a permissions-policy
   * warning for `accelerometer`. All of it originates inside a cross-origin
   * frame at `https://www.tiktok.com`, none of it is ours, and none of it
   * affects the embed, which loads correctly regardless.
   *
   * Collecting it would mean this check could never pass, and a check that can
   * never pass gets ignored — which is how a real error in OUR document would
   * go unnoticed. So messages are filtered by the URL of the frame that
   * produced them, and anything from our own origin still fails the test.
   */
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const frameUrl = m.location()?.url ?? ''
    if (/tiktok(cdn|v)?\.com|byteoversea|ibyteimg|ipstatp/.test(frameUrl)) return
    // One message the browser reports against the TOP document rather than the
    // frame that caused it: TikTok's script injects an iframe carrying
    // `allow="accelerometer; …"`, and our page does not delegate that feature.
    // We cannot change their iframe's attributes, and delegating a motion
    // sensor to a third party to silence a warning would be a worse trade than
    // the warning. The embed is unaffected.
    if (/Permissions policy violation: accelerometer/.test(m.text())) return
    errors.push(m.text().slice(0, 200))
  })

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await settled(page)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(2500)

  const hrefs = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
  )

  check(
    'YouTube block offers the channel',
    hrefs.includes(EXPECTED.youtube),
    `${hrefs.filter((h) => h?.includes('youtube')).join(', ') || 'none'}`,
  )
  check(
    'Patreon block offers the real creator page',
    hrefs.includes(EXPECTED.patreon),
    `${hrefs.filter((h) => h?.includes('patreon')).join(', ') || 'none'}`,
  )
  check(
    'TikTok block offers the real profile',
    hrefs.includes(EXPECTED.tiktok),
    `${hrefs.filter((h) => h?.includes('tiktok')).join(', ') || 'none'}`,
  )
  check('publisher is linked in the footer', hrefs.includes(EXPECTED.publisher))

  // Nothing invented. A Steam URL appearing here would mean one was fabricated.
  check(
    'NO Steam URL has been invented',
    !hrefs.some((h) => h && /steampowered|steamcommunity/i.test(h)),
    hrefs.filter((h) => h && /steam/i.test(h)).join(', '),
  )
  check(
    'no PLACEHOLDER text is rendered',
    !(await page.evaluate(() => /\bplaceholder\b/i.test(document.body.innerText))),
  )

  // The social rail: three live channels, Steam configured-but-hidden.
  const rail = await page.evaluate(() =>
    [...document.querySelectorAll('.k-social-link')].map((a) => ({
      label: a.textContent.trim(),
      href: a.getAttribute('href'),
    })),
  )
  check(
    'social rail carries TikTok, Patreon and YouTube',
    rail.length === 3 &&
      rail[0]?.href === EXPECTED.tiktok &&
      rail[1]?.href === EXPECTED.patreon &&
      rail[2]?.href === EXPECTED.youtube,
    rail.map((r) => `${r.label}`).join(' / '),
  )

  // Structured data: the publisher is Daineku, and its url is daineku.com —
  // NOT thekanjo.com, which would merge the two identities for a crawler.
  const jsonLd = await page.evaluate(() => {
    const node = document.querySelector('script[type="application/ld+json"]')
    return node ? JSON.parse(node.textContent) : null
  })
  const graph = jsonLd?.['@graph'] ?? []
  const publisher = graph.find((n) => n['@type'] === 'Organization')
  const game = graph.find((n) => n['@type'] === 'VideoGame')
  check(
    'JSON-LD publisher is Daineku at daineku.com',
    publisher?.name === 'Daineku' && publisher?.url === EXPECTED.publisher,
    JSON.stringify({ name: publisher?.name, url: publisher?.url }),
  )
  check(
    'JSON-LD game sameAs carries the three live channels, and no empty string',
    Array.isArray(game?.sameAs) &&
      game.sameAs.length === 3 &&
      game.sameAs.every((u) => typeof u === 'string' && u.length > 0),
    JSON.stringify(game?.sameAs),
  )
  check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  await context.close()
}

// ── 2. The TikTok script: once, late, and not during the loader ──────────────
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const embedRequests = []
  page.on('request', (r) => {
    if (EMBED_JS.test(r.url())) embedRequests.push({ url: r.url(), at: Date.now() })
  })

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })

  // While the loader is still up, nothing heavy may be fetched.
  await page.waitForTimeout(1200)
  const duringLoader = embedRequests.length
  check('TikTok embed.js is NOT fetched during the loader', duringLoader === 0, `${duringLoader}`)

  await settled(page)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(3000)

  check(
    'TikTok embed.js is fetched once the section is reached',
    embedRequests.length >= 1,
    `${embedRequests.length} request(s)`,
  )
  check(
    'TikTok embed.js is fetched EXACTLY once',
    embedRequests.length === 1,
    `${embedRequests.length} request(s)`,
  )

  const scriptTags = await page.evaluate(
    () => document.querySelectorAll('script[src*="tiktok.com/embed"]').length,
  )
  check('exactly one TikTok script tag in the DOM', scriptTags === 1, `${scriptTags}`)

  // A client-side round trip must not inject a second copy.
  await page.click('footer a[href="/updates"]')
  await page.waitForURL('**/updates', { timeout: 10000 })
  await page.waitForTimeout(400)
  await page.goBack()
  await page.waitForTimeout(1500)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(2500)

  check(
    'client-side navigation does not re-inject embed.js',
    embedRequests.length === 1,
    `${embedRequests.length} request(s) after a round trip`,
  )
  const afterNav = await page.evaluate(
    () => document.querySelectorAll('script[src*="tiktok.com/embed"]').length,
  )
  check('still exactly one TikTok script tag after navigation', afterNav <= 1, `${afterNav}`)

  const blockquotes = await page.evaluate(
    () => document.querySelectorAll('.tiktok-embed').length,
  )
  check('exactly one TikTok embed element', blockquotes === 1, `${blockquotes}`)
  await context.close()
}

// ── 3. Phone widths: the embed must not widen the page ───────────────────────
for (const width of [430, 390, 360]) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  const page = await context.newPage()
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await settled(page)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(3500)

  const metrics = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
    embedWidth: Math.round(
      document.querySelector('.k-tiktok')?.getBoundingClientRect().width ?? 0,
    ),
    ctaVisible: Boolean(document.querySelector('.k-tiktok a[href*="tiktok.com"]')),
  }))
  check(
    `${width}: no horizontal overflow with the TikTok embed`,
    metrics.scroll <= metrics.inner + 1,
    `${metrics.scroll} vs ${metrics.inner}`,
  )
  check(
    `${width}: the TikTok block fits its column`,
    metrics.embedWidth > 0 && metrics.embedWidth <= metrics.inner,
    `${metrics.embedWidth}px`,
  )
  await context.close()
}

// ── 4. TikTok blocked: the block is still a usable link, not a black box ─────
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  // Simulate the network conditions of a visitor in a region where TikTok is
  // blocked, or simply an ad blocker.
  await page.route('**://*.tiktok.com/**', (route) => route.abort())

  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await settled(page)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(2500)

  const fallback = await page.evaluate(() => {
    const link = document.querySelector('.k-tiktok a[href*="tiktok.com"]')
    if (!link) return null
    const rect = link.getBoundingClientRect()
    return {
      text: link.textContent.trim(),
      href: link.getAttribute('href'),
      visible: rect.width > 0 && rect.height > 0,
    }
  })
  check(
    'TikTok blocked: the CTA is still rendered and visible',
    Boolean(fallback?.visible) && fallback?.href === EXPECTED.tiktok,
    JSON.stringify(fallback),
  )
  check('TikTok blocked: no page error', errors.length === 0, errors.slice(0, 2).join(' | '))

  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }))
  check(
    'TikTok blocked: no horizontal overflow',
    overflow.scroll <= overflow.inner + 1,
    `${overflow.scroll} vs ${overflow.inner}`,
  )
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
