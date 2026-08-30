import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  durationBucket,
  formatDuration,
  formatSize,
  parseDateValue,
  parseDuration,
  parseSize,
} from '../src/shared/query/values.ts';

describe('parseDuration', () => {
  test('reads a bare number as minutes', () => {
    assert.equal(parseDuration('10'), 600);
    assert.equal(parseDuration('1.5'), 90);
  });

  test('reads explicit units', () => {
    assert.equal(parseDuration('90s'), 90);
    assert.equal(parseDuration('10m'), 600);
    assert.equal(parseDuration('2h'), 7200);
    assert.equal(parseDuration('1h30m'), 5400);
    assert.equal(parseDuration('1h30m10s'), 5410);
  });

  test('reads clock notation', () => {
    assert.equal(parseDuration('1:30'), 90);
    assert.equal(parseDuration('1:30:00'), 5400);
  });

  test('accepts Spanish unit names', () => {
    assert.equal(parseDuration('2horas'), 7200);
    assert.equal(parseDuration('30minutos'), 1800);
  });

  test('rejects nonsense', () => {
    for (const input of ['', 'abc', '10x', '10mfoo', '1:2:3:4', 'm10']) {
      assert.equal(parseDuration(input), null, `should reject ${JSON.stringify(input)}`);
    }
  });
});

describe('formatting', () => {
  test('durations render as clock times', () => {
    assert.equal(formatDuration(90), '1:30');
    assert.equal(formatDuration(3661), '1:01:01');
    assert.equal(formatDuration(null), '—');
  });

  test('sizes render with Spanish decimals', () => {
    assert.equal(formatSize(1024), '1,0 KB');
    assert.equal(formatSize(1536 * 1024), '1,5 MB');
    assert.equal(formatSize(0), '—');
  });
});

describe('parseSize', () => {
  test('reads units and bare bytes', () => {
    assert.equal(parseSize('1kb'), 1024);
    assert.equal(parseSize('1.5gb'), Math.round(1.5 * 1024 ** 3));
    assert.equal(parseSize('2048'), 2048);
  });

  test('rejects unknown units', () => {
    assert.equal(parseSize('5parsecs'), null);
    assert.equal(parseSize(''), null);
  });
});

describe('parseDateValue', () => {
  const now = Date.UTC(2025, 5, 15, 12, 0, 0);

  test('absolute dates cover the span they name', () => {
    const year = parseDateValue('2024', now)!;
    assert.equal(year.start, Date.UTC(2024, 0, 1));
    assert.equal(year.end, Date.UTC(2025, 0, 1));

    const month = parseDateValue('2024-05', now)!;
    assert.equal(month.start, Date.UTC(2024, 4, 1));
    assert.equal(month.end, Date.UTC(2024, 5, 1));

    const day = parseDateValue('2024-05-01', now)!;
    assert.equal(day.end! - day.start!, 86_400_000);
  });

  test('relative values run from the past until now', () => {
    const week = parseDateValue('7d', now)!;
    assert.equal(week.end, now);
    assert.equal(week.start, now - 7 * 86_400_000);
  });

  test('named ranges work in Spanish', () => {
    assert.ok(parseDateValue('hoy', now));
    assert.ok(parseDateValue('ayer', now));
    assert.ok(parseDateValue('semana', now));
  });

  test('rejects unparseable input', () => {
    assert.equal(parseDateValue('mañana por la tarde', now), null);
    assert.equal(parseDateValue('', now), null);
  });
});

describe('durationBucket', () => {
  test('assigns the expected bucket', () => {
    assert.equal(durationBucket(30), 'micro');
    assert.equal(durationBucket(120), 'corto');
    assert.equal(durationBucket(600), 'medio');
    assert.equal(durationBucket(2000), 'largo');
    assert.equal(durationBucket(7200), 'muy-largo');
    assert.equal(durationBucket(null), null);
  });
});
