# Media workflow

How to prepare and add real media. Adding footage is a **content operation** —
copy a file into a folder, edit one entry, done. No component is touched.

```
1. export the asset to public/media/<folder>/
2. edit one entry in content/*.json (or an article's frontmatter)
3. npm run test:media          → confirms the file is where the entry says
4. npm run check               → typecheck, lint, tests, production build
```

Folders and what refers to them: [`public/media/README.md`](../../public/media/README.md).
What is still missing: [`CONTENT_REQUIRED.md`](CONTENT_REQUIRED.md).

---

## Night images: read this before exporting anything

The Kanjo is almost entirely dark: near-black sky and asphalt, small intense
road lights, headlights and taillights, halation around them, and dark car paint
whose form is carried by very shallow gradients. That combination is the worst
case for every default compression setting, and the failures are specific:

| Failure | What causes it | What it looks like |
|---|---|---|
| **Banding** | 8-bit quantisation plus aggressive quality reduction across a shallow gradient | Concentric steps in the sky and along a fading wall |
| **Crushed blacks** | "Auto levels", "auto contrast", or an exporter clipping below ~16/255 | The road and the car merge into one flat black; detail simply gone |
| **Blocked gradients** | JPEG 8×8 blocks becoming visible in low-contrast areas | Faint square grid in dark, smooth regions |
| **Mosquito noise** | Ringing around a high-contrast edge — exactly a bright light against black | A shimmering halo of speckles around every lamp and taillight |
| **Over-sharpening** | A resize filter with sharpening on, or an export "sharpen for web" | Bright outlines on light sources; halation turns crunchy |

### The rules that follow

1. **Never auto-anything.** No auto levels, auto contrast, auto colour, auto
   tone. It will lift the blacks or clip them, and either destroys the look.
2. **Export at quality 82–90 for JPEG, not 70.** The usual "75 is fine for the
   web" advice is derived from daylight photography. On a night frame, 75 puts
   visible blocks in the sky. If a file is too big at 85, reduce the
   *resolution*, not the quality.
3. **Resize with a Lanczos/bicubic filter and sharpening OFF.** Halation is
   already in the render; sharpening it produces rings.
4. **Prefer 4:4:4 chroma if the exporter offers it**, or accept 4:2:0 but check
   the taillights — red on black is where chroma subsampling shows first.
5. **Check the export at 100% against the original, in a dark room**, looking
   specifically at: the sky gradient, one lamp's halo, and the darkest panel of
   the car. Those three tell you everything.
6. **Do not dither or add grain to hide banding.** It survives compression badly
   and reads as noise on an OLED phone.
7. **PNG is a legitimate answer for a frame that will not survive JPEG.** A
   dark, smooth frame can compress smaller as PNG than a quality-90 JPEG, with no
   artefacts at all. Try both and keep the smaller.

The site serves modern formats automatically: Next's image optimizer converts to
WebP (and AVIF where enabled) at request time, so **your source file should be a
high-quality master, not a pre-squeezed one**. Do not double-compress — export
once, well, and let the optimizer derive the rest.

---

## Hero image

`content/sections.json` → `hero.config.background`, `kind: "image"`.

| | Recommendation |
|---|---|
| Resolution | **2560 × 1440** (16:9). 1920 × 1080 is acceptable; above 2560 is wasted |
| Format | JPEG q85–90, or PNG if the frame bands (see above) |
| Target size | **≤ 400 KB** after export |
| Colour | sRGB, embedded profile |
| Intrinsic dims | Put the **real** pixel dimensions in `width`/`height` — they reserve the space |

### Safe composition area

The hero crops the image to the viewport and the UI group sits over the **lower
third**. So:

- **Keep the subject in the upper two thirds.** A car framed low will sit behind
  the title.
- **Leave the lower-left quarter uneventful.** That is where the status line,
  title, subtitle, description and action cards land.
