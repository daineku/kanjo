# TikTok

The homepage shows recent clips from <https://www.tiktok.com/@the_kanjo> using
TikTok's **official Creator Profile Embed** — inside a module the site owns, so
the page never depends on TikTok answering.

**No TikTok developer credentials are required**, and none are configured.

---

## The failure this module exists for

TikTok's anonymous embed ingress rate-limits aggressively. Measured, from a
plain `curl` and from a headless browser alike:

```
GET https://www.tiktok.com/embed/@the_kanjo
503 Service Unavailable
overload-protect triggered
```

That is the document the embed's iframe navigates to. Three facts about it
decide the design:

1. **The iframe's `load` event fires for it** exactly as for a real profile.
2. **TikTok's own library reveals the iframe on `load`.** `embed.js` is a
   bootstrap that pulls in `embed_lib_v*.js`; that library creates the iframe
   hidden, and in its `onload` removes the blockquote's placeholder and sets
   the iframe visible — before anything has proven the document is a profile.
3. **The parent page cannot look inside.** The iframe is cross-origin; its
   status, its text and its DOM are all behind the same-origin policy.

So the previous integration — the official pattern, blockquote plus script,
with the CTA as the blockquote's own fallback content — put a one-line
provider error in the middle of the homepage whenever TikTok was overloaded,
and a working button underneath it did not make that acceptable.

---

## What the parent page CAN observe

TikTok's library sizes the iframe from a `postMessage` the embedded
application sends once it has rendered:

```
origin   https://www.tiktok.com
data     '{"signalSource":"__tt_embed__<blockquote id>","height":<px>}'
```

The library sets the iframe's `name` to `__tt_embed__<id>`, the application
posts that name back with its height, and the library resizes the iframe. The
one-line error page runs no application and posts nothing.

`lib/tiktok/signal.ts` reads exactly that message — origin checked, payload
parsed, id validated to a plain token and compared with **our** blockquote's id,
height required and positive — and nothing else. It is the closest thing to
"it rendered" that exists on the parent side, and the module treats it as the
**only** reveal condition.

**This is a heuristic, and it is a safe one.** The protocol is what TikTok's
library does today, not something in their public documentation. If it changes,
the failure is in the safe direction: no signal arrives, the preview stays, and
the visitor sees a finished block with a working link. Nothing here claims the
problem has been fixed at TikTok's end — it has not, and it cannot be from this
side.

---

## The module's states

`components/tiktok/TikTokEmbed.tsx`. One DOM, four states on `data-state`:

| State | What is on screen | What is underneath |
|---|---|---|
| `preview` | The site-owned preview: artwork, the real handle, the profile link. **Server-rendered.** | The blockquote, in a wrapper that is in layout but invisible and inert. Nothing asked. |
| `loading` | The same preview, with a quiet CONNECTING TO TIKTOK line. | The official embed, rendering into the invisible wrapper. |
| `live` | The official embed, revealed on the render signal, with the profile link under it. | The preview, faded and `visibility: hidden`. |
| `unavailable` | The preview, with one explicit TRY THE LIVE FEED AGAIN. | The wrapper, dropped from layout. |

The wrapper is in layout while loading **on purpose**: the card lays itself out
at the module's real width and reports a real height. It is `opacity: 0`,
`pointer-events: none`, `inert` and `aria-hidden`, so whatever TikTok puts in
the iframe is never on screen, never focusable and never read out until it has
proven itself.

A crawler, a visitor without JavaScript, a visitor whose extension blocks
TikTok and a visitor TikTok has rate-limited all see the same thing: the
preview.

### The preview is content, not a hardcoded image

`TikTokConfig.preview` is an editable `ImageRef` (admin: **Preview artwork**,
filed under `social/`). The intended use is an **authorised snapshot of the
real profile**. When it is empty the section falls back to the site's default
social image — genuine artwork that already exists for the same purpose. The
block says "official profile" and links to it; it never pretends to be a live
feed, and it fabricates no thumbnails, counts or captions.

---

## Loading policy

`TikTokConfig.embedLoading`:

- **`auto`** (default). The embed is asked for **once**, after both gates: the
  loader has finished (`whenStageReady`) and the section is within 120px of the
  viewport (one `IntersectionObserver`, disconnected the moment it fires). No
  scroll listener, no polling, no timer-driven retry.
- **`manual`**. TikTok is never contacted until a visitor presses VIEW THE LIVE
  FEED. The setting to choose if the provider keeps rate-limiting.

Either way the wait is bounded:

- **12 s ceiling** from the ask. Past it the module settles on `unavailable`
  and stops listening — a feed appearing under a visitor who has moved on is a
  layout shift, not an enhancement.
- **4 s of silence after the iframe's `load`.** A real profile posts its
  height almost at once; the 503 never does. This is what makes a rate-limited
  visit settle in about five seconds rather than twelve.
- A script that fails to load (blocked) or a runtime that throws settles at
  once.

**At most two asks per mount, ever**: one automatic plus one the visitor makes
explicitly (or two explicit, in manual mode). A retry mounts a fresh blockquote
— TikTok's library appends an iframe to whatever it rendered into, and asking
it to render into the same node again would stack a second iframe under the
first.

### The script: once, resident, reused

