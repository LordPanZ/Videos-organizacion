import type { CompareOp, QueryNode } from '../shared/query/ast.ts';
import { parseDateValue, parseDuration, parseSize } from '../shared/query/values.ts';
import { PLATFORMS, type Platform, type Video } from '../shared/types.ts';

/** Folds accents and case so "programacion" matches "Programación". */
export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Short forms users type for platforms, mirroring the desktop compiler. */
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

/** Everything the evaluator needs beyond the video itself. */
export interface EvaluationContext {
  /** Slugs of a tag plus all of its descendants, keyed by slug. */
  tagDescendants: Map<string, Set<string>>;
  /** Collection ids a video belongs to. */
  collectionsByVideo: Map<string, Set<string>>;
  /** Collection name (lowercased) to id. */
  collectionIdsByName: Map<string, string>;
  /** Keys of every defined custom field. */
  customFieldKeys: Set<string>;
  videoHasBookmarks: Set<string>;
  now: number;
  warnings: string[];
}

/** Cached lowercase text for a video, so a scan does not re-normalize. */
export interface SearchableVideo {
  video: Video;
  haystack: string;
  tagSlugs: Set<string>;
}

/** Builds the searchable projection of a video. */
export function toSearchable(video: Video): SearchableVideo {
  const parts = [
    video.title,
    video.description ?? '',
    video.author?.name ?? '',
    video.author?.handle ?? '',
    video.notes ?? '',
    video.tags.map((tag) => tag.name).join(' '),
  ];
  return {
    video,
    haystack: normalize(parts.join('\n')),
    tagSlugs: new Set(video.tags.map((tag) => tag.slug)),
  };
}

function compareNumbers(actual: number | null, op: CompareOp, expected: number): boolean {
  // A missing value satisfies no comparison, not even "not equal".
  if (actual === null || !Number.isFinite(actual)) return false;
  switch (op) {
    case '>':
      return actual > expected;
    case '>=':
      return actual >= expected;
    case '<':
      return actual < expected;
    case '<=':
      return actual <= expected;
    case '!=':
      return actual !== expected;
    default:
      return actual === expected;
  }
}

function compareText(actual: string | null, op: CompareOp, expected: string): boolean {
  const haystack = normalize(actual ?? '');
  const needle = normalize(expected);
  if (op === '=' ) return haystack === needle;
  if (op === '!=') return haystack !== needle;
  return haystack.includes(needle);
}

/**
 * Dates are compared the same way the desktop build does: a relative value
 * such as `7d` resolves to a moment in the past, so `added:>7d` reads as
 * "added within the last seven days".
 */
function compareDate(iso: string | null, op: CompareOp, raw: string, context: EvaluationContext): boolean {
  const range = parseDateValue(raw, context.now);
  if (range === null) {
    context.warnings.push(`Fecha no reconocida en "${raw}".`);
    return true;
  }
  if (iso === null) return false;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return false;

  switch (op) {
    case '>':
    case '>=':
      return range.start === null ? true : time >= range.start;
    case '<':
    case '<=':
      return range.start === null ? true : time < range.start;
    case '!=':
      if (range.start === null || range.end === null) return true;
      return time < range.start || time >= range.end;
    default:
      if (range.start === null || range.end === null) return true;
      return time >= range.start && time < range.end;
  }
}

function matchIs(video: Video, value: string, context: EvaluationContext, raw: string): boolean {
  switch (normalize(value)) {
    case 'favorite':
    case 'favorito':
    case 'favoritos':
      return video.favorite;
    case 'downloaded':
    case 'descargado':
      return video.filePath !== null;
    case 'watched':
    case 'visto':
      return video.watchStatus === 'watched';
    case 'unwatched':
    case 'nuevo':
    case 'pendiente':
      return video.watchStatus === 'unwatched';
    case 'watching':
    case 'viendo':
      return video.watchStatus === 'in_progress';
    case 'short':
    case 'corto':
      return video.isShort;
    case 'live':
    case 'vivo':
      return video.isLive;
    case 'archived':
    case 'archivado':
      return video.archived;
    case 'untagged':
    case 'sinetiquetas':
      return video.tags.length === 0;
    case 'unavailable':
    case 'nodisponible':
      return video.availability === 'unavailable' || video.availability === 'private' || video.availability === 'geoblocked';
    case 'local':
      return video.platform === 'local';
    case 'rated':
    case 'valorado':
      return video.rating > 0;
    default:
      context.warnings.push(`Valor no soportado en "${raw}". Prueba con is:favorito, is:visto…`);
      return true;
  }
}

function matchHas(video: Video, value: string, context: EvaluationContext, raw: string): boolean {
  switch (normalize(value)) {
    case 'notes':
    case 'notas':
      return (video.notes ?? '').trim() !== '';
    case 'file':
    case 'archivo':
      return video.filePath !== null;
    case 'thumbnail':
    case 'miniatura':
      return video.thumbnailUrl !== null || video.thumbnailPath !== null;
    case 'bookmarks':
    case 'marcadores':
      return context.videoHasBookmarks.has(video.id);
    case 'description':
    case 'descripcion':
      return (video.description ?? '').trim() !== '';
    case 'tags':
    case 'etiquetas':
      return video.tags.length > 0;
    case 'author':
    case 'autor':
      return video.author !== null;
    default:
      context.warnings.push(`Valor no soportado en "${raw}". Prueba con has:notas, has:etiquetas…`);
      return true;
  }
}

