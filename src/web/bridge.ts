import { WebLibrary } from './store.ts';
import { resolveMetadata, splitUrls } from './metadata.ts';
import { requestPersistence, storageEstimate } from './idb.ts';
import { extractHashtags, ruleMatches } from '../core/services/autoTag.ts';
import { durationBucket, DURATION_BUCKETS } from '../shared/query/values.ts';
import { DEFAULT_SETTINGS } from '../shared/settings.ts';
import { PLATFORM_COLORS, PLATFORM_LABELS, type AppSettings, type ImportReport, type Tag, type Video } from '../shared/types.ts';
import type { EventMap, EventName } from '../shared/ipc.ts';

const SETTINGS_KEY = 'app';

/** Actions the desktop build offers that a web page simply cannot perform. */
const DESKTOP_ONLY = 'Esto solo está disponible en la versión de escritorio.';

/** Words too generic to be worth a tag of their own. */
const NOISE = new Set([
  'video', 'vídeo', 'shorts', 'short', 'reel', 'reels', 'tiktok', 'youtube', 'instagram',
  'viral', 'fyp', 'parati', 'foryou', 'foryoupage', 'trending', 'nuevo', 'new',
]);

type Listener = (payload: unknown) => void;

/**
 * The browser implementation of the same surface the desktop preload exposes.
 *
 * Because the interface only ever talks to this object, the entire React app
 * runs unchanged on a phone; the pieces that need a real computer (downloading
 * videos, reading folders) report that plainly instead of failing silently.
 */
