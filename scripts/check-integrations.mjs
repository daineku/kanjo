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
 * Set SHOTS=<dir> to also write screenshots of the TikTok module in every
 * tested state and width.
 *
 * WHAT IT IS LOOKING FOR, and why each one is here:
 *
 *  1. EVERY BLOCK IS STRUCTURALLY COMPLETE WITHOUT ITS PROVIDER. With no
 *     credentials — the state of a fresh clone and of the repository as
 *     committed — each block must render a real, clickable destination rather
 *     than an empty frame, a spinner or an error. This is the property that
 *     makes the site deployable before any API key exists.
 *
 *  2. THE TIKTOK SCRIPT LOADS EXACTLY ONCE, EVER. A duplicated embed.js is the
 *     characteristic failure of third-party embeds in a client-routed app: two
 *     copies race, initialise the same blockquote twice, and can leave two
 *     iframes stacked. Checked across a full-page scroll AND a client-side
 *     navigation round trip, where the resident runtime must be reused rather
 *     than the script re-fetched.
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
 *
 *  6. THE PROVIDER'S FAILURES ARE NEVER ON SCREEN. TikTok's embed ingress
 *     answers `503 overload-protect triggered` under load, and the iframe
 *     "loads" that document exactly as it loads a profile. Each failure below
 *     is simulated at the network layer — blocked, 403, 429, 503, a timeout,
 *     and a 200 whose body is an error — and in every one the site-owned
 *     preview must be what the visitor sees, the iframe must not be, and the
 *     module must settle rather than retry on its own. Success is simulated
 *     too, with a document that posts the same render signal TikTok's own
 *     library sizes the iframe from, so the reveal path is exercised without
 *     depending on TikTok's mood at test time.
 *
 * ON THE IFRAME: its interior is cross-origin and is NEVER inspected here.
 * "Not on screen" is measured from the outside — the module's state, the
 * provider wrapper's computed style, and which element is under the pointer
 * at the module's centre.
 */

import fs from 'node:fs'
import path from 'node:path'

import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:3517'
const SHOTS = process.env.SHOTS ?? ''
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

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

/** Scrolls the TikTok section into view, which is the module's own trigger. */
async function reachTikTok(page) {
  await page.evaluate(() => document.querySelector('#tiktok')?.scrollIntoView({ block: 'start' }))
}

/** Waits for the module to leave `loading`, or for the ceiling plus a margin. */
async function moduleSettled(page, timeout = 16000) {
  await page
    .waitForFunction(
      () => {
        const state = document.querySelector('.k-tiktok')?.getAttribute('data-state')
        return state === 'live' || state === 'unavailable'
      },
      null,
      { timeout },
    )
    .catch(() => {})
}

/**
 * Everything the outside of the module can say about what is on screen.
 * Nothing here reads the iframe's document.
 */
async function moduleReport(page) {
  return page.evaluate(() => {
    const block = document.querySelector('.k-tiktok')
    if (!block) return null
    const preview = block.querySelector('.k-tiktok-preview')
    const provider = block.querySelector('.k-tiktok-provider')
    const iframe = block.querySelector('iframe')
    // Live: the preview's link is hidden by design and the path moves under
    // the embed, so the report follows it there.
    const cta =
      block.getAttribute('data-state') === 'live'
        ? block.querySelector('.k-tiktok-direct a[href*="tiktok.com"]')
        : block.querySelector('.k-tiktok-preview a[href*="tiktok.com"]')
    const rect = block.getBoundingClientRect()
    const visible = (node) => {
      if (!node) return false
      const style = getComputedStyle(node)
      const box = node.getBoundingClientRect()
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) > 0.01 &&
        box.width > 0 &&
        box.height > 0
      )
    }
    // What is actually under the pointer at the module's centre.
    const cx = rect.left + rect.width / 2
    const cy = rect.top + Math.min(rect.height / 2, window.innerHeight / 2)
    const hit = document.elementFromPoint(cx, cy)
    return {
      state: block.getAttribute('data-state'),
      height: Math.round(rect.height),
      previewVisible: visible(preview),
      providerVisible: visible(provider) && Boolean(iframe) && visible(iframe),
      iframes: block.querySelectorAll('iframe').length,
      hitIsPreview: Boolean(hit?.closest('.k-tiktok-preview')),
      hitIsIframe: hit?.tagName === 'IFRAME',
      cta: cta
        ? { href: cta.getAttribute('href'), visible: visible(cta), text: cta.textContent.trim() }
        : null,
      retry: Boolean(block.querySelector('.k-tiktok-text-action')),
      status: block.querySelector('.k-tiktok-status')?.textContent.trim() ?? null,
      bodyText: document.body.innerText,
    }
  })
}

