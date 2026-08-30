import type { CompareOp, QueryNode } from '../../shared/query/ast.ts';
import { PLATFORMS, type Platform } from '../../shared/types.ts';
import { parseDateValue, parseDuration, parseSize } from '../../shared/query/values.ts';

export interface CompiledQuery {
  /** A boolean SQL expression usable inside a WHERE clause. */
  where: string;
  params: unknown[];
  warnings: string[];
}

export interface CompileContext {
  /** Maps a custom-field key to its id, so `cf.<key>` filters can bind. */
  customFieldIds: Map<string, string>;
  now?: number;
}

/** Short forms users type for platforms. */
const PLATFORM_ALIASES: Record<string, Platform> = {
  yt: 'youtube',
  youtube: 'youtube',
  'youtu.be': 'youtube',
  shorts: 'youtube',
  tt: 'tiktok',
  tiktok: 'tiktok',
  ig: 'instagram',
  insta: 'instagram',
  instagram: 'instagram',
  reels: 'instagram',
  vimeo: 'vimeo',
  x: 'twitter',
  twitter: 'twitter',
  tw: 'twitter',
  twitch: 'twitch',
  dm: 'dailymotion',
  dailymotion: 'dailymotion',
  fb: 'facebook',
  facebook: 'facebook',
  reddit: 'reddit',
  bilibili: 'bilibili',
  rumble: 'rumble',
  odysee: 'odysee',
  kick: 'kick',
  pinterest: 'pinterest',
  linkedin: 'linkedin',
  soundcloud: 'soundcloud',
  local: 'local',
  archivo: 'local',
  other: 'other',
  otra: 'other',
};

