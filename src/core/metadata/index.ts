import { derivedThumbnailUrl, parseVideoUrl } from '../platforms/detect.ts';
import { LocalFileProvider } from './local.ts';
import { OEmbedProvider } from './oembed.ts';
import { OpenGraphProvider } from './opengraph.ts';
import { YtdlpProvider } from './ytdlp.ts';
import { mergeMetadata, type MetadataProvider, type VideoMetadata } from './types.ts';
import type { Platform } from '../../shared/types.ts';

export * from './types.ts';
export { YtdlpProvider, looksLikePlaylist } from './ytdlp.ts';
export { OEmbedProvider } from './oembed.ts';
export { OpenGraphProvider } from './opengraph.ts';
export { LocalFileProvider, titleFromFilename } from './local.ts';

export interface ResolverOptions {
  ytdlpPath: string | null;
  ffprobePath: string | null;
  ytdlpArgs?: string[];
}

export interface ResolveResult {
  metadata: VideoMetadata;
  /** Providers that were tried and why they did not win. */
  attempts: { provider: string; ok: boolean; error?: string }[];
}

/**
 * Produces the best metadata available for a URL by trying providers in order
 * of fidelity and merging what they return.
 *
 * The chain always yields something: even with no tools installed and no
 * network, a record built from the URL itself is enough to file the video.
 */
export class MetadataResolver {
  private readonly options: ResolverOptions;

  constructor(options: ResolverOptions) {
    this.options = options;
  }

  /** Minimal record derived from the URL alone. Never fails. */
  static fromUrl(url: string): VideoMetadata {
    const parsed = parseVideoUrl(url);
    return {
      url,
      canonicalUrl: parsed.canonicalUrl,
      platform: parsed.platform,
      platformId: parsed.id,
      title: fallbackTitle(url, parsed.platform),
      description: null,
      authorName: parsed.handle,
      authorHandle: parsed.handle,
      authorId: null,
      authorUrl: null,
      durationSeconds: null,
      publishedAt: null,
      thumbnailUrl: derivedThumbnailUrl(parsed.platform, parsed.id),
      width: null,
      height: null,
      viewCount: null,
      likeCount: null,
      commentCount: null,
      language: null,
      isLive: false,
      isShort: parsed.isShort,
      platformTags: [],
      source: 'url',
      raw: null,
    };
  }

  private providers(platform: Platform, isLocal: boolean): MetadataProvider[] {
    if (isLocal) return [new LocalFileProvider(this.options.ffprobePath)];

    const chain: MetadataProvider[] = [];
    if (this.options.ytdlpPath) {
      chain.push(new YtdlpProvider({ binary: this.options.ytdlpPath, extraArgs: this.options.ytdlpArgs }));
    }
    const oembed = new OEmbedProvider();
    if (oembed.supports('', platform)) chain.push(oembed);
    chain.push(new OpenGraphProvider());
    return chain;
  }

  async resolve(url: string, signal?: AbortSignal): Promise<ResolveResult> {
    const trimmed = url.trim();
    const isLocal = trimmed.startsWith('file://') || /^([a-zA-Z]:\\|\/)/.test(trimmed);
    const parsed = parseVideoUrl(trimmed);
    const attempts: ResolveResult['attempts'] = [];

    let best: VideoMetadata | null = null;

    for (const provider of this.providers(parsed.platform, isLocal)) {
      if (signal?.aborted) break;
      if (!provider.supports(trimmed, parsed.platform)) continue;

      try {
        const result = await provider.fetch(trimmed, signal);
        if (!result) {
          attempts.push({ provider: provider.name, ok: false, error: 'sin datos' });
          continue;
        }
        attempts.push({ provider: provider.name, ok: true });
        best = best === null ? result : mergeMetadata(best, result);

        // yt-dlp is authoritative; anything else may still be missing fields
        // that a later provider can fill in.
        if (result.source === 'ytdlp' || result.source === 'local') break;
      } catch (error) {
        attempts.push({ provider: provider.name, ok: false, error: (error as Error).message });
      }
    }

    const metadata = mergeMetadata(best ?? MetadataResolver.fromUrl(trimmed), MetadataResolver.fromUrl(trimmed));
    return { metadata, attempts };
  }
}

/** A readable placeholder title when nothing better is known yet. */
function fallbackTitle(url: string, platform: Platform): string {
  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname.split('/').filter(Boolean).pop();
    if (lastSegment && lastSegment.length > 2 && !/^\d+$/.test(lastSegment)) {
      return decodeURIComponent(lastSegment).replace(/[-_]+/g, ' ').replace(/\.\w{2,4}$/, '').trim();
    }
    return `Vídeo de ${platform === 'other' ? parsed.hostname.replace(/^www\./, '') : platform}`;
  } catch {
    return 'Vídeo sin título';
  }
}
