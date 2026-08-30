import { api } from '../api.ts';
import { useLibrary } from '../store/useLibrary.ts';
import { formatSize } from '../../shared/query/values.ts';
import type { DownloadJob } from '../../shared/types.ts';

const STATE_LABELS: Record<DownloadJob['state'], string> = {
  queued: 'En cola',
  downloading: 'Descargando',
  paused: 'Pausada',
  completed: 'Completada',
  failed: 'Con error',
  canceled: 'Cancelada',
};

const STATE_COLORS: Record<DownloadJob['state'], string> = {
  queued: 'var(--text-dim)',
  downloading: 'var(--accent)',
  paused: 'var(--warning)',
  completed: 'var(--success)',
  failed: 'var(--danger)',
  canceled: 'var(--text-dim)',
};

/** The download queue with live progress. */
export function DownloadsPanel() {
  const { downloads, openDetail } = useLibrary();
  const active = downloads.filter((job) => job.state === 'queued' || job.state === 'downloading');

  return (
    <div className="dashboard">
      <div className="row" style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Descargas</h1>
        <div className="spacer" />
        {active.length > 0 && (
          <button type="button" className="btn btn-sm btn-danger" onClick={() => void api.downloads.cancelAll()}>
            Cancelar todo
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={() => void api.downloads.clearFinished()}>
          Limpiar terminadas
        </button>
      </div>

      {downloads.length === 0 && (
        <div className="empty">
          <span className="emoji">⬇</span>
          <h2>No hay descargas</h2>
          <p>
            Selecciona vídeos y pulsa <strong>Descargar</strong> para guardar una copia local. Necesitas yt-dlp instalado
            (puedes instalarlo desde Ajustes con un clic).
          </p>
        </div>
      )}

      {downloads.map((job) => (
        <div key={job.id} className="panel" style={{ padding: '13px 15px', marginBottom: 9 }}>
          <div className="row" style={{ marginBottom: 7 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm truncate"
              style={{ flex: 1, justifyContent: 'flex-start', fontWeight: 550 }}
              onClick={() => openDetail(job.videoId)}
              title={job.title}
            >
              {job.title || job.url}
            </button>
            <span style={{ fontSize: 12, color: STATE_COLORS[job.state], whiteSpace: 'nowrap' }}>{STATE_LABELS[job.state]}</span>
          </div>

          {(job.state === 'downloading' || job.state === 'queued') && (
            <>
              <div className="progress-bar">
                <span style={{ width: `${Math.round(job.progress * 100)}%` }} />
              </div>
              <div className="row" style={{ marginTop: 6, fontSize: 11.5, color: 'var(--text-dim)', gap: 12 }}>
                <span>{Math.round(job.progress * 100)}%</span>
                {job.totalBytes && (
                  <span>
                    {formatSize(job.downloadedBytes)} / {formatSize(job.totalBytes)}
                  </span>
                )}
                {job.speed && <span>{job.speed}</span>}
                {job.eta && <span>quedan {job.eta}</span>}
              </div>
            </>
          )}

          {job.error && (
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--danger)', userSelect: 'text' }}>{job.error}</p>
          )}

          {job.outputPath && job.state === 'completed' && (
            <p className="dim mono truncate" style={{ margin: '4px 0 0' }} title={job.outputPath}>
              {job.outputPath}
            </p>
          )}

          <div className="row" style={{ marginTop: 8, gap: 6 }}>
            {(job.state === 'downloading' || job.state === 'queued') && (
              <button type="button" className="btn btn-sm" onClick={() => void api.downloads.cancel(job.id)}>
                Cancelar
              </button>
            )}
            {(job.state === 'failed' || job.state === 'canceled') && (
              <button type="button" className="btn btn-sm" onClick={() => void api.downloads.retry(job.id)}>
                Reintentar
              </button>
            )}
            {job.state === 'completed' && job.outputPath && (
              <button type="button" className="btn btn-sm" onClick={() => void api.library.revealPath(job.outputPath!)}>
                📂 Ver archivo
              </button>
            )}
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void api.downloads.remove(job.id)}>
              Quitar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