/** Escapes a term for an FTS5 MATCH expression and adds prefix matching. */
export function toFtsQuery(text: string): string {
  const cleaned = text.trim().replace(/"/g, '""');
  if (cleaned === '') return '';
  // Quoting the whole term makes every character literal to FTS5, so user
  // input can never inject MATCH syntax.
  return `"${cleaned}"*`;
}

function likeParam(value: string): string {
  // Escape LIKE wildcards; the queries use ESCAPE '\'.
  return `%${value.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Maps `:` onto the natural operator for numeric comparisons. */
function numericOp(op: CompareOp): string {
  switch (op) {
    case ':':
    case '=':
      return '=';
    case '!=':
      return '!=';
    default:
      return op;
  }
}

const TRUE_SQL = '1=1';
const FALSE_SQL = '1=0';

class Compiler {
  readonly params: unknown[] = [];
  readonly warnings: string[] = [];
  private readonly now: number;

  private readonly ctx: CompileContext;

  constructor(ctx: CompileContext) {
    this.ctx = ctx;
    this.now = ctx.now ?? Date.now();
  }

  private bind(value: unknown): string {
    this.params.push(value);
    return '?';
  }

  compile(node: QueryNode): string {
    switch (node.type) {
      case 'true':
        return TRUE_SQL;
      case 'and': {
        const parts = node.children.map((c) => this.compile(c)).filter((p) => p !== TRUE_SQL);
        return parts.length ? `(${parts.join(' AND ')})` : TRUE_SQL;
      }
      case 'or': {
        const parts = node.children.map((c) => this.compile(c));
        return parts.length ? `(${parts.join(' OR ')})` : TRUE_SQL;
      }
      case 'not': {
        const inner = this.compile(node.child);
        return inner === TRUE_SQL ? TRUE_SQL : `(NOT ${inner})`;
      }
      case 'text':
        return this.compileText(node.value);
      case 'field':
        return this.compileField(node.field, node.op, node.value, node.raw);
      default:
        return TRUE_SQL;
    }
  }

  /** Free text hits the FTS index, which covers title, description, author, tags and notes. */
  private compileText(value: string): string {
    const match = toFtsQuery(value);
    if (match === '') return TRUE_SQL;
    return `v.rowid IN (SELECT rowid FROM videos_fts WHERE videos_fts MATCH ${this.bind(match)})`;
  }

  private compileField(field: string, op: CompareOp, value: string, raw: string): string {
    if (field.startsWith('cf.')) return this.compileCustomField(field.slice(3), op, value, raw);

    switch (field) {
      case 'platform':
        return this.compilePlatform(op, value, raw);
      case 'tag':
        return this.compileTag(op, value);
      case 'author':
        return this.compileAuthor(op, value);
      case 'title':
        return this.compileLike('v.title', op, value);
      case 'description':
        return this.compileLike('v.description', op, value);
      case 'notes':
        return this.compileLike('v.notes', op, value);
      case 'url':
        return this.compileLike('v.url', op, value);
      case 'language':
        return this.compileExact('v.language', op, value.toLowerCase());
      case 'status':
        return this.compileStatus(op, value, raw);
      case 'rating':
        return this.compileNumber('v.rating', op, Number(value), raw);
      case 'views':
        return this.compileNumber('v.view_count', op, Number(value), raw);
      case 'likes':
        return this.compileNumber('v.like_count', op, Number(value), raw);
      case 'opened':
        return this.compileNumber('v.opened_count', op, Number(value), raw);
      case 'duration':
        return this.compileNumber('v.duration_seconds', op, parseDuration(value), raw);
      case 'size':
        return this.compileNumber('v.file_size', op, parseSize(value), raw);
      case 'year':
        return this.compileYear(op, value, raw);
      case 'added':
        return this.compileDate('v.added_at', op, value, raw);
      case 'published':
        return this.compileDate('v.published_at', op, value, raw);
      case 'collection':
        return this.compileCollection(value);
      case 'is':
        return this.compileIs(value, raw);
      case 'has':
        return this.compileHas(value, raw);
      default:
        this.warnings.push(`Filtro desconocido: "${raw}".`);
        return TRUE_SQL;
    }
  }

  private compilePlatform(op: CompareOp, value: string, raw: string): string {
    const key = value.toLowerCase();
    const platform: Platform | null =
      PLATFORM_ALIASES[key] ??
      ((PLATFORMS as readonly string[]).includes(key) ? (key as Platform) : null);
    if (platform === null) {
      this.warnings.push(`Plataforma desconocida: "${value}" (en ${raw}).`);
      return FALSE_SQL;
    }
    return op === '!=' ? `v.platform != ${this.bind(platform)}` : `v.platform = ${this.bind(platform)}`;
  }

  /**
   * Tag filters include descendants, so `tag:cocina` also returns videos tagged
   * with any child topic of "cocina".
   */
  private compileTag(op: CompareOp, value: string): string {
    const needle = value.toLowerCase();
    const sql = `EXISTS (
      SELECT 1 FROM video_tags vt
      WHERE vt.video_id = v.id AND vt.tag_id IN (
        WITH RECURSIVE tag_tree(id) AS (
          SELECT id FROM tags WHERE slug = ${this.bind(needle)} OR lower(name) = ${this.bind(needle)}
          UNION
          SELECT t.id FROM tags t JOIN tag_tree ON t.parent_id = tag_tree.id
        )
        SELECT id FROM tag_tree
      )
    )`;
    return op === '!=' ? `(NOT ${sql})` : sql;
  }

  private compileAuthor(op: CompareOp, value: string): string {
    const exact = op === '=' || op === '!=';
    const comparison = exact
      ? `(lower(a.name) = ${this.bind(value.toLowerCase())} OR lower(a.handle) = ${this.bind(value.toLowerCase())})`
      : `(lower(a.name) LIKE ${this.bind(likeParam(value))} ESCAPE '\\' OR lower(a.handle) LIKE ${this.bind(likeParam(value))} ESCAPE '\\')`;
    return op === '!=' ? `(NOT ${comparison})` : comparison;
  }

  private compileLike(column: string, op: CompareOp, value: string): string {
    if (op === '=' || op === '!=') {
      const sql = `lower(${column}) = ${this.bind(value.toLowerCase())}`;
      return op === '!=' ? `(NOT ${sql})` : sql;
    }
    return `lower(${column}) LIKE ${this.bind(likeParam(value))} ESCAPE '\\'`;
  }

  private compileExact(column: string, op: CompareOp, value: string): string {
    const sql = `lower(${column}) = ${this.bind(value)}`;
    return op === '!=' ? `(NOT ${sql})` : sql;
  }

  private compileNumber(column: string, op: CompareOp, value: number | null, raw: string): string {
    if (value === null || !Number.isFinite(value)) {
      this.warnings.push(`Valor numérico no válido en "${raw}".`);
      return TRUE_SQL;
    }
    // NULL columns must not satisfy any comparison, including `!=`.
    return `(${column} IS NOT NULL AND ${column} ${numericOp(op)} ${this.bind(value)})`;
  }

  private compileYear(op: CompareOp, value: string, raw: string): string {
    const year = Number(value);
    if (!Number.isInteger(year)) {
      this.warnings.push(`Año no válido en "${raw}".`);
      return TRUE_SQL;
    }
    const expr = `CAST(strftime('%Y', v.published_at) AS INTEGER)`;
    return `(v.published_at IS NOT NULL AND ${expr} ${numericOp(op)} ${this.bind(year)})`;
  }

  /**
   * Dates are stored as ISO-8601 strings, which sort lexicographically, so the
   * comparison happens directly on the text column.
   */
  private compileDate(column: string, op: CompareOp, value: string, raw: string): string {
    const range = parseDateValue(value, this.now);
    if (range === null) {
      this.warnings.push(`Fecha no reconocida en "${raw}".`);
      return TRUE_SQL;
    }
    const iso = (ms: number) => new Date(ms).toISOString();
    const notNull = `${column} IS NOT NULL`;

    switch (op) {
      case '>':
      case '>=':
        // "within the last N units" for relative values, "after" for absolute ones.
        return range.start === null
          ? TRUE_SQL
          : `(${notNull} AND ${column} >= ${this.bind(iso(range.start))})`;
      case '<':
      case '<=':
        return range.start === null
          ? TRUE_SQL
          : `(${notNull} AND ${column} < ${this.bind(iso(range.start))})`;
      case '!=': {
        const lower = range.start === null ? null : iso(range.start);
        const upper = range.end === null ? null : iso(range.end);
        if (lower === null || upper === null) return TRUE_SQL;
        return `(${column} IS NULL OR ${column} < ${this.bind(lower)} OR ${column} >= ${this.bind(upper)})`;
      }
      default: {
        const lower = range.start === null ? null : iso(range.start);
        const upper = range.end === null ? null : iso(range.end);
        if (lower === null || upper === null) return TRUE_SQL;
        return `(${notNull} AND ${column} >= ${this.bind(lower)} AND ${column} < ${this.bind(upper)})`;
      }
    }
  }

  private compileCollection(value: string): string {
    return `EXISTS (
      SELECT 1 FROM collection_items ci
      JOIN collections c ON c.id = ci.collection_id
      WHERE ci.video_id = v.id
        AND (c.id = ${this.bind(value)} OR lower(c.name) = ${this.bind(value.toLowerCase())})
    )`;
  }

  private compileStatus(op: CompareOp, value: string, raw: string): string {
    const map: Record<string, string> = {
      unwatched: 'unwatched',
      nuevo: 'unwatched',
      pendiente: 'unwatched',
      watching: 'in_progress',
      viendo: 'in_progress',
      in_progress: 'in_progress',
      watched: 'watched',
      visto: 'watched',
      terminado: 'watched',
    };
    const status = map[value.toLowerCase()];
    if (status === undefined) {
      this.warnings.push(`Estado desconocido en "${raw}".`);
      return TRUE_SQL;
    }
    const sql = `v.watch_status = ${this.bind(status)}`;
    return op === '!=' ? `(NOT ${sql})` : sql;
  }

  private compileIs(value: string, raw: string): string {
    switch (value.toLowerCase()) {
      case 'favorite':
      case 'favorito':
      case 'favoritos':
        return 'v.favorite = 1';
      case 'downloaded':
      case 'descargado':
        return 'v.file_path IS NOT NULL';
      case 'watched':
      case 'visto':
        return `v.watch_status = 'watched'`;
      case 'unwatched':
      case 'nuevo':
      case 'pendiente':
        return `v.watch_status = 'unwatched'`;
      case 'watching':
      case 'viendo':
        return `v.watch_status = 'in_progress'`;
      case 'short':
      case 'corto':
        return 'v.is_short = 1';
      case 'live':
      case 'vivo':
        return 'v.is_live = 1';
      case 'archived':
      case 'archivado':
        return 'v.archived = 1';
      case 'untagged':
      case 'sinetiquetas':
        return 'NOT EXISTS (SELECT 1 FROM video_tags vt WHERE vt.video_id = v.id)';
      case 'unavailable':
      case 'nodisponible':
        return `v.availability IN ('unavailable', 'private', 'geoblocked')`;
      case 'local':
        return `v.platform = 'local'`;
      case 'rated':
      case 'valorado':
        return 'v.rating > 0';
      default:
        this.warnings.push(`Valor no soportado en "${raw}". Prueba con is:favorito, is:descargado, is:visto…`);
        return TRUE_SQL;
    }
  }

  private compileHas(value: string, raw: string): string {
    switch (value.toLowerCase()) {
      case 'notes':
      case 'notas':
        return `(v.notes IS NOT NULL AND trim(v.notes) != '')`;
      case 'file':
      case 'archivo':
        return 'v.file_path IS NOT NULL';
      case 'thumbnail':
      case 'miniatura':
        return '(v.thumbnail_path IS NOT NULL OR v.thumbnail_url IS NOT NULL)';
      case 'bookmarks':
      case 'marcadores':
        return 'EXISTS (SELECT 1 FROM bookmarks b WHERE b.video_id = v.id)';
      case 'description':
      case 'descripcion':
        return `(v.description IS NOT NULL AND trim(v.description) != '')`;
      case 'tags':
      case 'etiquetas':
        return 'EXISTS (SELECT 1 FROM video_tags vt WHERE vt.video_id = v.id)';
      case 'author':
      case 'autor':
        return 'v.author_id IS NOT NULL';
      default:
        this.warnings.push(`Valor no soportado en "${raw}". Prueba con has:notas, has:archivo, has:marcadores…`);
        return TRUE_SQL;
    }
  }

  /**
   * Custom fields store text in `value_text` and numbers in `value_number`, so
   * ordered comparisons stay numeric while `:` behaves as a contains match.
   */
  private compileCustomField(key: string, op: CompareOp, value: string, raw: string): string {
    const fieldId = this.ctx.customFieldIds.get(key.toLowerCase());
    if (fieldId === undefined) {
      this.warnings.push(`Campo personalizado desconocido: "${key}".`);
      return TRUE_SQL;
    }

    const numeric = Number(value);
    const isOrdered = op === '>' || op === '>=' || op === '<' || op === '<=';

    if (isOrdered) {
      if (!Number.isFinite(numeric)) {
        this.warnings.push(`El campo "${key}" necesita un número en "${raw}".`);
        return TRUE_SQL;
      }
      return `EXISTS (
        SELECT 1 FROM custom_field_values cv
        WHERE cv.video_id = v.id AND cv.field_id = ${this.bind(fieldId)}
          AND cv.value_number IS NOT NULL AND cv.value_number ${op} ${this.bind(numeric)}
      )`;
    }

    // Parameters are bound in the order they appear in the SQL text, so the
    // field id has to be bound before the comparison value.
    const fieldPlaceholder = this.bind(fieldId);

    // `multiselect` values are stored as a JSON array, so a contains match has
    // to look inside the serialized text too.
    const comparison =
      op === '='
        ? `lower(cv.value_text) = ${this.bind(value.toLowerCase())}`
        : `lower(cv.value_text) LIKE ${this.bind(likeParam(value))} ESCAPE '\\'`;

    const exists = `EXISTS (
      SELECT 1 FROM custom_field_values cv
      WHERE cv.video_id = v.id AND cv.field_id = ${fieldPlaceholder} AND ${comparison}
    )`;
    return op === '!=' ? `(NOT ${exists})` : exists;
  }
}

/** Compiles a parsed query into a WHERE fragment plus its bound parameters. */
export function compileQuery(node: QueryNode, ctx: CompileContext): CompiledQuery {
  const compiler = new Compiler(ctx);
  const where = compiler.compile(node);
  return { where, params: compiler.params, warnings: compiler.warnings };
}
