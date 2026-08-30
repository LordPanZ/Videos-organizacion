import type { Library } from '../db/library.ts';
import type { MetadataResolver } from '../metadata/index.ts';
import type { VideoMetadata } from '../metadata/types.ts';
import type { ThumbnailCache } from './thumbnails.ts';
import type { AutoTagger } from './autoTag.ts';
import { parseVideoUrl } from '../platforms/detect.ts';
import type { ImportReport, Video } from '../../shared/types.ts';

export interface ImportOptions {
  /** Fetch full metadata instead of filing the URL immediately. */
  fetchMetadata?: boolean;
  /** Download and cache the thumbnail image. */
  downloadThumbnail?: boolean;
  /** Run the auto-tagging engine on each new video. */
  autoTag?: boolean;
  /** Tags applied to every imported video, on top of automatic ones. */
  tagIds?: string[];
  /** Add each imported video to this collection. */
  collectionId?: string;
  /** How many URLs to process at once. */
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: ImportProgress) => void;
}

export interface ImportProgress {
  done: number;
  total: number;
  current: string;
  lastTitle: string | null;
  added: number;
  duplicates: number;
  failed: number;
}

/**
 * Turns URLs into library entries.
 *
 * The video row is written before metadata is fetched, so a large paste shows
 * up in the grid immediately and fills in as the network responds.
 */
export class Importer {
  private readonly library: Library;
  private readonly resolver: MetadataResolver;
  private readonly thumbnails: ThumbnailCache;
  private readonly tagger: AutoTagger;

  constructor(library: Library, resolver: MetadataResolver, thumbnails: ThumbnailCache, tagger: AutoTagger) {
    this.library = library;
    this.resolver = resolver;
    this.thumbnails = thumbnails;
    this.tagger = tagger;
  }

