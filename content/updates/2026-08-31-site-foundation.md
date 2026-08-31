---
title: The site, and where its design comes from
publishedAt: 2026-08-31
author: Daineku
tags: [site, design]
featured: true
excerpt: This site is not designed. It is transcribed — from the game's own UI canon, token for token.
---

This is the first entry, and it is about the site rather than the game.

## The design is not new

The Kanjo already has a design language. It lives in the game repository as a
canon: a set of token files, component specifications, layout rules and font
sources, with a validator that checks the runtime against them.

So this site did not need a visual direction. It needed a transcription. Every
colour, every type size, every duration on this page is a value read out of that
canon:

- the near-black background, the panel fill at one tenth opacity, and the green
  used for a selected item
- **Big Shoulders Display** for anything in a display role and **Iceland** for
  anything technical, served from the same open-licensed font binaries the game
  bakes its own font assets from
- the nine-pixel red corner brackets that mark a slot with nothing in it yet
- transitions at ninety milliseconds, because that is what the canon budgets for
  a selection change

## The card is the game's card

The block that carries a heading and a subtitle here — a band across the top, a
rule down the left edge, a faint panel behind it — is the same construction the
game uses for a menu item. Its states are the same too. Normal is the divider
grey. Selected is green. Hover and keyboard focus share one brighter green,
applied *on top of* selection rather than instead of it, so an item you have
arrowed onto does not stop looking chosen.

That last detail is not a stylistic preference. It is a decision recorded in the
game's own implementation, alongside a note explaining that three sources in the
canon disagreed about it and that six reference screenshots settled the
argument.

## What is not here yet

Quite a lot, deliberately.

There are no screenshots on this site, because none have been captured for it.
There is no trailer, no store page, no release date and no platform list —
because none of those have been announced, and a placeholder that reads like an
announcement is worse than an empty section.

Where something is missing, the page says so and shows the game's own treatment
for a slot that is waiting to be filled.

---

Development updates will appear here as there is something worth writing about.
