import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { healRecord } from '../src/web/records.ts';
import type { VideoRecord } from '../src/web/records.ts';

/** A record as the browser stored it before the container existed. */
function oldRecord(): VideoRecord {
  const record: VideoRecord = {
    hidden: false,
    id: 'v1',
    url: 'https://www.youtube.com/watch?v=abc11111111',
    urlKey: 'https://www.youtube.com/watch?v=abc11111111',
    platform: 'youtube',
    platformId: 'abc11111111',
    title: 'Un vídeo de siempre',
    description: null,
    authorId: null,
    durationSeconds: null,
    publishedAt: null,
    thumbnailUrl: null,
    width: null,
    height: null,
    viewCount: null,
    likeCount: null,
    commentCount: null,
    language: null,
    isLive: false,
    isShort: false,
    rating: 0,
    favorite: false,
    watchStatus: 'unwatched',
    watchProgress: 0,
    notes: null,
    color: null,
    archived: false,
    availability: 'unknown',
    lastCheckedAt: null,
    addedAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    openedCount: 0,
    lastOpenedAt: null,
    tagIds: [],
    customFields: {},
  };
  // Drop the field the old version never wrote, which is the whole point.
  delete (record as Partial<VideoRecord>).hidden;
  return record;
}

describe('healRecord', () => {
  test('a video stored before the container is not in the container', () => {
    // The whole library disappeared from every view when this read as
    // anything other than false.
    assert.equal(healRecord(oldRecord()).hidden, false);
  });

  test('an explicit flag is kept as it is', () => {
    assert.equal(healRecord({ ...oldRecord(), hidden: true }).hidden, true);
    assert.equal(healRecord({ ...oldRecord(), hidden: false }).hidden, false);
  });

  test('anything that is not exactly true stays out of the container', () => {
    for (const value of [undefined, null, 0, '', 'false']) {
      const record = { ...oldRecord(), hidden: value as unknown as boolean };
      assert.equal(healRecord(record).hidden, false, `hidden=${String(value)}`);
    }
  });
});
