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
 * Set SHOTS=<dir> to also write screenshots of the TikTok section in every
 * tested state and width.
 *
 * WHAT IT IS LOOKING FOR, and why each one is here:
 *
 *  1. EVERY BLOCK IS STRUCTURALLY COMPLETE WITHOUT ITS PROVIDER. With no
 *     credentials each block must render a real, clickable destination rather
 *     than an empty frame, a spinner or an error.
 *
 *  2. THE TIKTOK SCRIPT LOADS EXACTLY ONCE, EVER — across a full-page scroll
 *     AND a client-side navigation round trip, where the resident runtime must
 *     be reused rather than the script re-fetched. And not during the loader.
 *
 *  3. TIKTOK HAS EXACTLY TWO VISIBLE OUTCOMES. The official embed, revealed
 *     only on the render signal TikTok's own library sizes the iframe from; or
 *     one compact link, "Open @TheKanjo on TikTok ↗", with the provider
 *     removed. Each failure is simulated at the network layer — blocked, 403,
 *     429, 503 overload-protect, a 200 whose body is an error, and a request
 *     never answered — and success is simulated with a document that posts
 *     the render signal, so both paths are exercised without depending on
 *     TikTok's ingress at test time.
 *
 *  4. NO HORIZONTAL OVERFLOW, and a fallback that neither stretches nor
 *     leaves a blank frame, from 360 to 1920.
 *
 * ON THE IFRAME: its interior is cross-origin and is NEVER inspected here.
 * Page text is not trusted to prove an error is hidden — text inside a
 * cross-origin frame is not in `document.body.innerText`. "Not on screen" is
 * measured from the outside: the module's state, whether the iframe exists,
 * computed styles, geometry, and which element is under the pointer.
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
const LINK_TEXT = 'Open @TheKanjo on TikTok ↗'.replace(/\s+/g, '')

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

