import { derivedThumbnailUrl, parseVideoUrl } from '../core/platforms/detect.ts';
import { PLATFORM_LABELS, type Platform } from '../shared/types.ts';

export interface WebMetadata {
  url: string;
  platform: Platform;
  platformId: string | null;
  title: string;
  authorName: string | null;
  authorHandle: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  isShort: boolean;
  /** False when only the URL could be read, so the interface can invite a rename. */
  enriched: boolean;
}

/**
 * Public oEmbed endpoints. Whether a browser may read them depends on the
 * CORS headers each service sends, which varies and can change without notice,
 * so every call is best-effort.
 */
const OEMBED: Partial<Record<Platform, (url: string) => string>> = {
  youtube: (url) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
  vimeo: (url) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
  tiktok: (url) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
  dailymotion: (url) => `https://www.dailymotion.com/services/oembed?format=json&url=${encodeURIComponent(url)}`,
  soundcloud: (url) => `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`,
};

/**
 * Path segments that name the page type rather than the video, and so say
 * nothing useful in a title.
 */
const GENERIC_SEGMENTS = new Set([
  'watch', 'video', 'videos', 'embed', 'shorts', 'short', 'reel', 'reels',
  'p', 'tv', 'status', 'v', 'clip', 'clips', 'post', 'e',
]);

/**
 * A readable placeholder for when only the address is known.
 *
 * A slug in the URL usually carries the real title, so that wins. Failing
 * that, the platform and the video id at least tell two entries apart, which
 * "watch" repeated five times would not.
 */
function titleFromUrl(url: string, platform: Platform, platformId: string | null): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const label = platform === 'other' ? parsed.hostname.replace(/^www\./, '') : PLATFORM_LABELS[platform];

    for (const segment of [...segments].reverse()) {
      if (GENERIC_SEGMENTS.has(segment.toLowerCase())) continue;
      if (segment.startsWith('@')) continue;
      if (segment === platformId) break;
      // A slug reads as words; an opaque id does not.
      const words = decodeURIComponent(segment).replace(/[-_]+/g, ' ').replace(/\.\w{2,4}$/, '').trim();
      if (words.length > 3 && words.includes(' ')) {
        return words.charAt(0).toUpperCase() + words.slice(1);
      }
      break;
    }

    return platformId ? `${label} · ${platformId}` : `Vídeo de ${label}`;
  } catch {
    return 'Vídeo sin título';
  }
}

async function fetchJson(url: string, timeoutMs: number): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, mode: 'cors' });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    // Blocked by CORS, offline, or the service is down. The caller falls back.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads what it can about a URL.
 *
 * The URL alone already yields the platform, the id and — for YouTube — the
 * thumbnail, so a video is always filed with a picture even with no network.
 * The title is then improved opportunistically.
 */
export async function resolveMetadata(rawUrl: string, timeoutMs = 6000): Promise<WebMetadata> {
  const parsed = parseVideoUrl(rawUrl);

  const base: WebMetadata = {
    url: parsed.canonicalUrl,
    platform: parsed.platform,
    platformId: parsed.id,
    title: titleFromUrl(parsed.canonicalUrl, parsed.platform, parsed.id),
    authorName: parsed.handle,
    authorHandle: parsed.handle,
    thumbnailUrl: derivedThumbnailUrl(parsed.platform, parsed.id),
    durationSeconds: null,
    width: null,
    height: null,
    isShort: parsed.isShort,
    enriched: false,
  };

  const build = OEMBED[parsed.platform];
  if (!build) return base;

  const data = await fetchJson(build(parsed.canonicalUrl), timeoutMs);
  if (!data) return base;

  const text = (key: string): string | null => (typeof data[key] === 'string' ? (data[key] as string) : null);
  const number = (key: string): number | null => {
    const value = Number(data[key]);
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  return {
    ...base,
    title: text('title')?.trim() || base.title,
    authorName: text('author_name') ?? base.authorName,
    thumbnailUrl: text('thumbnail_url') ?? base.thumbnailUrl,
    durationSeconds: number('duration'),
    width: number('width'),
    height: number('height'),
    enriched: true,
  };
}

/** Splits pasted text into candidate URLs. */
export function splitUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of matches) {
    const cleaned = match.replace(/[.,;:!?]+$/, '');
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
}
