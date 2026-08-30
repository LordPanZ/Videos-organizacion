/**
 * Monogram used on generated covers, for videos that have no picture.
 */

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