/** Waits for the module to leave `loading`. */
async function moduleSettled(page, timeout = 14000) {
  await page
    .waitForFunction(
      () => {
        const state = document.querySelector('.k-tiktok')?.getAttribute('data-state')
        return state === 'live' || state === 'fallback'
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
    const provider = block.querySelector('.k-tiktok-provider')
    const iframe = block.querySelector('iframe')
    const link = block.querySelector('a.k-tiktok-link')
    const rect = block.getBoundingClientRect()
    const visible = (node) => {
      if (!node) return false
      let el = node
      while (el && el !== document.body) {
        const style = getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.01) {
          return false
        }
        el = el.parentElement
      }
      const box = node.getBoundingClientRect()
      return box.width > 0 && box.height > 0
    }
    // An iframe is reachable by keyboard unless it, or an ancestor, is inert,
    // hidden, or absent.
    const focusable = (node) =>
      Boolean(node) && !node.closest('[inert]') && getComputedStyle(node).visibility !== 'hidden'

    const linkBox = link?.getBoundingClientRect()
    const hitAt = (x, y) => document.elementFromPoint(x, y)
    const linkHit = linkBox
      ? hitAt(linkBox.left + linkBox.width / 2, linkBox.top + linkBox.height / 2)
      : null
    const centreHit = hitAt(
      rect.left + rect.width / 2,
      rect.top + Math.min(rect.height / 2, window.innerHeight / 2),
    )
    const linkStyle = link ? getComputedStyle(link) : null
    return {
      state: block.getAttribute('data-state'),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      providerPresent: Boolean(provider),
      iframes: block.querySelectorAll('iframe').length,
      iframeVisible: visible(iframe),
      iframeFocusable: focusable(iframe),
      centreIsIframe: centreHit?.tagName === 'IFRAME',
      link: link
        ? {
            href: link.getAttribute('href'),
            target: link.getAttribute('target'),
            // The gap before the arrow is CSS, so compare without whitespace.
            text: link.textContent.replace(/\s+/g, ''),
            visible: visible(link),
            onTop: Boolean(linkHit?.closest('a.k-tiktok-link')),
            width: Math.round(linkBox.width),
            height: Math.round(linkBox.height),
            centreOffset: Math.round(
              Math.abs(linkBox.left + linkBox.width / 2 - (rect.left + rect.width / 2)),
            ),
            lineHeight: parseFloat(linkStyle.lineHeight) * 1 || 0,
            fontSize: parseFloat(linkStyle.fontSize),
            inside: linkBox.left >= rect.left - 1 && linkBox.right <= rect.right + 1,
          }
        : null,
      // Kept only as a secondary check: it cannot see into the iframe.
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

/**
 * A document that behaves as TikTok's application does when it has rendered:
 * it posts the height message TikTok's own library sizes the iframe from,
 * addressed by the iframe's `name` (`__tt_embed__<blockquote id>`).
 */
const SIMULATED_PROFILE =
  '<!doctype html><html><body style="margin:0;background:#fff;color:#111;font:16px sans-serif">' +
  '<div style="height:640px;padding:24px">simulated creator profile</div>' +
  '<script>addEventListener("load", () => parent.postMessage(JSON.stringify({signalSource: window.name, height: 640}), "*"))</script>' +
  '</body></html>'

const serveSimulatedProfile = (page) =>
  page.route(EMBED_DOC, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: SIMULATED_PROFILE }))

// ── 1. The unconfigured state is complete and clickable ──────────────────────
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  /**
   * CONSOLE ERRORS ARE ATTRIBUTED BY FRAME, NOT COLLECTED BLINDLY. Once
   * TikTok's iframe is on the page it produces console errors of its own (CORS
   * and a 403 against its analytics endpoint, a permissions-policy warning).
   * None of it is ours; anything from our own origin still fails the test.
   */
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const frameUrl = m.location()?.url ?? ''
    if (/tiktok(cdn|v)?\.com|byteoversea|ibyteimg|ipstatp/.test(frameUrl)) return
    if (/Permissions policy violation: accelerometer/.test(m.text())) return
    // The provider's own 503 is reported as a failed resource load on the top
    // document. It is what the module exists to contain.
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
  check(
    'NO Steam URL has been invented',
    !hrefs.some((h) => h && /steampowered|steamcommunity/i.test(h)),
    hrefs.filter((h) => h && /steam/i.test(h)).join(', '),
  )
  check(
    'no PLACEHOLDER text is rendered',
    !(await page.evaluate(() => /\bplaceholder\b/i.test(document.body.innerText))),
  )

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

// ── 2. The TikTok script: once, late, and reused across navigation ───────────
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await serveSimulatedProfile(page)
  const embedRequests = []
  const documentRequests = []
  page.on('request', (r) => {
    if (EMBED_JS.test(r.url())) embedRequests.push(r.url())
    if (EMBED_DOC.test(r.url())) documentRequests.push(r.url())
  })

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  check(
    'TikTok embed.js is NOT fetched during the loader',
    embedRequests.length === 0,
    `${embedRequests.length}`,
  )

  await settled(page)
  const before = await moduleReport(page)
  check(
    'before the section is reached: the link only, and nothing asked',
    before?.state === 'loading' &&
      embedRequests.length === 0 &&
      // Present, not yet visible: the section's GSAP reveal has not run.
      before.link?.href === EXPECTED.tiktok &&
      !before.iframeVisible,
    JSON.stringify({ state: before?.state, requests: embedRequests.length }),
  )

  await reachTikTok(page)
  await moduleSettled(page)
  check('TikTok embed.js is fetched once the section is reached', embedRequests.length === 1, `${embedRequests.length}`)
  check(
    'exactly one TikTok script tag in the DOM',
    (await page.evaluate(() => document.querySelectorAll('script[src*="tiktok.com/embed"]').length)) === 1,
  )

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

  // Away and back on the client: a new blockquote, the resident runtime.
  await page.click('footer a[href="/privacy"]')
  await page.waitForURL('**/privacy', { timeout: 10000 })
  await page.waitForTimeout(400)
  await page.goBack()
  await page.waitForTimeout(800)
  await settled(page)
  await reachTikTok(page)
  await moduleSettled(page)
  await page.waitForTimeout(500)

  check(
    'a round trip fetches embed.js zero more times',
    embedRequests.length === 1,
    `${embedRequests.length} request(s)`,
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
    state: document.querySelector('.k-tiktok')?.getAttribute('data-state'),
  }))
  check('script tags never stack', afterNav.scripts === 1, `${afterNav.scripts}`)
  check(
    'after navigating back: one embed, one iframe, live again',
    afterNav.blockquotes === 1 && afterNav.iframes === 1 && afterNav.state === 'live',
    JSON.stringify(afterNav),
  )
  await context.close()
}

// ── 3. The provider's failures, one by one ───────────────────────────────────
/**
 * Each scenario routes TikTok's embed DOCUMENT (the iframe's URL) to a
 * controlled answer and leaves embed.js, the library and its stylesheet to
 * the real network. 'blocked' aborts every TikTok host instead — the ad
 * blocker / blocked-region case — and 'script timeout' never answers embed.js.
 */
