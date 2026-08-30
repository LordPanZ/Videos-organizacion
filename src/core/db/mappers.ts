import type {
  Author,
  Availability,
  Collection,
  CollectionKind,
  CustomField,
  CustomFieldOption,
  CustomFieldType,
  CustomFieldValue,
  DownloadFormat,
  DownloadJob,
  DownloadState,
  LayoutMode,
  Platform,
  SavedView,
  SortSpec,
  Tag,
  TagKind,
  Video,
  VideoBookmark,
  WatchStatus,
  AutoTagRule,
} from '../../shared/types.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const bool = (value: unknown): boolean => value === 1 || value === true;

export function safeJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function mapAuthor(row: Row | undefined): Author | null {
  if (!row || row.author_id === null || row.author_id === undefined) return null;
  return {
    id: row.author_id,
    platform: row.author_platform as Platform,
    externalId: row.author_external_id ?? null,
    name: row.author_name ?? 'Desconocido',
    handle: row.author_handle ?? null,
    url: row.author_url ?? null,
    avatarPath: row.author_avatar_path ?? null,
    subscriberCount: row.author_subscriber_count ?? null,
  };
}

export function mapAuthorRow(row: Row): Author {
  return {
    id: row.id,
    platform: row.platform as Platform,
    externalId: row.external_id ?? null,
    name: row.name,
    handle: row.handle ?? null,
    url: row.url ?? null,
    avatarPath: row.avatar_path ?? null,
    subscriberCount: row.subscriber_count ?? null,
    videoCount: row.video_count ?? undefined,
  };
}

export function mapTag(row: Row): Tag {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    color: row.color ?? null,
    icon: row.icon ?? null,
    kind: (row.kind ?? 'manual') as TagKind,
    parentId: row.parent_id ?? null,
    description: row.description ?? null,
    createdAt: row.created_at,
    videoCount: row.video_count ?? undefined,
  };
}

/** Decodes a stored custom-field value back into its declared type. */
export function decodeFieldValue(type: CustomFieldType, row: Row): CustomFieldValue {
  switch (type) {
    case 'number':
    case 'rating':
    case 'duration':
      return row.value_number ?? null;
    case 'boolean':
      return row.value_number === null || row.value_number === undefined ? null : row.value_number === 1;
    case 'multiselect':
      return safeJson<string[]>(row.value_text, []);
    default:
      return row.value_text ?? null;
  }
}

/** Encodes a domain value into the text/number column pair. */
export function encodeFieldValue(
  type: CustomFieldType,
  value: CustomFieldValue,
): { text: string | null; number: number | null } {
  if (value === null || value === undefined || value === '') return { text: null, number: null };

  switch (type) {
    case 'number':
    case 'rating':
    case 'duration': {
      const parsed = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(parsed) ? { text: String(parsed), number: parsed } : { text: null, number: null };
    }
    case 'boolean': {
      const truthy = value === true || value === 'true' || value === 1 || value === '1';
      return { text: truthy ? 'true' : 'false', number: truthy ? 1 : 0 };
    }
    case 'multiselect': {
      const list = Array.isArray(value) ? value : [String(value)];
      return { text: JSON.stringify(list), number: list.length };
    }
    default:
      return { text: String(value), number: null };
  }
}

export function mapCustomField(row: Row): CustomField {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    type: row.type as CustomFieldType,
    options: safeJson<CustomFieldOption[]>(row.options_json, []),
    defaultValue: row.default_value ?? null,
    description: row.description ?? null,
    icon: row.icon ?? null,
    color: row.color ?? null,
    position: row.position ?? 0,
    showInCard: bool(row.show_in_card),
    showInFacets: bool(row.show_in_facets),
    createdAt: row.created_at,
  };
}

