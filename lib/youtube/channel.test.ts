/**
 * Regression tests for YouTube handle parsing and response normalisation.
 *
 * Run with `npm run test:youtube`. No network, no API key, no live channel —
 * every case here is a string or a literal object, which is the whole reason
 * the parsing lives in channel.ts rather than inside the HTTP client.
 *
 * The cases that matter are the ones where a wrong answer would be CONFIDENT:
 * a `/channel/UC…` URL read as a handle, a private upload rendered as the
 * latest video, a `maxres` thumbnail that does not exist.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  readLatestVideo,
  readUploadsPlaylistId,
  youTubeChannelUrl,
  youTubeHandle,
} from './channel.ts'

// ── Handle parsing ───────────────────────────────────────────────────────────

test('accepts the forms that actually end up on a clipboard', () => {
  for (const input of [
    '@thekanjo',
    'thekanjo',
    'https://www.youtube.com/@thekanjo',
    'https://youtube.com/@thekanjo',
    'https://m.youtube.com/@thekanjo',
    'https://www.youtube.com/@thekanjo/videos',
    'https://www.youtube.com/@thekanjo/streams?view=0',
    '  https://www.youtube.com/@thekanjo  ',
  ]) {
    assert.equal(youTubeHandle(input), 'thekanjo', `failed for ${JSON.stringify(input)}`)
  }
})

test('the returned handle never carries the @', () => {
  assert.equal(youTubeHandle('@thekanjo'), 'thekanjo')
  assert.equal(youTubeChannelUrl('thekanjo'), 'https://www.youtube.com/@thekanjo')
})

test('a /channel/ or /c/ URL is REFUSED, not guessed at', () => {
  // The dangerous case: taking the last path segment would produce a confident
  // lookup for something that is not a handle at all.
  assert.equal(youTubeHandle('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv'), null)
  assert.equal(youTubeHandle('https://www.youtube.com/c/SomeChannel'), null)
  assert.equal(youTubeHandle('https://www.youtube.com/user/SomeUser'), null)
})

test('rejects other hosts, other schemes and malformed handles', () => {
  for (const input of [
    '',
    '   ',
    'https://vimeo.com/@thekanjo',
    'https://youtube.com.evil.example/@thekanjo',
    'javascript:alert(1)',
    'ab', // under the 3-character minimum
    '@a', // same
    'has spaces',
    '@has spaces',
    `@${'a'.repeat(31)}`, // over the 30-character maximum
  ]) {
    assert.equal(youTubeHandle(input), null, `should reject ${JSON.stringify(input)}`)
  }
})

test('accepts the punctuation YouTube actually allows in a handle', () => {
  assert.equal(youTubeHandle('@the.kanjo_01-x'), 'the.kanjo_01-x')
})

// ── channels.list → uploads playlist ─────────────────────────────────────────

test('reads the uploads playlist id', () => {
  assert.equal(
    readUploadsPlaylistId({
      items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUabcdefghij' } } }],
    }),
    'UUabcdefghij',
  )
})

test('a missing, empty or malformed uploads id is null, not a second request', () => {
  assert.equal(readUploadsPlaylistId({}), null)
  assert.equal(readUploadsPlaylistId({ items: [] }), null)
  assert.equal(readUploadsPlaylistId({ items: [{}] }), null)
  assert.equal(
    readUploadsPlaylistId({ items: [{ contentDetails: { relatedPlaylists: { uploads: '' } } }] }),
    null,
  )
  // A channel id rather than an uploads playlist id — the `UC` prefix would be
  // accepted by a laxer check and then 404 on the playlist request.
  assert.equal(
    readUploadsPlaylistId({
      items: [{ contentDetails: { relatedPlaylists: { uploads: 'UCabcdefghij' } } }],
    }),
    null,
  )
})

// ── playlistItems.list → latest video ────────────────────────────────────────

function item(overrides: Record<string, unknown> = {}) {
  return {
    snippet: {
      title: 'Night loop',
      description: 'A lap after dark.',
      publishedAt: '2026-09-01T10:00:00Z',
      resourceId: { videoId: 'aqz-KE-bpKQ' },
      thumbnails: {
        high: { url: 'https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg', width: 480, height: 360 },
      },
    },
    contentDetails: { videoId: 'aqz-KE-bpKQ', videoPublishedAt: '2026-09-01T10:00:00Z' },
    status: { privacyStatus: 'public' },
    ...overrides,
  }
}

test('reads the newest usable upload', () => {
  const video = readLatestVideo({ items: [item()] })
  assert.equal(video?.id, 'aqz-KE-bpKQ')
  assert.equal(video?.title, 'Night loop')
  assert.equal(video?.publishedAt, '2026-09-01T10:00:00Z')
  assert.equal(video?.poster?.width, 480)
})

test('SKIPS private and deleted entries rather than embedding them', () => {
  // The real failure this guards: an uploads playlist keeps entries whose video
  // has since gone private, and embedding one puts "Video unavailable" on the
  // homepage.
  const video = readLatestVideo({
    items: [
      item({ status: { privacyStatus: 'private' }, snippet: { title: 'Private video' } }),
      item({ snippet: { ...item().snippet, title: 'Deleted video' } }),
      item({ snippet: { ...item().snippet, title: 'The real one' } }),
    ],
  })
  assert.equal(video?.title, 'The real one')
})

test('skips an unlisted upload — only public means public', () => {
  assert.equal(readLatestVideo({ items: [item({ status: { privacyStatus: 'unlisted' } })] }), null)
})

test('an empty or unusable response is null, not a crash', () => {
  assert.equal(readLatestVideo({}), null)
  assert.equal(readLatestVideo({ items: [] }), null)
  assert.equal(readLatestVideo({ items: [{}] }), null)
  assert.equal(readLatestVideo({ items: [{ snippet: {} }] }), null)
})

test('a malformed video id or date is rejected', () => {
  assert.equal(
    readLatestVideo({ items: [item({ contentDetails: { videoId: 'too-short' } })] }),
    null,
  )
  assert.equal(
    readLatestVideo({
      items: [item({ contentDetails: { videoId: 'aqz-KE-bpKQ', videoPublishedAt: 'soon' } })],
    }),
    null,
  )
})

test('falls back through the thumbnail sizes that actually exist', () => {
  // `maxres` only exists for uploads above 720p. Preferring it blindly is how a
  // facade ends up with a 404 for its poster.
  const withMax = readLatestVideo({
    items: [
      item({
        snippet: {
          ...item().snippet,
          thumbnails: {
            high: { url: 'https://i.ytimg.com/h.jpg', width: 480, height: 360 },
            maxres: { url: 'https://i.ytimg.com/m.jpg', width: 1280, height: 720 },
          },
        },
      }),
    ],
  })
  assert.equal(withMax?.poster?.width, 1280)

  const withoutMax = readLatestVideo({ items: [item()] })
  assert.equal(withoutMax?.poster?.src, 'https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg')

  const none = readLatestVideo({
    items: [item({ snippet: { ...item().snippet, thumbnails: undefined } })],
  })
  assert.equal(none?.poster, undefined)
  assert.equal(none?.id, 'aqz-KE-bpKQ')
})

test('a thumbnail with no dimensions is skipped — an ImageRef needs both', () => {
  const video = readLatestVideo({
    items: [
      item({
        snippet: {
          ...item().snippet,
          thumbnails: {
            maxres: { url: 'https://i.ytimg.com/m.jpg' },
            high: { url: 'https://i.ytimg.com/h.jpg', width: 480, height: 360 },
          },
        },
      }),
    ],
  })
  assert.equal(video?.poster?.src, 'https://i.ytimg.com/h.jpg')
})
