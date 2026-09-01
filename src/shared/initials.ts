/**
 * Monogram used on generated covers, for videos that have no picture.
 */

import { PLATFORM_LABELS, type Platform } from './types.ts';

/**
 * Words too weak to earn a letter in the monogram. "Rutina de fuerza" should
 * read RF, not RD.
 */
const FILLER = new Set([
  'a', 'al', 'de', 'del', 'el', 'en', 'la', 'las', 'lo', 'los', 'un', 'una', 'unos', 'unas',
  'y', 'o', 'que', 'con', 'por', 'para', 'sin', 'su', 'sus', 'mi', 'mis', 'es', 'the', 'of',
  'and', 'to', 'in', 'for', 'is', 'an',
]);

/** Two-letter monogram for the generated cover. */
export function initialsFor(title: string): string {
  const words = title
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';

  const strong = words.filter(
    // A separator on its own is not a word: "YouTube · abc123" reads YA, not Y·.
    (word) => /[\p{L}\p{N}]/u.test(word) && !FILLER.has(word.toLowerCase()),
  );
  // If every word is filler the title is all filler, so fall back to it.
  const picked = strong.length > 0 ? strong : words;
  if (picked.length === 1) return picked[0].slice(0, 2).toUpperCase();
  return (picked[0][0] + picked[1][0]).toUpperCase();
}

/**
 * True when a title is one of the placeholders built from the address alone,
 * because the service would not say what the video actually is: either the
 * platform or the account, followed by the video id.
 */
export function isPlaceholderTitle(title: string, platform: Platform): boolean {
  if (title.startsWith(`${PLATFORM_LABELS[platform]} · `)) return true;
  return title.startsWith('@') && title.includes(' · ');
}

/**
 * Letters for a video's generated cover.
 *
 * X and Instagram hand a browser nothing, so their videos are named after
 * their own id — and every card from one platform ends up with the same two
 * letters, which is the one thing a cover must not do. The account is the
 * next best thing that is actually known.
 */
export function coverInitials(video: {
  title: string;
  platform: Platform;
  author: { name: string } | null;
}): string {
  if (isPlaceholderTitle(video.title, video.platform) && video.author?.name) {
    return initialsFor(video.author.name);
  }
  return initialsFor(video.title);
}
