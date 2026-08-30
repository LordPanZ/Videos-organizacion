import { useEffect, useState } from 'react';
import { api, thumbnailSrc } from '../api.ts';
import { useLibrary } from '../store/useLibrary.ts';
import { formatDate, formatDuration } from '../../shared/query/values.ts';
import { PLATFORM_LABELS, type DuplicateGroup } from '../../shared/types.ts';

const REASONS: Record<DuplicateGroup['reason'], string> = {
  'same-url': 'Misma dirección',
  'same-platform-id': 'Mismo vídeo en la plataforma',
  'same-title-author': 'Mismo título y autor',
};

/** Groups of probable duplicates, with a one-click way to keep the best copy. */
export function DuplicatesView() {
  const { refresh, openDetail, toast } = useLibrary();
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);

  const load = async () => setGroups(await api.videos.duplicates());

  useEffect(() => {
    void load();
  }, []);

  if (groups === null) return <div className="empty">Buscando duplicados…</div>;

  if (groups.length === 0) {
    return (
      <div className="empty">
        <span className="emoji">✨</span>
        <h2>Sin duplicados</h2>
        <p>No hay vídeos repetidos en tu biblioteca.</p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <h1 style={{ fontSize: 20, margin: '0 0 6px' }}>Duplicados</h1>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        {groups.length} grupo(s). «Conservar este» elimina el resto del grupo de la biblioteca; los archivos descargados no
        se tocan.
      </p>

      {groups.map((group) => (
        <div key={group.key} className="panel">
          <h3 style={{ marginBottom: 10 }}>
            {REASONS[group.reason]} · {group.videos.length} copias
          </h3>

          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
            {group.videos.map((video) => {
              const source = thumbnailSrc(video);
              return (
                <div key={video.id} className="card" style={{ cursor: 'default' }}>
                  <div className="card-thumb" onClick={() => openDetail(video.id)} style={{ cursor: 'pointer' }}>
                    {source ? <img src={source} alt="" loading="lazy" /> : <div className="placeholder">🎬</div>}
                    {video.durationSeconds !== null && <span className="card-duration">{formatDuration(video.durationSeconds)}</span>}
                  </div>
                  <div className="card-body">
                    <div className="card-title">{video.title}</div>
                    <div className="card-meta">
                      <span>{PLATFORM_LABELS[video.platform]}</span>
                      <span>· {formatDate(video.addedAt)}</span>
                    </div>
                    <div className="row" style={{ gap: 5, marginTop: 4, fontSize: 11.5, color: 'var(--text-dim)' }}>
                      {video.rating > 0 && <span style={{ color: 'var(--warning)' }}>{'★'.repeat(video.rating)}</span>}
                      {video.tags.length > 0 && <span>{video.tags.length} etiquetas</span>}
                      {video.filePath && <span>💾</span>}
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ marginTop: 8 }}
                      onClick={async () => {
                        const others = group.videos.filter((item) => item.id !== video.id).map((item) => item.id);
                        if (others.length === 0) return;
                        await api.videos.remove(others, false);
                        toast('success', `${others.length} copia(s) eliminadas.`);
                        await Promise.all([load(), refresh({ keepPage: true })]);
                      }}
                    >
                      Conservar este
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