async function shoot(page, name) {
  if (!SHOTS) return
  await page
    .locator('#tiktok')
    .screenshot({ path: path.join(SHOTS, `${name}.png`) })
    .catch(() => {})
}

const EMBED_JS = /tiktok\.com\/embed\.js/
const EMBED_DOC = /^https:\/\/www\.tiktok\.com\/embed\/@/

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
    // The provider's own 503 is reported by the browser as a failed resource
    // load on the top document. It is the very thing the module exists to
    // contain, not an error in our page.
    if (/tiktok\.com\/embed\/@.*(503|Service Unavailable)/i.test(m.text())) return
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
  const documentRequests = []
  page.on('request', (r) => {
    if (EMBED_JS.test(r.url())) embedRequests.push({ url: r.url(), at: Date.now() })
    if (EMBED_DOC.test(r.url())) documentRequests.push(r.url())
  })

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })

  // While the loader is still up, nothing heavy may be fetched.
  await page.waitForTimeout(1200)
  const duringLoader = embedRequests.length
  check('TikTok embed.js is NOT fetched during the loader', duringLoader === 0, `${duringLoader}`)

  await settled(page)

  // Before the section is reached: the preview is already the finished block.
  const before = await moduleReport(page)
  check(
    'before the section is reached, the module is the preview and nothing has been asked',
    before?.state === 'preview' && embedRequests.length === 0 && before.cta?.href === EXPECTED.tiktok,
    JSON.stringify({ state: before?.state, requests: embedRequests.length }),
  )

  await reachTikTok(page)
  await page.waitForTimeout(3000)

  check(
    'TikTok embed.js is fetched once the section is reached',
    embedRequests.length === 1,
    `${embedRequests.length} request(s)`,
  )

  const scriptTags = await page.evaluate(
    () => document.querySelectorAll('script[src*="tiktok.com/embed"]').length,
  )
  check('exactly one TikTok script tag in the DOM', scriptTags === 1, `${scriptTags}`)

  /**
   * SCROLLING MUST NEVER ASK AGAIN.
   *
   * This is the real "no initialisation loop" check. The IntersectionObserver
   * is disconnected the moment it fires and the request is behind a one-way
   * latch, so moving the section in and out of view any number of times must
   * add exactly zero requests — of the script AND of the embed document.
   */
  const documentsAfterFirstAsk = documentRequests.length
  for (let i = 0; i < 4; i += 1) {
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(150)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(150)
  }
  await page.waitForTimeout(1000)
  check(
    'scrolling past the section repeatedly asks for nothing more',
    embedRequests.length === 1 && documentRequests.length === documentsAfterFirstAsk,
    `${embedRequests.length} script, ${documentRequests.length} document request(s) after 4 passes`,
  )

  /**
   * A CLIENT-SIDE ROUND TRIP REUSES THE RESIDENT RUNTIME.
   *
   * `embed.js` scans for `.tiktok-embed` elements once, when it executes. After
   * navigating away and back, React has mounted a BRAND NEW blockquote that an
   * already-executed script will never look at. The module asks the runtime
   * TikTok's script installed (`tiktokEmbed.lib.render`) to render the new
   * blockquote, which costs no script fetch at all: the invariant is ONE
   * embed.js request for the page's life, one script tag, and one new embed
   * document for the new blockquote.
   */
  await moduleSettled(page)
  await page.click('footer a[href="/privacy"]')
  await page.waitForURL('**/privacy', { timeout: 10000 })
  await page.waitForTimeout(400)
  await page.goBack()
  await page.waitForTimeout(1500)
  await settled(page)
  await reachTikTok(page)
  await page.waitForTimeout(3000)

  check(
    'a round trip fetches embed.js zero more times — the resident runtime is reused',
    embedRequests.length === 1,
    `${embedRequests.length} request(s) after one round trip`,
  )
  check(
    'a round trip asks the provider for the new blockquote exactly once',
    documentRequests.length === documentsAfterFirstAsk + 1,
    `${documentRequests.length} document request(s)`,
  )

  const afterNav = await page.evaluate(() => ({
    scripts: document.querySelectorAll('script[src*="tiktok.com/embed"]').length,
    blockquotes: document.querySelectorAll('.tiktok-embed').length,
    iframes: document.querySelectorAll('.k-tiktok iframe').length,
  }))
  check('script tags never stack', afterNav.scripts === 1, `${afterNav.scripts} tag(s)`)
  check('exactly one TikTok embed element', afterNav.blockquotes === 1, `${afterNav.blockquotes}`)
  check(
    'the module asks again after navigating back — one iframe, not two',
    afterNav.iframes === 1,
    `${afterNav.iframes} iframe(s)`,
  )
  await context.close()
}

