import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from '../util/tools.ts';
import type { MetadataProvider, VideoMetadata } from './types.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = Record<string, any>;

/** Turns a file name into a readable title: separators out, extension gone. */
export function titleFromFilename(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath));
  return (
    base
      .replace(/[._]+/g, ' ')
      .replace(/\s*[-–]\s*/g, ' - ')
      .replace(/\s{2,}/g, ' ')
      .trim() || base
  );
}

/**
 * Metadata for video files already on disk. ffprobe supplies duration and
 * resolution; without it the file is still catalogued using its name and size.
 */
export class LocalFileProvider implements MetadataProvider {
  readonly name = 'local' as const;
  private readonly ffprobePath: string | null;

  constructor(ffprobePath: string | null) {
    this.ffprobePath = ffprobePath;
  }

  supports(url: string): boolean {
    return url.startsWith('file://') || path.isAbsolute(url);
  }

  async fetch(target: string): Promise<VideoMetadata | null> {
    const filePath = target.startsWith('file://') ? new URL(target).pathname : target;
    const stats = await stat(filePath);

    const base: VideoMetadata = {
      url: pathToFileURL(filePath).toString(),
      canonicalUrl: pathToFileURL(filePath).toString(),
      platform: 'local',
      platformId: null,
      title: titleFromFilename(filePath),
      description: null,
      authorName: null,
      authorHandle: null,
      authorId: null,
      authorUrl: null,
      durationSeconds: null,
      publishedAt: stats.mtime.toISOString(),
      thumbnailUrl: null,
      width: null,
      height: null,
      viewCount: null,
      likeCount: null,
      commentCount: null,
      language: null,
      isLive: false,
      isShort: false,
      platformTags: [],
      source: 'local',
      raw: { size: stats.size },
    };

    if (!this.ffprobePath) return base;

    try {
      const result = await run(
        this.ffprobePath,
        ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
        { timeoutMs: 30_000 },
      );
      if (result.code !== 0) return base;

      const probe = JSON.parse(result.stdout) as Json;
      const video = (Array.isArray(probe.streams) ? probe.streams : []).find((s: Json) => s.codec_type === 'video');
      const duration = Number(probe.format?.duration ?? video?.duration ?? 0);
      const width = Number(video?.width ?? 0);
      const height = Number(video?.height ?? 0);
      const tags = probe.format?.tags ?? {};

      return {
        ...base,
        title: typeof tags.title === 'string' && tags.title.trim() ? tags.title.trim() : base.title,
        description: typeof tags.comment === 'string' ? tags.comment : null,
        authorName: typeof tags.artist === 'string' ? tags.artist : null,
        durationSeconds: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
        width: width > 0 ? width : null,
        height: height > 0 ? height : null,
        isShort: height > width && duration > 0 && duration <= 90,
        language: typeof tags.language === 'string' ? tags.language : null,
        raw: { size: stats.size, probe },
      };
    } catch {
      // ffprobe failed on this file; the name-and-size record is still useful.
      return base;
    }
  }
}
