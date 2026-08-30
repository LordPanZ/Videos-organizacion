import { EventEmitter } from 'node:events';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { Library } from '../db/library.ts';
import { run } from '../util/tools.ts';
import type { DownloadFormat, DownloadJob } from '../../shared/types.ts';

export interface DownloadManagerOptions {
  ytdlpPath: string | null;
  ffmpegPath: string | null;
  downloadPath: string;
  maxConcurrent: number;
  /** Extra yt-dlp flags from settings (cookies, proxy, rate limit…). */
  extraArgs?: string[];
}

/** Live progress for a running job, merged over the persisted row. */
interface LiveProgress {
  progress: number;
  speed: string | null;
  eta: string | null;
  totalBytes: number | null;
  downloadedBytes: number | null;
}

function humanBytes(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return null;
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(1)} ${units[index]}`;
}

function humanEta(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} min ${s}s` : `${s}s`;
}

/** Builds the yt-dlp format selector for a requested quality. */
export function formatSelector(format: DownloadFormat): string[] {
  if (format.audioOnly) {
    return ['-f', 'bestaudio/best', '-x', '--audio-format', format.container ?? 'mp3', '--audio-quality', '0'];
  }

  const height = /^(\d+)p$/.exec(format.quality)?.[1];
  const selector = height
    ? `bv*[height<=${height}]+ba/b[height<=${height}]/bv*+ba/b`
    : 'bv*+ba/b';

  const args = ['-f', selector];
  if (format.container) args.push('--merge-output-format', format.container);
  return args;
}

/**
 * Serialized download queue backed by yt-dlp.
 *
 * Jobs are persisted, so a queue survives a restart; live progress is kept in
 * memory and merged on read, since writing every progress tick to SQLite would
 * be pointless churn.
 */
export class DownloadManager extends EventEmitter {
  private readonly library: Library;
  private options: DownloadManagerOptions;
  private readonly running = new Map<string, AbortController>();
  private readonly live = new Map<string, LiveProgress>();
  private draining = false;

  constructor(library: Library, options: DownloadManagerOptions) {
    super();
    this.library = library;
    this.options = options;
  }

  updateOptions(options: Partial<DownloadManagerOptions>): void {
    this.options = { ...this.options, ...options };
  }

  get available(): boolean {
    return this.options.ytdlpPath !== null;
  }

  /** Queues one video and starts draining the queue. */
  enqueue(videoId: string, format: DownloadFormat): DownloadJob {
    const video = this.library.videos.getById(videoId);
    if (!video) throw new Error('El vídeo no existe.');
    const job = this.library.downloads.create(videoId, video.url, format);
    this.emitChange();
    void this.drain();
    return job;
  }

  enqueueMany(videoIds: string[], format: DownloadFormat): DownloadJob[] {
    const jobs = videoIds.map((id) => {
      const video = this.library.videos.getById(id);
      if (!video) return null;
      return this.library.downloads.create(id, video.url, format);
    });
    this.emitChange();
    void this.drain();
    return jobs.filter((job): job is DownloadJob => job !== null);
  }

  /** Every job, with live progress merged in. */
  list(): DownloadJob[] {
    return this.library.downloads.list().map((job) => {
      const live = this.live.get(job.id);
      return live ? { ...job, ...live } : job;
    });
  }

  cancel(jobId: string): void {
    const controller = this.running.get(jobId);
    if (controller) {
      controller.abort();
      this.running.delete(jobId);
    }
    this.live.delete(jobId);
    this.library.downloads.setState(jobId, 'canceled');
    this.emitChange();
    void this.drain();
  }

  cancelAll(): void {
    for (const jobId of [...this.running.keys()]) this.cancel(jobId);
    for (const job of this.library.downloads.pending()) {
      this.library.downloads.setState(job.id, 'canceled');
    }
    this.emitChange();
  }

  retry(jobId: string): void {
    this.library.downloads.setState(jobId, 'queued', { error: null });
    this.emitChange();
    void this.drain();
  }

  remove(jobId: string): void {
    if (this.running.has(jobId)) this.cancel(jobId);
    this.library.downloads.remove(jobId);
    this.emitChange();
  }

  clearFinished(): void {
    this.library.downloads.clearFinished();
    this.emitChange();
  }

  private emitChange(): void {
    this.emit('change', this.list());
  }

