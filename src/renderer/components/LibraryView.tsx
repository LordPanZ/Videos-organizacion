import { useCallback, useEffect, useRef } from 'react';
import { api } from '../api.ts';
import { useLibrary } from '../store/useLibrary.ts';
import { VideoCard } from './VideoCard.tsx';
import { VideoRow, VideoTable } from './VideoViews.tsx';
import type { SortField } from '../../shared/types.ts';

export interface LibraryViewProps {
  onAdd(): void;
}

/** The grid, list or table of videos, with infinite scrolling. */
export function LibraryView({ onAdd }: LibraryViewProps) {
  const {
    videos,
    total,
    loading,
    hasMore,
    layout,
    cardSize,
    selection,
    settings,
    fields,
    sort,
    query,
    collectionId,
    select,
    openDetail,
    patchVideo,
    loadMore,
    setSort,
    runQuery,
  } = useLibrary();

  const sentinel = useRef<HTMLDivElement>(null);

  // Load the next page as the sentinel scrolls into view.
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: '800px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, videos.length]);

  const handleSelect = useCallback(
    (id: string, event: React.MouseEvent) => {
      if (event.shiftKey) select(id, 'range');
      else if (event.metaKey || event.ctrlKey) select(id, 'toggle');
      else select(id, 'replace');
    },
    [select],
  );

  const play = useCallback(
    (id: string) => {
      void api.videos.open(id);
      patchVideo(id, { watchStatus: 'in_progress' });
    },
    [patchVideo],
  );

  const contextMenu = useCallback(
    (id: string, event: React.MouseEvent) => {
      event.preventDefault();
      if (!selection.has(id)) select(id, 'replace');
      openDetail(id);
    },
    [selection, select, openDetail],
  );

  if (!loading && videos.length === 0) {
    const filtered = query.trim() !== '' || collectionId !== null;
    return (
      <div className="empty">
        <span className="emoji">{filtered ? '🔍' : '🎬'}</span>
        <h2>{filtered ? 'Sin resultados' : 'Tu videoteca está vacía'}</h2>
        <p>
          {filtered
            ? 'Prueba con otros términos o quita algún filtro. Pulsa ? en la barra superior para ver ejemplos de búsqueda.'
            : 'Pega enlaces de YouTube, TikTok, Instagram o cualquier otra plataforma y Videoteca se encargará de bajar la miniatura, leer los datos y etiquetar.'}
        </p>
        {!filtered && (
          <button type="button" className="btn btn-primary" onClick={onAdd}>
            + Añadir mis primeros vídeos
          </button>
        )}
        {filtered && (
          <button type="button" className="btn" onClick={() => void runQuery('')}>
            Limpiar la búsqueda
          </button>
        )}
      </div>
    );
  }

  if (layout === 'table') {
    return (
      <div style={{ padding: '0 0 40px' }}>
        <VideoTable
          videos={videos}
          selection={selection}
          fields={fields}
          sort={sort}
          onSort={(field: SortField) =>
            void setSort({ field, direction: sort.field === field && sort.direction === 'desc' ? 'asc' : 'desc' })
          }
          onSelect={handleSelect}
          onOpenDetail={openDetail}
          onContextMenu={contextMenu}
        />
        <div ref={sentinel} style={{ height: 1 }} />
        {loading && <p className="dim" style={{ textAlign: 'center', padding: 18 }}>Cargando…</p>}
      </div>
    );
  }

  if (layout === 'list') {
    return (
      <div className="grid-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {videos.map((video) => (
          <VideoRow
            key={video.id}
            video={video}
            selected={selection.has(video.id)}
            onSelect={(event) => handleSelect(video.id, event)}
            onOpenDetail={() => openDetail(video.id)}
            onContextMenu={(event) => contextMenu(video.id, event)}
          />
        ))}
        <div ref={sentinel} style={{ height: 1 }} />
        {loading && <p className="dim" style={{ textAlign: 'center', padding: 18 }}>Cargando…</p>}
        {!hasMore && videos.length > 0 && (
          <p className="dim" style={{ textAlign: 'center', padding: 18, fontSize: 12 }}>
            {total.toLocaleString('es-ES')} vídeos · fin de la lista
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid-wrap">
      <div
        className="video-grid"
        style={
          {
            '--card-size': `${cardSize}px`,
            gridAutoRows: layout === 'masonry' ? 'auto' : undefined,
            alignItems: layout === 'masonry' ? 'start' : 'stretch',
          } as React.CSSProperties
        }
      >
        {videos.map((video) => (
          <VideoCard
            key={video.id}
            video={video}
            selected={selection.has(video.id)}
            showTitle={settings.showTitles}
            showBadges={settings.showBadges}
            onSelect={(event) => handleSelect(video.id, event)}
            onOpenDetail={() => openDetail(video.id)}
            onPlay={() => play(video.id)}
            onToggleFavorite={() => {
              patchVideo(video.id, { favorite: !video.favorite });
              void api.videos.update(video.id, { favorite: !video.favorite });
            }}
            onToggleSelect={(event) => select(video.id, event.shiftKey ? 'range' : 'toggle')}
            onContextMenu={(event) => contextMenu(video.id, event)}
          />
        ))}
      </div>

      <div ref={sentinel} style={{ height: 1 }} />

      {loading && <p className="dim" style={{ textAlign: 'center', padding: 22 }}>Cargando…</p>}
      {!loading && !hasMore && videos.length > 0 && (
        <p className="dim" style={{ textAlign: 'center', padding: 22, fontSize: 12 }}>
          {total.toLocaleString('es-ES')} vídeos · has llegado al final
        </p>
      )}
    </div>
  );
}
