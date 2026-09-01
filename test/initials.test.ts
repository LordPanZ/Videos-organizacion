import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { coverInitials, initialsFor } from '../src/shared/initials.ts';

describe('initialsFor', () => {
  test('takes the first letter of the first two words', () => {
    assert.equal(initialsFor('Sonido directo'), 'SD');
    assert.equal(initialsFor('Masa madre sin complicaciones'), 'MM');
  });

  test('skips connectors so the monogram stays meaningful', () => {
    assert.equal(initialsFor('Rutina de fuerza para principiantes'), 'RF');
    assert.equal(initialsFor('Qué es realmente un transformer'), 'QR');
    assert.equal(initialsFor('The making of a film'), 'MF');
  });

  test('falls back to the first two letters of a single word', () => {
    assert.equal(initialsFor('Transformers'), 'TR');
  });

  test('uses the words themselves when every one is a connector', () => {
    assert.equal(initialsFor('de la'), 'DL');
  });

  test('ignores a separator standing in for a word', () => {
    assert.equal(initialsFor('YouTube · abc123'), 'YA');
    assert.equal(initialsFor('TikTok — 7222222'), 'T7');
  });

  test('ignores leading punctuation and emoji', () => {
    assert.equal(initialsFor('🔥 Bocetos rápidos'), 'BR');
    assert.equal(initialsFor('!!! probando ahora'), 'PA');
  });

  test('survives a title with nothing to work with', () => {
    assert.equal(initialsFor(''), '?');
    assert.equal(initialsFor('###'), '?');
  });
});

describe('coverInitials', () => {
  const video = (title: string, author: string | null) => ({
    title,
    platform: 'twitter' as const,
    author: author === null ? null : { name: author },
  });

  test('a title the platform actually gave wins', () => {
    assert.equal(coverInitials(video('Aterrizaje del cohete', '@nasa')), 'AC');
  });

  test('an account beats a placeholder built from the address', () => {
    // Otherwise every X video shows the same two letters, which is the one
    // thing a cover must not do.
    assert.equal(coverInitials(video('X / Twitter · 1890000000000000001', '@nasa')), 'NA');
    assert.equal(coverInitials(video('@nasa · 1890000000000000001', '@nasa')), 'NA');
  });

  test('a placeholder with no account still gives something', () => {
    assert.equal(coverInitials(video('X / Twitter · 1890000000000000001', null)), 'XT');
  });
});
