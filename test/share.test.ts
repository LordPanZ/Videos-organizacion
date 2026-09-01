import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { shareText, whatsappLink } from '../src/shared/share.ts';

describe('shareText', () => {
  test('puts the name above its link', () => {
    assert.equal(
      shareText({ title: 'Receta de paella', url: 'https://x.com/a/status/1' }),
      'Receta de paella\nhttps://x.com/a/status/1',
    );
  });

  test('sends the link alone when the name is only the link again', () => {
    const url = 'https://x.com/a/status/1';
    assert.equal(shareText({ title: url, url }), url);
    assert.equal(shareText({ title: '   ', url }), url);
  });
});

describe('whatsappLink', () => {
  test('escapes the message so the link survives the trip', () => {
    const link = whatsappLink({ title: 'Paella & arroz', url: 'https://x.com/a/status/1?t=2' });
    assert.ok(link.startsWith('https://wa.me/?text='));
    // The whole message must be one parameter: a bare & or ? would cut it off.
    assert.ok(!link.slice('https://wa.me/?text='.length).includes('&'));
    assert.ok(link.includes('%26'));
    assert.ok(link.includes('%3Ft%3D2'));
  });

  test('round-trips back to exactly what was meant', () => {
    const video = { title: 'Documental sobre montañas', url: 'https://vimeo.com/770001' };
    const text = decodeURIComponent(whatsappLink(video).split('text=')[1]);
    assert.equal(text, shareText(video));
  });
});
