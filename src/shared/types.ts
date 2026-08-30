/**
 * Domain model shared between the Electron main process (Node) and the
 * renderer (React). Nothing in this file may import Node or DOM APIs.
 */

export const PLATFORMS = [
  'youtube',
  'tiktok',
  'instagram',
  'vimeo',
  'twitter',
  'twitch',
  'dailymotion',
  'facebook',
  'reddit',
  'bilibili',
  'rumble',
  'odysee',
  'kick',
  'pinterest',
  'linkedin',
  'soundcloud',
  'local',
  'other',
] as const;

export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  vimeo: 'Vimeo',
  twitter: 'X / Twitter',
  twitch: 'Twitch',
  dailymotion: 'Dailymotion',
  facebook: 'Facebook',
  reddit: 'Reddit',
  bilibili: 'Bilibili',
  rumble: 'Rumble',
  odysee: 'Odysee',
  kick: 'Kick',
  pinterest: 'Pinterest',
  linkedin: 'LinkedIn',
  soundcloud: 'SoundCloud',
  local: 'Archivo local',
  other: 'Otra',
};

/** Brand colours used for platform chips and facet dots. */
export const PLATFORM_COLORS: Record<Platform, string> = {
  youtube: '#ff0033',
  tiktok: '#00f2ea',
  instagram: '#e1306c',
  vimeo: '#19b7ea',
  twitter: '#7d8590',
  twitch: '#9146ff',
  dailymotion: '#0066dc',
  facebook: '#1877f2',
  reddit: '#ff4500',
  bilibili: '#00a1d6',
  rumble: '#85c742',
  odysee: '#ef1970',
  kick: '#53fc18',
  pinterest: '#e60023',
  linkedin: '#0a66c2',
  soundcloud: '#ff5500',
  local: '#8b949e',
  other: '#6e7681',
};

export type WatchStatus = 'unwatched' | 'in_progress' | 'watched';
export type Availability = 'unknown' | 'ok' | 'unavailable' | 'private' | 'geoblocked';
export type TagSource = 'manual' | 'auto' | 'imported';
export type TagKind = 'manual' | 'auto' | 'platform' | 'topic' | 'creator';

export interface Author {
  id: string;
  platform: Platform;
  externalId: string | null;
  name: string;
  handle: string | null;
  url: string | null;
  avatarPath: string | null;
  subscriberCount: number | null;
  videoCount?: number;
}

export interface Tag {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  icon: string | null;
  kind: TagKind;
  parentId: string | null;
  description: string | null;
  createdAt: string;
  /** Populated by list queries. */
  videoCount?: number;
}

export type CustomFieldType =
  | 'text'
  | 'longtext'
  | 'number'
  | 'boolean'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'rating'
  | 'url'
  | 'duration';

export interface CustomFieldOption {
  value: string;
  label: string;
  color?: string;
}

/**
 * User-defined parameters. The whole point: the library schema grows with the
 * user instead of being frozen at build time.
 */
export interface CustomField {
  id: string;
  key: string;
  label: string;
  type: CustomFieldType;
  options: CustomFieldOption[];
  defaultValue: string | null;
  description: string | null;
  icon: string | null;
  color: string | null;
  position: number;
  showInCard: boolean;
  showInFacets: boolean;
  createdAt: string;
}

export type CustomFieldValue = string | number | boolean | string[] | null;

export interface VideoBookmark {
  id: string;
  videoId: string;
  timeSeconds: number;
  label: string;
  note: string | null;
  createdAt: string;
}

export interface Video {
  id: string;
  url: string;
  platform: Platform;
  platformId: string | null;
  title: string;
  description: string | null;
  author: Author | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  thumbnailPath: string | null;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  language: string | null;
  isLive: boolean;
  isShort: boolean;

  // User-owned data
  rating: number;
  favorite: boolean;
  watchStatus: WatchStatus;
  watchProgress: number;
  notes: string | null;
  color: string | null;
  archived: boolean;

  // Local copy
  filePath: string | null;
  fileSize: number | null;
  fileFormat: string | null;
  downloadedAt: string | null;

  // Housekeeping
  availability: Availability;
  lastCheckedAt: string | null;
  addedAt: string;
  updatedAt: string;
  openedCount: number;
  lastOpenedAt: string | null;

  tags: Tag[];
  customFields: Record<string, CustomFieldValue>;
}

export type CollectionKind = 'manual' | 'smart';

export interface Collection {
  id: string;
  name: string;
  description: string | null;
  coverPath: string | null;
  icon: string | null;
  color: string | null;
  kind: CollectionKind;
  /** For smart collections: the saved query string. */
  query: string | null;
  parentId: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  videoCount?: number;
}

