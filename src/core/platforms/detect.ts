import type { Platform } from '../../shared/types.ts';

export interface ParsedUrl {
  platform: Platform;
  /** Platform-native id, when the URL carries one. */
  id: string | null;
  /** Cleaned, canonical form used for dedupe and storage. */
  canonicalUrl: string;
  /** True for vertical short-form URLs (Shorts, Reels, TikTok). */
  isShort: boolean;
  /** Creator handle when the URL exposes it. */
  handle: string | null;
}

/** Query parameters that carry no meaning and break duplicate detection. */
const TRACKING_PARAMS = [
  'si',
  'feature',
  'app',
  'ab_channel',
  'pp',
  'sd',
  'is_from_webapp',
  'sender_device',
  'sender_web_id',
  'web_id',
  'igshid',
  'igsh',
  'img_index',
  'ref_src',
  'ref_url',
  's',
  'cxt',
  'mibextid',
  'rdid',
  'fbclid',
  'gclid',
  'yclid',
  'msclkid',
  'share_id',
  'social_share',
  'from',
  'spm_id_from',
  'vd_source',
];

const HOST_PLATFORMS: { pattern: RegExp; platform: Platform }[] = [
  { pattern: /(^|\.)youtube\.com$/i, platform: 'youtube' },
  { pattern: /^youtu\.be$/i, platform: 'youtube' },
  { pattern: /(^|\.)youtube-nocookie\.com$/i, platform: 'youtube' },
  { pattern: /(^|\.)tiktok\.com$/i, platform: 'tiktok' },
  { pattern: /(^|\.)instagram\.com$/i, platform: 'instagram' },
  { pattern: /(^|\.)instagr\.am$/i, platform: 'instagram' },
  { pattern: /(^|\.)vimeo\.com$/i, platform: 'vimeo' },
  { pattern: /(^|\.)twitter\.com$/i, platform: 'twitter' },
  { pattern: /(^|\.)x\.com$/i, platform: 'twitter' },
  { pattern: /(^|\.)twitch\.tv$/i, platform: 'twitch' },
  { pattern: /(^|\.)dailymotion\.com$/i, platform: 'dailymotion' },
  { pattern: /^dai\.ly$/i, platform: 'dailymotion' },
  { pattern: /(^|\.)facebook\.com$/i, platform: 'facebook' },
  { pattern: /^fb\.watch$/i, platform: 'facebook' },
  { pattern: /(^|\.)reddit\.com$/i, platform: 'reddit' },
  { pattern: /^redd\.it$/i, platform: 'reddit' },
  { pattern: /(^|\.)bilibili\.com$/i, platform: 'bilibili' },
  { pattern: /^b23\.tv$/i, platform: 'bilibili' },
  { pattern: /(^|\.)rumble\.com$/i, platform: 'rumble' },
  { pattern: /(^|\.)odysee\.com$/i, platform: 'odysee' },
  { pattern: /(^|\.)kick\.com$/i, platform: 'kick' },
  { pattern: /(^|\.)pinterest\.[a-z.]+$/i, platform: 'pinterest' },
  { pattern: /^pin\.it$/i, platform: 'pinterest' },
  { pattern: /(^|\.)linkedin\.com$/i, platform: 'linkedin' },
  { pattern: /(^|\.)soundcloud\.com$/i, platform: 'soundcloud' },
];

/** Recognizes the platform from a URL's host. */
export function detectPlatform(url: string): Platform {
  const parsed = safeUrl(url);
  if (!parsed) return 'other';
  if (parsed.protocol === 'file:') return 'local';
  const host = parsed.hostname.replace(/^www\./i, '');
  for (const entry of HOST_PLATFORMS) {
    if (entry.pattern.test(host)) return entry.platform;
  }
  return 'other';
}

function safeUrl(url: string): URL | null {
  try {
    return new URL(url.trim());
  } catch {
    // Accept bare hosts such as "youtube.com/watch?v=x".
    try {
      return new URL(`https://${url.trim()}`);
    } catch {
      return null;
    }
  }
}

