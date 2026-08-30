import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Library } from '../src/core/db/library.ts';
import { AutoTagger, extractHashtags, ruleMatches } from '../src/core/services/autoTag.ts';
import { fromYtdlpInfo } from '../src/core/metadata/ytdlp.ts';
import { parseIso8601Duration } from '../src/core/metadata/opengraph.ts';
import { titleFromFilename } from '../src/core/metadata/local.ts';
import { mergeMetadata } from '../src/core/metadata/types.ts';
import { MetadataResolver } from '../src/core/metadata/index.ts';
import type { AutoTagRule } from '../src/shared/types.ts';

let library: Library;

beforeEach(() => {
  library = new Library({ file: ':memory:' });
});

afterEach(() => {
  library.close();
});

const subject = {
  title: 'Cómo hacer PAELLA en casa',
  description: 'Receta paso a paso',
  author: 'Cocina Fácil',
  url: 'https://www.youtube.com/watch?v=abc11111111',
  platformTags: ['cocina', 'arroz'],
};

function rule(overrides: Partial<AutoTagRule> = {}): AutoTagRule {
  return {
    id: 'r1',
    name: 'Regla',
    enabled: true,
    field: 'title',
    matcher: 'contains',
    pattern: 'paella',
    caseSensitive: false,
    tagIds: [],
    setFields: {},
    position: 0,
    createdAt: new Date().toISOString(),
    matchCount: 0,
    ...overrides,
  };
}

describe('extractHashtags', () => {
  test('finds hashtags and de-duplicates case-insensitively', () => {
    assert.deepEqual(extractHashtags('Receta #Cocina rica #cocina #arroz'), ['Cocina', 'arroz']);
  });

  test('handles accents and returns nothing when there are none', () => {
    assert.deepEqual(extractHashtags('#programación'), ['programación']);
    assert.deepEqual(extractHashtags('sin etiquetas'), []);
    assert.deepEqual(extractHashtags(null), []);
  });
});

describe('ruleMatches', () => {
  test('contains is case-insensitive by default', () => {
    assert.ok(ruleMatches(rule(), subject));
    assert.ok(!ruleMatches(rule({ caseSensitive: true, pattern: 'paella' }), subject));
    assert.ok(ruleMatches(rule({ caseSensitive: true, pattern: 'PAELLA' }), subject));
  });

  test('matchers behave as named', () => {
    assert.ok(ruleMatches(rule({ matcher: 'startsWith', pattern: 'cómo' }), subject));
    assert.ok(ruleMatches(rule({ matcher: 'endsWith', pattern: 'casa' }), subject));
    assert.ok(ruleMatches(rule({ matcher: 'regex', pattern: 'p[a4]ella' }), subject));
    assert.ok(!ruleMatches(rule({ matcher: 'equals', pattern: 'paella' }), subject));
  });

  test('targets the requested field', () => {
    assert.ok(ruleMatches(rule({ field: 'author', pattern: 'cocina fácil' }), subject));
    assert.ok(ruleMatches(rule({ field: 'platformTags', pattern: 'arroz' }), subject));
    assert.ok(!ruleMatches(rule({ field: 'description', pattern: 'paella' }), subject));
    assert.ok(ruleMatches(rule({ field: 'anyText', pattern: 'arroz' }), subject));
  });

  test('an invalid regex fails the rule instead of the import', () => {
    assert.doesNotThrow(() => ruleMatches(rule({ matcher: 'regex', pattern: '([' }), subject));
    assert.ok(!ruleMatches(rule({ matcher: 'regex', pattern: '([' }), subject));
  });
});