export function mapVideo(
  row: Row,
  tags: Tag[] = [],
  customFields: Record<string, CustomFieldValue> = {},
): Video {
  return {
    id: row.id,
    url: row.url,
    platform: row.platform as Platform,
    platformId: row.platform_id ?? null,
    title: row.title,
    description: row.description ?? null,
    author: mapAuthor(row),
    durationSeconds: row.duration_seconds ?? null,
    publishedAt: row.published_at ?? null,
    thumbnailPath: row.thumbnail_path ?? null,
    thumbnailUrl: row.thumbnail_url ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
    viewCount: row.view_count ?? null,
    likeCount: row.like_count ?? null,
    commentCount: row.comment_count ?? null,
    language: row.language ?? null,
    isLive: bool(row.is_live),
    isShort: bool(row.is_short),
    rating: row.rating ?? 0,
    favorite: bool(row.favorite),
    watchStatus: (row.watch_status ?? 'unwatched') as WatchStatus,
    watchProgress: row.watch_progress ?? 0,
    notes: row.notes ?? null,
    color: row.color ?? null,
    archived: bool(row.archived),
    filePath: row.file_path ?? null,
    fileSize: row.file_size ?? null,
    fileFormat: row.file_format ?? null,
    downloadedAt: row.downloaded_at ?? null,
    availability: (row.availability ?? 'unknown') as Availability,
    lastCheckedAt: row.last_checked_at ?? null,
    addedAt: row.added_at,
    updatedAt: row.updated_at,
    openedCount: row.opened_count ?? 0,
    lastOpenedAt: row.last_opened_at ?? null,
    tags,
    customFields,
  };
}

export function mapCollection(row: Row): Collection {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    coverPath: row.cover_path ?? null,
    icon: row.icon ?? null,
    color: row.color ?? null,
    kind: (row.kind ?? 'manual') as CollectionKind,
    query: row.query ?? null,
    parentId: row.parent_id ?? null,
    position: row.position ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    videoCount: row.video_count ?? undefined,
  };
}

export function mapBookmark(row: Row): VideoBookmark {
  return {
    id: row.id,
    videoId: row.video_id,
    timeSeconds: row.time_seconds,
    label: row.label,
    note: row.note ?? null,
    createdAt: row.created_at,
  };
}

export function mapRule(row: Row): AutoTagRule {
  return {
    id: row.id,
    name: row.name,
    enabled: bool(row.enabled),
    field: row.field,
    matcher: row.matcher,
    pattern: row.pattern,
    caseSensitive: bool(row.case_sensitive),
    tagIds: safeJson<string[]>(row.tag_ids, []),
    setFields: safeJson<Record<string, CustomFieldValue>>(row.set_fields, {}),
    position: row.position ?? 0,
    createdAt: row.created_at,
    matchCount: row.match_count ?? 0,
  };
}

export function mapSavedView(row: Row): SavedView {
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    sort: safeJson<SortSpec>(row.sort, { field: 'addedAt', direction: 'desc' }),
    layout: (row.layout ?? 'grid') as LayoutMode,
    icon: row.icon ?? null,
    position: row.position ?? 0,
  };
}

export function mapDownloadJob(row: Row): DownloadJob {
  return {
    id: row.id,
    videoId: row.video_id,
    title: row.title ?? '',
    url: row.url,
    state: (row.state ?? 'queued') as DownloadState,
    progress: row.progress ?? 0,
    speed: null,
    eta: null,
    totalBytes: row.total_bytes ?? null,
    downloadedBytes: row.downloaded_bytes ?? null,
    outputPath: row.output_path ?? null,
    format: safeJson<DownloadFormat>(row.format_json, {
      quality: 'best',
      audioOnly: false,
      container: null,
      embedSubtitles: false,
      embedThumbnail: false,
      subtitleLanguages: [],
    }),
    error: row.error ?? null,
    createdAt: row.created_at,
    finishedAt: row.finished_at ?? null,
  };
}

/** Column list that hydrates the joined author fields consumed by `mapAuthor`. */
export const AUTHOR_JOIN_COLUMNS = `
  a.id                AS author_id,
  a.platform          AS author_platform,
  a.external_id       AS author_external_id,
  a.name              AS author_name,
  a.handle            AS author_handle,
  a.url               AS author_url,
  a.avatar_path       AS author_avatar_path,
  a.subscriber_count  AS author_subscriber_count
`;
