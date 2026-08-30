import type { Db } from '../database.ts';
import { mapBookmark, mapDownloadJob, mapRule, mapSavedView, safeJson } from '../mappers.ts';
import { newId } from '../ids.ts';
import type {
  AutoTagRule,
  DownloadFormat,
  DownloadJob,
  DownloadState,
  SavedView,
  VideoBookmark,
} from '../../../shared/types.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

/** Timestamped notes pinned to a moment inside a video. */
export class BookmarkRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  forVideo(videoId: string): VideoBookmark[] {
    const rows = this.db
      .prepare('SELECT * FROM bookmarks WHERE video_id = ? ORDER BY time_seconds ASC')
      .all(videoId) as Row[];
    return rows.map(mapBookmark);
  }

  create(videoId: string, timeSeconds: number, label: string, note?: string | null): VideoBookmark {
    const id = newId();
    this.db
      .prepare('INSERT INTO bookmarks (id, video_id, time_seconds, label, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, videoId, Math.max(0, timeSeconds), label.trim() || 'Marcador', note ?? null, new Date().toISOString());
    return mapBookmark(this.db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(id) as Row);
  }

  update(id: string, patch: { label?: string; note?: string | null; timeSeconds?: number }): void {
    const assignments: string[] = [];
    const values: Record<string, unknown> = { id };
    if (patch.label !== undefined) {
      assignments.push('label = @label');
      values.label = patch.label;
    }
    if (patch.note !== undefined) {
      assignments.push('note = @note');
      values.note = patch.note;
    }
    if (patch.timeSeconds !== undefined) {
      assignments.push('time_seconds = @timeSeconds');
      values.timeSeconds = patch.timeSeconds;
    }
    if (assignments.length === 0) return;
    this.db.prepare(`UPDATE bookmarks SET ${assignments.join(', ')} WHERE id = @id`).run(values);
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
  }
}

export interface RuleInput {
  name: string;
  field: AutoTagRule['field'];
  matcher: AutoTagRule['matcher'];
  pattern: string;
  tagIds: string[];
  enabled?: boolean;
  caseSensitive?: boolean;
  setFields?: AutoTagRule['setFields'];
  position?: number;
}

