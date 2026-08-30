import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { initialsFor } from '../src/shared/initials.ts';

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
