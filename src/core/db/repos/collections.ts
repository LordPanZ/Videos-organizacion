import type { Db } from '../database.ts';
import { mapCollection } from '../mappers.ts';
import { newId } from '../ids.ts';
import type { Collection, CollectionKind } from '../../../shared/types.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export interface CollectionInput {
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  coverPath?: string | null;
  kind?: CollectionKind;
  /** Smart collections store a query instead of explicit membership. */
  query?: string | null;
  parentId?: string | null;
  position?: number;
}

export class CollectionRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  list(): Collection[] {
    const rows = this.db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM collection_items ci JOIN videos v ON v.id = ci.video_id
          WHERE ci.collection_id = c.id AND v.hidden = 0) AS video_count
         FROM collections c ORDER BY c.position ASC, c.name COLLATE NOCASE`,
      )
      .all() as Row[];
    return rows.map(mapCollection);
  }

  getById(id: string): Collection | null {
    const row = this.db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM collection_items ci JOIN videos v ON v.id = ci.video_id
          WHERE ci.collection_id = c.id AND v.hidden = 0) AS video_count
         FROM collections c WHERE c.id = ?`,
      )
      .get(id) as Row | undefined;
    return row ? mapCollection(row) : null;
  }

  create(input: CollectionInput): Collection {
    const id = newId();
    const now = new Date().toISOString();
    const nextPosition =
      input.position ??
      Number((this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM collections').get() as Row).n);

    this.db
      .prepare(
        `INSERT INTO collections (id, name, description, cover_path, icon, color, kind, query, parent_id, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name.trim(),
        input.description ?? null,
        input.coverPath ?? null,
        input.icon ?? null,
        input.color ?? null,
        input.kind ?? 'manual',
        input.query ?? null,
        input.parentId ?? null,
        nextPosition,
        now,
        now,
      );
    return this.getById(id)!;
  }

  update(id: string, patch: Partial<CollectionInput>): void {
    const columns: Record<string, string> = {
      name: 'name',
      description: 'description',
      coverPath: 'cover_path',
      icon: 'icon',
      color: 'color',
      kind: 'kind',
      query: 'query',
      parentId: 'parent_id',
      position: 'position',
    };
    const assignments: string[] = [];
    const values: Record<string, unknown> = { id };
    for (const [key, column] of Object.entries(columns)) {
      if (!(key in patch)) continue;
      assignments.push(`${column} = @${key}`);
      values[key] = (patch as Record<string, unknown>)[key] ?? null;
    }
    if (assignments.length === 0) return;
    assignments.push('updated_at = @updatedAt');
    values.updatedAt = new Date().toISOString();
    this.db.prepare(`UPDATE collections SET ${assignments.join(', ')} WHERE id = @id`).run(values);
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM collections WHERE id = ?').run(id);
  }

  /** Appends videos to a manual collection, skipping ones already in it. */
  addVideos(collectionId: string, videoIds: string[]): number {
    if (videoIds.length === 0) return 0;
    const now = new Date().toISOString();
    let position = Number(
      (
        this.db
          .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM collection_items WHERE collection_id = ?')
          .get(collectionId) as Row
      ).n,
    );

    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO collection_items (collection_id, video_id, position, added_at) VALUES (?, ?, ?, ?)',
    );
    let added = 0;
    const run = this.db.transaction(() => {
      for (const videoId of videoIds) {
        const result = insert.run(collectionId, videoId, position, now);
        if (result.changes > 0) {
          added += 1;
          position += 1;
        }
      }
      this.db.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(now, collectionId);
    });
    run();
    return added;
  }

  removeVideos(collectionId: string, videoIds: string[]): number {
    if (videoIds.length === 0) return 0;
    const placeholders = videoIds.map(() => '?').join(',');
    const result = this.db
      .prepare(`DELETE FROM collection_items WHERE collection_id = ? AND video_id IN (${placeholders})`)
      .run(collectionId, ...videoIds);
    return result.changes;
  }

  /** Persists a manual reordering produced by drag and drop. */
  reorder(collectionId: string, orderedVideoIds: string[]): void {
    const update = this.db.prepare(
      'UPDATE collection_items SET position = ? WHERE collection_id = ? AND video_id = ?',
    );
    const run = this.db.transaction(() => {
      orderedVideoIds.forEach((videoId, index) => update.run(index, collectionId, videoId));
    });
    run();
  }

  /** Collections a given video belongs to. */
  forVideo(videoId: string): Collection[] {
    const rows = this.db
      .prepare(
        `SELECT c.* FROM collections c JOIN collection_items ci ON ci.collection_id = c.id
         WHERE ci.video_id = ? ORDER BY c.name COLLATE NOCASE`,
      )
      .all(videoId) as Row[];
    return rows.map(mapCollection);
  }
}