export function createWebBridge(library: WebLibrary) {
  const listeners = new Map<EventName, Set<Listener>>();

  const emit = <K extends EventName>(event: K, payload: EventMap[K]): void => {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  };
  const toast = (kind: 'info' | 'success' | 'error', message: string) => emit('toast', { kind, message });
  // Every mutation ends here, so this is also where a write is made durable:
  // awaiting it means the caller's change has actually reached IndexedDB.
  const changed = async (reason: string) => {
    emit('library:changed', { reason });
    await library.flush();
  };

  /* --------------------------------------------------------------- settings */

  const readSettings = (): AppSettings => ({
    ...DEFAULT_SETTINGS,
    ...library.getSetting<Partial<AppSettings>>(SETTINGS_KEY, {}),
    // These describe a filesystem the browser has no access to.
    libraryPath: 'Almacenamiento del navegador',
    downloadPath: '',
  });

  /* ------------------------------------------------------------ auto-tagging */

  const ensureTag = (name: string, kind: Tag['kind'], icon?: string, color?: string, filterNoise = false): Tag | null => {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (clean.length < 2 || clean.length > 60) return null;
    if (filterNoise && NOISE.has(clean.toLowerCase())) return null;
    return library.ensureTag({ name: clean, kind, icon: icon ?? null, color: color ?? null });
  };

  /** Derives tags from the video's own data, then applies the user's rules. */
  const autoTag = (video: Video): string[] => {
    const tags: Tag[] = [];

    const platform = ensureTag(PLATFORM_LABELS[video.platform] ?? video.platform, 'platform', undefined, PLATFORM_COLORS[video.platform]);
    if (platform) tags.push(platform);

    if (video.author?.name) {
      const creator = ensureTag(video.author.name, 'creator', '👤');
      if (creator) tags.push(creator);
    }

    if (video.publishedAt) {
      const year = new Date(video.publishedAt).getUTCFullYear();
      if (Number.isFinite(year)) {
        const tag = ensureTag(String(year), 'auto', '📅');
        if (tag) tags.push(tag);
      }
    }

    const bucket = durationBucket(video.durationSeconds);
    const label = DURATION_BUCKETS.find((entry) => entry.id === bucket)?.label;
    if (label) {
      const tag = ensureTag(label, 'auto', '⏱️');
      if (tag) tags.push(tag);
    }

    for (const hashtag of [...extractHashtags(video.title), ...extractHashtags(video.description)].slice(0, 10)) {
      const tag = ensureTag(hashtag, 'auto', '#', undefined, true);
      if (tag) tags.push(tag);
    }

    const subject = {
      title: video.title,
      description: video.description,
      author: video.author?.name ?? null,
      url: video.url,
      platformTags: [] as string[],
    };
    for (const rule of library.listRules()) {
      if (!rule.enabled || !ruleMatches(rule, subject)) continue;
      for (const tagId of rule.tagIds) {
        const tag = library.listTags().find((candidate) => candidate.id === tagId);
        if (tag) tags.push(tag);
      }
      for (const [key, value] of Object.entries(rule.setFields)) {
        try {
          library.setCustomField([video.id], key, value);
        } catch {
          // The rule refers to a field that no longer exists.
        }
      }
    }

    const unique = [...new Set(tags.map((tag) => tag.id))];
    if (unique.length > 0) library.addTags([video.id], unique);
    return unique;
  };

  /* ----------------------------------------------------------------- import */

  let importAbort: AbortController | null = null;

  const importUrls = async (
    urls: string[],
    options: { tagIds?: string[]; collectionId?: string; autoTag?: boolean } = {},
  ): Promise<ImportReport> => {
    const report: ImportReport = { requested: urls.length, added: 0, duplicates: 0, failed: [], videoIds: [] };
    const settings = readSettings();
    importAbort = new AbortController();
    const signal = importAbort.signal;

    for (const [index, url] of urls.entries()) {
      if (signal.aborted) break;
      try {
        const metadata = settings.autoFetchMetadata
          ? await resolveMetadata(url)
          : await resolveMetadata(url, 0);

        const author = metadata.authorName
          ? library.ensureAuthor({ platform: metadata.platform, name: metadata.authorName, handle: metadata.authorHandle })
          : null;

        const created = library.insertVideo({
          url: metadata.url,
          platform: metadata.platform,
          platformId: metadata.platformId,
          title: metadata.title,
          authorId: author?.id ?? null,
          durationSeconds: metadata.durationSeconds,
          thumbnailUrl: metadata.thumbnailUrl,
          width: metadata.width,
          height: metadata.height,
          isShort: metadata.isShort,
        });

        if (created === null) {
          report.duplicates += 1;
        } else {
          if (options.autoTag ?? settings.autoTagOnImport) autoTag(created);
          if (options.tagIds?.length) library.addTags([created.id], options.tagIds);
          if (options.collectionId) library.addToCollection(options.collectionId, [created.id]);
          report.added += 1;
          report.videoIds.push(created.id);
        }
      } catch (error) {
        report.failed.push({ url, error: (error as Error).message });
      }

      emit('import:progress', {
        done: index + 1,
        total: urls.length,
        current: url,
        lastTitle: null,
        added: report.added,
        duplicates: report.duplicates,
        failed: report.failed.length,
      });
    }

    importAbort = null;
    emit('import:done', report);
    await changed('import');
    return report;
  };

  /* ------------------------------------------------------------------ files */

  /** Hands the user a generated file through a temporary download link. */
  const saveFile = (name: string, content: string, type: string): void => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /** Opens the system file picker and returns the chosen file's text. */
  const readFile = (accept: string): Promise<string | null> =>
    new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = async () => {
        const file = input.files?.[0];
        resolve(file ? await file.text() : null);
      };
      // A cancelled picker fires nothing on some browsers; the promise simply
      // never settles, which is harmless here because nothing awaits forever.
      input.click();
    });

  const toCsv = (videos: Video[]): string => {
    const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = ['title,url,platform,author,duration,published,added,rating,favorite,watchStatus,tags,notes'];
    for (const video of videos) {
      rows.push(
        [
          video.title, video.url, video.platform, video.author?.name ?? '', video.durationSeconds ?? '',
          video.publishedAt ?? '', video.addedAt, video.rating, video.favorite ? 'sí' : 'no',
          video.watchStatus, video.tags.map((tag) => tag.name).join('; '), video.notes ?? '',
        ].map(cell).join(','),
      );
    }
    return rows.join('\n');
  };

  /* -------------------------------------------------------------------- api */

  return {
    platform: 'web' as NodeJS.Platform,

    on<K extends EventName>(event: K, listener: (payload: EventMap[K]) => void): () => void {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(listener as Listener);
      listeners.set(event, set);
      return () => set.delete(listener as Listener);
    },

    videos: {
      search: async (options: Parameters<WebLibrary['search']>[0]) => library.search(options),
      searchIds: async (options: Parameters<WebLibrary['searchIds']>[0]) => library.searchIds(options),
      get: async (id: string) => library.getVideo(id),
      getMany: async (ids: string[]) => library.getMany(ids),
      update: async (id: string, patch: Partial<Video>) => {
        const updated = library.updateVideo(id, patch);
        await changed('video-update');
        return updated;
      },
      updateMany: async (ids: string[], patch: Partial<Video>) => {
        const count = library.updateMany(ids, patch);
        await changed('video-update-many');
        return count;
      },
      remove: async (ids: string[]) => {
        const count = library.removeVideos(ids);
        await changed('video-remove');
        return count;
      },
      setCustomField: async (ids: string[], key: string, value: Parameters<WebLibrary['setCustomField']>[2]) => {
        const count = library.setCustomField(ids, key, value);
        await changed('custom-field');
        return count;
      },
      setCover: async (videoId: string, dataUrl: string | null) => {
        const updated = library.setCover(videoId, dataUrl);
        await changed('cover');
        return updated;
      },
      setTags: async (videoId: string, tagIds: string[]) => {
        const updated = library.setTags(videoId, tagIds);
        await changed('tags');
        return updated;
      },
      addTags: async (videoIds: string[], tagIds: string[]) => {
        const count = library.addTags(videoIds, tagIds);
        await changed('tags');
        return count;
      },
      removeTags: async (videoIds: string[], tagIds: string[]) => {
        const count = library.removeTags(videoIds, tagIds);
        await changed('tags');
        return count;
      },
      open: async (id: string) => {
        const video = library.getVideo(id);
        if (!video) return;
        library.markOpened(id);
        window.open(video.url, '_blank', 'noopener,noreferrer');
      },
      openFolder: async () => {
        throw new Error(DESKTOP_ONLY);
      },
      markOpened: async (id: string) => library.markOpened(id),
      stats: async () => library.stats(),
      duplicates: async () => library.duplicates(),
      refresh: async (ids: string[]) => {
        let updated = 0;
        let failed = 0;
        for (const [index, id] of ids.entries()) {
          const video = library.getVideo(id);
          if (!video) continue;
          const metadata = await resolveMetadata(video.url);
          if (metadata.enriched) {
            library.updateVideo(id, {
              title: metadata.title,
              thumbnailUrl: metadata.thumbnailUrl ?? video.thumbnailUrl,
              durationSeconds: metadata.durationSeconds ?? video.durationSeconds,
              availability: 'ok',
              lastCheckedAt: new Date().toISOString(),
            });
            updated += 1;
          } else {
            failed += 1;
          }
          emit('refresh:progress', { done: index + 1, total: ids.length, title: video.title });
        }
        await changed('refresh');
        toast('success', `${updated} vídeos actualizados${failed ? `, ${failed} sin datos` : ''}.`);
        return { updated, failed };
      },
      checkLinks: async () => ({ updated: 0, failed: 0 }),
    },

    import: {
      urls: async (request: { urls: string[]; tagIds?: string[]; collectionId?: string; autoTag?: boolean }) =>
        importUrls(request.urls ?? [], request),
      clipboard: async () => {
        const text = await navigator.clipboard.readText().catch(() => '');
        const urls = splitUrls(text);
        if (urls.length === 0) throw new Error('No se han encontrado enlaces en el portapapeles.');
        return importUrls(urls, {});
      },
      playlist: async () => {
        throw new Error('Importar listas o canales completos solo funciona en la versión de escritorio.');
      },
      scanFolder: async () => {
        throw new Error(DESKTOP_ONLY);
      },
      pickFolder: async () => null,
      pickFiles: async () => [],
      cancel: async () => {
        importAbort?.abort();
        toast('info', 'Importación cancelada.');
      },
    },

    tags: {
      list: async () => library.listTags(),
      create: async (input: { name: string; color?: string | null; icon?: string | null; parentId?: string | null }) => {
        const tag = library.ensureTag(input);
        await changed('tags');
        return tag;
      },
      update: async (id: string, patch: Partial<Tag>) => {
        library.updateTag(id, patch);
        await changed('tags');
      },
      remove: async (id: string) => {
        library.removeTag(id);
        await changed('tags');
      },
      merge: async (sourceIds: string[], targetId: string) => {
        const count = library.mergeTags(sourceIds, targetId);
        await changed('tags');
        return count;
      },
      unused: async () => library.unusedTags(),
      autoTag: async (videoIds: string[]) => {
        let tagsAdded = 0;
        for (const id of videoIds) {
          const video = library.getVideo(id);
          if (video) tagsAdded += autoTag(video).length;
        }
        await changed('auto-tag');
        toast('success', `${tagsAdded} etiquetas aplicadas a ${videoIds.length} vídeos.`);
        return { processed: videoIds.length, tagsAdded };
      },
    },

    authors: {
      list: async () => library.listAuthors(),
      update: async (id: string, patch: Parameters<WebLibrary['updateAuthor']>[1]) => {
        library.updateAuthor(id, patch);
        await changed('authors');
      },
    },

    collections: {
      list: async () => library.listCollections(),
      create: async (input: Parameters<WebLibrary['createCollection']>[0]) => {
        const collection = library.createCollection(input);
        await changed('collections');
        return collection;
      },
      update: async (id: string, patch: Parameters<WebLibrary['updateCollection']>[1]) => {
        library.updateCollection(id, patch);
        await changed('collections');
      },
      remove: async (id: string) => {
        library.removeCollection(id);
        await changed('collections');
      },
      addVideos: async (id: string, videoIds: string[]) => {
        const added = library.addToCollection(id, videoIds);
        await changed('collections');
        return added;
      },
      removeVideos: async (id: string, videoIds: string[]) => {
        const removed = library.removeFromCollection(id, videoIds);
        await changed('collections');
        return removed;
      },
      reorder: async (id: string, videoIds: string[]) => {
        library.reorderCollection(id, videoIds);
        await changed('collections');
      },
      forVideo: async (videoId: string) => library.collectionsForVideo(videoId),
    },

    fields: {
      list: async () => library.listFields(),
      create: async (input: Parameters<WebLibrary['createField']>[0]) => {
        const field = library.createField(input);
        await changed('fields');
        return field;
      },
      update: async (id: string, patch: Parameters<WebLibrary['updateField']>[1]) => {
        library.updateField(id, patch);
        await changed('fields');
      },
      remove: async (id: string) => {
        library.removeField(id);
        await changed('fields');
      },
      values: async (key: string) => library.fieldValues(key),
    },

    bookmarks: {
      forVideo: async (videoId: string) => library.bookmarksFor(videoId),
      create: async (videoId: string, timeSeconds: number, label: string, note?: string | null) =>
        library.createBookmark(videoId, timeSeconds, label, note),
      update: async (id: string, patch: Parameters<WebLibrary['updateBookmark']>[1]) => library.updateBookmark(id, patch),
      remove: async (id: string) => library.removeBookmark(id),
    },

    rules: {
      list: async () => library.listRules(),
      create: async (input: Parameters<WebLibrary['createRule']>[0]) => {
        const rule = library.createRule(input);
        await changed('rules');
        return rule;
      },
      update: async (id: string, patch: Parameters<WebLibrary['updateRule']>[1]) => {
        library.updateRule(id, patch);
        await changed('rules');
      },
      remove: async (id: string) => {
        library.removeRule(id);
        await changed('rules');
      },
      run: async () => {
        const ids = library.searchIds({});
        let tagsAdded = 0;
        for (const id of ids) {
          const video = library.getVideo(id);
          if (video) tagsAdded += autoTag(video).length;
        }
        await changed('rules-run');
        return { processed: ids.length, tagsAdded };
      },
    },

    views: {
      list: async () => library.listViews(),
      create: async (view: Parameters<WebLibrary['createView']>[0]) => {
        const created = library.createView(view);
        await changed('views');
        return created;
      },
      update: async (id: string, patch: Parameters<WebLibrary['updateView']>[1]) => {
        library.updateView(id, patch);
        await changed('views');
      },
      remove: async (id: string) => {
        library.removeView(id);
        await changed('views');
      },
    },

    // Downloading needs a real program on a computer; the queue stays empty and
    // any attempt says so rather than appearing to work.
    downloads: {
      list: async () => [],
      enqueue: async () => {
        throw new Error('Descargar vídeos solo funciona en la versión de escritorio.');
      },
      cancel: async () => {},
      cancelAll: async () => {},
      retry: async () => {},
      remove: async () => {},
      clearFinished: async () => {},
    },

    settings: {
      get: async () => readSettings(),
      set: async (patch: Partial<AppSettings>) => {
        const next = { ...readSettings(), ...patch };
        library.setSetting(SETTINGS_KEY, next);
        return next;
      },
      pickFolder: async () => null,
      tools: async () => [
        { name: 'yt-dlp' as const, available: false, path: null, version: null },
        { name: 'ffmpeg' as const, available: false, path: null, version: null },
      ],
      installYtdlp: async () => {
        throw new Error(DESKTOP_ONLY);
      },
    },

    library: {
      export: async (request: { format: string; videoIds?: string[]; query?: string }) => {
        const videos = request.videoIds?.length
          ? library.getMany(request.videoIds)
          : library.getMany(library.searchIds({ query: request.query ?? '', includeArchived: true }));
        const stamp = new Date().toISOString().slice(0, 10);

        if (request.format === 'csv') {
          saveFile(`videoteca-${stamp}.csv`, toCsv(videos), 'text/csv');
        } else if (request.format === 'txt') {
          saveFile(`videoteca-${stamp}.txt`, videos.map((video) => video.url).join('\n'), 'text/plain');
        } else {
          saveFile(`videoteca-${stamp}.json`, JSON.stringify(library.exportAll(), null, 2), 'application/json');
        }
        toast('success', `${videos.length} vídeos exportados.`);
        return { file: `videoteca-${stamp}`, count: videos.length };
      },
      import: async () => {
        const text = await readFile('application/json,.json');
        if (!text) return null;
        const result = library.importAll(JSON.parse(text) as Record<string, unknown>);
        await changed('library-import');
        toast('success', `Importados ${result.videos} vídeos y ${result.tags} etiquetas.`);
        return result;
      },
      backup: async () => {
        saveFile(`videoteca-copia-${Date.now()}.json`, JSON.stringify(library.exportAll(), null, 2), 'application/json');
        toast('success', 'Copia de seguridad descargada.');
        return 'descarga';
      },
      optimize: async () => {
        const persisted = await requestPersistence();
        toast(
          persisted ? 'success' : 'info',
          persisted
            ? 'Tu biblioteca está protegida frente a borrados automáticos.'
            : 'El navegador no ha concedido almacenamiento permanente. Exporta una copia de vez en cuando.',
        );
      },
      reindex: async () => library.searchIds({}).length,
      clearThumbnails: async () => {
        if ('caches' in window) {
          for (const key of await caches.keys()) {
            if (key.startsWith('videoteca-img')) await caches.delete(key);
          }
        }
        toast('success', 'Caché de imágenes vaciada.');
      },
      diskUsage: async () => {
        const { usage } = await storageEstimate();
        return { database: usage, thumbnails: 0, downloads: 0 };
      },
      revealPath: async () => {},
      openExternal: async (url: string) => {
        window.open(url, '_blank', 'noopener,noreferrer');
      },
    },
  };
}

export type WebBridge = ReturnType<typeof createWebBridge>;
