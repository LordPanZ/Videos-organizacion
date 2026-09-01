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
function titleFromUrl(url: string, platform: Platform, platformId: string | null, handle: string | null): string {
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

    // The account says more than the platform does: every X video would
    // otherwise be filed under the same two words.
    const who = handle ?? label;
    return platformId ? `${who} · ${platformId}` : `Vídeo de ${who}`;
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
/**
 * A picture and a real title for an X post, from X's own embed service.
 *
 * X publishes no oEmbed thumbnail and its pages cannot be read from a browser,
 * so this is the only first-party route left. It is best effort by nature: the
 * service is undocumented and may refuse a browser outright, in which case the
 * video keeps the cover built from its account and nothing else changes. No
 * third-party relay is used — a container's contents should not travel to
 * anyone.
 */
async function twitterEmbed(id: string, timeoutMs: number): Promise<Partial<WebMetadata> | null> {
  // The token the service expects is derived from the post id.
  const token = ((Number(id) / 1e15) * Math.PI).toString(6 ** 2).replace(/(0+|\.)/g, '');
  const data = await fetchJson(
    `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(id)}&token=${token}&lang=es`,
    timeoutMs,
  );
  if (!data) return null;

  const media = Array.isArray(data.mediaDetails) ? (data.mediaDetails as Record<string, unknown>[]) : [];
  const photos = Array.isArray(data.photos) ? (data.photos as Record<string, unknown>[]) : [];
  const video = (data.video ?? null) as Record<string, unknown> | null;

  const poster =
    media.map((item) => item.media_url_https).find((value): value is string => typeof value === 'string') ??
    photos.map((item) => item.url).find((value): value is string => typeof value === 'string') ??
    (typeof video?.poster === 'string' ? video.poster : null);

  const user = (data.user ?? null) as Record<string, unknown> | null;
  // The post's own words beat any placeholder, trimmed to a line.
  const text = typeof data.text === 'string' ? data.text.replace(/https?:\/\/\S+/g, '').trim() : '';
  const title = text ? text.split('\n')[0].slice(0, 120).trim() : null;

  const millis = Number((media[0]?.video_info as Record<string, unknown> | undefined)?.duration_millis);

  if (!poster && !title) return null;
  return {
    title: title ?? undefined,
    thumbnailUrl: poster ?? undefined,
    authorName: typeof user?.name === 'string' ? user.name : undefined,
    durationSeconds: Number.isFinite(millis) && millis > 0 ? Math.round(millis / 1000) : undefined,
    enriched: true,
  };
}

export async function resolveMetadata(rawUrl: string, timeoutMs = 6000): Promise<WebMetadata> {
  const parsed = parseVideoUrl(rawUrl);

  const base: WebMetadata = {
    url: parsed.canonicalUrl,
    platform: parsed.platform,
    platformId: parsed.id,
    title: titleFromUrl(parsed.canonicalUrl, parsed.platform, parsed.id, parsed.handle),
    authorName: parsed.handle,
    authorHandle: parsed.handle,
    thumbnailUrl: derivedThumbnailUrl(parsed.platform, parsed.id),
    durationSeconds: null,
    width: null,
    height: null,
    isShort: parsed.isShort,
    enriched: false,
  };

  if (parsed.platform === 'twitter' && parsed.id) {
    const extra = await twitterEmbed(parsed.id, timeoutMs);
    return extra ? { ...base, ...extra } : base;
  }

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