describe('AutoTagger', () => {
  function addVideo(overrides = {}) {
    return library.videos.insert({
      url: `https://www.youtube.com/watch?v=${Math.random().toString(36).slice(2, 13)}`,
      platform: 'youtube',
      title: 'Paella valenciana #arroz',
      durationSeconds: 940,
      publishedAt: '2024-05-12T10:00:00.000Z',
      ...overrides,
    });
  }

  test('derives platform, year, duration and hashtag tags', () => {
    const tagger = new AutoTagger(library);
    const result = tagger.apply(addVideo(), null);

    assert.ok(result.tagNames.includes('YouTube'));
    assert.ok(result.tagNames.includes('2024'));
    assert.ok(result.tagNames.includes('5 – 20 min'));
    assert.ok(result.tagNames.includes('arroz'));
  });

  test('tags the creator when there is one', () => {
    const author = library.authors.ensure({ platform: 'youtube', name: 'Cocina Fácil' });
    const tagger = new AutoTagger(library);
    const result = tagger.apply(addVideo({ authorId: author.id }), null);
    assert.ok(result.tagNames.includes('Cocina Fácil'));
  });

  test('generators can be switched off individually', () => {
    const tagger = new AutoTagger(library, { platform: false, year: false, duration: false, hashtags: false });
    assert.deepEqual(tagger.apply(addVideo(), null).tagNames, []);
  });

  test('skips generic words that would tag everything', () => {
    const tagger = new AutoTagger(library);
    const result = tagger.apply(addVideo({ title: 'Mira este #video #viral #fyp' }), null);
    for (const noise of ['video', 'viral', 'fyp']) {
      assert.ok(!result.tagNames.includes(noise), `should not tag "${noise}"`);
    }
  });

  test('re-running is idempotent', () => {
    const video = addVideo();
    const tagger = new AutoTagger(library);
    tagger.apply(video, null);
    const afterFirst = library.videos.getById(video.id)!.tags.length;
    tagger.apply(library.videos.getById(video.id)!, null);
    assert.equal(library.videos.getById(video.id)!.tags.length, afterFirst);
  });

  test('user rules add tags and set custom fields', () => {
    const tag = library.tags.ensure({ name: 'Recetas' });
    library.customFields.create({ label: 'Prioridad manual', type: 'text' });
    library.rules.create({
      name: 'Paella',
      field: 'title',
      matcher: 'contains',
      pattern: 'paella',
      tagIds: [tag.id],
      setFields: { prioridad_manual: 'alta' },
    });

    const video = addVideo();
    new AutoTagger(library).apply(video, null);

    const loaded = library.videos.getById(video.id)!;
    assert.ok(loaded.tags.some((item) => item.id === tag.id));
    assert.equal(loaded.customFields.prioridad_manual, 'alta');
  });

  test('rulesOnly skips the built-in generators', () => {
    const tag = library.tags.ensure({ name: 'Recetas' });
    const created = library.rules.create({
      name: 'Paella',
      field: 'title',
      matcher: 'contains',
      pattern: 'paella',
      tagIds: [tag.id],
    });

    const video = addVideo();
    const result = new AutoTagger(library).apply(video, null, { ruleIds: [created.id], rulesOnly: true });
    assert.deepEqual(result.tagNames, ['Recetas']);
  });

  test('disabled rules never fire', () => {
    const tag = library.tags.ensure({ name: 'Recetas' });
    library.rules.create({
      name: 'Paella',
      field: 'title',
      matcher: 'contains',
      pattern: 'paella',
      tagIds: [tag.id],
      enabled: false,
    });
    const result = new AutoTagger(library).apply(addVideo(), null);
    assert.ok(!result.tagNames.includes('Recetas'));
  });
});

describe('metadata mapping', () => {
  test('maps a yt-dlp info dict', () => {
    const metadata = fromYtdlpInfo(
      {
        id: 'abc11111111',
        title: 'Paella valenciana',
        description: 'Receta',
        webpage_url: 'https://www.youtube.com/watch?v=abc11111111',
        uploader: 'Cocina Fácil',
        channel_id: 'UC123',
        duration: 940.4,
        upload_date: '20240512',
        view_count: 1500,
        width: 1920,
        height: 1080,
        tags: ['cocina', 'arroz'],
        categories: ['Howto'],
        thumbnails: [
          { url: 'https://a/small.jpg', width: 120, height: 90 },
          { url: 'https://a/large.jpg', width: 1280, height: 720 },
        ],
      },
      'https://youtu.be/abc11111111',
    );

    assert.equal(metadata.platform, 'youtube');
    assert.equal(metadata.platformId, 'abc11111111');
    assert.equal(metadata.durationSeconds, 940);
    assert.equal(metadata.publishedAt, '2024-05-12T00:00:00.000Z');
    assert.equal(metadata.thumbnailUrl, 'https://a/large.jpg', 'should pick the largest thumbnail');
    assert.deepEqual(metadata.platformTags, ['cocina', 'arroz', 'Howto']);
    assert.equal(metadata.isShort, false);
  });

  test('treats short vertical video as short-form', () => {
    const metadata = fromYtdlpInfo({ id: 'x', title: 'Corto', width: 720, height: 1280, duration: 30 }, 'https://ejemplo.com/x');
    assert.equal(metadata.isShort, true);
  });

  test('survives a nearly empty info dict', () => {
    const metadata = fromYtdlpInfo({}, 'https://ejemplo.com/x');
    assert.equal(metadata.title, 'Sin título');
    assert.equal(metadata.durationSeconds, null);
  });

  test('parses ISO-8601 durations', () => {
    assert.equal(parseIso8601Duration('PT1H2M30S'), 3750);
    assert.equal(parseIso8601Duration('PT45S'), 45);
    assert.equal(parseIso8601Duration('no'), null);
    assert.equal(parseIso8601Duration(null), null);
  });

  test('builds a readable title from a file name', () => {
    assert.equal(titleFromFilename('/videos/mi_video_favorito.mp4'), 'mi video favorito');
    assert.equal(titleFromFilename('/videos/Serie-01.mkv'), 'Serie - 01');
  });

  test('merging fills gaps without overwriting known values', () => {
    const primary = MetadataResolver.fromUrl('https://www.youtube.com/watch?v=abc11111111');
    const fallback = { ...primary, description: 'de respaldo', viewCount: 10 };
    const merged = mergeMetadata({ ...primary, description: 'principal' }, fallback);

    assert.equal(merged.description, 'principal');
    assert.equal(merged.viewCount, 10);
  });

  test('a URL alone yields a usable record with a derived thumbnail', () => {
    const metadata = MetadataResolver.fromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.equal(metadata.platform, 'youtube');
    assert.equal(metadata.thumbnailUrl, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    assert.ok(metadata.title.length > 0);
  });
});
