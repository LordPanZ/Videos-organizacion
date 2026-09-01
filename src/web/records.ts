import type {
  Author,
  Availability,
  Collection,
  CustomField,
  CustomFieldValue,
  Platform,
  Tag,
  Video,
  WatchStatus,
} from '../shared/types.ts';

/**
 * Shapes persisted to IndexedDB. They stay close to the domain types so a
 * record can be turned into a `Video` without a translation layer, and an
 * export from either build stays readable.
 */
export interface VideoRecord {
  id: string;
  url: string;
  urlKey: string;
  platform: Platform;
  platformId: string | null;
  title: string;
  description: string | null;
  authorId: string | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  language: string | null;
  isLive: boolean;
  isShort: boolean;
  rating: number;
  favorite: boolean;
  watchStatus: WatchStatus;
  watchProgress: number;
  notes: string | null;
  color: string | null;
  archived: boolean;
  hidden: boolean;
  availability: Availability;
  lastCheckedAt: string | null;
  addedAt: string;
  updatedAt: string;
  openedCount: number;
  lastOpenedAt: string | null;
  tagIds: string[];
  customFields: Record<string, CustomFieldValue>;
}

export interface CollectionRecord extends Omit<Collection, 'videoCount'> {
  /** Ordered membership; the array position is the manual ordering. */
  videoIds: string[];
}

export type TagRecord = Omit<Tag, 'videoCount'>;
export type AuthorRecord = Omit<Author, 'videoCount'>;
export type CustomFieldRecord = CustomField;

/** Builds the `Video` the interface consumes from a stored record. */
export function toVideo(record: VideoRecord, tags: Tag[], author: Author | null): Video {
  return {
    id: record.id,
    url: record.url,
    platform: record.platform,
    platformId: record.platformId,
    title: record.title,
    description: record.description,
    author,
    durationSeconds: record.durationSeconds,
    publishedAt: record.publishedAt,
    // The browser build never copies images to disk; the remote URL is used
    // directly and the service worker keeps it available offline.
    thumbnailPath: null,
    thumbnailUrl: record.thumbnailUrl,
    width: record.width,
    height: record.height,
    viewCount: record.viewCount,
    likeCount: record.likeCount,
    commentCount: record.commentCount,
    language: record.language,
    isLive: record.isLive,
    isShort: record.isShort,
    rating: record.rating,
    favorite: record.favorite,
    watchStatus: record.watchStatus,
    watchProgress: record.watchProgress,
    notes: record.notes,
    color: record.color,
    archived: record.archived,
    hidden: record.hidden,
    filePath: null,
    fileSize: null,
    fileFormat: null,
    downloadedAt: null,
    availability: record.availability,
    lastCheckedAt: record.lastCheckedAt,
    addedAt: record.addedAt,
    updatedAt: record.updatedAt,
    openedCount: record.openedCount,
    lastOpenedAt: record.lastOpenedAt,
    tags,
    customFields: record.customFields,
  };
}

/** Stable id generator; `crypto.randomUUID` is missing on older mobile browsers. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Slug used to match tags regardless of accents and case. */
export function slugify(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'sin-nombre'
  );
}
