import { memo, useState } from 'react';
import { thumbnailSrc } from '../api.ts';
import { formatDuration } from '../../shared/query/values.ts';
import { PLATFORM_COLORS, PLATFORM_LABELS, type Video } from '../../shared/types.ts';

export interface VideoCardProps {
  video: Video;
  selected: boolean;
  showTitle: boolean;
  showBadges: boolean;
  onSelect(event: React.MouseEvent): void;
  onOpenDetail(): void;
  onPlay(): void;
  onToggleFavorite(): void;
  onToggleSelect(event: React.MouseEvent): void;
  onContextMenu(event: React.MouseEvent): void;
}

/** One thumbnail tile. Memoized: a 5000-item grid re-renders constantly. */
export const VideoCard = memo(function VideoCard({
  video,
  selected,
  showTitle,
  showBadges,
  onSelect,
  onOpenDetail,
  onPlay,
  onToggleFavorite,
  onToggleSelect,
  onContextMenu,
}: VideoCardProps) {
  const [failed, setFailed] = useState(false);
  const source = failed ? null : thumbnailSrc(video);
  const unavailable = video.availability === 'unavailable' || video.availability === 'private';

  return (
    <article
      className="card"
      data-selected={selected}
      data-short={video.isShort}
      onClick={onSelect}
      onDoubleClick={onOpenDetail}
      onContextMenu={onContextMenu}
      title={video.title}
    >
      <div className="card-thumb">
        {source ? (
          <img src={source} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
        ) : (
          <div className="placeholder">🎬</div>
        )}

        <div
          className="card-play"
          onClick={(event) => {
            event.stopPropagation();
            onPlay();
          }}
        >
          <span>▶</span>
        </div>

        {showBadges && (
          <div className="card-badges">
            <span className="platform-badge">
              <i className="dot" style={{ background: PLATFORM_COLORS[video.platform] }} />
              {PLATFORM_LABELS[video.platform]}
            </span>
            {unavailable && <span className="platform-badge" style={{ color: '#ff9d9d' }}>⚠ No disponible</span>}
          </div>
        )}

        <button
          type="button"
          className="card-select"
          aria-label={selected ? 'Quitar de la selección' : 'Añadir a la selección'}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelect(event);
          }}
        >
          {selected ? '✓' : ''}
        </button>

        <div className="card-actions">
          <button
            type="button"
            title={video.favorite ? 'Quitar de favoritos' : 'Marcar como favorito'}
            data-active={video.favorite}
            onClick={(event) => {
              event.stopPropagation();
              onToggleFavorite();
            }}
          >
            {video.favorite ? '♥' : '♡'}
          </button>
          <button
            type="button"
            title="Ver detalles"
            onClick={(event) => {
              event.stopPropagation();
              onOpenDetail();
            }}
          >
            ⓘ
          </button>
        </div>

        {video.durationSeconds !== null && <span className="card-duration">{formatDuration(video.durationSeconds)}</span>}

        {video.watchProgress > 0 && video.watchProgress < 1 && (
          <div className="card-progress">
            <span style={{ width: `${Math.round(video.watchProgress * 100)}%` }} />
          </div>
        )}
      </div>

      {showTitle && (
        <div className="card-body">
          <div className="card-title">{video.title}</div>
          <div className="card-meta">
            {video.author && <span className="author">{video.author.name}</span>}
            {video.rating > 0 && <span style={{ color: 'var(--warning)' }}>{'★'.repeat(video.rating)}</span>}
            {video.filePath && <span title="Descargado">💾</span>}
          </div>
          {video.tags.length > 0 && (
            <div className="card-tags">
              {video.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag.id}
                  className="chip"
                  style={tag.color ? { background: `color-mix(in srgb, ${tag.color} 22%, transparent)`, color: tag.color } : undefined}
                >
                  <span className="chip-label">{tag.name}</span>
                </span>
              ))}
              {video.tags.length > 3 && <span className="chip">+{video.tags.length - 3}</span>}
            </div>
          )}
        </div>
      )}
    </article>
  );
});
