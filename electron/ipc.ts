import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import { createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import type { AppContext } from './context.ts';
import { extractUrls, parseVideoUrl, VIDEO_EXTENSIONS } from '../src/core/platforms/detect.ts';
import { looksLikePlaylist, YtdlpProvider } from '../src/core/metadata/ytdlp.ts';
import { scanFolder } from '../src/core/services/files.ts';
import { makeExecutable, toolStatus, ytdlpAssetName } from '../src/core/util/tools.ts';
import { pathToFileURL } from 'node:url';
import type { EventMap, EventName, ExportRequest, ImportRequest, ScanRequest } from '../src/shared/ipc.ts';
import type {
  AppSettings,
  CustomFieldValue,
  DownloadFormat,
  ImportReport,
  QueryOptions,
  ToolStatus,
} from '../src/shared/types.ts';
import type { VideoPatch } from '../src/core/db/repos/videos.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

const YTDLP_RELEASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';

/** Broadcasts an event to every open window. */
function broadcast<K extends EventName>(name: K, payload: EventMap[K]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(name, payload);
  }
}

function notify(kind: 'info' | 'success' | 'error', message: string): void {
  broadcast('toast', { kind, message });
}

function changed(reason: string): void {
  broadcast('library:changed', { reason });
}

const emptyReport = (requested = 0): ImportReport => ({
  requested,
  added: 0,
  duplicates: 0,
  failed: [],
  videoIds: [],
});

/**
 * Registers every IPC handler.
 *
 * Handlers are deliberately thin: they translate renderer requests into core
 * service calls and broadcast what changed. Anything that touches the network
 * or the filesystem lives in `src/core`, where it can be tested without
 * Electron.
 */
