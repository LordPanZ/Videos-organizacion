import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  derivedThumbnailUrl,
  detectPlatform,
  embedUrl,
  extractUrls,
  normalizeUrl,
  parseVideoUrl,
} from '../src/core/platforms/detect.ts';

describe('detectPlatform', () => {
  const cases: [string, string][] = [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube'],
    ['https://youtu.be/dQw4w9WgXcQ', 'youtube'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube'],
    ['https://www.tiktok.com/@a/video/1', 'tiktok'],
    ['https://vm.tiktok.com/ZMabc/', 'tiktok'],
    ['https://www.instagram.com/reel/abc/', 'instagram'],
    ['https://vimeo.com/1', 'vimeo'],
    ['https://x.com/a/status/1', 'twitter'],
    ['https://twitter.com/a/status/1', 'twitter'],
    ['https://clips.twitch.tv/Slug', 'twitch'],
    ['https://dai.ly/x8abcde', 'dailymotion'],
    ['https://ejemplo.com/video.mp4', 'other'],
  ];

  for (const [url, expected] of cases) {
    test(`${url} → ${expected}`, () => assert.equal(detectPlatform(url), expected));
  }

  test('a host without a scheme still resolves', () => {
    assert.equal(detectPlatform('youtube.com/watch?v=dQw4w9WgXcQ'), 'youtube');
  });

  test('garbage does not throw', () => {
    assert.equal(detectPlatform(''), 'other');
    assert.equal(detectPlatform('no es una url'), 'other');
  });
});

describe('normalizeUrl', () => {
  test('drops tracking parameters', () => {
    const normalized = normalizeUrl('https://www.youtube.com/watch?v=abc&si=track&feature=share&t=42');
    assert.ok(!normalized.includes('si='));
    assert.ok(!normalized.includes('feature='));
    assert.ok(normalized.includes('v=abc'));
  });

  test('drops the fragment and a trailing slash', () => {
    assert.equal(normalizeUrl('https://ejemplo.com/ruta/#seccion'), 'https://ejemplo.com/ruta');
  });
});

describe('parseVideoUrl', () => {
  test('canonicalizes every YouTube spelling to the same URL', () => {
    const expected = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    for (const input of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=x',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share',
    ]) {
      assert.equal(parseVideoUrl(input).canonicalUrl, expected, input);
    }
  });

  test('marks short-form URLs', () => {
    assert.ok(parseVideoUrl('https://www.youtube.com/shorts/AbCdEfGhIjK').isShort);
    assert.ok(parseVideoUrl('https://www.tiktok.com/@a/video/123').isShort);
    assert.ok(parseVideoUrl('https://www.instagram.com/reel/abc/').isShort);
    assert.ok(!parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ').isShort);
  });

  test('extracts creator handles', () => {
    assert.equal(parseVideoUrl('https://www.tiktok.com/@chefpepe/video/123').handle, '@chefpepe');
    assert.equal(parseVideoUrl('https://x.com/usuario/status/1').handle, '@usuario');
  });

  test('rejects malformed YouTube ids', () => {
    assert.equal(parseVideoUrl('https://www.youtube.com/watch?v=demasiado-largo-para-ser-valido').id, null);
  });

  test('normalizes Instagram reels to a single path form', () => {
    assert.equal(parseVideoUrl('https://www.instagram.com/reels/abc/').canonicalUrl, 'https://www.instagram.com/reel/abc/');
  });
});

describe('thumbnails and embeds', () => {
  test('YouTube thumbnails are derivable without a network call', () => {
    assert.equal(derivedThumbnailUrl('youtube', 'dQw4w9WgXcQ'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    assert.equal(derivedThumbnailUrl('youtube', null), null);
    assert.equal(derivedThumbnailUrl('other', 'x'), null);
  });

  test('embeds use the privacy-preserving host where one exists', () => {
    assert.ok(embedUrl('youtube', 'abc', '')!.includes('youtube-nocookie.com'));
    assert.ok(embedUrl('vimeo', '123', '')!.includes('player.vimeo.com'));
    assert.equal(embedUrl('other', 'x', ''), null);
  });
});

describe('extractUrls', () => {
  test('pulls links out of prose and de-duplicates', () => {
    const found = extractUrls('Mira https://youtu.be/abc11111111 y https://vimeo.com/999.\nOtra vez https://youtu.be/abc11111111');
    assert.deepEqual(found, ['https://youtu.be/abc11111111', 'https://vimeo.com/999']);
  });

  test('returns nothing when there are no links', () => {
    assert.deepEqual(extractUrls('sin enlaces aquí'), []);
  });
});
