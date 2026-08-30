import type { Db } from '../database.ts';
import { mapTag } from '../mappers.ts';
import { newId, slugify } from '../ids.ts';
import type { Tag, TagKind, TagSource } from '../../../shared/types.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export interface TagInput {
  name: string;
  color?: string | null;
  icon?: string | null;
  kind?: TagKind;
  parentId?: string | null;
  description?: string | null;
}

export class TagRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  list(): Tag[] {
    const rows = this.db
      .prepare(
        `SELECT t.*, (SELECT COUNT(*) FROM video_tags vt WHERE vt.tag_id = t.id) AS video_count
         FROM tags t ORDER BY t.name COLLATE NOCASE`,
      )
      .all() as Row[];
    return rows.map(mapTag);
  }

  getById(id: string): Tag | null {
    const row = this.db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as Row | undefined;
    return row ? mapTag(row) : null;
  }

  getBySlug(slug: string): Tag | null {
    const row = this.db.prepare('SELECT * FROM tags WHERE slug = ?').get(slug) as Row | undefined;
    return row ? mapTag(row) : null;
  }

  /**
   * Returns the tag with this name, creating it when missing. Matching is by
   * slug, so "Programación" and "programacion" resolve to the same tag.
   */
  ensure(input: TagInput): Tag {
    const slug = slugify(input.name);
    const existing = this.getBySlug(slug);
    if (existing) return existing;

    const id = newId();
    this.db
      .prepare(
        `INSERT INTO tags (id, name, slug, color, icon, kind, parent_id, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name.trim(),
        slug,
        input.color ?? null,
        input.icon ?? null,
        input.kind ?? 'manual',
        input.parentId ?? null,
        input.description ?? null,
        new Date().toISOString(),
      );
    return this.getById(id)!;
  }

  update(id: string, patch: Partial<TagInput>): void {
    const assignments: string[] = [];
    const values: Record<string, unknown> = { id };

    if (patch.name !== undefined) {
      assignments.push('name = @name', 'slug = @slug');
      values.name = patch.name.trim();
      values.slug = slugify(patch.name);
    }
    if (patch.color !== undefined) {
      assignments.push('color = @color');
      values.color = patch.color;
    }
    if (patch.icon !== undefined) {
      assignments.push('icon = @icon');
      values.icon = patch.icon;
    }
    if (patch.kind !== undefined) {
      assignments.push('kind = @kind');
      values.kind = patch.kind;
    }
    if (patch.parentId !== undefined) {
      // Guard against a tag becoming its own ancestor.
      assignments.push('parent_id = @parentId');
      values.parentId = this.wouldCycle(id, patch.parentId) ? null : patch.parentId;
    }
    if (patch.description !== undefined) {
      assignments.push('description = @description');
      values.description = patch.description;
    }
    if (assignments.length === 0) return;

    this.db.prepare(`UPDATE tags SET ${assignments.join(', ')} WHERE id = @id`).run(values);
  }

  /** True when re-parenting `id` under `parentId` would create a loop. */
  private wouldCycle(id: string, parentId: string | null | undefined): boolean {
    if (!parentId) return false;
    if (parentId === id) return true;
    let cursor: string | null = parentId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (cursor === id) return true;
      const row = this.db.prepare('SELECT parent_id FROM tags WHERE id = ?').get(cursor) as Row | undefined;
      cursor = row?.parent_id ?? null;
    }
    return false;
  }

  remove(id: string): void {
    // Children are promoted to the removed tag's parent rather than orphaned.
    const row = this.db.prepare('SELECT parent_id FROM tags WHERE id = ?').get(id) as Row | undefined;
    const run = this.db.transaction(() => {
      this.db.prepare('UPDATE tags SET parent_id = ? WHERE parent_id = ?').run(row?.parent_id ?? null, id);
      this.db.prepare('DELETE FROM tags WHERE id = ?').run(id);
    });
    run();
  }

  /** Merges `sourceIds` into `targetId`, moving every assignment across. */
  merge(sourceIds: string[], targetId: string): number {
    const sources = sourceIds.filter((id) => id !== targetId);
    if (sources.length === 0) return 0;
    const placeholders = sources.map(() => '?').join(',');

    const affected = this.db
      .prepare(`SELECT DISTINCT video_id FROM video_tags WHERE tag_id IN (${placeholders})`)
      .all(...sources) as Row[];

    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO video_tags (video_id, tag_id, source, confidence, created_at)
           SELECT video_id, ?, source, confidence, created_at FROM video_tags WHERE tag_id IN (${placeholders})`,
        )
        .run(targetId, ...sources);
      this.db.prepare(`DELETE FROM tags WHERE id IN (${placeholders})`).run(...sources);
    });
    run();
    return affected.length;
  }

  /** Assigns tags to videos. Existing assignments are left untouched. */
  addToVideos(videoIds: string[], tagIds: string[], source: TagSource = 'manual'): void {
    if (videoIds.length === 0 || tagIds.length === 0) return;
    const now = new Date().toISOString();
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO video_tags (video_id, tag_id, source, confidence, created_at) VALUES (?, ?, ?, 1, ?)`,
    );
    const run = this.db.transaction(() => {
      for (const videoId of videoIds) {
        for (const tagId of tagIds) insert.run(videoId, tagId, source, now);
      }
    });
    run();
  }

  removeFromVideos(videoIds: string[], tagIds: string[]): void {
    if (videoIds.length === 0 || tagIds.length === 0) return;
    const videoPlaceholders = videoIds.map(() => '?').join(',');
    const tagPlaceholders = tagIds.map(() => '?').join(',');
    this.db
      .prepare(`DELETE FROM video_tags WHERE video_id IN (${videoPlaceholders}) AND tag_id IN (${tagPlaceholders})`)
      .run(...videoIds, ...tagIds);
  }

  /** Replaces the full tag set of a single video. */
  setForVideo(videoId: string, tagIds: string[]): void {
    const now = new Date().toISOString();
    const run = this.db.transaction(() => {
      this.db.prepare('DELETE FROM video_tags WHERE video_id = ?').run(videoId);
      const insert = this.db.prepare(
        `INSERT OR IGNORE INTO video_tags (video_id, tag_id, source, confidence, created_at) VALUES (?, ?, 'manual', 1, ?)`,
      );
      for (const tagId of tagIds) insert.run(videoId, tagId, now);
    });
    run();
  }

  /** Tags with no videos attached, offered as a cleanup action. */
  unused(): Tag[] {
    const rows = this.db
      .prepare(
        `SELECT t.* FROM tags t WHERE NOT EXISTS (SELECT 1 FROM video_tags vt WHERE vt.tag_id = t.id)
         AND NOT EXISTS (SELECT 1 FROM tags c WHERE c.parent_id = t.id)
         ORDER BY t.name COLLATE NOCASE`,
      )
      .all() as Row[];
    return rows.map(mapTag);
  }
}
