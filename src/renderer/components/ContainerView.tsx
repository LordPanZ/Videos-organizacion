import { useCallback, useEffect, useState } from 'react';
import { api, thumbnailSrc } from '../api.ts';
import { pickImage, prepareCover } from '../covers.ts';
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
  const { openDetail, patchVideo, settings, cardSize, lockContainer, toast } = useLibrary();
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [busy, setBusy] = useState(false);

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

  /** Takes a picture from the gallery or camera and makes it this video's cover. */
  const addCover = async (id: string) => {
    const file = await pickImage();
    if (!file) return;
    try {
      const updated = await api.videos.setCover(id, (await prepareCover(file)).dataUrl);
      if (updated) patchVideo(updated.id, updated);
      await load();
      toast('success', 'Miniatura puesta.');
    } catch (error) {
      toast('error', (error as Error).message);
    }
  };

  /**
   * Asks each platform again for a picture. X is the reason this exists: it
   * publishes no thumbnail through the usual route, and the attempt through
   * its own embed service either works or leaves the video exactly as it was.
   */
  const findCovers = async () => {
    const missing = (videos ?? []).filter((video) => thumbnailSrc(video) === null).map((video) => video.id);
    if (missing.length === 0) return;
    setBusy(true);
    try {
      await api.videos.refresh(missing);
      const after = await api.videos.search({ query: '', hidden: 'only', limit: 500, facets: false });
      setVideos(after.videos);
      const found = after.videos.filter(
        (video) => missing.includes(video.id) && thumbnailSrc(video) !== null,
      ).length;
      toast(
        found > 0 ? 'success' : 'info',
        found > 0
          ? `${found} de ${missing.length} han conseguido miniatura.`
          : 'Ninguna plataforma ha dado una imagen. Puedes ponerles una captura con 🖼.',
      );
    } catch {
      toast('error', 'No se ha podido consultar. Revisa la conexión.');
    } finally {
      setBusy(false);
    }
  };

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
        <span className="row" style={{ gap: 6 }}>
          {videos.some((video) => thumbnailSrc(video) === null) && (
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void findCovers()}>
              {busy ? 'Buscando…' : '🔍 Buscar miniaturas'}
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={lockContainer}>
            🔒 Cerrar
          </button>
        </span>
      </div>

      {videos.some((video) => thumbnailSrc(video) === null) && (
        <p className="container-hint">
          Pulsa 🖼 en un vídeo para ponerle una captura como miniatura. X e Instagram no dan
          ninguna, así que hasta entonces se muestran con las iniciales de la cuenta.
        </p>
      )}

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
              onAddCover={thumbnailSrc(video) === null ? () => void addCover(video.id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
