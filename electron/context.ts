import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Library } from '../src/core/db/library.ts';
import { MetadataResolver } from '../src/core/metadata/index.ts';
import { ThumbnailCache } from '../src/core/services/thumbnails.ts';
import { AutoTagger } from '../src/core/services/autoTag.ts';
import { Importer } from '../src/core/services/importer.ts';
import { DownloadManager } from '../src/core/services/downloads.ts';
import { Exchange } from '../src/core/services/exchange.ts';
import { findTool } from '../src/core/util/tools.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import type { AppSettings } from '../src/shared/types.ts';
import type { AppPaths } from './paths.ts';

const SETTINGS_KEY = 'app';

/**
 * Everything the IPC layer needs, wired together once at startup.
 *
 * Settings changes that affect service construction (tool paths, download
 * folder, concurrency) are pushed into the live services rather than
 * rebuilding them, so in-flight work is never interrupted by a preference
 * toggle.
 */
export class AppContext {
  readonly paths: AppPaths;
  readonly library: Library;
  readonly thumbnails: ThumbnailCache;
  readonly exchange: Exchange;
  downloads: DownloadManager;
  resolver: MetadataResolver;
  tagger: AutoTagger;
  importer: Importer;

  private cachedSettings: AppSettings;
  /** Cancels the import or refresh currently in flight. */
  activeOperation: AbortController | null = null;

  private constructor(paths: AppPaths, library: Library, settings: AppSettings, ytdlpPath: string | null, ffmpegPath: string | null, ffprobePath: string | null) {
    this.paths = paths;
    this.library = library;
    this.cachedSettings = settings;

    this.thumbnails = new ThumbnailCache(paths.thumbnails);
    this.exchange = new Exchange(library);
    this.resolver = new MetadataResolver({ ytdlpPath, ffprobePath });
    this.tagger = new AutoTagger(library);
    this.importer = new Importer(library, this.resolver, this.thumbnails, this.tagger);
    this.downloads = new DownloadManager(library, {
      ytdlpPath,
      ffmpegPath,
      downloadPath: settings.downloadPath,
      maxConcurrent: settings.maxConcurrentDownloads,
    });
  }

  static async create(paths: AppPaths): Promise<AppContext> {
    for (const dir of [paths.userData, paths.thumbnails, paths.tools, paths.backups]) {
      mkdirSync(dir, { recursive: true });
    }

    const library = new Library({ file: paths.database });

    const stored = library.settings.get<Partial<AppSettings>>(SETTINGS_KEY, {});
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...stored,
      libraryPath: paths.userData,
      downloadPath: stored.downloadPath || paths.defaultDownloads,
    };
    library.settings.set(SETTINGS_KEY, settings);
    mkdirSync(settings.downloadPath, { recursive: true });

    const [ytdlpPath, ffmpegPath, ffprobePath] = await Promise.all([
      findTool('yt-dlp', settings.ytdlpPath, paths.tools),
      findTool('ffmpeg', settings.ffmpegPath, paths.tools),
      findTool('ffprobe', settings.ffmpegPath ? path.join(path.dirname(settings.ffmpegPath), 'ffprobe') : null, paths.tools),
    ]);

    return new AppContext(paths, library, settings, ytdlpPath, ffmpegPath, ffprobePath);
  }

  get settings(): AppSettings {
    return this.cachedSettings;
  }

  /** Applies a settings patch and reconfigures anything that depends on it. */
  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const next: AppSettings = { ...this.cachedSettings, ...patch };
    this.cachedSettings = next;
    this.library.settings.set(SETTINGS_KEY, next);

    if (patch.downloadPath) mkdirSync(next.downloadPath, { recursive: true });

    // Tool paths may have changed; re-resolve them and rewire the services.
    if (patch.ytdlpPath !== undefined || patch.ffmpegPath !== undefined) {
      await this.refreshTools();
    }

    this.downloads.updateOptions({
      downloadPath: next.downloadPath,
      maxConcurrent: next.maxConcurrentDownloads,
    });

    return next;
  }

  /** Re-detects the external binaries and rebuilds the dependent services. */
  async refreshTools(): Promise<{ ytdlpPath: string | null; ffmpegPath: string | null; ffprobePath: string | null }> {
    const settings = this.cachedSettings;
    const [ytdlpPath, ffmpegPath, ffprobePath] = await Promise.all([
      findTool('yt-dlp', settings.ytdlpPath, this.paths.tools),
      findTool('ffmpeg', settings.ffmpegPath, this.paths.tools),
      findTool('ffprobe', settings.ffmpegPath ? path.join(path.dirname(settings.ffmpegPath), 'ffprobe') : null, this.paths.tools),
    ]);

    this.resolver = new MetadataResolver({ ytdlpPath, ffprobePath });
    this.importer = new Importer(this.library, this.resolver, this.thumbnails, this.tagger);
    this.downloads.updateOptions({ ytdlpPath, ffmpegPath });

    return { ytdlpPath, ffmpegPath, ffprobePath };
  }

  /** Aborts whatever long operation is running and starts a fresh controller. */
  beginOperation(): AbortController {
    this.activeOperation?.abort();
    const controller = new AbortController();
    this.activeOperation = controller;
    return controller;
  }

  endOperation(controller: AbortController): void {
    if (this.activeOperation === controller) this.activeOperation = null;
  }

  close(): void {
    this.activeOperation?.abort();
    this.downloads.cancelAll();
    this.library.close();
  }
}
