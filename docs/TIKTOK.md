# TikTok

The homepage shows recent clips from <https://www.tiktok.com/@the_kanjo> using
TikTok's **official Creator Profile Embed**.

**No TikTok developer credentials are required**, and none are configured.

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
is **already ours**. The embed does it with a blockquote and a script tag.

The brief's own framing, and the right call.

---

## What is NOT done

- **No scraping.** TikTok HTML is never fetched or parsed.
- **No proxying.** No TikTok video is downloaded, re-hosted or served by us.
- **No third-party scraper library.**
- **No arbitrary HTML from content.** See below — this is the part that matters.

---

## How it is built, and why that is safe

The embed is a `<blockquote class="tiktok-embed">` carrying `cite` and
`data-unique-id`, which TikTok's `embed.js` finds and replaces with an iframe.
Both attributes derive from the profile handle — and **the handle comes from
admin-editable content**.

So the handle is validated on the server, and the markup is constructed by our
own component from the validated value:

```
content (admin)  →  tikTokHandle()  →  ^[A-Za-z0-9_.]{2,24}$  →  <blockquote>
```

`lib/tiktok/profile.ts` returns either a string matching that character class
or `null`. Nothing else can reach the embed.

**There is no `dangerouslySetInnerHTML` anywhere in this path**, and no HTML
returned by any API is inserted into the page. An admin cannot introduce a
script tag through this route, because there is no route: the only thing that
crosses the boundary is a handle. `npm run test:tiktok` covers the injection
attempts explicitly.

The admin also refuses to *store* an invalid profile URL, so the failure is
reported when someone pastes it rather than silently at render time.

---

## Loading

`embed.js` pulls in more bytes than the rest of the homepage put together, so
it waits for **two** gates:

1. **The loader has finished.** Measured without this: the section sits within
   the observer's margin of the viewport on a 1440×900 screen, so the observer
   fired on mount and `embed.js` was requested *while the night highway was
   still animating* — competing with the one animation the visitor is actually
   watching. "Is it near the viewport" is not the same question as "is the page
   ready for it".
2. **The section is near the viewport.** One `IntersectionObserver` with a
   400px margin, disconnected the moment it fires.

It loads **exactly once**. `next/script` dedupes by `id` and the state is a
one-way latch, so neither a re-render nor a client-side navigation back to the
page can inject a second copy or re-run initialisation. Verified by
`scripts/check-integrations.mjs`, including across three navigation round trips.

No polling, no scroll listener, no hover trigger.

---

## When TikTok is unavailable

The `<section>` inside the blockquote is what a visitor sees until TikTok's
script replaces it — and what they keep seeing if TikTok is blocked, slow, or
unreachable. So it is not a spinner: it is the **FOLLOW ON TIKTOK** link,
styled like the rest of the site.

That is also the official pattern: the blockquote's own content is TikTok's
documented fallback.

**There is no state in which this block is an empty black rectangle.** The
check suite tests it with every `*.tiktok.com` request aborted.

---

## Console noise

Once TikTok's iframe is on the page it produces console errors of its own —
CORS failures and a 403 against `mon.tiktokv.com`, their analytics endpoint —
plus a permissions-policy warning, because their injected iframe declares
`allow="accelerometer"` and this site does not delegate that feature.

All of it originates inside a cross-origin frame, none of it is ours, and the
embed works regardless. Delegating a motion sensor to a third party to silence
a warning would be a worse trade than the warning.

The browser checks attribute console output **by frame**, so this noise does
not mask a real error in our own document. See `scripts/check-motion.mjs`.

---

## Styling

The iframe's interior is cross-origin and cannot be themed. Measured, it is a
~1354×560 **white** rectangle in the middle of a black title screen, which
reads as a broken image rather than as a panel.

So it is **framed, not restyled**: the canon's panel treatment (divider edge,
left rule, panel fill, padding) around the outside. No width, no height, no
fixed desktop size — the iframe inside stays exactly as responsive as TikTok
made it, and `.k-tiktok` reserves a `min-height` floor so the footer does not
leap up the page when the embed resolves.

Verified at 430, 390 and 360px: no horizontal overflow, and the block fits its
column.

---

## The upgrade path

If The Kanjo later wants **custom, Kanjo-styled cards** instead of TikTok's
block, the route is the **TikTok Display API**:

- scopes: `user.info.basic`, `video.list`
- requires: a TikTok developer app, Login Kit configuration, and app review
- then: an adapter under `lib/tiktok/` returning a reduced `TikTokVideo[]`, the
  same shape of thing `lib/patreon` and `lib/youtube` already do

The content model anticipates it: `TikTokConfig.mode` exists for exactly this,
and `'display-api'` would be the second value. The section component chooses
the renderer; nothing else changes.

**It is not needed for V1**, and the type does not pretend it is implemented.
