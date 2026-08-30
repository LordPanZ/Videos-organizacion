import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { VIDEO_EXTENSIONS } from '../platforms/detect.ts';

export interface ScanOptions {
  recursive?: boolean;
  maxDepth?: number;
  /** Skip files smaller than this; avoids cataloguing stray fragments. */
  minBytes?: number;
  signal?: AbortSignal;
  onProgress?: (found: number, currentDir: string) => void;
}

export interface ScannedFile {
  filePath: string;
  size: number;
  modifiedAt: string;
}

const IGNORED_DIRS = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information', '.Trash']);

/** Walks a folder collecting video files the library can catalogue. */
export async function scanFolder(root: string, options: ScanOptions = {}): Promise<ScannedFile[]> {
  const results: ScannedFile[] = [];
  const maxDepth = options.recursive === false ? 0 : (options.maxDepth ?? 12);
  const minBytes = options.minBytes ?? 64 * 1024;

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (options.signal?.aborted) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // Unreadable folder (permissions, disconnected drive): skip it quietly.
      return;
    }
    options.onProgress?.(results.length, dir);

    for (const entry of entries) {
      if (options.signal?.aborted) return;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (depth >= maxDepth) continue;
        if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
        await walk(full, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!VIDEO_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) continue;

      try {
        const stats = await stat(full);
        if (stats.size < minBytes) continue;
        results.push({ filePath: full, size: stats.size, modifiedAt: stats.mtime.toISOString() });
      } catch {
        /* file vanished between readdir and stat */
      }
    }
  };

  await walk(root, 0);
  return results;
}
