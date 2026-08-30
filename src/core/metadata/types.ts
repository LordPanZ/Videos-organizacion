import type { Platform } from '../../shared/types.ts';

/** Normalized metadata every provider produces, whatever its source. */
export interface VideoMetadata {
  url: string;
  canonicalUrl: string;
  platform: Platform;
  platformId: string | null;
  title: string;
  description: string | null;
  authorName: string | null;
  authorHandle: string | null;
  authorId: string | null;
  authorUrl: string | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  language: string | null;
  isLive: boolean;
  isShort: boolean;
  /** Tags and categories the platform itself assigns. */
  platformTags: string[];
  /** Which provider produced this record. */
  source: 'ytdlp' | 'oembed' | 'opengraph' | 'local' | 'url';
  /** Untouched provider payload, kept for future re-parsing. */
  raw: unknown;
}

export interface MetadataProvider {
  readonly name: VideoMetadata['source'];
  /** Cheap check so the chain can skip providers that cannot handle a URL. */
  supports(url: string, platform: Platform): boolean;
  fetch(url: string, signal?: AbortSignal): Promise<VideoMetadata | null>;
}

/** Merges a lower-priority record into a higher-priority one, filling gaps. */
export function mergeMetadata(primary: VideoMetadata, fallback: VideoMetadata | null): VideoMetadata {
  if (!fallback) return primary;
  const pick = <K extends keyof VideoMetadata>(key: K): VideoMetadata[K] => {
    const value = primary[key];
    if (value === null || value === undefined || value === '') return fallback[key];
    return value;
  };

  return {
    ...primary,
    title: primary.title && primary.title !== 'Sin título' ? primary.title : fallback.title,
    description: pick('description'),
    authorName: pick('authorName'),
    authorHandle: pick('authorHandle'),
    authorId: pick('authorId'),
    authorUrl: pick('authorUrl'),
    durationSeconds: pick('durationSeconds'),
    publishedAt: pick('publishedAt'),
    thumbnailUrl: pick('thumbnailUrl'),
    width: pick('width'),
    height: pick('height'),
    viewCount: pick('viewCount'),
    likeCount: pick('likeCount'),
    commentCount: pick('commentCount'),
    language: pick('language'),
    platformTags: primary.platformTags.length > 0 ? primary.platformTags : fallback.platformTags,
  };
}