function matchCustomField(video: Video, key: string, op: CompareOp, value: string, context: EvaluationContext, raw: string): boolean {
  if (!context.customFieldKeys.has(key)) {
    context.warnings.push(`Campo personalizado desconocido: "${key}".`);
    return true;
  }
  const stored = video.customFields[key];
  const ordered = op === '>' || op === '>=' || op === '<' || op === '<=';

  if (ordered) {
    const expected = Number(value);
    if (!Number.isFinite(expected)) {
      context.warnings.push(`El campo "${key}" necesita un número en "${raw}".`);
      return true;
    }
    const actual = typeof stored === 'number' ? stored : Number(stored);
    return compareNumbers(Number.isFinite(actual) ? actual : null, op, expected);
  }

  if (stored === null || stored === undefined) return op === '!=';
  // Multi-value fields match when any entry matches.
  const candidates = Array.isArray(stored) ? stored.map(String) : [String(stored)];
  const hit = candidates.some((candidate) => compareText(candidate, op === '!=' ? ':' : op, value));
  return op === '!=' ? !hit : hit;
}

function matchField(
  item: SearchableVideo,
  field: string,
  op: CompareOp,
  value: string,
  raw: string,
  context: EvaluationContext,
): boolean {
  const { video } = item;

  if (field.startsWith('cf.')) return matchCustomField(video, field.slice(3), op, value, context, raw);

  switch (field) {
    case 'platform': {
      const key = normalize(value);
      const platform = PLATFORM_ALIASES[key] ?? ((PLATFORMS as readonly string[]).includes(key) ? (key as Platform) : null);
      if (platform === null) {
        context.warnings.push(`Plataforma desconocida: "${value}" (en ${raw}).`);
        return false;
      }
      return op === '!=' ? video.platform !== platform : video.platform === platform;
    }
    case 'tag': {
      const needle = normalize(value);
      const family = context.tagDescendants.get(needle) ?? new Set([needle]);
      const hit = [...item.tagSlugs].some((slug) => family.has(slug));
      return op === '!=' ? !hit : hit;
    }
    case 'author': {
      const hit =
        compareText(video.author?.name ?? null, op === '!=' ? ':' : op, value) ||
        compareText(video.author?.handle ?? null, op === '!=' ? ':' : op, value);
      return op === '!=' ? !hit : hit;
    }
    case 'title':
      return compareText(video.title, op, value);
    case 'description':
      return compareText(video.description, op, value);
    case 'notes':
      return compareText(video.notes, op, value);
    case 'url':
      return compareText(video.url, op, value);
    case 'language':
      return compareText(video.language, op === ':' ? '=' : op, value);
    case 'status': {
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
      const status = map[normalize(value)];
      if (status === undefined) {
        context.warnings.push(`Estado desconocido en "${raw}".`);
        return true;
      }
      return op === '!=' ? video.watchStatus !== status : video.watchStatus === status;
    }
    case 'rating':
      return compareNumbers(video.rating, op, Number(value));
    case 'views':
      return compareNumbers(video.viewCount, op, Number(value));
    case 'likes':
      return compareNumbers(video.likeCount, op, Number(value));
    case 'opened':
      return compareNumbers(video.openedCount, op, Number(value));
    case 'duration': {
      const seconds = parseDuration(value);
      if (seconds === null) {
        context.warnings.push(`Valor numérico no válido en "${raw}".`);
        return true;
      }
      return compareNumbers(video.durationSeconds, op, seconds);
    }
    case 'size': {
      const bytes = parseSize(value);
      if (bytes === null) {
        context.warnings.push(`Valor numérico no válido en "${raw}".`);
        return true;
      }
      return compareNumbers(video.fileSize, op, bytes);
    }
    case 'year': {
      const year = Number(value);
      if (!Number.isInteger(year)) {
        context.warnings.push(`Año no válido en "${raw}".`);
        return true;
      }
      if (!video.publishedAt) return false;
      return compareNumbers(new Date(video.publishedAt).getUTCFullYear(), op, year);
    }
    case 'added':
      return compareDate(video.addedAt, op, value, context);
    case 'published':
      return compareDate(video.publishedAt, op, value, context);
    case 'collection': {
      const byId = context.collectionsByVideo.get(video.id);
      if (!byId) return false;
      if (byId.has(value)) return true;
      const resolved = context.collectionIdsByName.get(normalize(value));
      return resolved !== undefined && byId.has(resolved);
    }
    case 'is':
      return matchIs(video, value, context, raw);
    case 'has':
      return matchHas(video, value, context, raw);
    default:
      context.warnings.push(`Filtro desconocido: "${raw}".`);
      return true;
  }
}

/** Evaluates a parsed query against one video. */
export function evaluate(node: QueryNode, item: SearchableVideo, context: EvaluationContext): boolean {
  switch (node.type) {
    case 'true':
      return true;
    case 'and':
      return node.children.every((child) => evaluate(child, item, context));
    case 'or':
      return node.children.some((child) => evaluate(child, item, context));
    case 'not':
      return !evaluate(node.child, item, context);
    case 'text':
      return item.haystack.includes(normalize(node.value));
    case 'field':
      return matchField(item, node.field, node.op, node.value, node.raw, context);
    default:
      return true;
  }
}