// ── 3. The provider's failures, one by one ───────────────────────────────────
/**
 * Each scenario routes TikTok's embed DOCUMENT (the iframe's URL) to a
 * controlled answer and leaves everything else — embed.js, the library, the
 * stylesheet — to the real network, so the full lifecycle up to the iframe is
 * TikTok's own. 'blocked' aborts every TikTok host instead, which is the ad
 * blocker / blocked-region case.
 */
const FAILURES = [
  {
    name: 'blocked',
    route: async (page) => page.route('**://*.tiktok.com/**', (r) => r.abort()),
    settle: 6000,
  },
  {
    name: '503 overload-protect',
    route: async (page) =>
      page.route(EMBED_DOC, (r) =>
        r.fulfill({ status: 503, contentType: 'text/plain', body: 'overload-protect triggered' }),
      ),
    settle: 12000,
  },
  {
    name: '403',
    route: async (page) =>
      page.route(EMBED_DOC, (r) => r.fulfill({ status: 403, contentType: 'text/plain', body: 'Forbidden' })),
    settle: 12000,
  },
  {
    name: '429',
    route: async (page) =>
      page.route(EMBED_DOC, (r) =>
        r.fulfill({ status: 429, contentType: 'text/plain', body: 'Too Many Requests' }),
      ),
    settle: 12000,
  },
  {
    name: '200 with an error body',
    route: async (page) =>
      page.route(EMBED_DOC, (r) =>
        r.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><html><body><p>overload-protect triggered</p></body></html>',
        }),
      ),
    settle: 12000,
  },
  {
    name: 'timeout',
    // Never answered. The module's own ceiling (12s) is what ends the wait.
    route: async (page) => page.route(EMBED_DOC, () => {}),
    settle: 17000,
  },
]

for (const failure of FAILURES) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const documentRequests = []
  page.on('request', (r) => {
    if (EMBED_DOC.test(r.url())) documentRequests.push(r.url())
  })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
  await failure.route(page)

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await settled(page)
  await reachTikTok(page)
  await moduleSettled(page, failure.settle)
  await page.waitForTimeout(600)

  const report = await moduleReport(page)
  const label = `TikTok ${failure.name}`
  check(
    `${label}: the module settles on unavailable, by itself`,
    report?.state === 'unavailable',
    `state=${report?.state}`,
  )
  check(
    `${label}: the preview is what is on screen`,
    Boolean(report?.previewVisible) && Boolean(report?.hitIsPreview),
    JSON.stringify({ previewVisible: report?.previewVisible, hitIsPreview: report?.hitIsPreview }),
  )
  check(
    `${label}: the provider iframe is not on screen`,
    !report?.providerVisible && !report?.hitIsIframe,
    JSON.stringify({ providerVisible: report?.providerVisible, iframes: report?.iframes }),
  )
  check(
    `${label}: the direct profile link is visible and real`,
    report?.cta?.visible === true && report?.cta?.href === EXPECTED.tiktok,
    JSON.stringify(report?.cta),
  )
  check(
    `${label}: no provider wording leaks into the page's own text`,
    !/overload-protect/i.test(report?.bodyText ?? ''),
  )
  check(`${label}: no page error`, errors.length === 0, errors.slice(0, 2).join(' | '))
  check(
    `${label}: the module asked once and did not retry on its own`,
    documentRequests.length <= 1,
    `${documentRequests.length} document request(s)`,
  )
  await shoot(page, `tiktok-${failure.name.replace(/\W+/g, '-')}-1440`)

  // The explicit retry: offered once, bounded, user-initiated.
  check(`${label}: one explicit retry is offered`, report?.retry === true)
  if (report?.retry) {
    await page.click('.k-tiktok-text-action')
    await page.waitForTimeout(400)
    const during = await moduleReport(page)
    // A blocked script fails instantly, so the retry may already have settled.
    check(
      `${label}: the retry keeps the preview on screen while it waits`,
      (during?.state === 'loading' || during?.state === 'unavailable') &&
        during.previewVisible &&
        during.hitIsPreview,
      `state=${during?.state}`,
    )
    await moduleSettled(page, failure.settle)
    await page.waitForTimeout(600)
    const after = await moduleReport(page)
    check(
      `${label}: after the retry the module settles again, with no further retry on offer`,
      after?.state === 'unavailable' && after.retry === false && after.previewVisible,
      JSON.stringify({ state: after?.state, retry: after?.retry }),
    )
    check(
      `${label}: two asks in total, never a loop`,
      documentRequests.length <= 2,
      `${documentRequests.length} document request(s)`,
    )
  }

  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }))
  check(
    `${label}: no horizontal overflow`,
    overflow.scroll <= overflow.inner + 1,
    `${overflow.scroll} vs ${overflow.inner}`,
  )
  await context.close()
}