- **Expect the sides to be lost on a phone.** A 16:9 frame cropped to a portrait
  viewport keeps roughly the middle third of its width.
- The `dim` treatment darkens the bottom to about 82% black, so detail down
  there will not read anyway.

### Framing without re-exporting

```json
"objectPosition": "center 35%",
"mobileObjectPosition": "center 55%"
```

Plain CSS `object-position`. First value horizontal, second vertical; `35%` pulls
the crop toward the top of the image, `70%` toward the bottom. Try this **before**
producing a second crop — it usually solves it.

`mobileImage` exists for the case where the desktop frame genuinely cannot
survive a portrait crop. Supply it at **1440 × 1800** (4:5) or similar, and only
then.

---

## Hero video

`kind: "video"`, `videoSources`, `poster`.

| | Recommendation |
|---|---|
| Resolution | **1920 × 1080**. A background loop gains nothing from 4K |
| Duration | **8–12 s**, seamlessly looping |
| Frame rate | **30 fps**. 60 doubles the file for motion nobody studies |
| Container / codec | **MP4 / H.264 High profile** always; add **WebM / VP9** if you can |
| Bitrate | 3–5 Mbps VBR two-pass for H.264; 2–3 Mbps for VP9 |
| Target size | **≤ 3 MB** for the MP4. This is a background, not the feature |
| Audio | **Strip it entirely.** The element is muted, so an audio track is bytes nobody can hear |
| Poster | **Mandatory.** Same spec as the hero image, and it should be a frame *from the loop* |

Make the loop seamless in the edit — first and last frames matching — rather
than relying on a crossfade. A visible cut every ten seconds is worse than no
loop.

**What the site does with it:** `muted`, `loop`, `playsInline`,
`preload="none"`, no controls, not focusable. The poster is a separate
server-rendered layer, so it is the first paint and there is no layout shift when
the loop starts. Under `prefers-reduced-motion` the video element is **not
rendered at all** and the file is never requested — verified in the browser, not
assumed. There is no player library.

### ffmpeg, if you have it

```bash
# MP4 / H.264, 30fps, no audio
ffmpeg -i source.mov -an -c:v libx264 -profile:v high -preset slow \
  -b:v 4M -maxrate 5M -bufsize 8M -vf "fps=30,scale=1920:-2:flags=lanczos" \
  -pix_fmt yuv420p -movflags +faststart loop.mp4

# WebM / VP9
ffmpeg -i source.mov -an -c:v libvpx-vp9 -b:v 2.5M -row-mt 1 \
  -vf "fps=30,scale=1920:-2:flags=lanczos" loop.webm

# Poster from a chosen second
ffmpeg -i loop.mp4 -ss 00:00:02 -frames:v 1 -q:v 2 loop-poster.jpg
```

`-movflags +faststart` matters: without it the index sits at the end of the file
and playback waits for the whole download.

---

## Screenshots

`content/media.json`. Six reservations already exist; fill them in.

| | Recommendation |
|---|---|
| Count for V1 | **6.** Fewer reads as a placeholder set; the grid is built for 3 + 3 |
| Resolution | **1920 × 1080** |
| Aspect ratio | **16:9, and the same for all six.** Mixed ratios give a ragged grid |
| Format | JPEG q85–90, or PNG for a frame that bands |
| Target size | **≤ 400 KB** each |
| Alt text | **Required**, 60–120 characters, describing what is actually in the frame |
| Caption | Optional, ≤ 80 characters |

The grid shows each at ~442 px wide, and clicking one opens it to the viewport —
so these are viewed **both** small and large. Compose for the thumbnail (one
clear subject, not a busy wide shot) and export for the full view.

Only the first is loaded eagerly; the rest lazy-load. The viewer requests a
larger derivative of the same source, so nothing is downloaded twice.

---

## Featured video

`content/videos.json`.

**Local clip** (`provider: "file"`) — preferred: no third-party script, no
cookies, no consent question.

