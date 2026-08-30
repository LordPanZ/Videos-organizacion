import { memo, useState } from 'react';
import { thumbnailSrc } from '../api.ts';
import { generatedCover, initialsFor } from '../covers.ts';
import { formatCount, formatDate, formatDuration, formatSize } from '../../shared/query/values.ts';
import { PLATFORM_COLORS, PLATFORM_LABELS, type CustomField, type SortField, type SortSpec, type Video } from '../../shared/types.ts';

interface RowProps {
  video: Video;
  selected: boolean;
  onSelect(event: React.MouseEvent): void;
  onOpenDetail(): void;
  onContextMenu(event: React.MouseEvent): void;
}

/** Horizontal row used by the list layout: wider metadata, smaller thumbnail. */
export const VideoRow = memo(function VideoRow({ video, selected, onSelect, onOpenDetail, onContextMenu }: RowProps) {
  const [failed, setFailed] = useState(false);
  const source = failed ? null : thumbnailSrc(video);

  return (
    <div
      className="list-row"
      data-selected={selected}
      onClick={onSelect}
      onDoubleClick={onOpenDetail}
      onContextMenu={onContextMenu}
    >
      <div className="thumb">
        {source ? (
          <img src={source} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
        ) : (
          <div className="card-generated" style={generatedCover(video.id, PLATFORM_COLORS[video.platform])}>
            <span>{initialsFor(video.title)}</span>
          </div>
        )}
      </div>

      <div style={{ minWidth: 0 }}>
        <div className="truncate" style={{ fontWeight: 550, marginBottom: 3 }}>
          {video.title}
        </div>
        <div className="row" style={{ fontSize: 12, color: 'var(--text-dim)', gap: 7 }}>
          <span style={{ color: PLATFORM_COLORS[video.platform] }}>{PLATFORM_LABELS[video.platform]}</span>
          {video.author && <span className="truncate">· {video.author.name}</span>}
          {video.durationSeconds !== null && <span>· {formatDuration(video.durationSeconds)}</span>}
          {video.publishedAt && <span>· {formatDate(video.publishedAt)}</span>}
        </div>
        {video.tags.length > 0 && (
          <div className="row row-wrap" style={{ gap: 4, marginTop: 5 }}>
            {video.tags.slice(0, 6).map((tag) => (
              <span key={tag.id} className="chip">
                {tag.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="row" style={{ gap: 10, color: 'var(--text-dim)', fontSize: 12 }}>
        {video.rating > 0 && <span style={{ color: 'var(--warning)' }}>{'★'.repeat(video.rating)}</span>}
        {video.favorite && <span style={{ color: 'var(--danger)' }}>♥</span>}
        {video.filePath && <span title="Descargado">💾</span>}
      </div>
    </div>
  );
});

interface TableProps {
  videos: Video[];
  selection: Set<string>;
  fields: CustomField[];
  sort: SortSpec;
  onSort(field: SortField): void;
  onSelect(id: string, event: React.MouseEvent): void;
  onOpenDetail(id: string): void;
  onContextMenu(id: string, event: React.MouseEvent): void;
}

const COLUMNS: { field: SortField; label: string; width?: number }[] = [
  { field: 'title', label: 'Título' },
  { field: 'platform', label: 'Plataforma' },
  { field: 'author', label: 'Autor' },
  { field: 'durationSeconds', label: 'Duración' },
  { field: 'publishedAt', label: 'Publicado' },
  { field: 'addedAt', label: 'Añadido' },
  { field: 'rating', label: 'Nota' },
  { field: 'viewCount', label: 'Vistas' },
  { field: 'fileSize', label: 'Tamaño' },
];

/** Dense spreadsheet view; custom fields become extra columns. */
export function VideoTable({ videos, selection, fields, sort, onSort, onSelect, onOpenDetail, onContextMenu }: TableProps) {
  const extraColumns = fields.filter((field) => field.showInCard).slice(0, 4);

  const arrow = (field: SortField) => (sort.field === field ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : '');

  return (
    <table className="data-table">
      <thead>
        <tr>
          {COLUMNS.map((column) => (
            <th key={column.field} onClick={() => onSort(column.field)}>
              {column.label}
              {arrow(column.field)}
            </th>
          ))}
          {extraColumns.map((field) => (
            <th key={field.id}>{field.label}</th>
          ))}
          <th>Etiquetas</th>
        </tr>
      </thead>
      <tbody>
        {videos.map((video) => (
          <tr
            key={video.id}
            data-selected={selection.has(video.id)}
            onClick={(event) => onSelect(video.id, event)}
            onDoubleClick={() => onOpenDetail(video.id)}
            onContextMenu={(event) => onContextMenu(video.id, event)}
          >
            <td title={video.title}>{video.title}</td>
            <td style={{ color: PLATFORM_COLORS[video.platform] }}>{PLATFORM_LABELS[video.platform]}</td>
            <td>{video.author?.name ?? '—'}</td>
            <td>{formatDuration(video.durationSeconds)}</td>
            <td>{formatDate(video.publishedAt)}</td>
            <td>{formatDate(video.addedAt)}</td>
            <td style={{ color: 'var(--warning)' }}>{video.rating > 0 ? '★'.repeat(video.rating) : '—'}</td>
            <td>{formatCount(video.viewCount)}</td>
            <td>{formatSize(video.fileSize)}</td>
            {extraColumns.map((field) => (
              <td key={field.id}>{formatFieldValue(video.customFields[field.key])}</td>
            ))}
            <td>{video.tags.map((tag) => tag.name).join(', ') || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  return String(value);
}
