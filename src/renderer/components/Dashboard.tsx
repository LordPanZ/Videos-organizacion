import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useLibrary } from '../store/useLibrary.ts';
import { formatCount, formatDurationLong, formatRelative, formatSize } from '../../shared/query/values.ts';
import type { FacetValue, LibraryStats } from '../../shared/types.ts';

function StatCard({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div className="stat-card" title={hint}>
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

function BarList({ items, onPick }: { items: FacetValue[]; onPick(item: FacetValue): void }) {
  const max = Math.max(1, ...items.map((item) => item.count));
  if (items.length === 0) return <p className="dim" style={{ margin: 0, fontSize: 13 }}>Sin datos todavía.</p>;

  return (
    <>
      {items.map((item) => (
        <div
          key={item.value}
          className="bar-row"
          style={{ cursor: 'pointer' }}
          onClick={() => onPick(item)}
          title={`Ver los ${item.count} vídeos`}
        >
          <span className="truncate">{item.label}</span>
          <span className="bar-track">
            <span style={{ width: `${(item.count / max) * 100}%`, background: item.color ?? 'var(--accent)' }} />
          </span>
          <span className="count">{item.count}</span>
        </div>
      ))}
    </>
  );
}

/** Overview of the whole library: totals, distributions and growth. */
export function Dashboard() {
  const { runQuery, setScreen } = useLibrary();
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [usage, setUsage] = useState<{ database: number; thumbnails: number; downloads: number } | null>(null);

  useEffect(() => {
    void (async () => {
      const [loaded, disk] = await Promise.all([api.videos.stats(), api.library.diskUsage()]);
      setStats(loaded);
      setUsage(disk);
    })();
  }, []);

  const go = (query: string) => {
    void runQuery(query);
    setScreen('library');
  };

  if (!stats) return <div className="empty">Cargando estadísticas…</div>;

  const maxMonth = Math.max(1, ...stats.byMonth.map((month) => month.count));

  return (
    <div className="dashboard">
      <h1 style={{ fontSize: 20, margin: '0 0 18px' }}>Tu biblioteca en números</h1>

      <div className="stat-grid">
        <StatCard value={stats.totalVideos.toLocaleString('es-ES')} label="Vídeos guardados" />
        <StatCard value={formatDurationLong(stats.totalDuration)} label="Duración total" hint="Suma de todos los vídeos con duración conocida" />
        <StatCard value={formatDurationLong(stats.averageDuration)} label="Duración media" />
        <StatCard value={stats.totalDownloaded.toLocaleString('es-ES')} label="Descargados" />
        <StatCard value={formatSize(stats.totalDiskBytes)} label="Espacio en disco" />
        <StatCard value={stats.favorites.toLocaleString('es-ES')} label="Favoritos" />
        <StatCard value={stats.untagged.toLocaleString('es-ES')} label="Sin etiquetas" />
        <StatCard value={stats.newestAddedAt ? formatRelative(stats.newestAddedAt) : '—'} label="Última incorporación" />
      </div>

      <div className="row row-wrap" style={{ gap: 8, marginBottom: 20 }}>
        {stats.untagged > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => go('is:sinetiquetas')}>
            🏷 Revisar {stats.untagged} sin etiquetas
          </button>
        )}
        {stats.unavailable > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => go('is:nodisponible')}>
            ⚠ {stats.unavailable} enlaces con problemas
          </button>
        )}
        {stats.duplicates > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => setScreen('duplicates')}>
            🔁 {stats.duplicates} posibles duplicados
          </button>
        )}
      </div>

      {stats.byMonth.length > 0 && (
        <div className="panel">
          <h3>Vídeos añadidos por mes</h3>
          <div className="spark">
            {stats.byMonth.map((month) => (
              <div
                key={month.month}
                style={{ height: `${(month.count / maxMonth) * 100}%` }}
                title={`${month.month}: ${month.count} vídeos`}
              />
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 7, fontSize: 11.5, color: 'var(--text-dim)' }}>
            <span>{stats.byMonth[0]?.month}</span>
            <span>{stats.byMonth[stats.byMonth.length - 1]?.month}</span>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div className="panel">
          <h3>Por plataforma</h3>
          <BarList items={stats.byPlatform} onPick={(item) => go(`platform:${item.value}`)} />
        </div>

        <div className="panel">
          <h3>Etiquetas más usadas</h3>
          <BarList items={stats.byTag} onPick={(item) => go(`tag:${item.value}`)} />
        </div>

        <div className="panel">
          <h3>Creadores más guardados</h3>
          <BarList items={stats.byAuthor} onPick={(item) => go(`author:"${item.label}"`)} />
        </div>

        <div className="panel">
          <h3>Valoraciones</h3>
          <BarList items={stats.byRating} onPick={(item) => go(`rating:${item.value}`)} />
        </div>
      </div>

      {usage && (
        <div className="panel">
          <h3>Uso de disco</h3>
          <dl className="meta-grid" style={{ maxWidth: 380 }}>
            <dt>Base de datos</dt>
            <dd>{formatSize(usage.database)}</dd>
            <dt>Miniaturas en caché</dt>
            <dd>{formatSize(usage.thumbnails)}</dd>
            <dt>Vídeos descargados</dt>
            <dd>{formatSize(usage.downloads)}</dd>
          </dl>
          <p className="dim" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
            {formatCount(stats.totalVideos)} registros indexados para búsqueda instantánea.
          </p>
        </div>
      )}
    </div>
  );
}
