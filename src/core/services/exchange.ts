import { writeFile, readFile } from 'node:fs/promises';
import type { Library } from '../db/library.ts';
import type { Video } from '../../shared/types.ts';
import { formatDuration } from '../../shared/query/values.ts';

export type ExportFormat = 'json' | 'csv' | 'html' | 'txt' | 'm3u';

export interface ExportOptions {
  format: ExportFormat;
  /** Restrict to these videos; omit to export everything matching `query`. */
  videoIds?: string[];
  query?: string;
}

const CSV_COLUMNS = [
  'title',
  'url',
  'platform',
  'author',
  'duration',
  'published',
  'added',
  'rating',
  'favorite',
  'watchStatus',
  'tags',
  'notes',
  'filePath',
] as const;

/** RFC-4180 quoting: wrap in quotes and double any embedded quote. */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toCsv(videos: Video[]): string {
  const rows = [CSV_COLUMNS.join(',')];
  for (const video of videos) {
    rows.push(
      [
        video.title,
        video.url,
        video.platform,
        video.author?.name ?? '',
        video.durationSeconds ?? '',
        video.publishedAt ?? '',
        video.addedAt,
        video.rating,
        video.favorite ? 'sí' : 'no',
        video.watchStatus,
        video.tags.map((tag) => tag.name).join('; '),
        video.notes ?? '',
        video.filePath ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return rows.join('\n');
}

/** A self-contained, offline-readable HTML index of the library. */
function toHtml(videos: Video[], title: string): string {
  const cards = videos
    .map((video) => {
      const thumbnail = video.thumbnailUrl ? `<img src="${escapeHtml(video.thumbnailUrl)}" alt="" loading="lazy">` : '';
      const tags = video.tags.map((tag) => `<span class="tag">${escapeHtml(tag.name)}</span>`).join('');
      return `<article class="card">
  <a href="${escapeHtml(video.url)}" target="_blank" rel="noreferrer">${thumbnail}</a>
  <div class="body">
    <h2><a href="${escapeHtml(video.url)}" target="_blank" rel="noreferrer">${escapeHtml(video.title)}</a></h2>
    <p class="meta">${escapeHtml(video.author?.name ?? '—')} · ${escapeHtml(video.platform)} · ${formatDuration(video.durationSeconds)}</p>
    <div class="tags">${tags}</div>
  </div>
</article>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; --bg:#0f1115; --fg:#e8eaed; --card:#181b21; --muted:#9aa4b2; --accent:#4c8dff; }
  @media (prefers-color-scheme: light) { :root { --bg:#f6f7f9; --fg:#1a1d23; --card:#fff; --muted:#5f6673; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:32px; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif; }
  h1 { font-size:24px; margin:0 0 4px; }
  .count { color:var(--muted); margin:0 0 28px; }
  .grid { display:grid; gap:18px; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); }
  .card { background:var(--card); border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.25); }
  .card img { width:100%; aspect-ratio:16/9; object-fit:cover; display:block; }
  .body { padding:12px 14px 16px; }
  h2 { font-size:15px; margin:0 0 6px; line-height:1.35; }
  a { color:inherit; text-decoration:none; }
  h2 a:hover { color:var(--accent); }
  .meta { color:var(--muted); font-size:13px; margin:0 0 10px; }
  .tags { display:flex; flex-wrap:wrap; gap:5px; }
  .tag { background:rgba(127,127,127,.16); border-radius:999px; padding:2px 9px; font-size:12px; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="count">${videos.length} vídeos · exportado el ${new Date().toLocaleDateString('es-ES')}</p>
<div class="grid">
${cards}
</div>
</body>
</html>`;
}

/** An M3U playlist of downloaded files, playable in any media player. */
function toM3u(videos: Video[]): string {
  const lines = ['#EXTM3U'];
  for (const video of videos) {
    const target = video.filePath ?? video.url;
    lines.push(`#EXTINF:${video.durationSeconds ?? -1},${video.author?.name ?? ''} - ${video.title}`);
    lines.push(target);
  }
  return lines.join('\n');
}

export interface ImportedLibrary {
  videos: number;
  tags: number;
  collections: number;
  customFields: number;
}

/** Exports and re-imports the library in human-readable formats. */
export class Exchange {
  private readonly library: Library;

  constructor(library: Library) {
    this.library = library;
  }

  private collect(options: ExportOptions): Video[] {
    if (options.videoIds?.length) return this.library.videos.getMany(options.videoIds);
    const ids = this.library.videos.searchIds({ query: options.query ?? '', includeArchived: true });
    return this.library.videos.getMany(ids);
  }

  serialize(options: ExportOptions): string {
    const videos = this.collect(options);

    switch (options.format) {
      case 'csv':
        return toCsv(videos);
      case 'html':
        return toHtml(videos, 'Videoteca');
      case 'txt':
        return videos.map((video) => video.url).join('\n');
      case 'm3u':
        return toM3u(videos);
      default:
        return JSON.stringify(
          {
            format: 'videoteca-export',
            version: 1,
            exportedAt: new Date().toISOString(),
            customFields: this.library.customFields.list(),
            tags: this.library.tags.list(),
            collections: this.library.collections.list(),
            videos,
          },
          null,
          2,
        );
    }
  }

  async exportTo(file: string, options: ExportOptions): Promise<number> {
    const content = this.serialize(options);
    await writeFile(file, content, 'utf8');
    return this.collect(options).length;
  }

  /**
   * Restores a JSON export. Existing videos are matched by URL and skipped, so
   * re-importing the same file is safe.
   */
  async importFrom(file: string): Promise<ImportedLibrary> {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as {
      videos?: Video[];
      tags?: { name: string; color?: string | null; icon?: string | null }[];
      collections?: { name: string; description?: string | null; query?: string | null; kind?: 'manual' | 'smart' }[];
      customFields?: { label: string; key: string; type: string; options?: unknown[] }[];
    };

    const result: ImportedLibrary = { videos: 0, tags: 0, collections: 0, customFields: 0 };

    this.library.transaction(() => {
      for (const field of parsed.customFields ?? []) {
        if (this.library.customFields.getByKey(field.key)) continue;
        this.library.customFields.create({
          label: field.label,
          key: field.key,
          /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
          type: field.type as any,
          /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
          options: (field.options ?? []) as any,
        });
        result.customFields += 1;
      }

      for (const tag of parsed.tags ?? []) {
        this.library.tags.ensure({ name: tag.name, color: tag.color ?? null, icon: tag.icon ?? null });
        result.tags += 1;
      }

      for (const video of parsed.videos ?? []) {
        if (!video?.url || this.library.videos.getByUrl(video.url)) continue;

        const author = video.author
          ? this.library.authors.ensure({
              platform: video.platform,
              name: video.author.name,
              handle: video.author.handle,
              externalId: video.author.externalId,
              url: video.author.url,
            })
          : null;

        const created = this.library.videos.insert({
          url: video.url,
          platform: video.platform,
          platformId: video.platformId,
          title: video.title,
          description: video.description,
          authorId: author?.id ?? null,
          durationSeconds: video.durationSeconds,
          publishedAt: video.publishedAt,
          thumbnailUrl: video.thumbnailUrl,
          width: video.width,
          height: video.height,
          viewCount: video.viewCount,
          likeCount: video.likeCount,
          language: video.language,
          isShort: video.isShort,
          isLive: video.isLive,
        });

        this.library.videos.update(created.id, {
          rating: video.rating ?? 0,
          favorite: video.favorite ?? false,
          watchStatus: video.watchStatus ?? 'unwatched',
          notes: video.notes ?? null,
        });

        const tagIds = (video.tags ?? []).map((tag) => this.library.tags.ensure({ name: tag.name }).id);
        if (tagIds.length > 0) this.library.tags.addToVideos([created.id], tagIds, 'imported');

        for (const [key, value] of Object.entries(video.customFields ?? {})) {
          try {
            this.library.videos.setCustomField(created.id, key, value);
          } catch {
            // The export referenced a field this library does not define.
          }
        }

        this.library.videos.reindex(created.id);
        result.videos += 1;
      }

      for (const collection of parsed.collections ?? []) {
        this.library.collections.create({
          name: collection.name,
          description: collection.description ?? null,
          query: collection.query ?? null,
          kind: collection.kind ?? 'manual',
        });
        result.collections += 1;
      }
    });

    return result;
  }
}
