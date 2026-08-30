import { clearStore, deleteMany, openDb, putMany, readAll, type StoreName } from './idb.ts';
import { newId, slugify, toVideo, type AuthorRecord, type CollectionRecord, type CustomFieldRecord, type TagRecord, type VideoRecord } from './records.ts';
import { evaluate, normalize, toSearchable, type EvaluationContext, type SearchableVideo } from './evaluate.ts';
import { parseQuery } from '../shared/query/parser.ts';
import { DURATION_BUCKETS } from '../shared/query/values.ts';
import { parseVideoUrl } from '../core/platforms/detect.ts';
import {
  PLATFORM_COLORS,
  PLATFORM_LABELS,
  type Author,
  type AutoTagRule,
  type Collection,
  type CustomField,
  type CustomFieldValue,
  type DuplicateGroup,
  type FacetValue,
  type Facets,
  type LibraryStats,
  type Platform,
  type QueryOptions,
  type QueryResult,
  type SavedView,
  type SortSpec,
  type Tag,
  type Video,
  type VideoBookmark,
} from '../shared/types.ts';

const WATCH_LABELS: Record<string, string> = {
  unwatched: 'Sin ver',
  in_progress: 'Viendo',
  watched: 'Visto',
};

const AVAILABILITY_LABELS: Record<string, string> = {
  ok: 'Disponible',
  unknown: 'Sin comprobar',
  unavailable: 'No disponible',
  private: 'Privado',
  geoblocked: 'Bloqueado por región',
};

const DEFAULT_SORT: SortSpec = { field: 'addedAt', direction: 'desc' };

/** Returned instead of counting facets when a caller does not need them. */
const EMPTY_FACETS: Facets = {
  platforms: [],
  tags: [],
  authors: [],
  years: [],
  ratings: [],
  watchStatus: [],
  durations: [],
  availability: [],
  customFields: {},
};

/** Decodes a `data:` URL into a Blob without a network round trip. */
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload] = dataUrl.split(',', 2);
  const type = /data:([^;]+)/.exec(header)?.[1] ?? 'image/jpeg';
  if (!header.includes(';base64')) {
    return new Blob([decodeURIComponent(payload ?? '')], { type });
  }
  const binary = atob(payload ?? '');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

/**
 * The browser library.
 *
 * Everything lives in memory and is written through to IndexedDB, which keeps
 * reads instant on a phone and lets the query language run over plain objects
 * with exactly the semantics the desktop build gets from SQL.
 */
export class WebLibrary {
  private db!: IDBDatabase;

  private videos = new Map<string, VideoRecord>();
  private tags = new Map<string, TagRecord>();
  private authors = new Map<string, AuthorRecord>();
  private collections = new Map<string, CollectionRecord>();
  private fields = new Map<string, CustomFieldRecord>();
  private bookmarks = new Map<string, VideoBookmark>();
  private views = new Map<string, SavedView>();
  private rules = new Map<string, AutoTagRule>();
  private settingsRow: Record<string, unknown> = {};

  /** Cached searchable projections, invalidated whenever a video changes. */
  private searchable = new Map<string, SearchableVideo>();

  /**
   * Cover images the user attached, kept out of the video rows so a query
   * never drags image data around. The object URLs are created once and reused
   * for the life of the session.
   */
  private covers = new Map<string, Blob>();
  private coverUrls = new Map<string, string>();
  private writes = new Set<Promise<void>>();

  async open(): Promise<void> {
    this.db = await openDb();
    const [videos, tags, authors, collections, fields, bookmarks, views, rules, settings] = await Promise.all([
      readAll<VideoRecord>(this.db, 'videos'),
      readAll<TagRecord>(this.db, 'tags'),
      readAll<AuthorRecord>(this.db, 'authors'),
      readAll<CollectionRecord>(this.db, 'collections'),
      readAll<CustomFieldRecord>(this.db, 'customFields'),
      readAll<VideoBookmark>(this.db, 'bookmarks'),
      readAll<SavedView>(this.db, 'savedViews'),
      readAll<AutoTagRule>(this.db, 'rules'),
      readAll<{ key: string; value: unknown }>(this.db, 'settings'),
    ]);

    for (const cover of await readAll<{ id: string; blob: Blob }>(this.db, 'covers')) {
      this.covers.set(cover.id, cover.blob);
    }

    for (const record of videos) this.videos.set(record.id, record);
    for (const record of tags) this.tags.set(record.id, record);
    for (const record of authors) this.authors.set(record.id, record);
    for (const record of collections) this.collections.set(record.id, record);
    for (const record of fields) this.fields.set(record.id, record);
    for (const record of bookmarks) this.bookmarks.set(record.id, record);
    for (const record of views) this.views.set(record.id, record);
    for (const record of rules) this.rules.set(record.id, record);
    for (const row of settings) this.settingsRow[row.key] = row.value;
  }

  /* ------------------------------------------------------------ persistence */

  private persist(store: StoreName, records: unknown[]): void {
    this.track(putMany(this.db, store, records), 'guardado', store);
  }

  private forget(store: StoreName, ids: string[]): void {
    this.track(deleteMany(this.db, store, ids), 'borrado', store);
  }

  /**
   * Writes never block the interface — the in-memory copy answers reads — but
   * they are kept in flight here so `flush()` can wait for them. Without that,
   * closing or reloading the tab right after an edit aborts the pending
   * transaction and the edit is silently lost.
   */
  private track(write: Promise<void>, action: string, store: StoreName): void {
    const pending = write.catch((error) => console.error('[videoteca]', action, store, error));
    this.writes.add(pending);
    void pending.finally(() => this.writes.delete(pending));
  }

  /** Resolves once every write issued so far has reached IndexedDB. */
  async flush(): Promise<void> {
    while (this.writes.size > 0) await Promise.all([...this.writes]);
  }

