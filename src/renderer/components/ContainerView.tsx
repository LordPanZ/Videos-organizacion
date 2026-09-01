import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useLibrary } from '../store/useLibrary.ts';
import { VideoCard } from './VideoCard.tsx';
import type { Video } from '../../shared/types.ts';

/**
 * The container: videos kept out of every other view.
 *
 * It runs its own query rather than going through the shared store, so the
 * rest of the interface never holds a hidden video at all — a screen cannot
 * leak what was never handed to it.
 */
export function ContainerView() {
  const { openDetail, patchVideo, settings, cardSize, lockContainer } = useLibrary();
  const [videos, setVideos] = useState<Video[] | null>(null);

  const load = useCallback(async () => {
    const result = await api.videos.search({ query: '', hidden: 'only', limit: 500, facets: false });
    setVideos(result.videos);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The container reflects moves in and out of it, which happen from the
  // detail panel while this screen is on show.
  useEffect(() => api.on('library:changed', () => void load()), [load]);

  const play = (id: string) => {
    void api.videos.open(id);
    patchVideo(id, { watchStatus: 'in_progress' });
  };

  if (videos === null) return <p className="dim" style={{ padding: 22 }}>Abriendo…</p>;

  return (
    <div className="grid-wrap">
      <div className="container-bar">
        <span>
          🔓 Contenedor · {videos.length.toLocaleString('es-ES')}{' '}
          {videos.length === 1 ? 'vídeo' : 'vídeos'}
        </span>
        <button type="button" className="btn btn-sm" onClick={lockContainer}>
          🔒 Cerrar el contenedor
        </button>
      </div>

      {videos.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">🔒</div>
          <h2>El contenedor está vacío</h2>
          <p>
            Al añadir un enlace, marca la casilla <strong>Contenedor</strong> y ese vídeo vendrá aquí
            en lugar de aparecer en la portada o en la biblioteca.
          </p>
        </div>
      ) : (
        <div
          className="video-grid container-grid"
          data-layout="grid"
          style={{ '--card-size': `${cardSize}px` } as React.CSSProperties}
        >
          {videos.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              selected={false}
              showTitle={settings.showTitles}
              showBadges={settings.showBadges}
              onSelect={() => openDetail(video.id)}
              onOpenDetail={() => openDetail(video.id)}
              onPlay={() => play(video.id)}
              onToggleFavorite={() => {
                patchVideo(video.id, { favorite: !video.favorite });
                void api.videos.update(video.id, { favorite: !video.favorite });
              }}
              onToggleSelect={() => openDetail(video.id)}
              onContextMenu={(event) => event.preventDefault()}
            />
          ))}
        </div>
      )}
    </div>
  );
}