`embed.js` is appended **once per page life** and left resident. On a
client-side navigation back to the homepage the module asks the runtime the
script installed — `tiktokEmbed.lib.render([blockquote])` — to render the new
blockquote. That is the only re-scan mechanism TikTok offers and it costs no
network request. A script tag that *failed* is removed before a retry appends a
new one; one that loaded is never touched. Verified by
`scripts/check-integrations.mjs`: one `embed.js` request across a scroll pass
and a navigation round trip, one script tag, one iframe.

---

## What is NOT done

- **No scraping.** TikTok HTML is never fetched or parsed.
- **No proxying.** No TikTok video is downloaded, re-hosted or served by us.
- **No third-party scraper library, no unofficial proxy, no evasion.** The
  module reduces requests; it does not route around the rate limit.
- **No cross-origin access.** The iframe's document is never read, from the
  page or from the tests.
- **No arbitrary HTML from content.** See below.

---

## How it is built, and why that is safe

The embed is a `<blockquote class="tiktok-embed">` carrying `cite` and
`data-unique-id`, which TikTok's library finds and renders into. Both
attributes derive from the profile handle — and **the handle comes from
admin-editable content**.

So the handle is validated on the server, and the markup is constructed by our
own component from the validated value:

```
content (admin)  →  tikTokHandle()  →  ^[A-Za-z0-9_.]{2,24}$  →  <blockquote>
```

`lib/tiktok/profile.ts` returns either a string matching that character class
or `null`. Nothing else can reach the embed.

**There is no `dangerouslySetInnerHTML` anywhere in this path**, and no HTML
returned by any API is inserted into the page. `npm run test:tiktok` covers the
injection attempts explicitly, and the render-signal reader's refusals.

The admin also refuses to *store* an invalid profile URL, so the failure is
reported when someone pastes it rather than silently at render time.

---

## Sizing

TikTok's creator card lays itself out at **720px** inside the iframe. The
module holds the blockquote at that width, scales it to the module's canvas
with a transform, and sets the wrapper's height to the scaled result (a
transform does not change layout). One `ResizeObserver` on the module, keyed
on width only, so the module's own height writes cannot schedule another fit.

---

## Testing

`npm run test:tiktok` — profile validation (including the injection attempts)
and the render-signal reader.

`scripts/check-integrations.mjs`, against a production build, simulates each
failure **at the network layer** and leaves everything else to the real
network: TikTok blocked; the embed document answered with 503, 403, 429; a 200
whose body is an error; and a request never answered. In every case it asserts,
from the outside, that the module settles on `unavailable` by itself, that the
preview is the element under the pointer at the module's centre, that the
iframe is not visible, that the real profile link is, that the words
"overload-protect" do not appear in the page's own text, that exactly one
explicit retry is offered and that no more than two asks are made. Success is
simulated with a document that posts the render signal, so the reveal path is
exercised without depending on TikTok at test time. Six widths, 360 to 1920,
with screenshots under `SHOTS=<dir>`.

---

## Console noise

Once TikTok's iframe is on the page it produces console errors of its own —
CORS failures and a 403 against `mon.tiktokv.com`, their analytics endpoint —
plus a permissions-policy warning, because their injected iframe declares
`allow="accelerometer"` and this site does not delegate that feature. The 503
itself is reported by the browser as a failed resource load.

All of it originates from a cross-origin frame or from the provider's own
answer, none of it is ours, and the module is designed around it. The checks
attribute console output **by frame**, so this noise does not mask a real
error in our own document. See `scripts/check-motion.mjs`.

---

## Why the creator embed and not the Display API

Two official routes exist for putting our own public videos on our own site.

| | Creator Profile Embed | Display API |
|---|---|---|
| Developer app | not needed | required |
| Login Kit / app review | not needed | required |
| `video.list` authorisation | not needed | required |
| Stored OAuth token | none | yes, refreshed |
| Styling | TikTok's block | ours |

For V1 the Display API would mean an app review cycle and a credential to store
and rotate — to display videos that are **already public**, on the profile that
is **already ours**.

## The upgrade path

If The Kanjo later wants **custom, Kanjo-styled cards** instead of TikTok's
block — which would also remove the dependency on the embed ingress entirely —
the route is the **TikTok Display API**:

- scopes: `user.info.basic`, `video.list`
- requires: a TikTok developer app, Login Kit configuration, and app review
- then: an adapter under `lib/tiktok/` returning a reduced `TikTokVideo[]`, the
  same shape of thing `lib/patreon` and `lib/youtube` already do

The content model anticipates it: `TikTokConfig.mode` exists for exactly this,
and `'display-api'` would be the second value. The section component chooses
the renderer; the preview and the loading policy stay as they are.

**It is not needed for V1**, and the type does not pretend it is implemented.

---

## Remaining limitations, stated plainly

- The rate limit is TikTok's. When their ingress answers 503, no visitor sees
  the live feed; they see the preview. The module makes that invisible, not
  impossible.
- The render signal is observed, not documented. A change on TikTok's side
  degrades to "preview always", never to "error on screen".
- Revealing a proven embed changes the module's height once, from the
  preview's footprint to the card's. That is the one layout change the module
  makes, and it happens only on success.
