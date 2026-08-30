import { createHash } from 'node:crypto';
import { mkdir, rm, stat, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fetchBuffer } from '../metadata/http.ts';

/** Magic-number sniffing: the extension comes from the bytes, not the URL. */
function detectImageExtension(data: Buffer, contentType: string | null): string | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return '.jpg';
  if (data.length >= 8 && data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return '.png';
  if (data.length >= 6 && data.subarray(0, 6).toString('ascii').startsWith('GIF8')) return '.gif';
  if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') {
    return '.webp';
  }
  if (contentType?.startsWith('image/')) {
    const guessed = contentType.split('/')[1]?.split(';')[0];
    if (guessed && /^[a-z0-9]{2,5}$/.test(guessed)) return `.${guessed === 'jpeg' ? 'jpg' : guessed}`;
  }
  return null;
}

/**
 * Local thumbnail cache.
 *
 * Grid scrolling must never wait on the network, so every thumbnail is copied
 * to disk once and served from there afterwards. Files are sharded by hash
 * prefix to keep directory listings small.
 */
export class ThumbnailCache {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  /** Path a given remote URL maps to, without touching the filesystem. */
  private pathFor(url: string, extension: string): { absolute: string; relative: string } {
    const hash = createHash('sha256').update(url).digest('hex');
    const relative = path.join(hash.slice(0, 2), `${hash.slice(2, 34)}${extension}`);
    return { absolute: path.join(this.rootDir, relative), relative };
  }

  /** Resolves a stored relative path back to an absolute one. */
  absolutePath(relative: string): string {
    // Reject traversal: stored paths are always inside the cache root.
    const resolved = path.resolve(this.rootDir, relative);
    if (!resolved.startsWith(path.resolve(this.rootDir))) {
      throw new Error('Ruta de miniatura fuera del caché.');
    }
    return resolved;
  }

  /**
   * Downloads `url` into the cache and returns the relative path, or null when
   * the image cannot be fetched. Already-cached images are reused.
   */
  async store(url: string, signal?: AbortSignal): Promise<string | null> {
    if (!url || !/^https?:\/\//i.test(url)) return null;

    // Common extensions first: a cache hit avoids the request entirely.
    for (const extension of ['.jpg', '.png', '.webp', '.gif']) {
      const candidate = this.pathFor(url, extension);
      try {
        const stats = await stat(candidate.absolute);
        if (stats.size > 0) return candidate.relative;
      } catch {
        /* not cached yet */
      }
    }

    let data: Buffer;
    let contentType: string | null;
    try {
      ({ data, contentType } = await fetchBuffer(url, { signal, timeoutMs: 20_000, maxBytes: 12_000_000 }));
    } catch {
      return null;
    }

    const extension = detectImageExtension(data, contentType);
    if (!extension || data.byteLength === 0) return null;

    const target = this.pathFor(url, extension);
    await mkdir(path.dirname(target.absolute), { recursive: true });
    await writeFile(target.absolute, data);
    return target.relative;
  }

  /**
   * Writes an image the user supplied and returns its relative path.
   *
   * Keyed by the video id rather than by content, so replacing a cover
   * overwrites the old file instead of leaving it behind.
   */
  async storeBuffer(key: string, data: Buffer, extension = '.jpg'): Promise<string> {
    const hash = createHash('sha256').update(key).digest('hex');
    const relative = path.join(hash.slice(0, 2), `cover-${hash.slice(2, 34)}${extension}`);
    const absolute = path.join(this.rootDir, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, data);
    return relative;
  }

  /** Deletes a stored file, ignoring one that is already gone. */
  async removeRelative(relative: string): Promise<void> {
    await rm(this.absolutePath(relative), { force: true });
  }

  /** Total bytes held by the cache. */
  async size(): Promise<number> {
    let total = 0;
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else {
          try {
            total += (await stat(full)).size;
          } catch {
            /* file vanished mid-walk */
          }
        }
      }
    };
    await walk(this.rootDir);
    return total;
  }

  /** Empties the cache. Thumbnails are re-fetched on demand afterwards. */
  async clear(): Promise<void> {
    await rm(this.rootDir, { recursive: true, force: true });
    await mkdir(this.rootDir, { recursive: true });
  }

  /** Removes cached files no video references any more. */
  async prune(keep: Set<string>): Promise<number> {
    let removed = 0;
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        const relative = path.relative(this.rootDir, full);
        if (!keep.has(relative)) {
          await rm(full, { force: true });
          removed += 1;
        }
      }
    };
    await walk(this.rootDir);
    return removed;
  }
}