/** Strips tracking parameters and normalizes the host casing. */
export function normalizeUrl(url: string): string {
  const parsed = safeUrl(url);
  if (!parsed) return url.trim();

  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.hash = '';
  for (const param of TRACKING_PARAMS) parsed.searchParams.delete(param);
  // Drop a trailing slash on paths deeper than the root.
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }
  return parsed.toString();
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extracts the platform, native id and a canonical URL.
 *
 * Canonicalization matters twice: it is what duplicate detection compares, and
 * for several platforms it is what lets the app derive a thumbnail without any
 * network call.
 */
export function parseVideoUrl(rawUrl: string): ParsedUrl {
  const url = safeUrl(rawUrl);
  const platform = detectPlatform(rawUrl);

  if (!url) {
    return { platform: 'other', id: null, canonicalUrl: rawUrl.trim(), isShort: false, handle: null };
  }

  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);
  const normalized = normalizeUrl(rawUrl);

  switch (platform) {
    case 'youtube': {
      let id: string | null = null;
      let isShort = false;

      if (host === 'youtu.be') id = segments[0] ?? null;
      else if (segments[0] === 'shorts') {
        id = segments[1] ?? null;
        isShort = true;
      } else if (segments[0] === 'embed' || segments[0] === 'live' || segments[0] === 'v') {
        id = segments[1] ?? null;
      } else {
        id = url.searchParams.get('v');
      }

      if (id && !YOUTUBE_ID.test(id)) id = null;
      return {
        platform,
        id,
        canonicalUrl: id ? `https://www.youtube.com/watch?v=${id}` : normalized,
        isShort,
        handle: segments[0]?.startsWith('@') ? segments[0] : null,
      };
    }

    case 'tiktok': {
      const videoIndex = segments.indexOf('video');
      const id = videoIndex >= 0 ? (segments[videoIndex + 1] ?? null) : null;
      const handle = segments.find((s) => s.startsWith('@')) ?? null;
      return {
        platform,
        id,
        canonicalUrl: id && handle ? `https://www.tiktok.com/${handle}/video/${id}` : normalized,
        isShort: true,
        handle,
      };
    }

    case 'instagram': {
      const kinds = ['p', 'reel', 'reels', 'tv'];
      const index = segments.findIndex((s) => kinds.includes(s));
      const kind = index >= 0 ? segments[index] : null;
      const id = index >= 0 ? (segments[index + 1] ?? null) : null;
      // A profile prefix appears only when the post is linked from a profile.
      const handle = index > 0 ? segments[0] : null;
      const path = kind === 'reels' ? 'reel' : (kind ?? 'p');
      return {
        platform,
        id,
        canonicalUrl: id ? `https://www.instagram.com/${path}/${id}/` : normalized,
        isShort: kind === 'reel' || kind === 'reels',
        handle,
      };
    }

    case 'vimeo': {
      const numeric = segments.find((s) => /^\d+$/.test(s)) ?? null;
      return {
        platform,
        id: numeric,
        canonicalUrl: numeric ? `https://vimeo.com/${numeric}` : normalized,
        isShort: false,
        handle: null,
      };
    }

    case 'twitter': {
      const index = segments.indexOf('status');
      const id = index >= 0 ? (segments[index + 1] ?? null) : null;
      const handle = segments[0] && segments[0] !== 'i' ? `@${segments[0]}` : null;
      return {
        platform,
        id,
        canonicalUrl: id && handle ? `https://x.com/${segments[0]}/status/${id}` : normalized,
        isShort: false,
        handle,
      };
    }

    case 'twitch': {
      if (segments[0] === 'videos') {
        return {
          platform,
          id: segments[1] ?? null,
          canonicalUrl: segments[1] ? `https://www.twitch.tv/videos/${segments[1]}` : normalized,
          isShort: false,
          handle: null,
        };
      }
      const clipIndex = segments.indexOf('clip');
      const id = clipIndex >= 0 ? (segments[clipIndex + 1] ?? null) : (host === 'clips.twitch.tv' ? segments[0] : null);
      return { platform, id: id ?? null, canonicalUrl: normalized, isShort: true, handle: segments[0] ?? null };
    }

    case 'dailymotion': {
      const id = host === 'dai.ly' ? segments[0] : segments[segments.indexOf('video') + 1];
      return {
        platform,
        id: id ?? null,
        canonicalUrl: id ? `https://www.dailymotion.com/video/${id}` : normalized,
        isShort: false,
        handle: null,
      };
    }

    case 'facebook': {
      const id = url.searchParams.get('v') ?? (segments.includes('videos') ? segments[segments.indexOf('videos') + 1] : null);
      return { platform, id: id ?? null, canonicalUrl: normalized, isShort: segments[0] === 'reel', handle: null };
    }

    case 'reddit': {
      const index = segments.indexOf('comments');
      const id = index >= 0 ? (segments[index + 1] ?? null) : (host === 'redd.it' ? segments[0] : null);
      return { platform, id: id ?? null, canonicalUrl: normalized, isShort: false, handle: null };
    }

    case 'bilibili': {
      const id = segments.find((s) => /^(BV|av)/i.test(s)) ?? null;
      return {
        platform,
        id,
        canonicalUrl: id ? `https://www.bilibili.com/video/${id}` : normalized,
        isShort: false,
        handle: null,
      };
    }

    case 'rumble': {
      const id = segments[0]?.split('-')[0] ?? null;
      return { platform, id, canonicalUrl: normalized, isShort: false, handle: null };
    }

    case 'odysee': {
      const handle = segments.find((s) => s.startsWith('@')) ?? null;
      return { platform, id: segments[segments.length - 1] ?? null, canonicalUrl: normalized, isShort: false, handle };
    }

    case 'kick': {
      const id = segments.includes('videos') ? segments[segments.indexOf('videos') + 1] : (segments[1] ?? null);
      return { platform, id: id ?? null, canonicalUrl: normalized, isShort: false, handle: segments[0] ?? null };
    }

    case 'pinterest': {
      const id = segments.includes('pin') ? segments[segments.indexOf('pin') + 1] : null;
      return { platform, id: id ?? null, canonicalUrl: normalized, isShort: false, handle: null };
    }

    case 'soundcloud':
      return {
        platform,
        id: segments.join('/') || null,
        canonicalUrl: normalized,
        isShort: false,
        handle: segments[0] ?? null,
      };

    case 'local':
      return { platform, id: null, canonicalUrl: rawUrl, isShort: false, handle: null };

    default:
      return { platform, id: null, canonicalUrl: normalized, isShort: false, handle: null };
  }
}