  /** Starts as many queued jobs as the concurrency limit allows. */
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.running.size < Math.max(1, this.options.maxConcurrent)) {
        const next = this.library.downloads.pending().find((job) => job.state === 'queued' && !this.running.has(job.id));
        if (!next) break;
        void this.execute(next);
        // Give the spawn a tick so `running` is populated before re-checking.
        await new Promise((resolve) => setImmediate(resolve));
      }
    } finally {
      this.draining = false;
    }
  }

  private async execute(job: DownloadJob): Promise<void> {
    const binary = this.options.ytdlpPath;
    if (!binary) {
      this.library.downloads.setState(job.id, 'failed', {
        error: 'yt-dlp no está instalado. Instálalo desde Ajustes para descargar vídeos.',
      });
      this.emitChange();
      return;
    }

    const controller = new AbortController();
    this.running.set(job.id, controller);
    this.library.downloads.setState(job.id, 'downloading');
    this.emitChange();

    // Raw numeric progress is far easier to parse than the default display.
    const progressTemplate =
      'VTPROG|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s';

    const outputTemplate = path.join(this.options.downloadPath, '%(uploader,channel,extractor)s', '%(title).150B [%(id)s].%(ext)s');

    const args = [
      ...formatSelector(job.format),
      '--newline',
      '--no-warnings',
      '--ignore-config',
      '--no-playlist',
      '--restrict-filenames',
      '--windows-filenames',
      '--progress-template',
      progressTemplate,
      '--no-simulate',
      '--print',
      'after_move:filepath',
      '-o',
      outputTemplate,
    ];

    if (this.options.ffmpegPath) args.push('--ffmpeg-location', this.options.ffmpegPath);
    if (job.format.embedThumbnail) args.push('--embed-thumbnail');
    if (job.format.embedSubtitles && job.format.subtitleLanguages.length > 0) {
      args.push('--write-subs', '--sub-langs', job.format.subtitleLanguages.join(','), '--embed-subs');
    }
    args.push(...(this.options.extraArgs ?? []));
    args.push(job.url);

    let outputPath: string | null = null;

    try {
      const result = await run(binary, args, {
        signal: controller.signal,
        onStdout: (line) => {
          if (line.startsWith('VTPROG|')) {
            this.handleProgress(job.id, line);
            return;
          }
          // Any other stdout line from `--print` is the final file path.
          const trimmed = line.trim();
          if (trimmed && path.isAbsolute(trimmed)) outputPath = trimmed;
        },
      });

      if (controller.signal.aborted) {
        this.library.downloads.setState(job.id, 'canceled');
      } else if (result.code === 0) {
        await this.complete(job, outputPath);
      } else {
        const reason =
          result.stderr
            .split(/\r?\n/)
            .filter((line) => line.trim())
            .pop() ?? `yt-dlp terminó con código ${result.code}`;
        this.library.downloads.setState(job.id, 'failed', { error: reason.replace(/^ERROR:\s*/i, '') });
      }
    } catch (error) {
      this.library.downloads.setState(job.id, controller.signal.aborted ? 'canceled' : 'failed', {
        error: (error as Error).message,
      });
    } finally {
      this.running.delete(job.id);
      this.live.delete(job.id);
      this.emitChange();
      void this.drain();
    }
  }

  private handleProgress(jobId: string, line: string): void {
    const [, downloaded, total, estimate, speed, eta] = line.split('|');
    const toNumber = (value: string | undefined): number | null => {
      if (!value || value === 'NA' || value === 'None') return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const downloadedBytes = toNumber(downloaded);
    const totalBytes = toNumber(total) ?? toNumber(estimate);
    const progress = totalBytes && downloadedBytes ? Math.min(1, downloadedBytes / totalBytes) : 0;

    this.live.set(jobId, {
      progress,
      downloadedBytes,
      totalBytes,
      speed: humanBytes(toNumber(speed)),
      eta: humanEta(toNumber(eta)),
    });

    this.emit('progress', { jobId, progress, downloadedBytes, totalBytes });
  }

  /** Records the finished file on both the job and the video. */
  private async complete(job: DownloadJob, outputPath: string | null): Promise<void> {
    this.library.downloads.setState(job.id, 'completed', { outputPath });
    this.library.downloads.setProgress(job.id, 1, null, null);

    if (!outputPath) return;
    let size: number | null = null;
    try {
      size = (await stat(outputPath)).size;
    } catch {
      /* the file was moved or removed straight away */
    }

    this.library.videos.update(job.videoId, {
      filePath: outputPath,
      fileSize: size,
      fileFormat: path.extname(outputPath).replace('.', '') || null,
      downloadedAt: new Date().toISOString(),
    });
    this.emit('completed', { jobId: job.id, videoId: job.videoId, outputPath });
  }
}
