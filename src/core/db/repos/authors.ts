import type { Db } from '../database.ts';
import { mapAuthorRow } from '../mappers.ts';
import { newId } from '../ids.ts';
import type { Author, Platform } from '../../../shared/types.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export interface AuthorInput {
  platform: Platform;
  name: string;
  externalId?: string | null;
  handle?: string | null;
  url?: string | null;
  avatarPath?: string | null;
  subscriberCount?: number | null;
}

export class AuthorRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  list(): Author[] {
    const rows = this.db
      .prepare(
        `SELECT a.*, (SELECT COUNT(*) FROM videos v WHERE v.author_id = a.id) AS video_count
         FROM authors a ORDER BY video_count DESC, a.name COLLATE NOCASE`,
      )
      .all() as Row[];
    return rows.map(mapAuthorRow);
  }

  getById(id: string): Author | null {
    const row = this.db.prepare('SELECT * FROM authors WHERE id = ?').get(id) as Row | undefined;
    return row ? mapAuthorRow(row) : null;
  }

  /**
   * Finds an author by platform identity, creating the record when missing.
   * A platform-native id wins over the display name, which creators change.
   */
  ensure(input: AuthorInput): Author {
    if (input.externalId) {
      const byExternal = this.db
        .prepare('SELECT * FROM authors WHERE platform = ? AND external_id = ?')
        .get(input.platform, input.externalId) as Row | undefined;
      if (byExternal) {
        this.refresh(byExternal.id, input);
        return this.getById(byExternal.id)!;
      }
    }

    const byName = this.db
      .prepare(`SELECT * FROM authors WHERE platform = ? AND lower(name) = ? AND COALESCE(handle, '') = ?`)
      .get(input.platform, input.name.toLowerCase(), input.handle ?? '') as Row | undefined;
    if (byName) {
      this.refresh(byName.id, input);
      return this.getById(byName.id)!;
    }

    const id = newId();
    this.db
      .prepare(
        `INSERT INTO authors (id, platform, external_id, name, handle, url, avatar_path, subscriber_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.platform,
        input.externalId ?? null,
        input.name.trim(),
        input.handle ?? null,
        input.url ?? null,
        input.avatarPath ?? null,
        input.subscriberCount ?? null,
        new Date().toISOString(),
      );
    return this.getById(id)!;
  }

  /** Fills in fields a later fetch discovered, without clobbering known values. */
  private refresh(id: string, input: AuthorInput): void {
    this.db
      .prepare(
        `UPDATE authors SET
           url              = COALESCE(?, url),
           avatar_path      = COALESCE(?, avatar_path),
           handle           = COALESCE(?, handle),
           external_id      = COALESCE(?, external_id),
           subscriber_count = COALESCE(?, subscriber_count)
         WHERE id = ?`,
      )
      .run(
        input.url ?? null,
        input.avatarPath ?? null,
        input.handle ?? null,
        input.externalId ?? null,
        input.subscriberCount ?? null,
        id,
      );
  }

  update(id: string, patch: Partial<AuthorInput>): void {
    const assignments: string[] = [];
    const values: Record<string, unknown> = { id };
    const columns: Record<string, string> = {
      name: 'name',
      handle: 'handle',
      url: 'url',
      avatarPath: 'avatar_path',
      subscriberCount: 'subscriber_count',
      externalId: 'external_id',
    };
    for (const [key, column] of Object.entries(columns)) {
      if (!(key in patch)) continue;
      assignments.push(`${column} = @${key}`);
      values[key] = (patch as Record<string, unknown>)[key] ?? null;
    }
    if (assignments.length === 0) return;
    this.db.prepare(`UPDATE authors SET ${assignments.join(', ')} WHERE id = @id`).run(values);
  }

  /** Deletes authors that no video references any more. */
  pruneOrphans(): number {
    const result = this.db
      .prepare('DELETE FROM authors WHERE NOT EXISTS (SELECT 1 FROM videos v WHERE v.author_id = authors.id)')
      .run();
    return result.changes;
  }
}