// ── 4. The provider's success, simulated ─────────────────────────────────────
/**
 * The embed document is replaced by one that behaves as TikTok's application
 * does when it has rendered: it posts the height message TikTok's own library
 * sizes the iframe from, addressed by the iframe's `name`, which that library
 * set to `__tt_embed__<blockquote id>`. The parent-side reveal path is thereby
 * exercised end to end without depending on TikTok's ingress at test time.
 */
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.route(EMBED_DOC, (r) =>
    r.fulfill({
      status: 200,
      contentType: 'text/html',
      body:
        '<!doctype html><html><body style="margin:0;background:#fff;color:#111;font:16px sans-serif">' +
        '<div style="height:640px;padding:24px">simulated creator profile</div>' +
        // Posted after load, as TikTok's application does.
        '<script>addEventListener("load", () => parent.postMessage(JSON.stringify({signalSource: window.name, height: 640}), "*"))</script>' +
        '</body></html>',
    }),
  )

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await settled(page)
  await reachTikTok(page)
  await moduleSettled(page, 14000)
  await page.waitForTimeout(900)

  const report = await moduleReport(page)
  check('TikTok rendered: the module goes live on the render signal', report?.state === 'live', `state=${report?.state}`)
  check(
    'TikTok rendered: the embed is on screen and the preview is not',
    Boolean(report?.providerVisible) && !report?.previewVisible && Boolean(report?.hitIsIframe),
    JSON.stringify({
      providerVisible: report?.providerVisible,
      previewVisible: report?.previewVisible,
      hitIsIframe: report?.hitIsIframe,
    }),
  )
  check(
    'TikTok rendered: the module took the reported height',
    (report?.height ?? 0) >= 600,
    `${report?.height}px`,
  )
  check(
    'TikTok rendered: the direct profile link is still offered, under the embed',
    report?.cta?.visible === true && report?.cta?.href === EXPECTED.tiktok,
    JSON.stringify(report?.cta),
  )
  await shoot(page, 'tiktok-live-simulated-1440')
  await context.close()
}

// ── 5. Without JavaScript ────────────────────────────────────────────────────
{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    javaScriptEnabled: false,
  })
  const page = await context.newPage()
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  const report = await moduleReport(page)
  check(
    'no JavaScript: the preview and the real link are in the HTML, and no iframe',
    report?.state === 'preview' &&
      report.previewVisible &&
      report.cta?.href === EXPECTED.tiktok &&
      report.iframes === 0,
    JSON.stringify({ state: report?.state, cta: report?.cta?.href, iframes: report?.iframes }),
  )
  await context.close()
}

// ── 6. Every width: the fallback fits, and nothing widens the page ──────────
for (const width of [1920, 1440, 768, 430, 390, 360]) {
  const phone = width < 768
  const context = await browser.newContext({
    viewport: { width, height: phone ? 844 : 1000 },
    deviceScaleFactor: phone ? 3 : 2,
    hasTouch: phone,
    isMobile: phone,
  })
  const page = await context.newPage()
  await page.route(EMBED_DOC, (r) =>
    r.fulfill({ status: 503, contentType: 'text/plain', body: 'overload-protect triggered' }),
  )
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await settled(page)
  await reachTikTok(page)
  await moduleSettled(page, 12000)
  await page.waitForTimeout(600)

  const metrics = await page.evaluate(() => {
    const block = document.querySelector('.k-tiktok')
    const preview = block?.querySelector('.k-tiktok-preview')
    const cta = block?.querySelector('a[href*="tiktok.com"]')
    const rect = block?.getBoundingClientRect()
    const box = cta?.getBoundingClientRect()
    return {
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
      width: Math.round(rect?.width ?? 0),
      height: Math.round(rect?.height ?? 0),
      previewHeight: Math.round(preview?.getBoundingClientRect().height ?? 0),
      ctaHeight: Math.round(box?.height ?? 0),
      ctaInside: Boolean(box && rect && box.right <= rect.right + 1 && box.left >= rect.left - 1),
      state: block?.getAttribute('data-state'),
    }
  })
  check(
    `${width}: no horizontal overflow with the TikTok module`,
    metrics.scroll <= metrics.inner + 1,
    `${metrics.scroll} vs ${metrics.inner}`,
  )
  check(
    `${width}: the module fits its column and reserves a real footprint`,
    metrics.width > 0 && metrics.width <= metrics.inner && metrics.previewHeight >= 240,
    `${metrics.width}x${metrics.height}px (preview ${metrics.previewHeight}px)`,
  )
  check(
    `${width}: the profile action is a full touch target inside the plate`,
    metrics.ctaHeight >= 44 && metrics.ctaInside,
    `${metrics.ctaHeight}px tall, inside=${metrics.ctaInside}`,
  )
  await shoot(page, `tiktok-unavailable-${width}`)
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