const ERROR_PAGE = '<!doctype html><html><body><p>overload-protect triggered</p></body></html>'
const FAILURES = [
  {
    name: '503 overload-protect',
    route: (page) =>
      page.route(EMBED_DOC, (r) =>
        r.fulfill({ status: 503, contentType: 'text/plain', body: 'overload-protect triggered' }),
      ),
  },
  {
    name: '403',
    route: (page) =>
      page.route(EMBED_DOC, (r) => r.fulfill({ status: 403, contentType: 'text/plain', body: 'Forbidden' })),
  },
  {
    name: '429',
    route: (page) =>
      page.route(EMBED_DOC, (r) =>
        r.fulfill({ status: 429, contentType: 'text/plain', body: 'Too Many Requests' }),
      ),
  },
  {
    name: '200 with an error page',
    route: (page) =>
      page.route(EMBED_DOC, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: ERROR_PAGE })),
  },
  {
    name: 'blocked',
    route: (page) => page.route('**://*.tiktok.com/**', (r) => r.abort()),
  },
  {
    name: 'script timeout',
    route: (page) => page.route(EMBED_JS, () => {}),
  },
  {
    name: 'document timeout',
    route: (page) => page.route(EMBED_DOC, () => {}),
  },
]

for (const failure of FAILURES) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const embedRequests = []
  const documentRequests = []
  page.on('request', (r) => {
    if (EMBED_JS.test(r.url())) embedRequests.push(r.url())
    if (EMBED_DOC.test(r.url())) documentRequests.push(r.url())
  })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
  await failure.route(page)

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await settled(page)
  await reachTikTok(page)
  const askedAt = Date.now()
  await moduleSettled(page, 12000)
  const settledIn = Date.now() - askedAt
  // Then wait on: nothing may ask again by itself.
  await page.waitForTimeout(2500)

  const report = await moduleReport(page)
  const label = `TikTok ${failure.name}`
  check(`${label}: reaches fallback, by itself`, report?.state === 'fallback', `state=${report?.state}, ${settledIn}ms`)
  check(`${label}: settles within the 8s ceiling`, settledIn <= 9000, `${settledIn}ms`)
  check(
    `${label}: the provider is removed — no iframe, nothing visible or focusable`,
    !report?.providerPresent && report?.iframes === 0 && !report?.iframeVisible && !report?.iframeFocusable,
    JSON.stringify({ provider: report?.providerPresent, iframes: report?.iframes }),
  )
  check(
    `${label}: the link is the one thing shown, on top, pointing at the profile`,
    report?.link?.visible === true &&
      report.link.onTop &&
      report.link.href === EXPECTED.tiktok &&
      report.link.target === '_blank' &&
      report.link.text === LINK_TEXT,
    JSON.stringify(report?.link && { href: report.link.href, text: report.link.text, onTop: report.link.onTop }),
  )
  check(
    `${label}: no oversized container — the block is the link's height`,
    // The link plus the 8px kept for its focus ring.
    (report?.height ?? 999) <= (report?.link?.height ?? 0) + 10,
    `block ${report?.height}px, link ${report?.link?.height}px`,
  )
  check(
    `${label}: the link does not stretch`,
    (report?.link?.width ?? 9999) < Math.min(420, (report?.width ?? 0) * 0.6) &&
      (report?.link?.centreOffset ?? 99) <= 2,
    `link ${report?.link?.width}px in a ${report?.width}px column, offset ${report?.link?.centreOffset}px`,
  )
  check(`${label}: no provider wording in the page`, !/overload-protect/i.test(report?.bodyText ?? ''))
  check(`${label}: no page error`, errors.length === 0, errors.slice(0, 2).join(' | '))
  check(
    `${label}: one ask, no retry`,
    embedRequests.length <= 1 && documentRequests.length <= 1,
    `${embedRequests.length} script, ${documentRequests.length} document request(s)`,
  )
  check(
    `${label}: no retry control`,
    (await page.locator('#tiktok button').count()) === 0 &&
      (await page.locator('#tiktok a').count()) === 1,
  )
  await shoot(page, `fallback-${failure.name.replace(/\W+/g, '-')}-1440`)

  if (failure.name === '503 overload-protect') {
    // Keyboard: the link takes focus and shows it; the module offers nothing else.
    await page.focus('a.k-tiktok-link')
    const focus = await page.evaluate(() => {
      const a = document.activeElement
      const s = getComputedStyle(a)
      return { isLink: a?.classList.contains('k-tiktok-link'), outline: s.outlineStyle, width: s.outlineWidth }
    })
    check(
      `${label}: keyboard focus lands on the link with a visible focus ring`,
      focus.isLink && focus.outline !== 'none' && parseFloat(focus.width) >= 2,
      JSON.stringify(focus),
    )
    await shoot(page, 'fallback-focus-1440')
  }
  await context.close()
}

