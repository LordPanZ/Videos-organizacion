import type { AppSettings, DownloadFormat } from './types.ts';

export const DEFAULT_DOWNLOAD_FORMAT: DownloadFormat = {
  quality: '1080p',
  audioOnly: false,
  container: 'mp4',
  embedSubtitles: false,
  embedThumbnail: true,
  subtitleLanguages: ['es', 'en'],
};

/**
 * Defaults applied to a fresh install. `libraryPath` and `downloadPath` are
 * filled in by the main process, which is the only place that knows the real
 * per-user directories.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  accentColor: '#4c8dff',
  language: 'es',
  libraryPath: '',
  downloadPath: '',
  layout: 'grid',
  cardSize: 260,
  sort: { field: 'addedAt', direction: 'desc' },
  autoFetchMetadata: true,
  autoTagOnImport: true,
  autoDownloadThumbnails: true,
  clipboardWatcher: false,
  quickAddServer: false,
  quickAddPort: 7317,
  ytdlpPath: null,
  ffmpegPath: null,
  maxConcurrentDownloads: 2,
  maxConcurrentMetadata: 4,
  defaultDownloadFormat: DEFAULT_DOWNLOAD_FORMAT,
  hoverPreview: true,
  showTitles: true,
  showBadges: true,
  confirmDelete: true,
  checkLinksOnStartup: false,
};

export const QUALITY_OPTIONS = [
  { value: 'best', label: 'Máxima disponible' },
  { value: '2160p', label: '4K · 2160p' },
  { value: '1440p', label: '2K · 1440p' },
  { value: '1080p', label: 'Full HD · 1080p' },
  { value: '720p', label: 'HD · 720p' },
  { value: '480p', label: 'SD · 480p' },
  { value: '360p', label: 'Baja · 360p' },
] as const;

export const ACCENT_COLORS = [
  '#4c8dff',
  '#7c5cff',
  '#e056a0',
  '#ff6b6b',
  '#ff9f43',
  '#26de81',
  '#2bcbba',
  '#fed330',
] as const;