  private touch(record: VideoRecord): void {
    record.updatedAt = new Date().toISOString();
    this.searchable.delete(record.id);
    this.persist('videos', [record]);
  }

  /* ---------------------------------------------------------------- reading */

  private resolveTags(ids: string[]): Tag[] {
    const resolved: Tag[] = [];
    for (const id of ids) {
      const tag = this.tags.get(id);
      if (tag) resolved.push({ ...tag });
    }
    return resolved.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  private hydrate(record: VideoRecord): Video {
    const author = record.authorId ? (this.authors.get(record.authorId) ?? null) : null;
    const video = toVideo(record, this.resolveTags(record.tagIds), author ? { ...author } : null);
    const cover = this.coverUrl(record.id);
    // A cover the user chose always wins over whatever the platform offered.
    return cover ? { ...video, thumbnailUrl: cover } : video;
  }

  /** Object URL for a stored cover, created on first use. */
  private coverUrl(videoId: string): string | null {
    const existing = this.coverUrls.get(videoId);
    if (existing) return existing;
    const blob = this.covers.get(videoId);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this.coverUrls.set(videoId, url);
    return url;
  }

  /** True when the user attached their own image to this video. */
  hasCover(videoId: string): boolean {
    return this.covers.has(videoId);
  }

  /**
   * Stores a cover from a data URL, or clears it when given null.
   *
   * The image is held as a Blob rather than as text: a screenshot kept as a
   * data URL would take a third more space and be copied on every read.
   */
  setCover(videoId: string, dataUrl: string | null): Video | null {
    const record = this.videos.get(videoId);
    if (!record) return null;

    const stale = this.coverUrls.get(videoId);
    if (stale) {
      URL.revokeObjectURL(stale);
      this.coverUrls.delete(videoId);
    }

    if (dataUrl === null) {
      this.covers.delete(videoId);
      this.forget('covers', [videoId]);
    } else {
      const blob = dataUrlToBlob(dataUrl);
      this.covers.set(videoId, blob);
      this.persist('covers', [{ id: videoId, blob }]);
    }

    this.searchable.delete(videoId);
    return this.hydrate(record);
  }

  private searchableFor(record: VideoRecord): SearchableVideo {
    const cached = this.searchable.get(record.id);
    if (cached) return cached;
    const built = toSearchable(this.hydrate(record));
    this.searchable.set(record.id, built);
    return built;
  }

  getVideo(id: string): Video | null {
    const record = this.videos.get(id);
    return record ? this.hydrate(record) : null;
  }

  getMany(ids: string[]): Video[] {
    return ids.map((id) => this.videos.get(id)).filter((r): r is VideoRecord => r !== undefined).map((r) => this.hydrate(r));
  }

  getByUrl(url: string): Video | null {
    const key = parseVideoUrl(url).canonicalUrl;
    for (const record of this.videos.values()) {
      if (record.urlKey === key) return this.hydrate(record);
    }
    return null;
  }

  /* ------------------------------------------------------------ query setup */

  /** Maps each tag slug to itself plus every descendant slug. */
  private tagFamilies(): Map<string, Set<string>> {
    const childrenOf = new Map<string, TagRecord[]>();
    for (const tag of this.tags.values()) {
      if (!tag.parentId) continue;
      const list = childrenOf.get(tag.parentId) ?? [];
      list.push(tag);
      childrenOf.set(tag.parentId, list);
    }

    const families = new Map<string, Set<string>>();
    for (const tag of this.tags.values()) {
      const family = new Set<string>();
      const queue = [tag];
      while (queue.length > 0) {
        const current = queue.pop()!;
        if (family.has(current.slug)) continue;
        family.add(current.slug);
        queue.push(...(childrenOf.get(current.id) ?? []));
      }
      families.set(tag.slug, family);
      // A tag is also reachable by its display name.
      families.set(normalize(tag.name), family);
    }
    return families;
  }

  private buildContext(warnings: string[]): EvaluationContext {
    const collectionsByVideo = new Map<string, Set<string>>();
    const collectionIdsByName = new Map<string, string>();
    for (const collection of this.collections.values()) {
      collectionIdsByName.set(normalize(collection.name), collection.id);
      for (const videoId of collection.videoIds) {
        const set = collectionsByVideo.get(videoId) ?? new Set<string>();
        set.add(collection.id);
        collectionsByVideo.set(videoId, set);
      }
    }

    return {
      tagDescendants: this.tagFamilies(),
      collectionsByVideo,
      collectionIdsByName,
      customFieldKeys: new Set([...this.fields.values()].map((field) => field.key)),
      videoHasBookmarks: new Set([...this.bookmarks.values()].map((bookmark) => bookmark.videoId)),
      now: Date.now(),
      warnings,
    };
  }

  private sortVideos(items: VideoRecord[], sort: SortSpec, collection: CollectionRecord | null): VideoRecord[] {
    if (sort.field === 'random') {
      const shuffled = [...items];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    }

    if (collection && sort.field === 'addedAt') {
      const order = new Map(collection.videoIds.map((id, index) => [id, index]));
      return [...items].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }

    const direction = sort.direction === 'asc' ? 1 : -1;
    const value = (record: VideoRecord): string | number | null => {
      switch (sort.field) {
        case 'title':
          return record.title.toLowerCase();
        case 'author':
          return this.authors.get(record.authorId ?? '')?.name.toLowerCase() ?? null;
        case 'platform':
          return record.platform;
        case 'durationSeconds':
          return record.durationSeconds;
        case 'rating':
          return record.rating;
        case 'viewCount':
          return record.viewCount;
        case 'likeCount':
          return record.likeCount;
        case 'openedCount':
          return record.openedCount;
        case 'fileSize':
          return null;
        case 'publishedAt':
          return record.publishedAt;
        case 'updatedAt':
          return record.updatedAt;
        case 'lastOpenedAt':
          return record.lastOpenedAt;
        default:
          return record.addedAt;
      }
    };

    return [...items].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      // Rows without the sort value always sink to the bottom.
      if (left === null && right === null) return b.addedAt.localeCompare(a.addedAt);
      if (left === null) return 1;
      if (right === null) return -1;
      if (left === right) return b.addedAt.localeCompare(a.addedAt);
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
      return String(left).localeCompare(String(right), 'es') * direction;
    });
  }

  /** Runs a query and returns the page plus facet counts. */
  search(options: QueryOptions = {}): QueryResult {
    const warnings: string[] = [];
    const parsed = parseQuery(options.query ?? '', {
      customFieldKeys: [...this.fields.values()].map((field) => field.key),
    });
    warnings.push(...parsed.warnings);

    const context = this.buildContext(warnings);
    const collection = options.collectionId ? (this.collections.get(options.collectionId) ?? null) : null;
    const scope = collection
      ? collection.videoIds.map((id) => this.videos.get(id)).filter((r): r is VideoRecord => r !== undefined)
      : [...this.videos.values()];

    const matched = scope.filter((record) => {
      if (!options.includeArchived && record.archived) return false;
      return evaluate(parsed.root, this.searchableFor(record), context);
    });

    const sorted = this.sortVideos(matched, options.sort ?? DEFAULT_SORT, collection);
    const offset = Math.max(0, options.offset ?? 0);
    const limit = Math.max(0, Math.min(options.limit ?? 200, 2000));
    const page = sorted.slice(offset, offset + limit);

    return {
      videos: page.map((record) => this.hydrate(record)),
      total: sorted.length,
      facets: options.facets === false ? EMPTY_FACETS : this.facets(matched),
      // The same warning can fire once per video; show each only once.
      warnings: [...new Set(warnings)],
    };
  }

  searchIds(options: QueryOptions = {}): string[] {
    return this.search({ ...options, limit: 2000, offset: 0 }).videos.map((video) => video.id);
  }

  /* ----------------------------------------------------------------- facets */

  private facets(records: VideoRecord[]): Facets {
    const tally = <K extends string>(values: (K | null)[]): Map<K, number> => {
      const counts = new Map<K, number>();
      for (const value of values) {
        if (value === null) continue;
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return counts;
    };

    const byCount = (a: FacetValue, b: FacetValue) => b.count - a.count;

    const platforms = [...tally(records.map((r) => r.platform))].map(([value, count]) => ({
      value,
      label: PLATFORM_LABELS[value] ?? value,
      count,
      color: PLATFORM_COLORS[value] ?? null,
    }));

    const tagCounts = new Map<string, number>();
    for (const record of records) {
      for (const tagId of record.tagIds) tagCounts.set(tagId, (tagCounts.get(tagId) ?? 0) + 1);
    }
    const tags: FacetValue[] = [];
    for (const [tagId, count] of tagCounts) {
      const tag = this.tags.get(tagId);
      if (tag) tags.push({ value: tag.slug, label: tag.name, count, color: tag.color, icon: tag.icon });
    }

    const authorCounts = tally(records.map((r) => r.authorId));
    const authors: FacetValue[] = [];
    for (const [authorId, count] of authorCounts) {
      const author = this.authors.get(authorId);
      if (author) authors.push({ value: authorId, label: author.name, count });
    }

    const years = [...tally(records.map((r) => (r.publishedAt ? String(new Date(r.publishedAt).getUTCFullYear()) : null)))]
      .map(([value, count]) => ({ value, label: value, count }))
      .sort((a, b) => b.value.localeCompare(a.value));

    const durationOf = (seconds: number | null): string | null => {
      if (seconds === null) return null;
      if (seconds < 60) return 'micro';
      if (seconds < 300) return 'corto';
      if (seconds < 1200) return 'medio';
      if (seconds < 3600) return 'largo';
      return 'muy-largo';
    };
    const durationCounts = tally(records.map((r) => durationOf(r.durationSeconds)));
    const durations = DURATION_BUCKETS.filter((bucket) => durationCounts.has(bucket.id)).map((bucket) => ({
      value: bucket.id as string,
      label: bucket.label,
      count: durationCounts.get(bucket.id) ?? 0,
    }));

    const customFields: Record<string, FacetValue[]> = {};
    for (const field of this.fields.values()) {
      if (!field.showInFacets || field.type === 'longtext' || field.type === 'url') continue;
      const counts = new Map<string, number>();
      for (const record of records) {
        const stored = record.customFields[field.key];
        if (stored === null || stored === undefined || stored === '') continue;
        const values = Array.isArray(stored) ? stored.map(String) : [String(stored)];
        for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      customFields[field.key] = [...counts]
        .map(([value, count]) => ({
          value,
          label: field.options.find((option) => option.value === value)?.label ?? value,
          count,
          color: field.options.find((option) => option.value === value)?.color ?? null,
        }))
        .sort(byCount);
    }

    return {
      platforms: platforms.sort(byCount),
      tags: tags.sort(byCount).slice(0, 300),
      authors: authors.sort(byCount).slice(0, 300),
      years,
      ratings: [...tally(records.map((r) => String(r.rating)))]
        .map(([value, count]) => ({ value, label: `${value} ★`, count }))
        .sort((a, b) => Number(b.value) - Number(a.value)),
      watchStatus: [...tally(records.map((r) => r.watchStatus))].map(([value, count]) => ({
        value,
        label: WATCH_LABELS[value] ?? value,
        count,
      })),
      durations,
      availability: [...tally(records.map((r) => r.availability))].map(([value, count]) => ({
        value,
        label: AVAILABILITY_LABELS[value] ?? value,
        count,
      })),
      customFields,
    };
  }

  /* ---------------------------------------------------------------- videos */

  /** Creates a video, or returns null when its URL is already in the library. */
  insertVideo(input: {
    url: string;
    platform: Platform;
    platformId?: string | null;
    title: string;
    description?: string | null;
    authorId?: string | null;
    durationSeconds?: number | null;
    publishedAt?: string | null;
    thumbnailUrl?: string | null;
    width?: number | null;
    height?: number | null;
    viewCount?: number | null;
    likeCount?: number | null;
    language?: string | null;
    isShort?: boolean;
    isLive?: boolean;
  }): Video | null {
    const urlKey = parseVideoUrl(input.url).canonicalUrl;
    for (const existing of this.videos.values()) {
      if (existing.urlKey === urlKey) return null;
    }

    const now = new Date().toISOString();
    const record: VideoRecord = {
      id: newId(),
      url: urlKey,
      urlKey,
      platform: input.platform,
      platformId: input.platformId ?? null,
      title: input.title,
      description: input.description ?? null,
      authorId: input.authorId ?? null,
      durationSeconds: input.durationSeconds ?? null,
      publishedAt: input.publishedAt ?? null,
      thumbnailUrl: input.thumbnailUrl ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      viewCount: input.viewCount ?? null,
      likeCount: input.likeCount ?? null,
      commentCount: null,
      language: input.language ?? null,
      isLive: input.isLive ?? false,
      isShort: input.isShort ?? false,
      rating: 0,
      favorite: false,
      watchStatus: 'unwatched',
      watchProgress: 0,
      notes: null,
      color: null,
      archived: false,
      availability: 'unknown',
      lastCheckedAt: null,
      addedAt: now,
      updatedAt: now,
      openedCount: 0,
      lastOpenedAt: null,
      tagIds: [],
      customFields: {},
    };

    this.videos.set(record.id, record);
    this.persist('videos', [record]);
    return this.hydrate(record);
  }

  updateVideo(id: string, patch: Partial<Video>): Video | null {
    const record = this.videos.get(id);
    if (!record) return null;

    const assignable: (keyof VideoRecord)[] = [
      'title',
      'description',
      'platformId',
      'durationSeconds',
      'publishedAt',
      'thumbnailUrl',
      'width',
      'height',
      'viewCount',
      'likeCount',
      'commentCount',
      'language',
      'isLive',
      'isShort',
      'rating',
      'favorite',
      'watchStatus',
      'watchProgress',
      'notes',
      'color',
      'archived',
      'availability',
      'lastCheckedAt',
    ];

    for (const key of assignable) {
      if (key in patch) {
        // The assignable list is a subset of keys the two types share, so the
        // values line up; TypeScript cannot see that through the index write.
        (record as unknown as Record<string, unknown>)[key] = (patch as unknown as Record<string, unknown>)[key];
      }
    }
    if (patch.author !== undefined) record.authorId = patch.author?.id ?? null;
    if (patch.url !== undefined && patch.url) {
      record.url = patch.url;
      record.urlKey = parseVideoUrl(patch.url).canonicalUrl;
    }

    this.touch(record);
    return this.hydrate(record);
  }

  updateMany(ids: string[], patch: Partial<Video>): number {
    let count = 0;
    for (const id of ids) {
      if (this.updateVideo(id, patch)) count += 1;
    }
    return count;
  }

  removeVideos(ids: string[]): number {
    let removed = 0;
    for (const id of ids) {
      if (!this.videos.delete(id)) continue;
      this.searchable.delete(id);
      removed += 1;
    }
    // Membership and bookmarks would otherwise point at videos that are gone.
    for (const collection of this.collections.values()) {
      const before = collection.videoIds.length;
      collection.videoIds = collection.videoIds.filter((videoId) => !ids.includes(videoId));
      if (collection.videoIds.length !== before) this.persist('collections', [collection]);
    }
    for (const id of ids) {
      const url = this.coverUrls.get(id);
      if (url) URL.revokeObjectURL(url);
      this.coverUrls.delete(id);
      this.covers.delete(id);
    }
    this.forget('covers', ids);

    const orphanBookmarks = [...this.bookmarks.values()].filter((bookmark) => ids.includes(bookmark.videoId));
    for (const bookmark of orphanBookmarks) this.bookmarks.delete(bookmark.id);
    this.forget('bookmarks', orphanBookmarks.map((bookmark) => bookmark.id));
    this.forget('videos', ids);
    return removed;
  }

  markOpened(id: string): void {
    const record = this.videos.get(id);
    if (!record) return;
    record.openedCount += 1;
    record.lastOpenedAt = new Date().toISOString();
    this.persist('videos', [record]);
  }

  /* ------------------------------------------------------------------ tags */

  listTags(): Tag[] {
    const counts = new Map<string, number>();
    for (const record of this.videos.values()) {
      for (const tagId of record.tagIds) counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
    }
    return [...this.tags.values()]
      .map((tag) => ({ ...tag, videoCount: counts.get(tag.id) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  /** Finds a tag by slug, creating it when missing. */
  ensureTag(input: { name: string; color?: string | null; icon?: string | null; kind?: Tag['kind']; parentId?: string | null }): Tag {
    const slug = slugify(input.name);
    for (const tag of this.tags.values()) {
      if (tag.slug === slug) return { ...tag };
    }
    const tag: TagRecord = {
      id: newId(),
      name: input.name.trim(),
      slug,
      color: input.color ?? null,
      icon: input.icon ?? null,
      kind: input.kind ?? 'manual',
      parentId: input.parentId ?? null,
      description: null,
      createdAt: new Date().toISOString(),
    };
    this.tags.set(tag.id, tag);
    this.persist('tags', [tag]);
    return { ...tag };
  }

  updateTag(id: string, patch: Partial<Tag>): void {
    const tag = this.tags.get(id);
    if (!tag) return;
    if (patch.name !== undefined) {
      tag.name = patch.name.trim();
      tag.slug = slugify(patch.name);
    }
    if (patch.color !== undefined) tag.color = patch.color;
    if (patch.icon !== undefined) tag.icon = patch.icon;
    if (patch.parentId !== undefined) tag.parentId = this.wouldCycle(id, patch.parentId) ? null : patch.parentId;
    this.persist('tags', [tag]);
    this.searchable.clear();
  }

  /** True when re-parenting `id` under `parentId` would create a loop. */
  private wouldCycle(id: string, parentId: string | null | undefined): boolean {
    if (!parentId) return false;
    let cursor: string | null = parentId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      if (cursor === id) return true;
      seen.add(cursor);
      cursor = this.tags.get(cursor)?.parentId ?? null;
    }
    return false;
  }

  removeTag(id: string): void {
    const tag = this.tags.get(id);
    if (!tag) return;
    // Children are promoted rather than orphaned.
    const promoted: TagRecord[] = [];
    for (const candidate of this.tags.values()) {
      if (candidate.parentId === id) {
        candidate.parentId = tag.parentId;
        promoted.push(candidate);
      }
    }
    this.tags.delete(id);
    this.forget('tags', [id]);
    if (promoted.length > 0) this.persist('tags', promoted);
    this.detachTag(id);
  }

  private detachTag(tagId: string): void {
    const touched: VideoRecord[] = [];
    for (const record of this.videos.values()) {
      if (!record.tagIds.includes(tagId)) continue;
      record.tagIds = record.tagIds.filter((id) => id !== tagId);
      this.searchable.delete(record.id);
      touched.push(record);
    }
    if (touched.length > 0) this.persist('videos', touched);
  }

  mergeTags(sourceIds: string[], targetId: string): number {
    const sources = sourceIds.filter((id) => id !== targetId);
    if (sources.length === 0) return 0;
    const touched: VideoRecord[] = [];
    for (const record of this.videos.values()) {
      if (!record.tagIds.some((id) => sources.includes(id))) continue;
      const kept = record.tagIds.filter((id) => !sources.includes(id));
      if (!kept.includes(targetId)) kept.push(targetId);
      record.tagIds = kept;
      this.searchable.delete(record.id);
      touched.push(record);
    }
    for (const id of sources) this.tags.delete(id);
    this.forget('tags', sources);
    if (touched.length > 0) this.persist('videos', touched);
    return touched.length;
  }

  unusedTags(): Tag[] {
    return this.listTags().filter(
      (tag) => (tag.videoCount ?? 0) === 0 && ![...this.tags.values()].some((child) => child.parentId === tag.id),
    );
  }

  setTags(videoId: string, tagIds: string[]): Video | null {
    const record = this.videos.get(videoId);
    if (!record) return null;
    record.tagIds = [...new Set(tagIds.filter((id) => this.tags.has(id)))];
    this.touch(record);
    return this.hydrate(record);
  }

  addTags(videoIds: string[], tagIds: string[]): number {
    const valid = tagIds.filter((id) => this.tags.has(id));
    const touched: VideoRecord[] = [];
    for (const videoId of videoIds) {
      const record = this.videos.get(videoId);
      if (!record) continue;
      record.tagIds = [...new Set([...record.tagIds, ...valid])];
      record.updatedAt = new Date().toISOString();
      this.searchable.delete(record.id);
      touched.push(record);
    }
    this.persist('videos', touched);
    return touched.length;
  }

  removeTags(videoIds: string[], tagIds: string[]): number {
    const touched: VideoRecord[] = [];
    for (const videoId of videoIds) {
      const record = this.videos.get(videoId);
      if (!record) continue;
      record.tagIds = record.tagIds.filter((id) => !tagIds.includes(id));
      record.updatedAt = new Date().toISOString();
      this.searchable.delete(record.id);
      touched.push(record);
    }
    this.persist('videos', touched);
    return touched.length;
  }

  /* --------------------------------------------------------------- authors */

  listAuthors(): Author[] {
    const counts = new Map<string, number>();
    for (const record of this.videos.values()) {
      if (record.authorId) counts.set(record.authorId, (counts.get(record.authorId) ?? 0) + 1);
    }
    return [...this.authors.values()]
      .map((author) => ({ ...author, videoCount: counts.get(author.id) ?? 0 }))
      .sort((a, b) => (b.videoCount ?? 0) - (a.videoCount ?? 0));
  }

  ensureAuthor(input: { platform: Platform; name: string; handle?: string | null; url?: string | null }): Author {
    const name = normalize(input.name);
    for (const author of this.authors.values()) {
      if (author.platform === input.platform && normalize(author.name) === name) return { ...author };
    }
    const author: AuthorRecord = {
      id: newId(),
      platform: input.platform,
      externalId: null,
      name: input.name.trim(),
      handle: input.handle ?? null,
      url: input.url ?? null,
      avatarPath: null,
      subscriberCount: null,
    };
    this.authors.set(author.id, author);
    this.persist('authors', [author]);
    return { ...author };
  }

  updateAuthor(id: string, patch: Partial<Author>): void {
    const author = this.authors.get(id);
    if (!author) return;
    if (patch.name !== undefined) author.name = patch.name;
    if (patch.handle !== undefined) author.handle = patch.handle;
    if (patch.url !== undefined) author.url = patch.url;
    this.persist('authors', [author]);
    this.searchable.clear();
  }

  /* ----------------------------------------------------------- collections */

  listCollections(): Collection[] {
    return [...this.collections.values()]
      .map(({ videoIds, ...rest }) => ({ ...rest, videoCount: videoIds.length }))
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'es'));
  }

  createCollection(input: Partial<Collection> & { name: string }): Collection {
    const now = new Date().toISOString();
    const record: CollectionRecord = {
      id: newId(),
      name: input.name.trim(),
      description: input.description ?? null,
      coverPath: null,
      icon: input.icon ?? null,
      color: input.color ?? null,
      kind: input.kind ?? 'manual',
      query: input.query ?? null,
      parentId: null,
      position: this.collections.size,
      createdAt: now,
      updatedAt: now,
      videoIds: [],
    };
    this.collections.set(record.id, record);
    this.persist('collections', [record]);
    const { videoIds, ...rest } = record;
    return { ...rest, videoCount: videoIds.length };
  }

  updateCollection(id: string, patch: Partial<Collection>): void {
    const record = this.collections.get(id);
    if (!record) return;
    if (patch.name !== undefined) record.name = patch.name.trim();
    if (patch.description !== undefined) record.description = patch.description;
    if (patch.icon !== undefined) record.icon = patch.icon;
    if (patch.color !== undefined) record.color = patch.color;
    if (patch.query !== undefined) record.query = patch.query;
    if (patch.kind !== undefined) record.kind = patch.kind;
    record.updatedAt = new Date().toISOString();
    this.persist('collections', [record]);
  }

  removeCollection(id: string): void {
    this.collections.delete(id);
    this.forget('collections', [id]);
  }

  addToCollection(id: string, videoIds: string[]): number {
    const record = this.collections.get(id);
    if (!record) return 0;
    const before = record.videoIds.length;
    record.videoIds = [...new Set([...record.videoIds, ...videoIds.filter((videoId) => this.videos.has(videoId))])];
    record.updatedAt = new Date().toISOString();
    this.persist('collections', [record]);
    return record.videoIds.length - before;
  }

  removeFromCollection(id: string, videoIds: string[]): number {
    const record = this.collections.get(id);
    if (!record) return 0;
    const before = record.videoIds.length;
    record.videoIds = record.videoIds.filter((videoId) => !videoIds.includes(videoId));
    this.persist('collections', [record]);
    return before - record.videoIds.length;
  }

  reorderCollection(id: string, videoIds: string[]): void {
    const record = this.collections.get(id);
    if (!record) return;
    const known = new Set(record.videoIds);
    record.videoIds = [...videoIds.filter((videoId) => known.has(videoId)), ...record.videoIds.filter((videoId) => !videoIds.includes(videoId))];
    this.persist('collections', [record]);
  }

  collectionsForVideo(videoId: string): Collection[] {
    return [...this.collections.values()]
      .filter((collection) => collection.videoIds.includes(videoId))
      .map(({ videoIds, ...rest }) => ({ ...rest, videoCount: videoIds.length }));
  }

  /* --------------------------------------------------------- custom fields */

  listFields(): CustomField[] {
    return [...this.fields.values()].sort((a, b) => a.position - b.position || a.label.localeCompare(b.label, 'es'));
  }

  createField(input: Partial<CustomField> & { label: string; type: CustomField['type'] }): CustomField {
    const base = slugify(input.key ?? input.label).replace(/-/g, '_') || 'campo';
    let key = base;
    let counter = 2;
    while ([...this.fields.values()].some((field) => field.key === key)) {
      key = `${base}_${counter}`;
      counter += 1;
    }
    const field: CustomFieldRecord = {
      id: newId(),
      key,
      label: input.label.trim(),
      type: input.type,
      options: input.options ?? [],
      defaultValue: null,
      description: input.description ?? null,
      icon: input.icon ?? null,
      color: input.color ?? null,
      position: this.fields.size,
      showInCard: input.showInCard ?? false,
      showInFacets: input.showInFacets !== false,
      createdAt: new Date().toISOString(),
    };
    this.fields.set(field.id, field);
    this.persist('customFields', [field]);
    return { ...field };
  }

  updateField(id: string, patch: Partial<CustomField>): void {
    const field = this.fields.get(id);
    if (!field) return;
    if (patch.label !== undefined) field.label = patch.label.trim();
    if (patch.options !== undefined) field.options = patch.options;
    if (patch.icon !== undefined) field.icon = patch.icon;
    if (patch.color !== undefined) field.color = patch.color;
    if (patch.description !== undefined) field.description = patch.description;
    if (patch.showInCard !== undefined) field.showInCard = patch.showInCard;
    if (patch.showInFacets !== undefined) field.showInFacets = patch.showInFacets;
    this.persist('customFields', [field]);
  }

  removeField(id: string): void {
    const field = this.fields.get(id);
    if (!field) return;
    this.fields.delete(id);
    this.forget('customFields', [id]);

    const touched: VideoRecord[] = [];
    for (const record of this.videos.values()) {
      if (!(field.key in record.customFields)) continue;
      delete record.customFields[field.key];
      touched.push(record);
    }
    this.persist('videos', touched);
  }

  setCustomField(videoIds: string[], key: string, value: CustomFieldValue): number {
    const field = [...this.fields.values()].find((candidate) => candidate.key === key);
    if (!field) throw new Error(`El campo personalizado "${key}" no existe.`);

    const clearing = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
    const touched: VideoRecord[] = [];
    for (const videoId of videoIds) {
      const record = this.videos.get(videoId);
      if (!record) continue;
      if (clearing) delete record.customFields[key];
      else record.customFields[key] = value;
      record.updatedAt = new Date().toISOString();
      touched.push(record);
    }
    this.persist('videos', touched);
    return touched.length;
  }

  fieldValues(key: string): string[] {
    const counts = new Map<string, number>();
    for (const record of this.videos.values()) {
      const stored = record.customFields[key];
      if (stored === null || stored === undefined) continue;
      for (const value of Array.isArray(stored) ? stored.map(String) : [String(stored)]) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    return [...counts].sort((a, b) => b[1] - a[1]).map(([value]) => value);
  }

  /* ------------------------------------------------------------- bookmarks */

  bookmarksFor(videoId: string): VideoBookmark[] {
    return [...this.bookmarks.values()]
      .filter((bookmark) => bookmark.videoId === videoId)
      .sort((a, b) => a.timeSeconds - b.timeSeconds);
  }

  createBookmark(videoId: string, timeSeconds: number, label: string, note?: string | null): VideoBookmark {
    const bookmark: VideoBookmark = {
      id: newId(),
      videoId,
      timeSeconds: Math.max(0, timeSeconds),
      label: label.trim() || 'Marcador',
      note: note ?? null,
      createdAt: new Date().toISOString(),
    };
    this.bookmarks.set(bookmark.id, bookmark);
    this.persist('bookmarks', [bookmark]);
    return bookmark;
  }

  updateBookmark(id: string, patch: Partial<VideoBookmark>): void {
    const bookmark = this.bookmarks.get(id);
    if (!bookmark) return;
    Object.assign(bookmark, patch, { id: bookmark.id, videoId: bookmark.videoId });
    this.persist('bookmarks', [bookmark]);
  }

  removeBookmark(id: string): void {
    this.bookmarks.delete(id);
    this.forget('bookmarks', [id]);
  }

  /* ----------------------------------------------------- views, rules, prefs */

  listViews(): SavedView[] {
    return [...this.views.values()].sort((a, b) => a.position - b.position);
  }

  createView(view: Omit<SavedView, 'id'>): SavedView {
    const record: SavedView = { ...view, id: newId() };
    this.views.set(record.id, record);
    this.persist('savedViews', [record]);
    return record;
  }

  updateView(id: string, patch: Partial<SavedView>): void {
    const view = this.views.get(id);
    if (!view) return;
    Object.assign(view, patch, { id: view.id });
    this.persist('savedViews', [view]);
  }

  removeView(id: string): void {
    this.views.delete(id);
    this.forget('savedViews', [id]);
  }

  listRules(): AutoTagRule[] {
    return [...this.rules.values()].sort((a, b) => a.position - b.position);
  }

  createRule(input: Omit<AutoTagRule, 'id' | 'createdAt' | 'matchCount'>): AutoTagRule {
    const rule: AutoTagRule = { ...input, id: newId(), createdAt: new Date().toISOString(), matchCount: 0 };
    this.rules.set(rule.id, rule);
    this.persist('rules', [rule]);
    return rule;
  }

  updateRule(id: string, patch: Partial<AutoTagRule>): void {
    const rule = this.rules.get(id);
    if (!rule) return;
    Object.assign(rule, patch, { id: rule.id });
    this.persist('rules', [rule]);
  }

  removeRule(id: string): void {
    this.rules.delete(id);
    this.forget('rules', [id]);
  }

  getSetting<T>(key: string, fallback: T): T {
    const value = this.settingsRow[key];
    return value === undefined || value === null ? fallback : (value as T);
  }

  setSetting(key: string, value: unknown): void {
    this.settingsRow[key] = value;
    this.persist('settings', [{ key, value }]);
  }

  /* ------------------------------------------------------------ analytics */

  stats(): LibraryStats {
    const active = [...this.videos.values()].filter((record) => !record.archived);
    const duration = active.reduce((sum, record) => sum + (record.durationSeconds ?? 0), 0);

    const monthly = new Map<string, number>();
    for (const record of active) {
      const month = record.addedAt.slice(0, 7);
      monthly.set(month, (monthly.get(month) ?? 0) + 1);
    }

    const facets = this.facets(active);
    const platformIds = new Map<string, number>();
    for (const record of active) {
      if (!record.platformId) continue;
      const key = `${record.platform}:${record.platformId}`;
      platformIds.set(key, (platformIds.get(key) ?? 0) + 1);
    }

    return {
      totalVideos: active.length,
      totalDuration: duration,
      totalDownloaded: 0,
      totalDiskBytes: 0,
      byPlatform: facets.platforms,
      byTag: facets.tags.slice(0, 40),
      byAuthor: facets.authors.slice(0, 40),
      byMonth: [...monthly].sort((a, b) => a[0].localeCompare(b[0])).slice(-24).map(([month, count]) => ({ month, count })),
      byWatchStatus: facets.watchStatus,
      byRating: facets.ratings,
      unavailable: active.filter((r) => r.availability !== 'ok' && r.availability !== 'unknown').length,
      untagged: active.filter((r) => r.tagIds.length === 0).length,
      duplicates: [...platformIds.values()].filter((count) => count > 1).length,
      favorites: active.filter((r) => r.favorite).length,
      averageDuration: active.length > 0 ? Math.round(duration / active.length) : 0,
      newestAddedAt: active.reduce<string | null>((newest, r) => (newest === null || r.addedAt > newest ? r.addedAt : newest), null),
    };
  }

  duplicates(): DuplicateGroup[] {
    const groups = new Map<string, VideoRecord[]>();
    for (const record of this.videos.values()) {
      const key = record.platformId
        ? `${record.platform}:${record.platformId}`
        : `${normalize(record.title)}|${record.authorId ?? ''}`;
      const list = groups.get(key) ?? [];
      list.push(record);
      groups.set(key, list);
    }

    return [...groups]
      .filter(([, records]) => records.length > 1)
      .map(([key, records]) => ({
        key,
        reason: records[0].platformId ? ('same-platform-id' as const) : ('same-title-author' as const),
        videos: records.map((record) => this.hydrate(record)),
      }));
  }

  /* ---------------------------------------------------------- import/export */

  /** The whole library as a plain object, for backup and transfer. */
  exportAll(): Record<string, unknown> {
    return {
      format: 'videoteca-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      customFields: this.listFields(),
      tags: this.listTags(),
      collections: [...this.collections.values()],
      videos: [...this.videos.values()].map((record) => this.hydrate(record)),
    };
  }

  /** Restores an export. Videos already present (by URL) are skipped. */
  importAll(payload: Record<string, unknown>): { videos: number; tags: number; collections: number; customFields: number } {
    const result = { videos: 0, tags: 0, collections: 0, customFields: 0 };

    for (const field of (payload.customFields as CustomField[] | undefined) ?? []) {
      if ([...this.fields.values()].some((existing) => existing.key === field.key)) continue;
      this.createField(field);
      result.customFields += 1;
    }

    const tagIdByName = new Map<string, string>();
    for (const tag of (payload.tags as Tag[] | undefined) ?? []) {
      const created = this.ensureTag({ name: tag.name, color: tag.color, icon: tag.icon, kind: tag.kind });
      tagIdByName.set(normalize(tag.name), created.id);
      result.tags += 1;
    }

    for (const video of (payload.videos as Video[] | undefined) ?? []) {
      if (!video?.url) continue;
      const author = video.author
        ? this.ensureAuthor({ platform: video.platform, name: video.author.name, handle: video.author.handle, url: video.author.url })
        : null;

      const created = this.insertVideo({
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
      if (!created) continue;

      this.updateVideo(created.id, {
        rating: video.rating ?? 0,
        favorite: video.favorite ?? false,
        watchStatus: video.watchStatus ?? 'unwatched',
        notes: video.notes ?? null,
      });

      const tagIds = (video.tags ?? [])
        .map((tag) => tagIdByName.get(normalize(tag.name)) ?? this.ensureTag({ name: tag.name }).id)
        .filter(Boolean);
      if (tagIds.length > 0) this.addTags([created.id], tagIds);

      for (const [key, value] of Object.entries(video.customFields ?? {})) {
        try {
          this.setCustomField([created.id], key, value);
        } catch {
          // The export referenced a field this library does not define.
        }
      }
      result.videos += 1;
    }

    for (const collection of (payload.collections as Collection[] | undefined) ?? []) {
      this.createCollection(collection);
      result.collections += 1;
    }

    return result;
  }

  /** Wipes the library. Used by the "start over" action in settings. */
  async reset(): Promise<void> {
    this.videos.clear();
    this.tags.clear();
    this.authors.clear();
    this.collections.clear();
    this.fields.clear();
    this.bookmarks.clear();
    this.views.clear();
    this.rules.clear();
    this.searchable.clear();
    for (const url of this.coverUrls.values()) URL.revokeObjectURL(url);
    this.coverUrls.clear();
    this.covers.clear();
    await Promise.all([
      clearStore(this.db, 'videos'),
      clearStore(this.db, 'tags'),
      clearStore(this.db, 'authors'),
      clearStore(this.db, 'collections'),
      clearStore(this.db, 'customFields'),
      clearStore(this.db, 'bookmarks'),
      clearStore(this.db, 'savedViews'),
      clearStore(this.db, 'rules'),
      clearStore(this.db, 'covers'),
    ]);
  }

  /** True when the library has never been used. */
  get isEmpty(): boolean {
    return this.videos.size === 0 && this.tags.size === 0 && this.fields.size === 0;
  }

  /** Starter topics, fields and views, matching the desktop build. */
  seed(): void {
    if (this.tags.size > 0 || this.fields.size > 0 || this.views.size > 0) return;

    const topics: [string, string, string][] = [
      ['Tutoriales', '#4c8dff', '🎓'],
      ['Música', '#c56cf0', '🎵'],
      ['Cocina', '#ff9f43', '🍳'],
      ['Deporte', '#26de81', '🏃'],
      ['Tecnología', '#45aaf2', '💻'],
      ['Inteligencia artificial', '#7c5cff', '🤖'],
      ['Humor', '#fed330', '😂'],
      ['Viajes', '#2bcbba', '✈️'],
      ['Noticias', '#fc5c65', '📰'],
      ['Arte y diseño', '#a55eea', '🎨'],
      ['Ideas guardadas', '#778ca3', '💡'],
    ];
    for (const [name, color, icon] of topics) this.ensureTag({ name, color, icon, kind: 'topic' });

    this.createField({
      label: 'Prioridad',
      key: 'prioridad',
      type: 'select',
      icon: '🔥',
      showInCard: true,
      options: [
        { value: 'alta', label: 'Alta', color: '#fc5c65' },
        { value: 'media', label: 'Media', color: '#fed330' },
        { value: 'baja', label: 'Baja', color: '#778ca3' },
      ],
    });
    this.createField({ label: 'Para volver a ver', key: 'revisitar', type: 'boolean', icon: '🔁' });
    this.createField({ label: 'Utilidad', key: 'utilidad', type: 'rating', icon: '⭐' });
    this.createField({ label: 'Proyecto', key: 'proyecto', type: 'text', icon: '📁' });

    const views: [string, string, string][] = [
      ['Añadidos esta semana', 'added:>7d', '🆕'],
      ['Favoritos', 'is:favorito', '❤️'],
      ['Pendientes de ver', 'is:pendiente', '👀'],
      ['Sin etiquetas', 'is:sinetiquetas', '🏷️'],
      ['Mejor valorados', 'rating>=4', '🌟'],
      ['Vídeos cortos', 'duration<5', '⚡'],
    ];
    views.forEach(([name, query, icon], index) => {
      this.createView({ name, query, icon, sort: DEFAULT_SORT, layout: 'grid', position: index });
    });
  }
}