/**
 * Thumbnail URL derivable without any network request. YouTube and Vimeo
 * expose predictable image paths, which keeps grid population instant.
 */
export function derivedThumbnailUrl(platform: Platform, id: string | null): string | null {
  if (!id) return null;
  switch (platform) {
    case 'youtube':
      // hqdefault exists for every video; maxresdefault does not.
      return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    default:
      return null;
  }
}

/** Embeddable player URL for the detail view, when the platform allows it. */
export function embedUrl(platform: Platform, id: string | null, canonicalUrl: string): string | null {
  if (!id) return null;
  switch (platform) {
    case 'youtube':
      return `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
    case 'vimeo':
      return `https://player.vimeo.com/video/${id}`;
    case 'dailymotion':
      return `https://www.dailymotion.com/embed/video/${id}`;
    case 'twitch':
      return `https://player.twitch.tv/?video=${id}&parent=localhost`;
    case 'tiktok':
      return `https://www.tiktok.com/embed/v2/${id}`;
    case 'instagram':
      return `${canonicalUrl.replace(/\/$/, '')}/embed`;
    default:
      return null;
  }
}

/** Video file extensions the local-folder scanner picks up. */
export const VIDEO_EXTENSIONS = [
  '.mp4',
  '.mkv',
  '.webm',
  '.mov',
  '.avi',
  '.m4v',
  '.flv',
  '.wmv',
  '.mpg',
  '.mpeg',
  '.ts',
  '.m2ts',
  '.ogv',
  '.3gp',
];

/** Extracts every http(s) URL from a blob of pasted text. */
export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of matches) {
    // Trailing punctuation is almost always sentence punctuation, not URL.
    const cleaned = match.replace(/[.,;:!?]+$/, '');
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
}