// ── 4. The provider's success, simulated ─────────────────────────────────────
for (const width of [1440, 390]) {
  const phone = width < 768
  const context = await browser.newContext({
    viewport: { width, height: phone ? 844 : 900 },
    isMobile: phone,
    hasTouch: phone,
  })
  const page = await context.newPage()
  await serveSimulatedProfile(page)
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await settled(page)
  await reachTikTok(page)
  await moduleSettled(page)
  await page.waitForTimeout(900)

  const report = await moduleReport(page)
  const label = `${width}: TikTok rendered`
  check(`${label}: live on the render signal`, report?.state === 'live', `state=${report?.state}`)
  check(
    `${label}: the official embed is on screen, reachable, and the fallback link is not shown`,
    Boolean(report?.iframeVisible) && report?.iframeFocusable && report?.centreIsIframe && !report?.link,
    JSON.stringify({
      iframeVisible: report?.iframeVisible,
      focusable: report?.iframeFocusable,
      centreIsIframe: report?.centreIsIframe,
      link: Boolean(report?.link),
    }),
  )
  check(`${label}: the module took the reported height`, (report?.height ?? 0) >= 300, `${report?.height}px`)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check(`${label}: no horizontal overflow`, overflow <= 1, `${overflow}px`)
  await shoot(page, `live-simulated-${width}`)
  await context.close()
}

// ── 5. A signal that is not ours is not success ──────────────────────────────
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  // The embed document is the error page; the PARENT receives a well-formed
  // signal naming the right blockquote — but not from the iframe's window.
  await page.route(EMBED_DOC, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: ERROR_PAGE }))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await settled(page)
  await reachTikTok(page)
  await page.waitForFunction(() => document.querySelector('.k-tiktok iframe'), null, { timeout: 8000 }).catch(() => {})
  await page.evaluate(() => {
    const iframe = document.querySelector('.k-tiktok iframe')
    window.postMessage(JSON.stringify({ signalSource: iframe?.name ?? '', height: 640 }), '*')
  })
  await moduleSettled(page, 12000)
  const report = await moduleReport(page)
  check(
    'a forged signal from another window does not reveal the iframe',
    report?.state === 'fallback' && report.iframes === 0,
    `state=${report?.state}`,
  )
  await context.close()
}

// ── 6. Without JavaScript ────────────────────────────────────────────────────
{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    javaScriptEnabled: false,
  })
  const page = await context.newPage()
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  const report = await moduleReport(page)
  check(
    'no JavaScript: the link is in the HTML, visible, and no iframe',
    report?.link?.visible === true &&
      report.link.href === EXPECTED.tiktok &&
      report.link.text === LINK_TEXT &&
      report.iframes === 0,
    JSON.stringify({ state: report?.state, link: report?.link?.href, iframes: report?.iframes }),
  )
  await context.close()
}

// ── 7. Every width: the fallback is compact, and nothing widens the page ────
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
  await page.waitForTimeout(400)

  const report = await moduleReport(page)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check(`${width}: fallback reached`, report?.state === 'fallback', `state=${report?.state}`)
  check(`${width}: no horizontal overflow`, overflow <= 1, `${overflow}px`)
  check(
    `${width}: the link is a 44px touch target on one line, inside its column`,
    (report?.link?.height ?? 0) >= 44 &&
      (report?.link?.height ?? 99) < (report?.link?.fontSize ?? 0) * 2.4 + 12 &&
      report?.link?.inside === true,
    `${report?.link?.width}x${report?.link?.height}px, font ${report?.link?.fontSize}px`,
  )
  check(
    `${width}: the link keeps its content width and is centred`,
    (report?.link?.width ?? 9999) < Math.min(420, (report?.width ?? 0) * 0.92) &&
      (report?.link?.centreOffset ?? 99) <= 2,
    `link ${report?.link?.width}px of ${report?.width}px, offset ${report?.link?.centreOffset}px`,
  )
  await shoot(page, `fallback-${width}`)
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
