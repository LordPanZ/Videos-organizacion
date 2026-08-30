import { derivedThumbnailUrl, parseVideoUrl } from '../platforms/detect.ts';
import { fetchText } from './http.ts';
import type { MetadataProvider, VideoMetadata } from './types.ts';

/** Decodes the handful of HTML entities that show up in meta tags. */
function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * Reads a `<meta>` value by property or name. Attribute order varies between
 * sites, so both `property="og:x" content="y"` and the reverse are matched.
 */
function readMeta(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*\\scontent=["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*\\s(?:property|name)=["']${escaped}["']`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(html);
      if (match?.[1]) return decodeEntities(match[1]).trim();
    }
  }
  return null;
}

/** Parses ISO-8601 durations such as `PT1H2M30S`. */
export function parseIso8601Duration(value: string | null): number | null {
  if (!value) return null;
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(value.trim());
  if (!match || match.slice(1).every((part) => part === undefined)) return null;
  const [, days, hours, minutes, seconds] = match;
  return Math.round(
    Number(days ?? 0) * 86400 + Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0),
  );
}

/**
 * Last-resort provider: fetches the page and reads its Open Graph tags. Works
 * on essentially any site, including ones with no oEmbed endpoint.
 */
export class OpenGraphProvider implements MetadataProvider {
  readonly name = 'opengraph' as const;

  supports(url: string): boolean {
    return url.startsWith('http://') || url.startsWith('https://');
  }

  async fetch(url: string, signal?: AbortSignal): Promise<VideoMetadata | null> {
    const parsed = parseVideoUrl(url);
    const html = await fetchText(parsed.canonicalUrl, { signal, timeoutMs: 15_000, maxBytes: 1_500_000 });

    const documentTitle = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
    const title = readMeta(html, ['og:title', 'twitter:title']) ?? (documentTitle ? decodeEntities(documentTitle) : null);

    const width = Number(readMeta(html, ['og:video:width', 'og:image:width']) ?? 0);
    const height = Number(readMeta(html, ['og:video:height', 'og:image:height']) ?? 0);
    const published = readMeta(html, ['article:published_time', 'og:video:release_date', 'uploadDate']);
    const parsedDate = published ? new Date(published) : null;

    return {
      url,
      canonicalUrl: parsed.canonicalUrl,
      platform: parsed.platform,
      platformId: parsed.id,
      title: title && title.trim() ? title.trim() : 'Sin título',
      description: readMeta(html, ['og:description', 'twitter:description', 'description']),
      authorName: readMeta(html, ['og:site_name', 'author', 'twitter:creator']),
      authorHandle: parsed.handle,
      authorId: null,
      authorUrl: null,
      durationSeconds: parseIso8601Duration(readMeta(html, ['og:video:duration', 'duration'])),
      publishedAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null,
      thumbnailUrl:
        readMeta(html, ['og:image:secure_url', 'og:image', 'twitter:image']) ??
        derivedThumbnailUrl(parsed.platform, parsed.id),
      width: width > 0 ? width : null,
      height: height > 0 ? height : null,
      viewCount: null,
      likeCount: null,
      commentCount: null,
      language: readMeta(html, ['og:locale']),
      isLive: false,
      isShort: parsed.isShort,
      platformTags: (readMeta(html, ['og:video:tag', 'keywords']) ?? '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 25),
      source: 'opengraph',
      raw: null,
    };
  }
}
