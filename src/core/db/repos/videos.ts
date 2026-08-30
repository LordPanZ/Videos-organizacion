import type { Db } from '../database.ts';
import { AUTHOR_JOIN_COLUMNS, decodeFieldValue, encodeFieldValue, mapCustomField, mapTag, mapVideo } from '../mappers.ts';
import { hashUrl, newId } from '../ids.ts';
import { parseQuery } from '../../../shared/query/parser.ts';
import { compileQuery } from '../../search/compile.ts';
import { DURATION_BUCKETS } from '../../../shared/query/values.ts';
import {
  PLATFORM_COLORS,
  PLATFORM_LABELS,
  type CustomFieldValue,
  type DuplicateGroup,
  type FacetValue,
  type Facets,
  type LibraryStats,
  type Platform,
  type QueryOptions,
  type QueryResult,
  type SortSpec,
  type Tag,
  type Video,
} from '../../../shared/types.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

/** Fields accepted when creating or updating a video. */
export interface VideoInput {
  url: string;
  platform: Platform;
  platformId?: string | null;
  title: string;
  description?: string | null;
  authorId?: string | null;
  durationSeconds?: number | null;
  publishedAt?: string | null;
  thumbnailPath?: string | null;
  thumbnailUrl?: string | null;
  width?: number | null;
  height?: number | null;
  viewCount?: number | null;
  likeCount?: number | null;
  commentCount?: number | null;
  language?: string | null;
  isLive?: boolean;
  isShort?: boolean;
  filePath?: string | null;
  fileSize?: number | null;
  fileFormat?: string | null;
  rawMetadata?: unknown;
}

/** Every column a bulk edit is allowed to touch. */
export interface VideoPatch {
  title?: string;
  description?: string | null;
  url?: string;
  authorId?: string | null;
  rating?: number;
  favorite?: boolean;
  watchStatus?: Video['watchStatus'];
  watchProgress?: number;
  notes?: string | null;
  color?: string | null;
  archived?: boolean;
  thumbnailPath?: string | null;
  thumbnailUrl?: string | null;
  filePath?: string | null;
  fileSize?: number | null;
  fileFormat?: string | null;
  downloadedAt?: string | null;
  availability?: Video['availability'];
  lastCheckedAt?: string | null;
  durationSeconds?: number | null;
  publishedAt?: string | null;
  platformId?: string | null;
  viewCount?: number | null;
  likeCount?: number | null;
  commentCount?: number | null;
  language?: string | null;
  isShort?: boolean;
  isLive?: boolean;
  width?: number | null;
  height?: number | null;
  rawMetadata?: unknown;
}

const PATCH_COLUMNS: Record<keyof VideoPatch, string> = {
  title: 'title',
  description: 'description',
  url: 'url',
  authorId: 'author_id',
  rating: 'rating',
  favorite: 'favorite',
  watchStatus: 'watch_status',
  watchProgress: 'watch_progress',
  notes: 'notes',
  color: 'color',
  archived: 'archived',
  thumbnailPath: 'thumbnail_path',
  thumbnailUrl: 'thumbnail_url',
  filePath: 'file_path',
  fileSize: 'file_size',
  fileFormat: 'file_format',
  downloadedAt: 'downloaded_at',
  availability: 'availability',
  lastCheckedAt: 'last_checked_at',
  durationSeconds: 'duration_seconds',
  publishedAt: 'published_at',
  platformId: 'platform_id',
  viewCount: 'view_count',
  likeCount: 'like_count',
  commentCount: 'comment_count',
  language: 'language',
  isShort: 'is_short',
  isLive: 'is_live',
  width: 'width',
  height: 'height',
  rawMetadata: 'raw_metadata',
};

