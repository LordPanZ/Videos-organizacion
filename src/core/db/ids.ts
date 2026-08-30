import { createHash, randomUUID } from 'node:crypto';

/** Primary keys are UUIDv4 so records can be merged across libraries safely. */
export function newId(): string {
  return randomUUID();
}

/** Stable hash used to detect duplicate URLs. */
export function hashUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 32);
}

/**
 * Normalizes a name into a URL-safe slug, folding accents so "Programación"
 * and "programacion" resolve to the same tag.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'sin-nombre';
}
