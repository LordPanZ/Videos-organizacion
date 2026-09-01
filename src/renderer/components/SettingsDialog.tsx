import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useLibrary } from '../store/useLibrary.ts';
import { Modal } from './Modal.tsx';
import { ACCENT_COLORS, QUALITY_OPTIONS } from '../../shared/settings.ts';
import { formatSize } from '../../shared/query/values.ts';
import type { ToolStatus } from '../../shared/types.ts';

type Tab = 'apariencia' | 'importacion' | 'descargas' | 'herramientas' | 'datos';

const TABS: [Tab, string][] = [
  ['apariencia', '🎨 Apariencia'],
  ['importacion', '📥 Importación'],
  ['descargas', '⬇ Descargas'],
  ['herramientas', '🔧 Herramientas'],
  ['datos', '💾 Datos'],
];

/**
 * Which build is running, and a way out of a stale one.
 *
 * An installed web app keeps its own copy of the page, so a phone can sit on
 * an old build without any sign that it has. This says which one it is, and
 * clears the stored copy so the next start fetches the current one.
 */
function UpdateBlock() {
  const stamp = typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : null;
  if (stamp === null) return null;

  const refresh = async () => {
    if (!window.confirm('Se descargará la versión más reciente. Tus vídeos no se tocan. ¿Continuar?')) return;
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
      if ('caches' in window) {
        // Only the app's own files. The library lives in IndexedDB and is not
        // touched by any of this.
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.startsWith('videoteca-shell')).map((key) => caches.delete(key)));
      }
    } finally {
      window.location.reload();
    }
  };

  return (
    <div className="field" style={{ marginTop: 18 }}>
      <label>Versión instalada</label>
      <p className="dim" style={{ margin: '0 0 8px', fontSize: 12.5 }}>
        Compilada el {stamp} (UTC).
      </p>
      <button type="button" className="btn" onClick={() => void refresh()}>
        Buscar una versión más reciente
      </button>
    </div>
  );
}

