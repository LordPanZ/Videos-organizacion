import type { Db } from '../database.ts';
import { encodeFieldValue, mapCustomField } from '../mappers.ts';
import { newId, slugify } from '../ids.ts';
import type { CustomField, CustomFieldOption, CustomFieldType, CustomFieldValue } from '../../../shared/types.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export interface CustomFieldInput {
  label: string;
  type: CustomFieldType;
  /** Defaults to a slug of the label; must be unique and query-safe. */
  key?: string;
  options?: CustomFieldOption[];
  defaultValue?: string | null;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  position?: number;
  showInCard?: boolean;
  showInFacets?: boolean;
}

/**
 * User-defined parameters. Creating one immediately makes it filterable
 * (`mikey:value`), sortable in the table view and available as a facet.
 */
export class CustomFieldRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  list(): CustomField[] {
    const rows = this.db
      .prepare('SELECT * FROM custom_fields ORDER BY position ASC, label COLLATE NOCASE')
      .all() as Row[];
    return rows.map(mapCustomField);
  }

  getByKey(key: string): CustomField | null {
    const row = this.db.prepare('SELECT * FROM custom_fields WHERE key = ?').get(key) as Row | undefined;
    return row ? mapCustomField(row) : null;
  }

  getById(id: string): CustomField | null {
    const row = this.db.prepare('SELECT * FROM custom_fields WHERE id = ?').get(id) as Row | undefined;
    return row ? mapCustomField(row) : null;
  }

  create(input: CustomFieldInput): CustomField {
    const key = this.uniqueKey(input.key ?? input.label);
    const id = newId();
    const position =
      input.position ??
      Number((this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM custom_fields').get() as Row).n);

    this.db
      .prepare(
        `INSERT INTO custom_fields (id, key, label, type, options_json, default_value, description, icon, color, position, show_in_card, show_in_facets, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        key,
        input.label.trim(),
        input.type,
        JSON.stringify(input.options ?? []),
        input.defaultValue ?? null,
        input.description ?? null,
        input.icon ?? null,
        input.color ?? null,
        position,
        input.showInCard ? 1 : 0,
        input.showInFacets === false ? 0 : 1,
        new Date().toISOString(),
      );
    return this.getById(id)!;
  }

  /** Derives a query-safe key, appending a counter when it is already taken. */
  private uniqueKey(source: string): string {
    const base = slugify(source).replace(/-/g, '_') || 'campo';
    let candidate = base;
    let counter = 2;
    while (this.getByKey(candidate) !== null) {
      candidate = `${base}_${counter}`;
      counter += 1;
    }
    return candidate;
  }

  update(id: string, patch: Partial<CustomFieldInput>): void {
    const assignments: string[] = [];
    const values: Record<string, unknown> = { id };

    const simple: Record<string, string> = {
      label: 'label',
      defaultValue: 'default_value',
      description: 'description',
      icon: 'icon',
      color: 'color',
      position: 'position',
    };
    for (const [key, column] of Object.entries(simple)) {
      if (!(key in patch)) continue;
      assignments.push(`${column} = @${key}`);
      values[key] = (patch as Record<string, unknown>)[key] ?? null;
    }
    if (patch.options !== undefined) {
      assignments.push('options_json = @options');
      values.options = JSON.stringify(patch.options);
    }
    if (patch.showInCard !== undefined) {
      assignments.push('show_in_card = @showInCard');
      values.showInCard = patch.showInCard ? 1 : 0;
    }
    if (patch.showInFacets !== undefined) {
      assignments.push('show_in_facets = @showInFacets');
      values.showInFacets = patch.showInFacets ? 1 : 0;
    }
    // The type is deliberately not editable: stored values would need a
    // migration. The UI offers "create a new field" instead.
    if (assignments.length === 0) return;
    this.db.prepare(`UPDATE custom_fields SET ${assignments.join(', ')} WHERE id = @id`).run(values);
  }

  remove(id: string): void {
    // Values cascade via the foreign key.
    this.db.prepare('DELETE FROM custom_fields WHERE id = ?').run(id);
  }

  /** Applies one field value to many videos at once. */
  setForVideos(videoIds: string[], key: string, value: CustomFieldValue): number {
    const field = this.getByKey(key);
    if (!field) throw new Error(`El campo personalizado "${key}" no existe.`);
    if (videoIds.length === 0) return 0;

    const encoded = encodeFieldValue(field.type, value);
    const clearing = encoded.text === null && encoded.number === null;

    const remove = this.db.prepare('DELETE FROM custom_field_values WHERE video_id = ? AND field_id = ?');
    const upsert = this.db.prepare(
      `INSERT INTO custom_field_values (video_id, field_id, value_text, value_number) VALUES (?, ?, ?, ?)
       ON CONFLICT (video_id, field_id) DO UPDATE SET value_text = excluded.value_text, value_number = excluded.value_number`,
    );

    const run = this.db.transaction(() => {
      for (const videoId of videoIds) {
        if (clearing) remove.run(videoId, field.id);
        else upsert.run(videoId, field.id, encoded.text, encoded.number);
      }
    });
    run();
    return videoIds.length;
  }

  /**
   * Distinct values already used for a field, so the editor can suggest them
   * even for free-text fields.
   */
  distinctValues(key: string, limit = 100): string[] {
    const field = this.getByKey(key);
    if (!field) return [];
    const rows = this.db
      .prepare(
        `SELECT value_text AS v, COUNT(*) AS n FROM custom_field_values
         WHERE field_id = ? AND value_text IS NOT NULL
         GROUP BY value_text ORDER BY n DESC LIMIT ?`,
      )
      .all(field.id, limit) as Row[];
    return rows.map((r) => String(r.v));
  }
}