export function registerIpc(context: AppContext): void {
  const { library } = context;

  const handle = (channel: string, handler: (...args: any[]) => any): void => {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await handler(...args);
      } catch (error) {
        const message = (error as Error).message ?? 'Error desconocido';
        notify('error', message);
        throw new Error(message);
      }
    });
  };

  /* ------------------------------------------------------------------ videos */

  handle('videos.search', (options: QueryOptions) => library.videos.search(options));
  handle('videos.searchIds', (options: QueryOptions) => library.videos.searchIds(options));
  handle('videos.get', (id: string) => library.videos.getById(id));
  handle('videos.getMany', (ids: string[]) => library.videos.getMany(ids));
  handle('videos.stats', () => library.videos.stats());
  handle('videos.duplicates', () => library.videos.findDuplicates());
  handle('videos.markOpened', (id: string) => library.videos.markOpened(id));

  handle('videos.update', (id: string, patch: VideoPatch) => {
    library.videos.update(id, patch);
    changed('video-update');
    return library.videos.getById(id);
  });

  handle('videos.updateMany', (ids: string[], patch: VideoPatch) => {
    const count = library.videos.updateMany(ids, patch);
    changed('video-update-many');
    return count;
  });

  handle('videos.remove', async (ids: string[], deleteFiles: boolean) => {
    if (deleteFiles) {
      for (const video of library.videos.getMany(ids)) {
        if (!video.filePath) continue;
        // Send to the trash rather than unlinking: deletions stay recoverable.
        try {
          await shell.trashItem(video.filePath);
        } catch {
          /* the file is already gone or on a volume without a trash */
        }
      }
    }
    const count = library.videos.remove(ids);
    changed('video-remove');
    return count;
  });

  handle('videos.setCustomField', (ids: string[], key: string, value: CustomFieldValue) => {
    const count = library.customFields.setForVideos(ids, key, value);
    changed('custom-field');
    return count;
  });

  handle('videos.setTags', (videoId: string, tagIds: string[]) => {
    library.tags.setForVideo(videoId, tagIds);
    library.videos.reindex(videoId);
    changed('tags');
    return library.videos.getById(videoId);
  });

  handle('videos.addTags', (videoIds: string[], tagIds: string[]) => {
    library.tags.addToVideos(videoIds, tagIds);
    for (const id of videoIds) library.videos.reindex(id);
    changed('tags');
    return videoIds.length;
  });

  handle('videos.removeTags', (videoIds: string[], tagIds: string[]) => {
    library.tags.removeFromVideos(videoIds, tagIds);
    for (const id of videoIds) library.videos.reindex(id);
    changed('tags');
    return videoIds.length;
  });

  handle('videos.open', async (id: string) => {
    const video = library.videos.getById(id);
    if (!video) throw new Error('El vídeo no existe.');
    library.videos.markOpened(id);
    // A downloaded copy opens locally; otherwise fall back to the source URL.
    if (video.filePath) {
      const error = await shell.openPath(video.filePath);
      if (!error) return;
    }
    await shell.openExternal(video.url);
  });

  handle('videos.openFolder', async (id: string) => {
    const video = library.videos.getById(id);
    if (!video?.filePath) throw new Error('Este vídeo no tiene archivo descargado.');
    shell.showItemInFolder(video.filePath);
  });

  handle('videos.refresh', async (ids: string[]) => {
    const controller = context.beginOperation();
    try {
      const result = await context.importer.refresh(ids, {
        signal: controller.signal,
        onProgress: (done, total, title) => broadcast('refresh:progress', { done, total, title }),
      });
      changed('refresh');
      notify('success', `${result.updated} vídeos actualizados${result.failed ? `, ${result.failed} con error` : ''}.`);
      return result;
    } finally {
      context.endOperation(controller);
    }
  });

  // Checking links is a refresh that only records availability.
  handle('videos.checkLinks', async (ids: string[]) => {
    const controller = context.beginOperation();
    try {
      const result = await context.importer.refresh(ids, {
        signal: controller.signal,
        onProgress: (done, total, title) => broadcast('refresh:progress', { done, total, title }),
      });
      changed('check-links');
      return result;
    } finally {
      context.endOperation(controller);
    }
  });

  /* ------------------------------------------------------------------ import */

  const runImport = async (urls: string[], request: Partial<ImportRequest>): Promise<ImportReport> => {
    if (urls.length === 0) return emptyReport();
    const settings = context.settings;
    const controller = context.beginOperation();

    try {
      const report = await context.importer.importUrls(urls, {
        fetchMetadata: request.fetchMetadata ?? settings.autoFetchMetadata,
        autoTag: request.autoTag ?? settings.autoTagOnImport,
        downloadThumbnail: settings.autoDownloadThumbnails,
        tagIds: request.tagIds,
        collectionId: request.collectionId,
        concurrency: settings.maxConcurrentMetadata,
        signal: controller.signal,
        onProgress: (progress) => broadcast('import:progress', progress),
      });
      broadcast('import:done', report);
      changed('import');
      return report;
    } finally {
      context.endOperation(controller);
    }
  };

  handle('import.urls', (request: ImportRequest) => runImport(request.urls ?? [], request));

  handle('import.clipboard', () => {
    const urls = extractUrls(clipboard.readText());
    if (urls.length === 0) throw new Error('No se han encontrado enlaces en el portapapeles.');
    return runImport(urls, {});
  });

  handle('import.playlist', async (url: string, limit: number, collectionId?: string) => {
    const tools = await context.refreshTools();
    if (!tools.ytdlpPath) {
      throw new Error('Necesitas yt-dlp para importar listas o canales. Instálalo desde Ajustes.');
    }

    const provider = new YtdlpProvider({ binary: tools.ytdlpPath });
    const controller = context.beginOperation();
    let entries;
    try {
      entries = await provider.listPlaylist(url, limit, controller.signal);
    } finally {
      context.endOperation(controller);
    }

    // A playlist gets its own collection unless the caller picked one.
    let target = collectionId;
    if (!target && entries.title) {
      target = library.collections.create({ name: entries.title, description: url }).id;
      changed('collections');
    }

    return runImport(
      entries.entries.map((entry) => entry.url),
      { collectionId: target },
    );
  });

  handle('import.scanFolder', async (request: ScanRequest) => {
    const files = await scanFolder(request.folder, { recursive: request.recursive !== false });
    if (files.length === 0) throw new Error('No se han encontrado vídeos en esa carpeta.');
    return runImport(
      files.map((file) => file.filePath),
      { tagIds: request.tagIds, collectionId: request.collectionId },
    );
  });

  handle('import.pickFolder', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Elige una carpeta con vídeos',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle('import.pickFiles', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Elige archivos de vídeo',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Vídeos', extensions: VIDEO_EXTENSIONS.map((extension) => extension.slice(1)) }],
    });
    return result.canceled ? [] : result.filePaths;
  });

  handle('import.cancel', () => {
    context.activeOperation?.abort();
    notify('info', 'Operación cancelada.');
  });

  /* -------------------------------------------------------------------- tags */

  handle('tags.list', () => library.tags.list());
  handle('tags.unused', () => library.tags.unused());
  handle('tags.create', (input: any) => {
    const tag = library.tags.ensure(input);
    changed('tags');
    return tag;
  });
  handle('tags.update', (id: string, patch: any) => {
    library.tags.update(id, patch);
    changed('tags');
  });
  handle('tags.remove', (id: string) => {
    library.tags.remove(id);
    changed('tags');
  });
  handle('tags.merge', (sourceIds: string[], targetId: string) => {
    const affected = library.tags.merge(sourceIds, targetId);
    library.videos.reindexAll();
    changed('tags');
    return affected;
  });
  handle('tags.autoTag', (videoIds: string[]) => {
    const result = context.tagger.applyToExisting(videoIds);
    changed('auto-tag');
    notify('success', `${result.tagsAdded} etiquetas aplicadas a ${result.processed} vídeos.`);
    return result;
  });

  /* ----------------------------------------------------------------- authors */

  handle('authors.list', () => library.authors.list());
  handle('authors.update', (id: string, patch: any) => {
    library.authors.update(id, patch);
    changed('authors');
  });

  /* ------------------------------------------------------------- collections */

  handle('collections.list', () => library.collections.list());
  handle('collections.forVideo', (videoId: string) => library.collections.forVideo(videoId));
  handle('collections.create', (input: any) => {
    const collection = library.collections.create(input);
    changed('collections');
    return collection;
  });
  handle('collections.update', (id: string, patch: any) => {
    library.collections.update(id, patch);
    changed('collections');
  });
  handle('collections.remove', (id: string) => {
    library.collections.remove(id);
    changed('collections');
  });
  handle('collections.addVideos', (id: string, videoIds: string[]) => {
    const added = library.collections.addVideos(id, videoIds);
    changed('collections');
    return added;
  });
  handle('collections.removeVideos', (id: string, videoIds: string[]) => {
    const removed = library.collections.removeVideos(id, videoIds);
    changed('collections');
    return removed;
  });
  handle('collections.reorder', (id: string, videoIds: string[]) => {
    library.collections.reorder(id, videoIds);
    changed('collections');
  });

  /* ----------------------------------------------------------- custom fields */

  handle('fields.list', () => library.customFields.list());
  handle('fields.values', (key: string) => library.customFields.distinctValues(key));
  handle('fields.create', (input: any) => {
    const field = library.customFields.create(input);
    changed('fields');
    return field;
  });
  handle('fields.update', (id: string, patch: any) => {
    library.customFields.update(id, patch);
    changed('fields');
  });
  handle('fields.remove', (id: string) => {
    library.customFields.remove(id);
    changed('fields');
  });

  /* --------------------------------------------------------------- bookmarks */

  handle('bookmarks.forVideo', (videoId: string) => library.bookmarks.forVideo(videoId));
  handle('bookmarks.create', (videoId: string, timeSeconds: number, label: string, note?: string | null) =>
    library.bookmarks.create(videoId, timeSeconds, label, note),
  );
  handle('bookmarks.update', (id: string, patch: any) => library.bookmarks.update(id, patch));
  handle('bookmarks.remove', (id: string) => library.bookmarks.remove(id));

  /* ------------------------------------------------------------------- rules */

  handle('rules.list', () => library.rules.list());
  handle('rules.create', (input: any) => {
    const rule = library.rules.create(input);
    changed('rules');
    return rule;
  });
  handle('rules.update', (id: string, patch: any) => {
    library.rules.update(id, patch);
    changed('rules');
  });
  handle('rules.remove', (id: string) => {
    library.rules.remove(id);
    changed('rules');
  });
  // A null `ruleId` runs every enabled rule; a specific id runs just that one,
  // without re-applying the built-in generators.
  handle('rules.run', (ruleId: string | null) => {
    const ids = library.videos.searchIds({ includeArchived: false });
    const result = context.tagger.applyToExisting(ids, {
      ruleIds: ruleId ? [ruleId] : undefined,
      rulesOnly: ruleId !== null,
    });
    changed('rules-run');
    notify('success', `Reglas aplicadas: ${result.tagsAdded} etiquetas en ${result.processed} vídeos.`);
    return result;
  });

  /* ------------------------------------------------------------------- views */

  handle('views.list', () => library.savedViews.list());
  handle('views.create', (view: any) => {
    const created = library.savedViews.create(view);
    changed('views');
    return created;
  });
  handle('views.update', (id: string, patch: any) => {
    library.savedViews.update(id, patch);
    changed('views');
  });
  handle('views.remove', (id: string) => {
    library.savedViews.remove(id);
    changed('views');
  });

  /* --------------------------------------------------------------- downloads */

  context.downloads.on('change', (jobs) => broadcast('downloads:changed', jobs));
  context.downloads.on('completed', () => changed('download-completed'));

  handle('downloads.list', () => context.downloads.list());
  handle('downloads.enqueue', async (videoIds: string[], format: DownloadFormat) => {
    const tools = await context.refreshTools();
    if (!tools.ytdlpPath) {
      throw new Error('Necesitas yt-dlp para descargar vídeos. Instálalo desde Ajustes.');
    }
    return context.downloads.enqueueMany(videoIds, format);
  });
  handle('downloads.cancel', (jobId: string) => context.downloads.cancel(jobId));
  handle('downloads.cancelAll', () => context.downloads.cancelAll());
  handle('downloads.retry', (jobId: string) => context.downloads.retry(jobId));
  handle('downloads.remove', (jobId: string) => context.downloads.remove(jobId));
  handle('downloads.clearFinished', () => context.downloads.clearFinished());

  /* ---------------------------------------------------------------- settings */

  handle('settings.get', () => context.settings);
  handle('settings.set', (patch: Partial<AppSettings>) => context.updateSettings(patch));

  handle('settings.pickFolder', async (current: string) => {
    const result = await dialog.showOpenDialog({
      title: 'Elige una carpeta',
      defaultPath: current || undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle('settings.tools', async (): Promise<ToolStatus[]> => {
    const settings = context.settings;
    return Promise.all([
      toolStatus('yt-dlp', settings.ytdlpPath, context.paths.tools),
      toolStatus('ffmpeg', settings.ffmpegPath, context.paths.tools),
      toolStatus('ffprobe', null, context.paths.tools),
    ]);
  });

  handle('settings.installYtdlp', async (): Promise<ToolStatus> => {
    const asset = ytdlpAssetName();
    const target = path.join(context.paths.tools, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

    notify('info', 'Descargando yt-dlp…');
    const response = await fetch(`${YTDLP_RELEASE}/${asset}`, { redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`No se ha podido descargar yt-dlp (HTTP ${response.status}).`);

    await pipeline(Readable.fromWeb(response.body as any), createWriteStream(target));
    await makeExecutable(target);

    const status = await toolStatus('yt-dlp', target, context.paths.tools);
    if (!status.available) {
      await rm(target, { force: true });
      throw new Error('El archivo descargado no es ejecutable.');
    }

    await context.updateSettings({ ytdlpPath: target });
    notify('success', `yt-dlp instalado (${status.version ?? 'versión desconocida'}).`);
    return status;
  });

  /* ----------------------------------------------------------------- library */

  handle('library.export', async (request: ExportRequest) => {
    const extensions: Record<ExportRequest['format'], string> = {
      json: 'json',
      csv: 'csv',
      html: 'html',
      txt: 'txt',
      m3u: 'm3u',
    };
    const result = await dialog.showSaveDialog({
      title: 'Exportar biblioteca',
      defaultPath: `videoteca-${new Date().toISOString().slice(0, 10)}.${extensions[request.format]}`,
    });
    if (result.canceled || !result.filePath) return null;

    const count = await context.exchange.exportTo(result.filePath, request);
    notify('success', `${count} vídeos exportados.`);
    return { file: result.filePath, count };
  });

  handle('library.import', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Importar biblioteca',
      properties: ['openFile'],
      filters: [{ name: 'Exportación de Videoteca', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;

    const imported = await context.exchange.importFrom(result.filePaths[0]);
    changed('library-import');
    notify('success', `Importados ${imported.videos} vídeos y ${imported.tags} etiquetas.`);
    return imported;
  });

  handle('library.backup', async () => {
    const file = path.join(context.paths.backups, `videoteca-${Date.now()}.db`);
    await library.backup(file);
    notify('success', 'Copia de seguridad creada.');
    return file;
  });

  handle('library.optimize', () => {
    library.optimize();
    library.vacuum();
    notify('success', 'Base de datos optimizada.');
  });

  handle('library.reindex', () => {
    const count = library.videos.reindexAll();
    notify('success', `Índice de búsqueda reconstruido (${count} vídeos).`);
    return count;
  });

  handle('library.clearThumbnails', async () => {
    await context.thumbnails.clear();
    library.videos.updateMany(library.videos.searchIds({ includeArchived: true }), { thumbnailPath: null });
    changed('thumbnails');
    notify('success', 'Caché de miniaturas vaciada.');
  });

  handle('library.diskUsage', async () => {
    const sizeOf = async (target: string): Promise<number> => {
      try {
        return (await stat(target)).size;
      } catch {
        return 0;
      }
    };
    const downloads = library.videos.stats().totalDiskBytes;
    return {
      database: await sizeOf(context.paths.database),
      thumbnails: await context.thumbnails.size(),
      downloads,
    };
  });

  handle('library.revealPath', (target: string) => {
    shell.showItemInFolder(target);
  });

  handle('library.openExternal', async (url: string) => {
    // Only ever hand real web URLs to the OS browser.
    const parsed = parseVideoUrl(url);
    if (!/^https?:$/.test(new URL(parsed.canonicalUrl).protocol)) {
      throw new Error('Solo se pueden abrir enlaces http o https.');
    }
    await shell.openExternal(parsed.canonicalUrl);
  });
}

/** Exposed so the main process can serve cached thumbnails to the renderer. */
export function thumbnailFileUrl(absolutePath: string): string {
  return pathToFileURL(absolutePath).toString();
}

/** True when a URL looks like a playlist and should use the playlist importer. */
export { looksLikePlaylist };