export interface SavedView {
  id: string;
  name: string;
  query: string;
  sort: SortSpec;
  layout: LayoutMode;
  icon: string | null;
  position: number;
}

export type LayoutMode = 'grid' | 'masonry' | 'list' | 'table' | 'compact';

export type SortField =
  | 'addedAt'
  | 'updatedAt'
  | 'publishedAt'
  | 'title'
  | 'durationSeconds'
  | 'rating'
  | 'viewCount'
  | 'likeCount'
  | 'author'
  | 'platform'
  | 'lastOpenedAt'
  | 'openedCount'
  | 'fileSize'
  | 'random';

export interface SortSpec {
  field: SortField;
  direction: 'asc' | 'desc';
}

export interface QueryOptions {
  /** Search-bar text using the Videoteca query language. */
  query?: string;
  sort?: SortSpec;
  limit?: number;
  offset?: number;
  /** Restrict to a manual collection (respects its stored ordering). */
  collectionId?: string;
  includeArchived?: boolean;
}

export interface FacetValue {
  value: string;
  label: string;
  count: number;
  color?: string | null;
  icon?: string | null;
}

export interface Facets {
  platforms: FacetValue[];
  tags: FacetValue[];
  authors: FacetValue[];
  years: FacetValue[];
  ratings: FacetValue[];
  watchStatus: FacetValue[];
  durations: FacetValue[];
  availability: FacetValue[];
  /** Keyed by custom field key. */
  customFields: Record<string, FacetValue[]>;
}

export interface QueryResult {
  videos: Video[];
  total: number;
  facets: Facets;
  /** Non-fatal parse problems, surfaced next to the search bar. */
  warnings: string[];
}

/** Rule engine: `when` matches, `then` applies tags. */
export interface AutoTagRule {
  id: string;
  name: string;
  enabled: boolean;
  /** Field the pattern is tested against. */
  field: 'title' | 'description' | 'author' | 'url' | 'anyText' | 'platformTags';
  matcher: 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'regex';
  pattern: string;
  caseSensitive: boolean;
  tagIds: string[];
  /** Optional custom-field assignments applied alongside the tags. */
  setFields: Record<string, CustomFieldValue>;
  position: number;
  createdAt: string;
  matchCount: number;
}

export type DownloadState =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface DownloadJob {
  id: string;
  videoId: string;
  title: string;
  url: string;
  state: DownloadState;
  progress: number;
  speed: string | null;
  eta: string | null;
  totalBytes: number | null;
  downloadedBytes: number | null;
  outputPath: string | null;
  format: DownloadFormat;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface DownloadFormat {
  /** `best`, `1080p`, `720p`, `480p`, `audio` … */
  quality: string;
  audioOnly: boolean;
  container: string | null;
  embedSubtitles: boolean;
  embedThumbnail: boolean;
  subtitleLanguages: string[];
}

export interface AppSettings {
  theme: 'dark' | 'light' | 'system';
  accentColor: string;
  language: 'es' | 'en';
  libraryPath: string;
  downloadPath: string;
  layout: LayoutMode;
  cardSize: number;
  sort: SortSpec;
  autoFetchMetadata: boolean;
  autoTagOnImport: boolean;
  autoDownloadThumbnails: boolean;
  clipboardWatcher: boolean;
  quickAddServer: boolean;
  quickAddPort: number;
  ytdlpPath: string | null;
  ffmpegPath: string | null;
  maxConcurrentDownloads: number;
  maxConcurrentMetadata: number;
  defaultDownloadFormat: DownloadFormat;
  hoverPreview: boolean;
  showTitles: boolean;
  showBadges: boolean;
  confirmDelete: boolean;
  checkLinksOnStartup: boolean;
}

export interface LibraryStats {
  totalVideos: number;
  totalDuration: number;
  totalDownloaded: number;
  totalDiskBytes: number;
  byPlatform: FacetValue[];
  byTag: FacetValue[];
  byAuthor: FacetValue[];
  byMonth: { month: string; count: number }[];
  byWatchStatus: FacetValue[];
  byRating: FacetValue[];
  unavailable: number;
  untagged: number;
  duplicates: number;
  favorites: number;
  averageDuration: number;
  newestAddedAt: string | null;
}

/** Result of importing a batch of URLs. */
export interface ImportReport {
  requested: number;
  added: number;
  duplicates: number;
  failed: { url: string; error: string }[];
  videoIds: string[];
}

export interface ToolStatus {
  name: 'yt-dlp' | 'ffmpeg' | 'ffprobe';
  available: boolean;
  path: string | null;
  version: string | null;
}

export interface DuplicateGroup {
  key: string;
  reason: 'same-url' | 'same-platform-id' | 'same-title-author';
  videos: Video[];
}