const SORT_EXPRESSIONS: Record<string, string> = {
  addedAt: 'v.added_at',
  updatedAt: 'v.updated_at',
  publishedAt: 'v.published_at',
  title: 'v.title COLLATE NOCASE',
  durationSeconds: 'v.duration_seconds',
  rating: 'v.rating',
  viewCount: 'v.view_count',
  likeCount: 'v.like_count',
  author: 'a.name COLLATE NOCASE',
  platform: 'v.platform',
  lastOpenedAt: 'v.last_opened_at',
  openedCount: 'v.opened_count',
  fileSize: 'v.file_size',
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

/** A compiled query: the SQL fragments plus their parameters, in bind order. */
interface Scope {
  from: string;
  where: string;
  joinParams: unknown[];
  whereParams: unknown[];
  warnings: string[];
}

export class VideoRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /* ------------------------------------------------------------------ reads */

  getById(id: string): Video | null {
    const row = this.db
      .prepare(`SELECT v.*, ${AUTHOR_JOIN_COLUMNS} FROM videos v LEFT JOIN authors a ON a.id = v.author_id WHERE v.id = ?`)
      .get(id) as Row | undefined;
    if (!row) return null;
    const [video] = this.hydrate([row]);
    return video;
  }

  getByUrl(url: string): Video | null {
    const row = this.db
      .prepare(
        `SELECT v.*, ${AUTHOR_JOIN_COLUMNS} FROM videos v LEFT JOIN authors a ON a.id = v.author_id WHERE v.url_hash = ?`,
      )
      .get(hashUrl(url)) as Row | undefined;
    if (!row) return null;
    const [video] = this.hydrate([row]);
    return video;
  }

  getMany(ids: string[]): Video[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT v.*, ${AUTHOR_JOIN_COLUMNS} FROM videos v LEFT JOIN authors a ON a.id = v.author_id WHERE v.id IN (${placeholders})`,
      )
      .all(...ids) as Row[];
    return this.hydrate(rows);
  }

  exists(url: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM videos WHERE url_hash = ?').get(hashUrl(url));
    return row !== undefined;
  }

  /** Resolves the id/text pairs for every custom field, used by the compiler. */
  private customFieldIds(): Map<string, string> {
    const rows = this.db.prepare('SELECT id, key FROM custom_fields').all() as Row[];
    return new Map(rows.map((r) => [String(r.key).toLowerCase(), String(r.id)]));
  }

  private customFieldKeys(): string[] {
    return [...this.customFieldIds().keys()];
  }

  /**
   * Builds the shared FROM/WHERE fragment for a set of query options.
   *
   * Join and WHERE parameters are kept apart because callers may splice extra
   * placeholders between them; every query composes them in textual order.
   */
  private buildWhere(options: QueryOptions): Scope {
    const parsed = parseQuery(options.query ?? '', { customFieldKeys: this.customFieldKeys() });
    const compiled = compileQuery(parsed.root, { customFieldIds: this.customFieldIds() });

    const clauses = [compiled.where];
    const joinParams: unknown[] = [];

    let from = 'FROM videos v LEFT JOIN authors a ON a.id = v.author_id';

    if (options.collectionId) {
      from += ' JOIN collection_items ci ON ci.video_id = v.id AND ci.collection_id = ?';
      joinParams.push(options.collectionId);
    }

    if (!options.includeArchived) clauses.push('v.archived = 0');

    return {
      from,
      where: clauses.join(' AND '),
      joinParams,
      whereParams: compiled.params,
      warnings: [...parsed.warnings, ...compiled.warnings],
    };
  }

  private orderBy(sort: SortSpec | undefined, hasCollection: boolean): string {
    const spec = sort ?? DEFAULT_SORT;
    if (spec.field === 'random') return 'ORDER BY RANDOM()';
    if (hasCollection && spec.field === 'addedAt') return 'ORDER BY ci.position ASC, ci.added_at DESC';

    const expression = SORT_EXPRESSIONS[spec.field] ?? SORT_EXPRESSIONS.addedAt;
    const direction = spec.direction === 'asc' ? 'ASC' : 'DESC';
    // Rows missing the sort value always sink to the bottom.
    return `ORDER BY (${expression}) IS NULL ASC, ${expression} ${direction}, v.added_at DESC`;
  }

  search(options: QueryOptions = {}): QueryResult {
    const scope = this.buildWhere(options);
    const { from, where } = scope;
    const params = [...scope.joinParams, ...scope.whereParams];

    const total = this.db.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${where}`).get(...params) as Row;

    const limit = Math.max(0, Math.min(options.limit ?? 200, 2000));
    const offset = Math.max(0, options.offset ?? 0);

    const rows = this.db
      .prepare(
        `SELECT v.*, ${AUTHOR_JOIN_COLUMNS} ${from} WHERE ${where} ${this.orderBy(options.sort, Boolean(options.collectionId))} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as Row[];

    return {
      videos: this.hydrate(rows),
      total: Number(total?.n ?? 0),
      facets: options.facets === false ? EMPTY_FACETS : this.facets(scope),
      warnings: scope.warnings,
    };
  }

  /** Returns just the ids matching a query — used by "select all" and bulk ops. */
  searchIds(options: QueryOptions = {}): string[] {
    const { from, where, joinParams, whereParams } = this.buildWhere(options);
    const rows = this.db
      .prepare(`SELECT v.id ${from} WHERE ${where} ${this.orderBy(options.sort, Boolean(options.collectionId))}`)
      .all(...joinParams, ...whereParams) as Row[];
    return rows.map((r) => String(r.id));
  }

  /** Loads tags and custom-field values for a page of rows in two queries. */
  private hydrate(rows: Row[]): Video[] {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => String(r.id));
    const placeholders = ids.map(() => '?').join(',');

    const tagRows = this.db
      .prepare(
        `SELECT vt.video_id, t.* FROM video_tags vt JOIN tags t ON t.id = vt.tag_id
         WHERE vt.video_id IN (${placeholders}) ORDER BY t.name COLLATE NOCASE`,
      )
      .all(...ids) as Row[];

    const tagsByVideo = new Map<string, Tag[]>();
    for (const row of tagRows) {
      const list = tagsByVideo.get(row.video_id) ?? [];
      list.push(mapTag(row));
      tagsByVideo.set(row.video_id, list);
    }

    const valueRows = this.db
      .prepare(
        `SELECT cv.video_id, cv.value_text, cv.value_number, cf.key, cf.type
         FROM custom_field_values cv JOIN custom_fields cf ON cf.id = cv.field_id
         WHERE cv.video_id IN (${placeholders})`,
      )
      .all(...ids) as Row[];

    const fieldsByVideo = new Map<string, Record<string, CustomFieldValue>>();
    for (const row of valueRows) {
      const record = fieldsByVideo.get(row.video_id) ?? {};
      record[row.key] = decodeFieldValue(row.type, row);
      fieldsByVideo.set(row.video_id, record);
    }

    return rows.map((row) =>
      mapVideo(row, tagsByVideo.get(String(row.id)) ?? [], fieldsByVideo.get(String(row.id)) ?? {}),
    );
  }

  /* ----------------------------------------------------------------- facets */

  private facets(scope: Scope): Facets {
    const { from, where, joinParams, whereParams } = scope;
    const params = [...joinParams, ...whereParams];
    const groupBy = (expression: string, extra = ''): Row[] =>
      this.db
        .prepare(
          `SELECT ${expression} AS value, COUNT(*) AS count ${from} WHERE ${where} ${extra}
           GROUP BY value HAVING value IS NOT NULL ORDER BY count DESC`,
        )
        .all(...params) as Row[];

    const platforms: FacetValue[] = groupBy('v.platform').map((r) => ({
      value: String(r.value),
      label: PLATFORM_LABELS[r.value as Platform] ?? String(r.value),
      count: Number(r.count),
      color: PLATFORM_COLORS[r.value as Platform] ?? null,
    }));

    const tagRows = this.db
      .prepare(
        `SELECT t.slug AS value, t.name AS label, t.color AS color, t.icon AS icon, COUNT(*) AS count
         ${from} JOIN video_tags vt ON vt.video_id = v.id JOIN tags t ON t.id = vt.tag_id
         WHERE ${where} GROUP BY t.id ORDER BY count DESC, label COLLATE NOCASE LIMIT 300`,
      )
      .all(...params) as Row[];

    const authorRows = this.db
      .prepare(
        `SELECT a.id AS value, a.name AS label, COUNT(*) AS count
         ${from} WHERE ${where} AND a.id IS NOT NULL
         GROUP BY a.id ORDER BY count DESC, label COLLATE NOCASE LIMIT 300`,
      )
      .all(...params) as Row[];

    const years = groupBy(`strftime('%Y', v.published_at)`).sort((a, b) => String(b.value).localeCompare(String(a.value)));

    const durationRows = this.db
      .prepare(
        `SELECT
           CASE
             WHEN v.duration_seconds IS NULL THEN NULL
             WHEN v.duration_seconds < 60 THEN 'micro'
             WHEN v.duration_seconds < 300 THEN 'corto'
             WHEN v.duration_seconds < 1200 THEN 'medio'
             WHEN v.duration_seconds < 3600 THEN 'largo'
             ELSE 'muy-largo'
           END AS value,
           COUNT(*) AS count
         ${from} WHERE ${where} GROUP BY value HAVING value IS NOT NULL`,
      )
      .all(...params) as Row[];

    const durationLabels = new Map(DURATION_BUCKETS.map((b) => [b.id as string, b.label]));

    const watchLabels: Record<string, string> = {
      unwatched: 'Sin ver',
      in_progress: 'Viendo',
      watched: 'Visto',
    };

    const availabilityLabels: Record<string, string> = {
      ok: 'Disponible',
      unknown: 'Sin comprobar',
      unavailable: 'No disponible',
      private: 'Privado',
      geoblocked: 'Bloqueado por región',
    };

    return {
      platforms,
      tags: tagRows.map((r) => ({
        value: String(r.value),
        label: String(r.label),
        count: Number(r.count),
        color: r.color ?? null,
        icon: r.icon ?? null,
      })),
      authors: authorRows.map((r) => ({ value: String(r.value), label: String(r.label), count: Number(r.count) })),
      years: years.map((r) => ({ value: String(r.value), label: String(r.value), count: Number(r.count) })),
      ratings: groupBy('v.rating')
        .map((r) => ({ value: String(r.value), label: `${r.value} ★`, count: Number(r.count) }))
        .sort((a, b) => Number(b.value) - Number(a.value)),
      watchStatus: groupBy('v.watch_status').map((r) => ({
        value: String(r.value),
        label: watchLabels[String(r.value)] ?? String(r.value),
        count: Number(r.count),
      })),
      durations: durationRows
        .map((r) => ({
          value: String(r.value),
          label: durationLabels.get(String(r.value)) ?? String(r.value),
          count: Number(r.count),
        }))
        .sort(
          (a, b) =>
            DURATION_BUCKETS.findIndex((x) => x.id === a.value) - DURATION_BUCKETS.findIndex((x) => x.id === b.value),
        ),
      availability: groupBy('v.availability').map((r) => ({
        value: String(r.value),
        label: availabilityLabels[String(r.value)] ?? String(r.value),
        count: Number(r.count),
      })),
      customFields: this.customFieldFacets(scope),
    };
  }

  /** Facet counts for each user-defined field flagged as filterable. */
  private customFieldFacets(scope: Scope): Record<string, FacetValue[]> {
    const { from, where, joinParams, whereParams } = scope;
    const fields = (this.db.prepare('SELECT * FROM custom_fields WHERE show_in_facets = 1 ORDER BY position').all() as Row[])
      .map(mapCustomField);

    const result: Record<string, FacetValue[]> = {};

    for (const field of fields) {
      if (field.type === 'longtext' || field.type === 'url') continue;

      if (field.type === 'multiselect') {
        // Values are JSON arrays; expand them with json_each so each entry counts.
        const rows = this.db
          .prepare(
            `SELECT je.value AS value, COUNT(*) AS count
             ${from}
             JOIN custom_field_values cv ON cv.video_id = v.id AND cv.field_id = ?
             JOIN json_each(cv.value_text) je
             WHERE ${where} GROUP BY je.value ORDER BY count DESC LIMIT 200`,
          )
          .all(...joinParams, field.id, ...whereParams) as Row[];
        result[field.key] = rows.map((r) => ({
          value: String(r.value),
          label: field.options.find((o) => o.value === String(r.value))?.label ?? String(r.value),
          count: Number(r.count),
          color: field.options.find((o) => o.value === String(r.value))?.color ?? null,
        }));
        continue;
      }

      const rows = this.db
        .prepare(
          `SELECT cv.value_text AS value, COUNT(*) AS count
           ${from}
           JOIN custom_field_values cv ON cv.video_id = v.id AND cv.field_id = ?
           WHERE ${where} AND cv.value_text IS NOT NULL
           GROUP BY cv.value_text ORDER BY count DESC LIMIT 200`,
        )
        .all(...joinParams, field.id, ...whereParams) as Row[];

      result[field.key] = rows.map((r) => ({
        value: String(r.value),
        label: field.options.find((o) => o.value === String(r.value))?.label ?? String(r.value),
        count: Number(r.count),
        color: field.options.find((o) => o.value === String(r.value))?.color ?? null,
      }));
    }

    return result;
  }

  /* ----------------------------------------------------------------- writes */

  insert(input: VideoInput): Video {
    const id = newId();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO videos (
           id, url, url_hash, platform, platform_id, title, description, author_id,
           duration_seconds, published_at, thumbnail_path, thumbnail_url, width, height,
           view_count, like_count, comment_count, language, is_live, is_short,
           file_path, file_size, file_format, added_at, updated_at, raw_metadata
         ) VALUES (
           @id, @url, @urlHash, @platform, @platformId, @title, @description, @authorId,
           @durationSeconds, @publishedAt, @thumbnailPath, @thumbnailUrl, @width, @height,
           @viewCount, @likeCount, @commentCount, @language, @isLive, @isShort,
           @filePath, @fileSize, @fileFormat, @addedAt, @updatedAt, @rawMetadata
         )`,
      )
      .run({
        id,
        url: input.url,
        urlHash: hashUrl(input.url),
        platform: input.platform,
        platformId: input.platformId ?? null,
        title: input.title,
        description: input.description ?? null,
        authorId: input.authorId ?? null,
        durationSeconds: input.durationSeconds ?? null,
        publishedAt: input.publishedAt ?? null,
        thumbnailPath: input.thumbnailPath ?? null,
        thumbnailUrl: input.thumbnailUrl ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
        viewCount: input.viewCount ?? null,
        likeCount: input.likeCount ?? null,
        commentCount: input.commentCount ?? null,
        language: input.language ?? null,
        isLive: input.isLive ? 1 : 0,
        isShort: input.isShort ? 1 : 0,
        filePath: input.filePath ?? null,
        fileSize: input.fileSize ?? null,
        fileFormat: input.fileFormat ?? null,
        addedAt: now,
        updatedAt: now,
        rawMetadata: input.rawMetadata === undefined ? null : JSON.stringify(input.rawMetadata),
      });

    this.reindex(id);
    return this.getById(id)!;
  }

  update(id: string, patch: VideoPatch): void {
    const assignments: string[] = [];
    const values: Record<string, unknown> = { id };

    for (const [key, column] of Object.entries(PATCH_COLUMNS) as [keyof VideoPatch, string][]) {
      if (!(key in patch)) continue;
      const value = patch[key];
      assignments.push(`${column} = @${key}`);
      if (typeof value === 'boolean') values[key] = value ? 1 : 0;
      else if (key === 'rawMetadata') values[key] = value === null ? null : JSON.stringify(value);
      else values[key] = value ?? null;
    }

    if (assignments.length === 0) return;

    if ('url' in patch && patch.url) {
      assignments.push('url_hash = @urlHash');
      values.urlHash = hashUrl(patch.url);
    }

    assignments.push('updated_at = @updatedAt');
    values.updatedAt = new Date().toISOString();

    this.db.prepare(`UPDATE videos SET ${assignments.join(', ')} WHERE id = @id`).run(values);
    this.reindex(id);
  }

  /** Applies the same patch to many videos in one transaction. */
  updateMany(ids: string[], patch: VideoPatch): number {
    if (ids.length === 0) return 0;
    const run = this.db.transaction((list: string[]) => {
      for (const id of list) this.update(id, patch);
    });
    run(ids);
    return ids.length;
  }

  remove(ids: string[]): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const rowids = this.db
      .prepare(`SELECT rowid FROM videos WHERE id IN (${placeholders})`)
      .all(...ids) as Row[];

    const run = this.db.transaction(() => {
      for (const row of rowids) {
        this.db.prepare('DELETE FROM videos_fts WHERE rowid = ?').run(row.rowid);
      }
      this.db.prepare(`DELETE FROM videos WHERE id IN (${placeholders})`).run(...ids);
    });
    run();
    return ids.length;
  }

  /** Records that the user opened a video, feeding the "most watched" views. */
  markOpened(id: string): void {
    this.db
      .prepare('UPDATE videos SET opened_count = opened_count + 1, last_opened_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  /* --------------------------------------------------------------- indexing */

  /**
   * Rewrites the FTS document for one video. Called after any change that can
   * affect its searchable text, including tag and author edits.
   */
  reindex(id: string): void {
    const row = this.db
      .prepare(
        `SELECT v.rowid AS rowid, v.title, v.description, v.notes, a.name AS author_name,
                (SELECT group_concat(t.name, ' ') FROM video_tags vt JOIN tags t ON t.id = vt.tag_id WHERE vt.video_id = v.id) AS tag_names
         FROM videos v LEFT JOIN authors a ON a.id = v.author_id WHERE v.id = ?`,
      )
      .get(id) as Row | undefined;
    if (!row) return;

    this.db.prepare('DELETE FROM videos_fts WHERE rowid = ?').run(row.rowid);
    this.db
      .prepare('INSERT INTO videos_fts (rowid, title, description, author, tags, notes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(row.rowid, row.title ?? '', row.description ?? '', row.author_name ?? '', row.tag_names ?? '', row.notes ?? '');
  }

  /** Rebuilds the entire search index. Offered as a maintenance action. */
  reindexAll(): number {
    const ids = (this.db.prepare('SELECT id FROM videos').all() as Row[]).map((r) => String(r.id));
    const run = this.db.transaction(() => {
      this.db.exec('DELETE FROM videos_fts');
      for (const id of ids) this.reindex(id);
    });
    run();
    return ids.length;
  }

  /* ---------------------------------------------------------- custom fields */

  setCustomField(videoId: string, fieldKey: string, value: CustomFieldValue): void {
    const field = this.db.prepare('SELECT * FROM custom_fields WHERE key = ?').get(fieldKey) as Row | undefined;
    if (!field) throw new Error(`El campo personalizado "${fieldKey}" no existe.`);

    const encoded = encodeFieldValue(field.type, value);
    if (encoded.text === null && encoded.number === null) {
      this.db.prepare('DELETE FROM custom_field_values WHERE video_id = ? AND field_id = ?').run(videoId, field.id);
    } else {
      this.db
        .prepare(
          `INSERT INTO custom_field_values (video_id, field_id, value_text, value_number)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (video_id, field_id) DO UPDATE SET value_text = excluded.value_text, value_number = excluded.value_number`,
        )
        .run(videoId, field.id, encoded.text, encoded.number);
    }
    this.touch(videoId);
  }

  private touch(videoId: string): void {
    this.db.prepare('UPDATE videos SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), videoId);
  }

  /* -------------------------------------------------------------- analytics */

  stats(): LibraryStats {
    const scalar = this.db
      .prepare(
        `SELECT
           COUNT(*)                                        AS total,
           COALESCE(SUM(duration_seconds), 0)              AS duration,
           SUM(CASE WHEN file_path IS NOT NULL THEN 1 ELSE 0 END) AS downloaded,
           COALESCE(SUM(file_size), 0)                     AS disk,
           SUM(CASE WHEN favorite = 1 THEN 1 ELSE 0 END)   AS favorites,
           SUM(CASE WHEN availability IN ('unavailable','private','geoblocked') THEN 1 ELSE 0 END) AS unavailable,
           MAX(added_at)                                   AS newest
         FROM videos WHERE archived = 0`,
      )
      .get() as Row;

    const untagged = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM videos v
         WHERE v.archived = 0 AND NOT EXISTS (SELECT 1 FROM video_tags vt WHERE vt.video_id = v.id)`,
      )
      .get() as Row;

    const duplicates = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT platform, platform_id FROM videos
           WHERE platform_id IS NOT NULL AND archived = 0
           GROUP BY platform, platform_id HAVING COUNT(*) > 1
         )`,
      )
      .get() as Row;

    const byMonth = this.db
      .prepare(
        `SELECT strftime('%Y-%m', added_at) AS month, COUNT(*) AS count
         FROM videos WHERE archived = 0 GROUP BY month ORDER BY month DESC LIMIT 24`,
      )
      .all() as Row[];

    const total = Number(scalar.total ?? 0);
    const duration = Number(scalar.duration ?? 0);

    const facetQuery = (sql: string, labeler: (row: Row) => FacetValue): FacetValue[] =>
      (this.db.prepare(sql).all() as Row[]).map(labeler);

    return {
      totalVideos: total,
      totalDuration: duration,
      totalDownloaded: Number(scalar.downloaded ?? 0),
      totalDiskBytes: Number(scalar.disk ?? 0),
      favorites: Number(scalar.favorites ?? 0),
      unavailable: Number(scalar.unavailable ?? 0),
      untagged: Number(untagged.n ?? 0),
      duplicates: Number(duplicates.n ?? 0),
      averageDuration: total > 0 ? Math.round(duration / total) : 0,
      newestAddedAt: scalar.newest ?? null,
      byPlatform: facetQuery(
        `SELECT platform AS value, COUNT(*) AS count FROM videos WHERE archived = 0 GROUP BY platform ORDER BY count DESC`,
        (r) => ({
          value: String(r.value),
          label: PLATFORM_LABELS[r.value as Platform] ?? String(r.value),
          count: Number(r.count),
          color: PLATFORM_COLORS[r.value as Platform] ?? null,
        }),
      ),
      byTag: facetQuery(
        `SELECT t.slug AS value, t.name AS label, t.color AS color, COUNT(*) AS count
         FROM video_tags vt JOIN tags t ON t.id = vt.tag_id JOIN videos v ON v.id = vt.video_id
         WHERE v.archived = 0 GROUP BY t.id ORDER BY count DESC LIMIT 40`,
        (r) => ({ value: String(r.value), label: String(r.label), count: Number(r.count), color: r.color ?? null }),
      ),
      byAuthor: facetQuery(
        `SELECT a.id AS value, a.name AS label, COUNT(*) AS count
         FROM videos v JOIN authors a ON a.id = v.author_id WHERE v.archived = 0
         GROUP BY a.id ORDER BY count DESC LIMIT 40`,
        (r) => ({ value: String(r.value), label: String(r.label), count: Number(r.count) }),
      ),
      byWatchStatus: facetQuery(
        `SELECT watch_status AS value, COUNT(*) AS count FROM videos WHERE archived = 0 GROUP BY watch_status`,
        (r) => ({ value: String(r.value), label: String(r.value), count: Number(r.count) }),
      ),
      byRating: facetQuery(
        `SELECT rating AS value, COUNT(*) AS count FROM videos WHERE archived = 0 GROUP BY rating ORDER BY rating DESC`,
        (r) => ({ value: String(r.value), label: `${r.value} ★`, count: Number(r.count) }),
      ),
      byMonth: byMonth.reverse().map((r) => ({ month: String(r.month), count: Number(r.count) })),
    };
  }

  /** Finds likely duplicates by platform id and by title+author. */
  findDuplicates(): DuplicateGroup[] {
    const groups: DuplicateGroup[] = [];

    const byPlatformId = this.db
      .prepare(
        `SELECT platform, platform_id, group_concat(id) AS ids FROM videos
         WHERE platform_id IS NOT NULL GROUP BY platform, platform_id HAVING COUNT(*) > 1`,
      )
      .all() as Row[];

    for (const row of byPlatformId) {
      const ids = String(row.ids).split(',');
      groups.push({
        key: `${row.platform}:${row.platform_id}`,
        reason: 'same-platform-id',
        videos: this.getMany(ids),
      });
    }

    const byTitle = this.db
      .prepare(
        `SELECT lower(v.title) AS t, COALESCE(v.author_id, '') AS au, group_concat(v.id) AS ids
         FROM videos v
         WHERE v.platform_id IS NULL
         GROUP BY t, au HAVING COUNT(*) > 1`,
      )
      .all() as Row[];

    for (const row of byTitle) {
      const ids = String(row.ids).split(',');
      groups.push({ key: String(row.t), reason: 'same-title-author', videos: this.getMany(ids) });
    }

    return groups;
  }
}
