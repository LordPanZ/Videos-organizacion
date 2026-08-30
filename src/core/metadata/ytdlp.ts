import { parseVideoUrl } from '../platforms/detect.ts';
import { run } from '../util/tools.ts';
import type { MetadataProvider, VideoMetadata } from './types.ts';
import type { Platform } from '../../shared/types.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = Record<string, any>;

/** Turns yt-dlp's `20240512` upload_date into an ISO timestamp. */
function toIsoDate(value: unknown): string | null {
  if (typeof value === 'number') return new Date(value * 1000).toISOString();
  if (typeof value !== 'string') return null;
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}T00:00:00.000Z`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Picks the largest thumbnail yt-dlp offers, falling back to its own choice. */
function bestThumbnail(info: Json): string | null {
  const list = Array.isArray(info.thumbnails) ? info.thumbnails : [];
  let best: Json | null = null;
  for (const entry of list) {
    if (typeof entry?.url !== 'string') continue;
    const area = Number(entry.width ?? 0) * Number(entry.height ?? 0);
    const bestArea = Number(best?.width ?? 0) * Number(best?.height ?? 0);
    if (best === null || area > bestArea) best = entry;
  }
  return (best?.url as string | undefined) ?? (typeof info.thumbnail === 'string' ? info.thumbnail : null);
}

function collectPlatformTags(info: Json): string[] {
  const tags = new Set<string>();
  for (const value of Array.isArray(info.tags) ? info.tags : []) {
    if (typeof value === 'string' && value.trim()) tags.add(value.trim());
  }
  for (const value of Array.isArray(info.categories) ? info.categories : []) {
    if (typeof value === 'string' && value.trim()) tags.add(value.trim());
  }
  return [...tags].slice(0, 40);
}

/** Maps one yt-dlp info dict onto the app's metadata shape. */
export function fromYtdlpInfo(info: Json, requestedUrl: string): VideoMetadata {
  const url = typeof info.webpage_url === 'string' ? info.webpage_url : requestedUrl;
  const parsed = parseVideoUrl(url);
  const height = Number(info.height ?? 0);
  const width = Number(info.width ?? 0);
  const duration = Number(info.duration ?? 0);

  return {
    url,
    canonicalUrl: parsed.canonicalUrl,
    platform: parsed.platform,
    platformId: (typeof info.id === 'string' ? info.id : null) ?? parsed.id,
    title: (typeof info.title === 'string' && info.title.trim()) || 'Sin título',
    description: typeof info.description === 'string' ? info.description : null,
    authorName:
      (typeof info.uploader === 'string' && info.uploader) ||
      (typeof info.channel === 'string' && info.channel) ||
      null,
    authorHandle: typeof info.uploader_id === 'string' ? info.uploader_id : null,
    authorId: typeof info.channel_id === 'string' ? info.channel_id : null,
    authorUrl:
      (typeof info.channel_url === 'string' && info.channel_url) ||
      (typeof info.uploader_url === 'string' && info.uploader_url) ||
      null,
    durationSeconds: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
    publishedAt: toIsoDate(info.release_timestamp ?? info.timestamp ?? info.upload_date),
    thumbnailUrl: bestThumbnail(info),
    width: width > 0 ? width : null,
    height: height > 0 ? height : null,
    viewCount: typeof info.view_count === 'number' ? info.view_count : null,
    likeCount: typeof info.like_count === 'number' ? info.like_count : null,
    commentCount: typeof info.comment_count === 'number' ? info.comment_count : null,
    language: typeof info.language === 'string' ? info.language : null,
    isLive: info.is_live === true,
    // Vertical video under a minute is short-form regardless of platform.
    isShort: parsed.isShort || (height > width && duration > 0 && duration <= 90),
    platformTags: collectPlatformTags(info),
    source: 'ytdlp',
    raw: info,
  };
}

export interface YtdlpOptions {
  /** Absolute path to the yt-dlp binary. */
  binary: string;
  /** Extra CLI flags configured by the user (cookies, proxy, rate limits…). */
  extraArgs?: string[];
  timeoutMs?: number;
}

/**
 * Metadata via yt-dlp. This is the highest-fidelity provider and covers every
 * site yt-dlp supports, but it is optional: the app degrades to oEmbed and
 * OpenGraph when the binary is absent.
 */
export class YtdlpProvider implements MetadataProvider {
  readonly name = 'ytdlp' as const;
  private readonly options: YtdlpOptions;

  constructor(options: YtdlpOptions) {
    this.options = options;
  }

  supports(): boolean {
    return true;
  }

  async fetch(url: string, signal?: AbortSignal): Promise<VideoMetadata | null> {
    const args = [
      '--dump-single-json',
      '--no-playlist',
      '--no-warnings',
      '--ignore-config',
      '--socket-timeout',
      '20',
      ...(this.options.extraArgs ?? []),
      url,
    ];

    const result = await run(this.options.binary, args, {
      timeoutMs: this.options.timeoutMs ?? 90_000,
      signal,
    });

    if (result.code !== 0 || !result.stdout.trim()) {
      const reason = result.stderr.split(/\r?\n/).find((line) => line.trim()) ?? `código ${result.code}`;
      throw new Error(reason.replace(/^ERROR:\s*/i, ''));
    }

    const info = JSON.parse(result.stdout) as Json;
    // A playlist URL slipped through: take the first entry.
    if (info._type === 'playlist' && Array.isArray(info.entries) && info.entries.length > 0) {
      return fromYtdlpInfo(info.entries[0] as Json, url);
    }
    return fromYtdlpInfo(info, url);
  }

  /**
   * Expands a playlist or channel URL into its entries. Uses the flat listing
   * so a 500-video channel resolves in one request instead of 500.
   */
  async listPlaylist(
    url: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<{ title: string | null; entries: { url: string; title: string | null; id: string | null }[] }> {
    const args = [
      '--dump-single-json',
      '--flat-playlist',
      '--no-warnings',
      '--ignore-config',
      '--playlist-end',
      String(Math.max(1, limit)),
      ...(this.options.extraArgs ?? []),
      url,
    ];

    const result = await run(this.options.binary, args, { timeoutMs: 180_000, signal });
    if (result.code !== 0 || !result.stdout.trim()) {
      const reason = result.stderr.split(/\r?\n/).find((line) => line.trim()) ?? `código ${result.code}`;
      throw new Error(reason.replace(/^ERROR:\s*/i, ''));
    }

    const info = JSON.parse(result.stdout) as Json;
    const rawEntries: Json[] = Array.isArray(info.entries) ? info.entries : [info];

    const entries = rawEntries
      .filter((entry) => entry && (entry.url || entry.webpage_url || entry.id))
      .map((entry) => ({
        url: String(entry.webpage_url ?? entry.url ?? `https://www.youtube.com/watch?v=${entry.id}`),
        title: typeof entry.title === 'string' ? entry.title : null,
        id: typeof entry.id === 'string' ? entry.id : null,
      }));

    return { title: typeof info.title === 'string' ? info.title : null, entries };
  }
}

/** True when a URL looks like a playlist, channel or user feed. */
export function looksLikePlaylist(url: string, platform: Platform): boolean {
  const lower = url.toLowerCase();
  if (platform === 'youtube') {
    return (
      lower.includes('/playlist') ||
      lower.includes('list=') ||
      /\/(channel|c|user)\//.test(lower) ||
      /youtube\.com\/@[^/]+(\/|$)/.test(lower)
    );
  }
  if (platform === 'tiktok') return /tiktok\.com\/@[^/]+\/?$/.test(lower);
  if (platform === 'vimeo') return lower.includes('/album/') || lower.includes('/showcase/');
  return false;
}