| | Recommendation |
|---|---|
| Resolution | **1920 × 1080** |
| Duration | 30–90 s |
| Frame rate | 30 or 60 fps — this one is watched, so 60 is justified for gameplay |
| Codec | H.264 High in MP4, plus VP9 in WebM if you can |
| Bitrate | 8–12 Mbps for 1080p60 gameplay; 6–8 for 30 fps |
| Audio | **Keep it.** Somebody pressing PLAY wants the engine note. AAC 160 kbps stereo |
| Poster | Mandatory, 1920 × 1080, a frame from the clip |

Put the MP4 in `ref` and the WebM in `sources`. Nothing is fetched until the
visitor presses PLAY; the native `<video>` element provides controls, fullscreen
and Picture-in-Picture.

**External clip** (`provider: "youtube"` / `"vimeo"`) — `ref` is the **bare id**,
not a watch URL. A poster is still required, and the provider's script only loads
after PLAY is pressed.

---

## Article images

Article covers and in-body images. Files go in `public/media/articles/`.

| | Recommendation |
|---|---|
| In-body width | **1860 px** (twice the 930 px reading column) |
| Cover | **1920 × 1080** |
| Format | JPEG q85, or PNG for dark gradients |
| Target size | ≤ 300 KB |

- A cover needs `cover`, `coverWidth`, `coverHeight` and `coverAlt` in the
  frontmatter. **Dimensions are mandatory** — the parser throws without them,
  because they are what reserves the space.
- In-body images use `![alt text](/media/articles/name.jpg)` alone on a line.
- **Alt describes the content; caption adds information.** If an image is purely
  decorative, `alt=""` is correct and better than repeating the caption.

---

## OpenGraph / share image

Two ways; the first is preferred.

**1. File convention (recommended).** Put a PNG at `app/opengraph-image.png` and
Next generates the tags automatically, including the absolute URL. Add
`app/twitter-image.png` for a different crop, or omit it and Twitter uses the OG
image.

**2. Content field.** `content/site.json` → `seo.defaultSocialImage`, pointing at
`/media/og/…`. Use this if the image should be editable as content.

| | Recommendation |
|---|---|
| Dimensions | **1200 × 630** exactly (1.91:1) |
| Format | PNG, or JPEG q90 |
| Target size | ≤ 300 KB |
| Content | The wordmark plus one strong frame. **Keep text out of the outer 60 px** — crops vary by platform |

Without this, every shared link previews with no image. It is the cheapest
high-impact asset on the list.

---

## Favicon and app icons

App Router file conventions, all in `app/`:

| File | Size | Purpose |
|---|---|---|
| `app/icon.png` | **512 × 512** | The browser tab icon; Next derives smaller sizes |
| `app/apple-icon.png` | **180 × 180** | iOS home screen. No transparency — iOS composites on white |
| `app/favicon.ico` | 32 × 32 (+16) | Only for very old browsers; `icon.png` covers the rest |

`icon.png` alone is enough to start.

**Design note:** the icon is 16 px in a tab. A wordmark is unreadable there — use
a single mark. Because the site's background is `#000003`, an icon with a
transparent background disappears in dark browser chrome, so give it an explicit
background.

**None of these exist yet, and no placeholder has been created for them.** A
recognisable-looking fake would be worse than the browser default: it could be
mistaken for the real brand and get copied into a store page. Leaving them absent
is the deliberate choice.

---

## Checking your work

```bash
npm run test:media   # every published entry points at a file that exists
npm run check        # typecheck, lint, all tests, production build
```

`test:media` reports three things: **errors** (a published entry pointing at a
missing file — this fails the build), **awaiting** (an unpublished reservation
whose file is not there yet — expected), and what is actually present in
`public/media/`.

For the browser-level media checks — no request on hover, no request while
idling, no refetch when navigating, no duplicate loop in the viewer, and no
video fetched under reduced motion — see
[`scripts/check-media-requests.mjs`](../scripts/check-media-requests.mjs).
