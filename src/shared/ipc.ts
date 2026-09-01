import type {
  AppSettings,
  AutoTagRule,
  Collection,
  CustomField,
  CustomFieldValue,
  DownloadFormat,
  DownloadJob,
  DuplicateGroup,
  ImportReport,
  LibraryStats,
  QueryOptions,
  QueryResult,
  SavedView,
  Tag,
  ToolStatus,
  Video,
  VideoBookmark,
  Author,
} from './types.ts';
import type { VideoPatch } from '../core/db/repos/videos.ts';

export interface ImportRequest {
  urls: string[];
  tagIds?: string[];
  collectionId?: string;
  fetchMetadata?: boolean;
  autoTag?: boolean;
  /** File everything imported straight into the container. */
  hidden?: boolean;
}

export interface ScanRequest {
  folder: string;
  recursive?: boolean;
  tagIds?: string[];
  collectionId?: string;
}

export interface ExportRequest {
  format: 'json' | 'csv' | 'html' | 'txt' | 'm3u';
  videoIds?: string[];
  query?: string;
}

/** Progress events pushed from the main process to the renderer. */
export interface EventMap {
  'import:progress': {
    done: number;
    total: number;
    current: string;
    lastTitle: string | null;
    added: number;
    duplicates: number;
    failed: number;
  };
  'import:done': ImportReport;
  'downloads:changed': DownloadJob[];
  'library:changed': { reason: string };
  'refresh:progress': { done: number; total: number; title: string };
  'toast': { kind: 'info' | 'success' | 'error'; message: string };
}

export type EventName = keyof EventMap;

/**
 * The full surface the renderer can call. Every method crosses the IPC
 * boundary, so arguments and results must be structured-cloneable.
 */
export interface VideotecaApi {
  videos: {
    search(options: QueryOptions): Promise<QueryResult>;
    searchIds(options: QueryOptions): Promise<string[]>;
    get(id: string): Promise<Video | null>;
    getMany(ids: string[]): Promise<Video[]>;
    update(id: string, patch: VideoPatch): Promise<Video | null>;
    updateMany(ids: string[], patch: VideoPatch): Promise<number>;
    remove(ids: string[], deleteFiles: boolean): Promise<number>;
    setCustomField(ids: string[], key: string, value: CustomFieldValue): Promise<number>;
    /** Attaches a cover image, or clears it when `dataUrl` is null. */
    setCover(videoId: string, dataUrl: string | null): Promise<Video | null>;
    setTags(videoId: string, tagIds: string[]): Promise<Video | null>;
    addTags(videoIds: string[], tagIds: string[]): Promise<number>;
    removeTags(videoIds: string[], tagIds: string[]): Promise<number>;
    open(id: string): Promise<void>;
    openFolder(id: string): Promise<void>;
    markOpened(id: string): Promise<void>;
    stats(): Promise<LibraryStats>;
    duplicates(): Promise<DuplicateGroup[]>;
    refresh(ids: string[]): Promise<{ updated: number; failed: number }>;
    checkLinks(ids: string[]): Promise<{ updated: number; failed: number }>;
    /**
     * Why a platform is handing over no picture. Null when there is nothing
     * useful to say. Only meaningful after an attempt returned nothing.
     */
    diagnose(platform: string, platformId: string | null): Promise<string | null>;
  };
  import: {
    urls(request: ImportRequest): Promise<ImportReport>;
    clipboard(): Promise<ImportReport>;
    playlist(url: string, limit: number, collectionId?: string): Promise<ImportReport>;
    scanFolder(request: ScanRequest): Promise<ImportReport>;
    pickFolder(): Promise<string | null>;
    pickFiles(): Promise<string[]>;
    cancel(): Promise<void>;
  };
  tags: {
    list(): Promise<Tag[]>;
    create(input: { name: string; color?: string | null; icon?: string | null; parentId?: string | null }): Promise<Tag>;
    update(id: string, patch: Partial<Tag>): Promise<void>;
    remove(id: string): Promise<void>;
    merge(sourceIds: string[], targetId: string): Promise<number>;
    unused(): Promise<Tag[]>;
    autoTag(videoIds: string[]): Promise<{ processed: number; tagsAdded: number }>;
  };
  authors: {
    list(): Promise<Author[]>;
    update(id: string, patch: Partial<Author>): Promise<void>;
  };
  collections: {
    list(): Promise<Collection[]>;
    create(input: { name: string; description?: string | null; icon?: string | null; color?: string | null; kind?: 'manual' | 'smart'; query?: string | null }): Promise<Collection>;
    update(id: string, patch: Partial<Collection>): Promise<void>;
    remove(id: string): Promise<void>;
    addVideos(id: string, videoIds: string[]): Promise<number>;
    removeVideos(id: string, videoIds: string[]): Promise<number>;
    reorder(id: string, videoIds: string[]): Promise<void>;
    forVideo(videoId: string): Promise<Collection[]>;
  };
  fields: {
    list(): Promise<CustomField[]>;
    create(input: { label: string; type: CustomField['type']; options?: CustomField['options']; icon?: string | null; color?: string | null; showInCard?: boolean; showInFacets?: boolean; description?: string | null }): Promise<CustomField>;
    update(id: string, patch: Partial<CustomField>): Promise<void>;
    remove(id: string): Promise<void>;
    values(key: string): Promise<string[]>;
  };
  bookmarks: {
    forVideo(videoId: string): Promise<VideoBookmark[]>;
    create(videoId: string, timeSeconds: number, label: string, note?: string | null): Promise<VideoBookmark>;
    update(id: string, patch: { label?: string; note?: string | null; timeSeconds?: number }): Promise<void>;
    remove(id: string): Promise<void>;
  };
  rules: {
    list(): Promise<AutoTagRule[]>;
    create(input: Omit<AutoTagRule, 'id' | 'createdAt' | 'matchCount'>): Promise<AutoTagRule>;
    update(id: string, patch: Partial<AutoTagRule>): Promise<void>;
    remove(id: string): Promise<void>;
    run(ruleId: string | null): Promise<{ processed: number; tagsAdded: number }>;
  };
  views: {
    list(): Promise<SavedView[]>;
    create(view: Omit<SavedView, 'id'>): Promise<SavedView>;
    update(id: string, patch: Partial<SavedView>): Promise<void>;
    remove(id: string): Promise<void>;
  };
  downloads: {
    list(): Promise<DownloadJob[]>;
    enqueue(videoIds: string[], format: DownloadFormat): Promise<DownloadJob[]>;
    cancel(jobId: string): Promise<void>;
    cancelAll(): Promise<void>;
    retry(jobId: string): Promise<void>;
    remove(jobId: string): Promise<void>;
    clearFinished(): Promise<void>;
  };
  settings: {
    get(): Promise<AppSettings>;
    set(patch: Partial<AppSettings>): Promise<AppSettings>;
    pickFolder(current: string): Promise<string | null>;
    tools(): Promise<ToolStatus[]>;
    installYtdlp(): Promise<ToolStatus>;
  };
  library: {
    export(request: ExportRequest): Promise<{ file: string; count: number } | null>;
    import(): Promise<{ videos: number; tags: number; collections: number; customFields: number } | null>;
    backup(): Promise<string | null>;
    optimize(): Promise<void>;
    reindex(): Promise<number>;
    clearThumbnails(): Promise<void>;
    diskUsage(): Promise<{ database: number; thumbnails: number; downloads: number }>;
    revealPath(target: string): Promise<void>;
    openExternal(url: string): Promise<void>;
  };
}

