import { useState } from 'react';
import { api } from '../api.ts';
import { useLibrary } from '../store/useLibrary.ts';

export interface BulkBarProps {
  onAddTags(): void;
  onSetField(): void;
  onAddToCollection(): void;
}

/** Floating action bar shown while videos are selected. */
export function BulkBar({ onAddTags, onSetField, onAddToCollection }: BulkBarProps) {
  const { selection, clearSelection, settings, refresh, toast } = useLibrary();
  const [busy, setBusy] = useState(false);
  const ids = [...selection];

  if (ids.length === 0) return null;

  const guard = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await refresh({ keepPage: true });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (settings.confirmDelete && !window.confirm(`¿Eliminar ${ids.length} vídeo(s) de la biblioteca?`)) return;
    const deleteFiles = ids.length > 0 && window.confirm('¿Enviar también los archivos descargados a la papelera?');
    await guard(async () => {
      await api.videos.remove(ids, deleteFiles);
      clearSelection();
    });
  };

  return (
    <div className="bulk-bar">
      <span className="bulk-count">{ids.length} seleccionados</span>

      <button type="button" className="btn btn-sm" disabled={busy} onClick={onAddTags} title="Añadir etiquetas">
        🏷 Etiquetar
      </button>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={onSetField} title="Asignar un campo personalizado">
        🧩 Campo
      </button>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={onAddToCollection} title="Añadir a una colección">
        📁 Colección
      </button>

      <button
        type="button"
        className="btn btn-sm"
        disabled={busy}
        title="Marcar como favorito"
        onClick={() => void guard(() => api.videos.updateMany(ids, { favorite: true }))}
      >
        ♥
      </button>
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy}
        title="Marcar como visto"
        onClick={() => void guard(() => api.videos.updateMany(ids, { watchStatus: 'watched' }))}
      >
        ✓ Visto
      </button>
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy}
        title="Volver a leer los metadatos desde la plataforma"
        onClick={() => void guard(() => api.videos.refresh(ids))}
      >
        ⟳ Actualizar
      </button>
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy}
        title="Generar etiquetas automáticas"
        onClick={() => void guard(() => api.tags.autoTag(ids))}
      >
        ✨ Auto-etiquetar
      </button>
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy}
        title="Descargar los vídeos seleccionados"
        onClick={() =>
          void guard(async () => {
            await api.downloads.enqueue(ids, settings.defaultDownloadFormat);
            toast('info', `${ids.length} vídeos añadidos a la cola de descarga.`);
          })
        }
      >
        ⬇ Descargar
      </button>

      <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void remove()}>
        🗑 Eliminar
      </button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={clearSelection} title="Cancelar selección (Esc)">
        ✕
      </button>
    </div>
  );
}