export function SettingsDialog({ onClose }: { onClose(): void }) {
  const { settings, applySettings, toast } = useLibrary();
  const [tab, setTab] = useState<Tab>('apariencia');
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [usage, setUsage] = useState<{ database: number; thumbnails: number; downloads: number } | null>(null);
  const [installing, setInstalling] = useState(false);

  const loadTools = async () => setTools(await api.settings.tools());

  useEffect(() => {
    void loadTools();
    void api.library.diskUsage().then(setUsage);
  }, []);

  const ytdlp = tools.find((tool) => tool.name === 'yt-dlp');
  const ffmpeg = tools.find((tool) => tool.name === 'ffmpeg');

  return (
    <Modal title="Ajustes" onClose={onClose} wide>
      <div className="segmented" style={{ marginBottom: 18, width: '100%' }}>
        {TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            style={{ flex: 1, width: 'auto', padding: '0 10px', fontSize: 12.5 }}
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'apariencia' && (
        <>
          <div className="field">
            <label htmlFor="theme">Tema</label>
            <select
              id="theme"
              className="select"
              value={settings.theme}
              onChange={(event) => void applySettings({ theme: event.target.value as 'dark' | 'light' | 'system' })}
            >
              <option value="dark">Oscuro</option>
              <option value="light">Claro</option>
              <option value="system">Seguir al sistema</option>
            </select>
          </div>

          <div className="field">
            <label>Color de acento</label>
            <div className="row row-wrap" style={{ gap: 7 }}>
              {ACCENT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  title={color}
                  onClick={() => void applySettings({ accentColor: color })}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: color,
                    border: settings.accentColor === color ? '2px solid var(--text)' : '2px solid transparent',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
          </div>

          <label className="switch">
            <input type="checkbox" checked={settings.showTitles} onChange={(event) => void applySettings({ showTitles: event.target.checked })} />
            <span>Mostrar títulos bajo las miniaturas</span>
          </label>
          <label className="switch">
            <input type="checkbox" checked={settings.showBadges} onChange={(event) => void applySettings({ showBadges: event.target.checked })} />
            <span>Mostrar distintivo de plataforma sobre la miniatura</span>
          </label>
          <label className="switch">
            <input type="checkbox" checked={settings.confirmDelete} onChange={(event) => void applySettings({ confirmDelete: event.target.checked })} />
            <span>Pedir confirmación antes de eliminar</span>
          </label>
        </>
      )}

      {tab === 'importacion' && (
        <>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.autoFetchMetadata}
              onChange={(event) => void applySettings({ autoFetchMetadata: event.target.checked })}
            />
            <span>Descargar metadatos automáticamente al añadir</span>
          </label>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.autoTagOnImport}
              onChange={(event) => void applySettings({ autoTagOnImport: event.target.checked })}
            />
            <span>Generar etiquetas automáticas al importar</span>
          </label>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.autoDownloadThumbnails}
              onChange={(event) => void applySettings({ autoDownloadThumbnails: event.target.checked })}
            />
            <span>Guardar las miniaturas en local (recomendado)</span>
          </label>

          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="meta-concurrency">Descargas de metadatos en paralelo</label>
            <input
              id="meta-concurrency"
              className="input"
              type="number"
              min={1}
              max={12}
              value={settings.maxConcurrentMetadata}
              onChange={(event) => void applySettings({ maxConcurrentMetadata: Number(event.target.value) })}
            />
            <span className="hint">Más paralelismo va más rápido, pero algunas plataformas limitan las peticiones.</span>
          </div>
        </>
      )}

      {tab === 'descargas' && (
        <>
          <div className="field">
            <label>Carpeta de descargas</label>
            <div className="row">
              <input className="input mono" readOnly value={settings.downloadPath} />
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  const picked = await api.settings.pickFolder(settings.downloadPath);
                  if (picked) await applySettings({ downloadPath: picked });
                }}
              >
                Cambiar…
              </button>
            </div>
          </div>

          <div className="field">
            <label htmlFor="quality">Calidad predeterminada</label>
            <select
              id="quality"
              className="select"
              value={settings.defaultDownloadFormat.quality}
              onChange={(event) =>
                void applySettings({
                  defaultDownloadFormat: { ...settings.defaultDownloadFormat, quality: event.target.value },
                })
              }
            >
              {QUALITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <label className="switch">
            <input
              type="checkbox"
              checked={settings.defaultDownloadFormat.audioOnly}
              onChange={(event) =>
                void applySettings({
                  defaultDownloadFormat: { ...settings.defaultDownloadFormat, audioOnly: event.target.checked },
                })
              }
            />
            <span>Descargar solo el audio</span>
          </label>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.defaultDownloadFormat.embedThumbnail}
              onChange={(event) =>
                void applySettings({
                  defaultDownloadFormat: { ...settings.defaultDownloadFormat, embedThumbnail: event.target.checked },
                })
              }
            />
            <span>Incrustar la miniatura en el archivo</span>
          </label>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.defaultDownloadFormat.embedSubtitles}
              onChange={(event) =>
                void applySettings({
                  defaultDownloadFormat: { ...settings.defaultDownloadFormat, embedSubtitles: event.target.checked },
                })
              }
            />
            <span>Incrustar subtítulos (es, en)</span>
          </label>

          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="dl-concurrency">Descargas simultáneas</label>
            <input
              id="dl-concurrency"
              className="input"
              type="number"
              min={1}
              max={6}
              value={settings.maxConcurrentDownloads}
              onChange={(event) => void applySettings({ maxConcurrentDownloads: Number(event.target.value) })}
            />
          </div>
        </>
      )}

      {tab === 'herramientas' && (
        <>
          <p className="muted" style={{ marginTop: 0, fontSize: 13, lineHeight: 1.6 }}>
            Videoteca funciona sin nada instalado: lee títulos, autores y miniaturas por sí sola. Con <strong>yt-dlp</strong>{' '}
            obtiene metadatos completos de más de mil sitios y puede descargar los vídeos; <strong>ffmpeg</strong> permite
            unir vídeo y audio en máxima calidad.
          </p>

          {tools.map((tool) => (
            <div key={tool.name} className="panel" style={{ padding: '13px 15px', marginBottom: 10 }}>
              <div className="row">
                <strong style={{ fontSize: 13.5 }}>{tool.name}</strong>
                <span style={{ fontSize: 12, color: tool.available ? 'var(--success)' : 'var(--text-dim)' }}>
                  {tool.available ? '✓ disponible' : '— no encontrado'}
                </span>
                <div className="spacer" />
                {tool.name === 'yt-dlp' && (
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={installing}
                    onClick={async () => {
                      setInstalling(true);
                      try {
                        await api.settings.installYtdlp();
                        await loadTools();
                      } catch {
                        /* the error was already reported as a toast */
                      } finally {
                        setInstalling(false);
                      }
                    }}
                  >
                    {installing ? 'Instalando…' : tool.available ? 'Reinstalar' : 'Instalar ahora'}
                  </button>
                )}
              </div>
              {tool.version && (
                <p className="dim mono truncate" style={{ margin: '5px 0 0' }}>
                  {tool.version}
                </p>
              )}
              {tool.path && (
                <p className="dim mono truncate" style={{ margin: '2px 0 0' }} title={tool.path}>
                  {tool.path}
                </p>
              )}
            </div>
          ))}

          {!ffmpeg?.available && (
            <p className="dim" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
              ffmpeg no se instala automáticamente. En Windows: <span className="mono">winget install ffmpeg</span>. En macOS:{' '}
              <span className="mono">brew install ffmpeg</span>. En Linux, con el gestor de paquetes de tu distribución.
            </p>
          )}
          {!ytdlp?.available && (
            <p className="dim" style={{ fontSize: 12.5 }}>
              Sin yt-dlp seguirás pudiendo guardar y organizar vídeos, pero no descargarlos.
            </p>
          )}
        </>
      )}

      {tab === 'datos' && (
        <>
          <div className="field">
            <label>Carpeta de la biblioteca</label>
            <input className="input mono" readOnly value={settings.libraryPath} />
            <span className="hint">Aquí viven la base de datos, las miniaturas y las copias de seguridad.</span>
          </div>

          {usage && (
            <dl className="meta-grid" style={{ maxWidth: 360, marginBottom: 18 }}>
              <dt>Base de datos</dt>
              <dd>{formatSize(usage.database)}</dd>
              <dt>Miniaturas</dt>
              <dd>{formatSize(usage.thumbnails)}</dd>
              <dt>Vídeos descargados</dt>
              <dd>{formatSize(usage.downloads)}</dd>
            </dl>
          )}

          <div className="row row-wrap" style={{ gap: 8 }}>
            <button type="button" className="btn" onClick={() => void api.library.export({ format: 'json' })}>
              Exportar todo (JSON)
            </button>
            <button type="button" className="btn" onClick={() => void api.library.export({ format: 'html' })}>
              Exportar como página web
            </button>
            <button type="button" className="btn" onClick={() => void api.library.export({ format: 'csv' })}>
              Exportar CSV
            </button>
            <button type="button" className="btn" onClick={() => void api.library.import()}>
              Importar biblioteca…
            </button>
          </div>

          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '18px 0' }} />

          <div className="row row-wrap" style={{ gap: 8 }}>
            <button type="button" className="btn" onClick={() => void api.library.backup()}>
              Crear copia de seguridad
            </button>
            <button type="button" className="btn" onClick={() => void api.library.optimize()}>
              Optimizar base de datos
            </button>
            <button type="button" className="btn" onClick={() => void api.library.reindex()}>
              Reconstruir índice de búsqueda
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={async () => {
                if (!window.confirm('Se borrarán las miniaturas guardadas. Se volverán a descargar cuando haga falta. ¿Continuar?')) return;
                await api.library.clearThumbnails();
                toast('success', 'Caché vaciada.');
                setUsage(await api.library.diskUsage());
              }}
            >
              Vaciar caché de miniaturas
            </button>

            <UpdateBlock />
          </div>
        </>
      )}
    </Modal>
  );
}