/**
 * Channel names, derived from the API shape. Preload turns each dotted name
 * into a nested method, so `videos.search` becomes `api.videos.search`.
 */
export const IPC_CHANNELS: string[] = [
  'videos.search',
  'videos.searchIds',
  'videos.get',
  'videos.getMany',
  'videos.update',
  'videos.updateMany',
  'videos.remove',
  'videos.setCustomField',
  'videos.setCover',
  'videos.setTags',
  'videos.addTags',
  'videos.removeTags',
  'videos.open',
  'videos.openFolder',
  'videos.markOpened',
  'videos.stats',
  'videos.duplicates',
  'videos.refresh',
  'videos.checkLinks',
  'videos.diagnose',
  'import.urls',
  'import.clipboard',
  'import.playlist',
  'import.scanFolder',
  'import.pickFolder',
  'import.pickFiles',
  'import.cancel',
  'tags.list',
  'tags.create',
  'tags.update',
  'tags.remove',
  'tags.merge',
  'tags.unused',
  'tags.autoTag',
  'authors.list',
  'authors.update',
  'collections.list',
  'collections.create',
  'collections.update',
  'collections.remove',
  'collections.addVideos',
  'collections.removeVideos',
  'collections.reorder',
  'collections.forVideo',
  'fields.list',
  'fields.create',
  'fields.update',
  'fields.remove',
  'fields.values',
  'bookmarks.forVideo',
  'bookmarks.create',
  'bookmarks.update',
  'bookmarks.remove',
  'rules.list',
  'rules.create',
  'rules.update',
  'rules.remove',
  'rules.run',
  'views.list',
  'views.create',
  'views.update',
  'views.remove',
  'downloads.list',
  'downloads.enqueue',
  'downloads.cancel',
  'downloads.cancelAll',
  'downloads.retry',
  'downloads.remove',
  'downloads.clearFinished',
  'settings.get',
  'settings.set',
  'settings.pickFolder',
  'settings.tools',
  'settings.installYtdlp',
  'library.export',
  'library.import',
  'library.backup',
  'library.optimize',
  'library.reindex',
  'library.clearThumbnails',
  'library.diskUsage',
  'library.revealPath',
  'library.openExternal',
];

export const EVENT_NAMES: EventName[] = [
  'import:progress',
  'import:done',
  'downloads:changed',
  'library:changed',
  'refresh:progress',
  'toast',
];