/** Persistence for the auto-tagging rule engine. */
export class RuleRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  list(): AutoTagRule[] {
    const rows = this.db.prepare('SELECT * FROM auto_tag_rules ORDER BY position ASC, name COLLATE NOCASE').all() as Row[];
    return rows.map(mapRule);
  }

  enabled(): AutoTagRule[] {
    return this.list().filter((rule) => rule.enabled);
  }

  create(input: RuleInput): AutoTagRule {
    const id = newId();
    const position =
      input.position ??
      Number((this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM auto_tag_rules').get() as Row).n);

    this.db
      .prepare(
        `INSERT INTO auto_tag_rules (id, name, enabled, field, matcher, pattern, case_sensitive, tag_ids, set_fields, position, match_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        id,
        input.name.trim(),
        input.enabled === false ? 0 : 1,
        input.field,
        input.matcher,
        input.pattern,
        input.caseSensitive ? 1 : 0,
        JSON.stringify(input.tagIds ?? []),
        JSON.stringify(input.setFields ?? {}),
        position,
        new Date().toISOString(),
      );
    return mapRule(this.db.prepare('SELECT * FROM auto_tag_rules WHERE id = ?').get(id) as Row);
  }

  update(id: string, patch: Partial<RuleInput>): void {
    const assignments: string[] = [];
    const values: Record<string, unknown> = { id };
    const simple: Record<string, string> = {
      name: 'name',
      field: 'field',
      matcher: 'matcher',
      pattern: 'pattern',
      position: 'position',
    };
    for (const [key, column] of Object.entries(simple)) {
      if (!(key in patch)) continue;
      assignments.push(`${column} = @${key}`);
      values[key] = (patch as Record<string, unknown>)[key];
    }
    if (patch.enabled !== undefined) {
      assignments.push('enabled = @enabled');
      values.enabled = patch.enabled ? 1 : 0;
    }
    if (patch.caseSensitive !== undefined) {
      assignments.push('case_sensitive = @caseSensitive');
      values.caseSensitive = patch.caseSensitive ? 1 : 0;
    }
    if (patch.tagIds !== undefined) {
      assignments.push('tag_ids = @tagIds');
      values.tagIds = JSON.stringify(patch.tagIds);
    }
    if (patch.setFields !== undefined) {
      assignments.push('set_fields = @setFields');
      values.setFields = JSON.stringify(patch.setFields);
    }
    if (assignments.length === 0) return;
    this.db.prepare(`UPDATE auto_tag_rules SET ${assignments.join(', ')} WHERE id = @id`).run(values);
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM auto_tag_rules WHERE id = ?').run(id);
  }

  countMatch(id: string, matches: number): void {
    this.db.prepare('UPDATE auto_tag_rules SET match_count = match_count + ? WHERE id = ?').run(matches, id);
  }
}

/** Saved searches shown as one-click entries in the sidebar. */
export class SavedViewRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  list(): SavedView[] {
    const rows = this.db.prepare('SELECT * FROM saved_views ORDER BY position ASC, name COLLATE NOCASE').all() as Row[];
    return rows.map(mapSavedView);
  }

  create(view: Omit<SavedView, 'id'>): SavedView {
    const id = newId();
    this.db
      .prepare('INSERT INTO saved_views (id, name, query, sort, layout, icon, position) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, view.name.trim(), view.query, JSON.stringify(view.sort), view.layout, view.icon ?? null, view.position ?? 0);
    return mapSavedView(this.db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as Row);
  }

  update(id: string, patch: Partial<Omit<SavedView, 'id'>>): void {
    const assignments: string[] = [];
    const values: Record<string, unknown> = { id };
    if (patch.name !== undefined) {
      assignments.push('name = @name');
      values.name = patch.name;
    }
    if (patch.query !== undefined) {
      assignments.push('query = @query');
      values.query = patch.query;
    }
    if (patch.sort !== undefined) {
      assignments.push('sort = @sort');
      values.sort = JSON.stringify(patch.sort);
    }
    if (patch.layout !== undefined) {
      assignments.push('layout = @layout');
      values.layout = patch.layout;
    }
    if (patch.icon !== undefined) {
      assignments.push('icon = @icon');
      values.icon = patch.icon;
    }
    if (patch.position !== undefined) {
      assignments.push('position = @position');
      values.position = patch.position;
    }
    if (assignments.length === 0) return;
    this.db.prepare(`UPDATE saved_views SET ${assignments.join(', ')} WHERE id = @id`).run(values);
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM saved_views WHERE id = ?').run(id);
  }
}

/** Simple key/value store for app settings, persisted as JSON. */
export class SettingsRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  all(): Record<string, unknown> {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Row[];
    const result: Record<string, unknown> = {};
    for (const row of rows) result[row.key] = safeJson<unknown>(row.value, null);
    return result;
  }

  get<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as Row | undefined;
    if (!row) return fallback;
    const parsed = safeJson<T | null>(row.value, null);
    return parsed === null ? fallback : parsed;
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  setMany(values: Record<string, unknown>): void {
    const run = this.db.transaction(() => {
      for (const [key, value] of Object.entries(values)) this.set(key, value);
    });
    run();
  }
}

/** Persisted download queue, so jobs survive a restart. */
export class DownloadRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  private select(where: string, ...params: unknown[]): DownloadJob[] {
    const rows = this.db
      .prepare(
        `SELECT d.*, v.title AS title FROM download_jobs d JOIN videos v ON v.id = d.video_id
         ${where} ORDER BY d.created_at ASC`,
      )
      .all(...params) as Row[];
    return rows.map(mapDownloadJob);
  }

  list(): DownloadJob[] {
    return this.select('');
  }

  pending(): DownloadJob[] {
    return this.select(`WHERE d.state IN ('queued', 'downloading')`);
  }

  getById(id: string): DownloadJob | null {
    const [job] = this.select('WHERE d.id = ?', id);
    return job ?? null;
  }

  create(videoId: string, url: string, format: DownloadFormat): DownloadJob {
    const id = newId();
    this.db
      .prepare(
        `INSERT INTO download_jobs (id, video_id, url, state, progress, format_json, created_at)
         VALUES (?, ?, ?, 'queued', 0, ?, ?)`,
      )
      .run(id, videoId, url, JSON.stringify(format), new Date().toISOString());
    return this.getById(id)!;
  }

  setState(id: string, state: DownloadState, extra: Partial<{ error: string | null; outputPath: string | null }> = {}): void {
    const finished = state === 'completed' || state === 'failed' || state === 'canceled';
    this.db
      .prepare(
        `UPDATE download_jobs SET state = ?, error = COALESCE(?, error),
           output_path = COALESCE(?, output_path), finished_at = CASE WHEN ? THEN ? ELSE finished_at END
         WHERE id = ?`,
      )
      .run(state, extra.error ?? null, extra.outputPath ?? null, finished ? 1 : 0, new Date().toISOString(), id);
  }

  setProgress(id: string, progress: number, totalBytes: number | null, downloadedBytes: number | null): void {
    this.db
      .prepare('UPDATE download_jobs SET progress = ?, total_bytes = COALESCE(?, total_bytes), downloaded_bytes = ? WHERE id = ?')
      .run(Math.max(0, Math.min(1, progress)), totalBytes, downloadedBytes, id);
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM download_jobs WHERE id = ?').run(id);
  }

  /** Drops finished jobs from the queue view. */
  clearFinished(): number {
    return this.db.prepare(`DELETE FROM download_jobs WHERE state IN ('completed', 'failed', 'canceled')`).run().changes;
  }

  /**
   * Jobs left mid-flight by a crash are re-queued at startup rather than being
   * shown as permanently "downloading".
   */
  requeueInterrupted(): number {
    return this.db.prepare(`UPDATE download_jobs SET state = 'queued', progress = 0 WHERE state = 'downloading'`).run()
      .changes;
  }
}
