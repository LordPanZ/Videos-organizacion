import { derivedThumbnailUrl, parseVideoUrl } from '../platforms/detect.ts';
import { fetchJson } from './http.ts';
import type { MetadataProvider, VideoMetadata } from './types.ts';
import type { Platform } from '../../shared/types.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type OEmbed = Record<string, any>;

/** Public oEmbed endpoints that need no API key. */
const ENDPOINTS: Partial<Record<Platform, (url: string) => string>> = {
  youtube: (url) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
  vimeo: (url) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
  tiktok: (url) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
  dailymotion: (url) => `https://www.dailymotion.com/services/oembed?format=json&url=${encodeURIComponent(url)}`,
  soundcloud: (url) => `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`,
  reddit: (url) => `https://www.reddit.com/oembed?url=${encodeURIComponent(url)}`,
};

/**
 * Metadata from each platform's public oEmbed endpoint.
 *
 * It returns far less than yt-dlp — usually title, author and thumbnail — but
 * needs no external binary, so a fresh install is useful immediately.
 */
export class OEmbedProvider implements MetadataProvider {
  readonly name = 'oembed' as const;

  supports(_url: string, platform: Platform): boolean {
    return platform in ENDPOINTS;
  }

  async fetch(url: string, signal?: AbortSignal): Promise<VideoMetadata | null> {
    const parsed = parseVideoUrl(url);
    const build = ENDPOINTS[parsed.platform];
    if (!build) return null;

    const data = await fetchJson<OEmbed>(build(parsed.canonicalUrl), { signal, timeoutMs: 12_000 });

    const duration = Number(data.duration ?? 0);
    const width = Number(data.width ?? 0);
    const height = Number(data.height ?? 0);

    return {
      url,
      canonicalUrl: parsed.canonicalUrl,
      platform: parsed.platform,
      platformId: parsed.id,
      title: (typeof data.title === 'string' && data.title.trim()) || 'Sin título',
      description: typeof data.description === 'string' ? data.description : null,
      authorName: typeof data.author_name === 'string' ? data.author_name : null,
      authorHandle: parsed.handle,
      authorId: null,
      authorUrl: typeof data.author_url === 'string' ? data.author_url : null,
      durationSeconds: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
      publishedAt: typeof data.upload_date === 'string' ? new Date(data.upload_date).toISOString() : null,
      thumbnailUrl:
        (typeof data.thumbnail_url === 'string' ? data.thumbnail_url : null) ??
        derivedThumbnailUrl(parsed.platform, parsed.id),
      width: width > 0 ? width : null,
      height: height > 0 ? height : null,
      viewCount: null,
      likeCount: null,
      commentCount: null,
      language: null,
      isLive: false,
      isShort: parsed.isShort,
      platformTags: [],
      source: 'oembed',
      raw: data,
    };
  }
}