  /** Imports a batch of URLs, reporting progress as it goes. */
  async importUrls(urls: string[], options: ImportOptions = {}): Promise<ImportReport> {
    const report: ImportReport = { requested: urls.length, added: 0, duplicates: 0, failed: [], videoIds: [] };
    const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 12));

    // Deduplicate within the batch itself before touching the database.
    const seen = new Set<string>();
    const queue: string[] = [];
    for (const raw of urls) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const canonical = parseVideoUrl(trimmed).canonicalUrl;
      if (seen.has(canonical)) {
        report.duplicates += 1;
        continue;
      }
      seen.add(canonical);
      queue.push(trimmed);
    }

    let index = 0;
    let done = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        if (options.signal?.aborted) return;
        const position = index++;
        if (position >= queue.length) return;
        const url = queue[position];

        try {
          const result = await this.importOne(url, options);
          if (result === 'duplicate') report.duplicates += 1;
          else {
            report.added += 1;
            report.videoIds.push(result.id);
          }
          done += 1;
          options.onProgress?.({
            done,
            total: queue.length,
            current: url,
            lastTitle: result === 'duplicate' ? null : result.title,
            added: report.added,
            duplicates: report.duplicates,
            failed: report.failed.length,
          });
        } catch (error) {
          report.failed.push({ url, error: (error as Error).message });
          done += 1;
          options.onProgress?.({
            done,
            total: queue.length,
            current: url,
            lastTitle: null,
            added: report.added,
            duplicates: report.duplicates,
            failed: report.failed.length,
          });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
    return report;
  }

  /** Imports one URL. Returns 'duplicate' when it is already in the library. */
  async importOne(url: string, options: ImportOptions = {}): Promise<Video | 'duplicate'> {
    const parsed = parseVideoUrl(url);
    const existing = this.library.videos.getByUrl(parsed.canonicalUrl);
    if (existing) return 'duplicate';

    let metadata: VideoMetadata | null = null;
    if (options.fetchMetadata !== false) {
      const resolved = await this.resolver.resolve(url, options.signal);
      metadata = resolved.metadata;
    }

    const seed = metadata ?? (await import('../metadata/index.ts')).MetadataResolver.fromUrl(url);

    // Re-check after the network round trip: a concurrent worker may have
    // inserted the same video, and yt-dlp may resolve a short link to a URL
    // that is already in the library.
    const afterFetch = this.library.videos.getByUrl(seed.canonicalUrl);
    if (afterFetch) return 'duplicate';

    const author =
      seed.authorName || seed.authorHandle
        ? this.library.authors.ensure({
            platform: seed.platform,
            name: seed.authorName ?? seed.authorHandle ?? 'Desconocido',
            handle: seed.authorHandle,
            externalId: seed.authorId,
            url: seed.authorUrl,
          })
        : null;

    let thumbnailPath: string | null = null;
    if (options.downloadThumbnail !== false && seed.thumbnailUrl) {
      thumbnailPath = await this.thumbnails.store(seed.thumbnailUrl, options.signal);
    }

    const video = this.library.videos.insert({
      url: seed.canonicalUrl,
      platform: seed.platform,
      platformId: seed.platformId,
      title: seed.title,
      description: seed.description,
      authorId: author?.id ?? null,
      durationSeconds: seed.durationSeconds,
      publishedAt: seed.publishedAt,
      thumbnailPath,
      thumbnailUrl: seed.thumbnailUrl,
      width: seed.width,
      height: seed.height,
      viewCount: seed.viewCount,
      likeCount: seed.likeCount,
      commentCount: seed.commentCount,
      language: seed.language,
      isLive: seed.isLive,
      isShort: seed.isShort,
      rawMetadata: seed.raw,
    });

    if (options.autoTag !== false) this.tagger.apply(video, seed);
    if (options.tagIds?.length) {
      this.library.tags.addToVideos([video.id], options.tagIds);
      this.library.videos.reindex(video.id);
    }
    if (options.collectionId) this.library.collections.addVideos(options.collectionId, [video.id]);

    return this.library.videos.getById(video.id) ?? video;
  }

  /**
   * Refreshes metadata for videos already in the library, keeping user-owned
   * fields (rating, notes, tags) untouched.
   */
  async refresh(
    videoIds: string[],
    options: { signal?: AbortSignal; onProgress?: (done: number, total: number, title: string) => void } = {},
  ): Promise<{ updated: number; failed: number }> {
    let updated = 0;
    let failed = 0;

    for (const [position, id] of videoIds.entries()) {
      if (options.signal?.aborted) break;
      const video = this.library.videos.getById(id);
      if (!video) continue;

      try {
        const { metadata } = await this.resolver.resolve(video.url, options.signal);
        const author =
          metadata.authorName || metadata.authorHandle
            ? this.library.authors.ensure({
                platform: metadata.platform,
                name: metadata.authorName ?? metadata.authorHandle ?? 'Desconocido',
                handle: metadata.authorHandle,
                externalId: metadata.authorId,
                url: metadata.authorUrl,
              })
            : null;

        let thumbnailPath = video.thumbnailPath;
        if (metadata.thumbnailUrl && metadata.thumbnailUrl !== video.thumbnailUrl) {
          thumbnailPath = (await this.thumbnails.store(metadata.thumbnailUrl, options.signal)) ?? thumbnailPath;
        }

        this.library.videos.update(id, {
          title: metadata.title !== 'Sin título' ? metadata.title : video.title,
          description: metadata.description ?? video.description,
          authorId: author?.id ?? video.author?.id ?? null,
          durationSeconds: metadata.durationSeconds ?? video.durationSeconds,
          publishedAt: metadata.publishedAt ?? video.publishedAt,
          thumbnailUrl: metadata.thumbnailUrl ?? video.thumbnailUrl,
          thumbnailPath,
          viewCount: metadata.viewCount ?? video.viewCount,
          likeCount: metadata.likeCount ?? video.likeCount,
          commentCount: metadata.commentCount ?? video.commentCount,
          width: metadata.width ?? video.width,
          height: metadata.height ?? video.height,
          language: metadata.language ?? video.language,
          isLive: metadata.isLive,
          platformId: metadata.platformId ?? video.platformId,
          availability: 'ok',
          lastCheckedAt: new Date().toISOString(),
          rawMetadata: metadata.raw,
        });
        updated += 1;
        options.onProgress?.(position + 1, videoIds.length, metadata.title);
      } catch (error) {
        failed += 1;
        // A fetch failure is itself information: the link is probably dead.
        this.library.videos.update(id, {
          availability: classifyError((error as Error).message),
          lastCheckedAt: new Date().toISOString(),
        });
        options.onProgress?.(position + 1, videoIds.length, video.title);
      }
    }

    return { updated, failed };
  }
}

/** Maps a provider error message onto an availability state. */
function classifyError(message: string): Video['availability'] {
  const lower = message.toLowerCase();
  if (lower.includes('private')) return 'private';
  if (lower.includes('not available in your country') || lower.includes('geo')) return 'geoblocked';
  if (
    lower.includes('unavailable') ||
    lower.includes('removed') ||
    lower.includes('deleted') ||
    lower.includes('404') ||
    lower.includes('does not exist')
  ) {
    return 'unavailable';
  }
  return 'unknown';
}
