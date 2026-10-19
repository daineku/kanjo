import type { ImageRef } from '@/lib/content/types'

/**
 * The phone hero's footage: the real Civic on the night highway.
 *
 * ── WHY THIS IS CODE AND NOT CONTENT ────────────────────────────────────────
 *
 * Everything else the hero shows comes from the content source, and in
 * production that source is a Supabase row edited in the admin. This loop is
 * different in kind: it is a build artefact shipped in `public/`, encoded from
 * footage that is not in the repository, and it exists at exactly one place on
 * the site. Making it a content field would mean the mobile hero stays on the
 * old still until somebody also edits the production row — a deploy that looks
 * finished and is not. So it is declared here, next to the files it names, and
 * the hero applies it below the phone breakpoint whenever it has a desktop
 * still to pair it with.
 *
 * ── THE ASSETS ──────────────────────────────────────────────────────────────
 *
 * Source: VIDEOS/video.MOV, 720x1260, 30 fps, 16.8 s, H.264 at 3.4 Mb/s with a
 * silent AAC track (7.2 MB). Not served, not committed — see .gitignore.
 *
 * mobile-loop.mp4 — the same 720x1260 frame (no scaling, no crop: the source
 * has no letterboxing, measured with cropdetect), 30 fps, H.264 High at
 * CRF 23 / preset slow with aq-mode 3 for the dark gradients, yuv420p, no
 * audio, faststart. The last half second dissolves into the first half second
 * so the loop does not hard-cut from the side profile back to the front view;
 * nothing else in the clip is altered and the duration is unchanged.
 *
 * mobile-poster.webp — frame 0 of the same clip, so the first frame of
 * playback IS the poster and the swap is invisible. Served through next/image,
 * which re-encodes it as AVIF/WebP at the viewport's width.
 *
 * Re-encode (ffmpeg 7):
 *   ffmpeg -i VIDEOS/video.MOV -i VIDEOS/video.MOV -i VIDEOS/video.MOV \
 *     -filter_complex "[0:v]trim=end_frame=489,setpts=PTS-STARTPTS[m];\
 *       [1:v]trim=start_frame=489,setpts=PTS-STARTPTS,fps=30[t];\
 *       [2:v]trim=end_frame=15,setpts=PTS-STARTPTS,fps=30[h];\
 *       [t][h]xfade=transition=fade:duration=0.5:offset=0[x];\
 *       [m][x]concat=n=2:v=1:a=0,format=yuv420p[out]" \
 *     -map "[out]" -an -r 30 -c:v libx264 -preset slow -profile:v high -level 4.0 \
 *     -crf 23 -x264-params aq-mode=3:aq-strength=1.0 -movflags +faststart \
 *     public/media/hero/mobile-loop.mp4
 *   ffmpeg -i VIDEOS/video.MOV -frames:v 1 -c:v libwebp -quality 85 \
 *     public/media/hero/mobile-poster.webp
 */
export interface MobileHeroVideo {
  /** Local paths in preference order; MIME types derive from the extension. */
  sources: string[]
  /** Frame 0 of the loop. The first paint, and the whole hero under reduced motion. */
  poster: ImageRef
  /** CSS object-position for both the poster and the loop inside the phone crop. */
  objectPosition: string
}

export const MOBILE_HERO_VIDEO: MobileHeroVideo = {
  sources: ['/media/hero/mobile-loop.mp4'],
  poster: {
    src: '/media/hero/mobile-poster.webp',
    alt: '',
    width: 720,
    height: 1260,
  },
  // The car sits in the lower-middle of a 4:7 frame. Phone viewports are
  // between 9:16 and 9:21, so the crop trims the sides, never the height, and
  // a centre crop keeps the whole car at every one of them.
  objectPosition: 'center',
}

/** The breakpoint the stylesheet already uses for the phone layout. */
export const MOBILE_HERO_MEDIA_QUERY = '(max-width: 767px)'
export const DESKTOP_HERO_MEDIA_QUERY = '(min-width: 768px)'
