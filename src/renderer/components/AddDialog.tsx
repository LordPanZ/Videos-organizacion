import { useState } from 'react';
import { api } from '../api.ts';
import { useLibrary } from '../store/useLibrary.ts';
import { Modal } from './Modal.tsx';
import { TagPicker } from './TagPicker.tsx';
import { extractUrls, parseVideoUrl } from '../../core/platforms/detect.ts';
import { PLATFORM_LABELS, type Tag } from '../../shared/types.ts';

export interface AddDialogProps {
  onClose(): void;
  initialText?: string;
}

type Mode = 'urls' | 'playlist' | 'folder';

/** Every way to get videos into the library, in one dialog. */
export function AddDialog({ onClose, initialText = '' }: AddDialogProps) {
  const { collections, tags, reloadMeta, refresh, toast } = useLibrary();
  const [mode, setMode] = useState<Mode>('urls');
  const [text, setText] = useState(initialText);
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [playlistLimit, setPlaylistLimit] = useState(100);
  const [folder, setFolder] = useState('');
  const [recursive, setRecursive] = useState(true);
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [collectionId, setCollectionId] = useState('');
  const [busy, setBusy] = useState(false);

  const urls = extractUrls(text);
  // A bare line that is not a URL still counts if it looks like a file path.
  const paths = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/^https?:\/\//i.test(line) && /^([a-zA-Z]:\\|\/|file:\/\/)/.test(line));
  const candidates = [...urls, ...paths];

  const summary = (() => {
    const counts = new Map<string, number>();
    for (const url of urls) {
      const { platform } = parseVideoUrl(url);
      counts.set(platform, (counts.get(platform) ?? 0) + 1);
    }
    return [...counts.entries()].map(([platform, count]) => `${PLATFORM_LABELS[platform as never] ?? platform}: ${count}`);
  })();

  const run = async () => {
    setBusy(true);
    try {
      const shared = {
        tagIds: selectedTags.map((tag) => tag.id),
        collectionId: collectionId || undefined,
      };

      if (mode === 'urls') {
        if (candidates.length === 0) {
          toast('error', 'Pega al menos un enlace o una ruta de archivo.');
          return;
        }
        await api.import.urls({ urls: candidates, ...shared });
      } else if (mode === 'playlist') {
        if (!playlistUrl.trim()) {
          toast('error', 'Escribe la dirección de la lista o el canal.');
          return;
        }
        await api.import.playlist(playlistUrl.trim(), playlistLimit, collectionId || undefined);
      } else {
        if (!folder) {
          toast('error', 'Elige una carpeta.');
          return;
        }
        await api.import.scanFolder({ folder, recursive, ...shared });
      }

      await Promise.all([refresh(), reloadMeta()]);
      onClose();
    } catch {
      // The main process already surfaced the reason as a toast.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Añadir vídeos"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={busy}>
            {busy ? 'Importando…' : 'Añadir a la biblioteca'}
          </button>
        </>
      }
    >
      <div className="segmented" style={{ marginBottom: 16, width: '100%' }}>
        {(
          [
            ['urls', '🔗 Enlaces'],
            ['playlist', '📃 Lista o canal'],
            ['folder', '📂 Carpeta local'],
          ] as [Mode, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            style={{ flex: 1, width: 'auto', padding: '0 12px', fontSize: 13 }}
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'urls' && (
        <div className="field">
          <label htmlFor="add-urls">Pega uno o varios enlaces, uno por línea</label>
          <textarea
            id="add-urls"
            className="textarea"
            style={{ minHeight: 168 }}
            autoFocus
            value={text}
            placeholder={'https://www.youtube.com/watch?v=…\nhttps://www.tiktok.com/@usuario/video/…\nhttps://www.instagram.com/reel/…'}
            onChange={(event) => setText(event.target.value)}
          />
          <span className="hint">
            {candidates.length > 0
              ? `${candidates.length} elemento(s) detectados${summary.length ? ` · ${summary.join(' · ')}` : ''}`
              : 'También acepta rutas de archivos locales.'}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            style={{ alignSelf: 'flex-start', marginTop: 4 }}
            onClick={async () => {
              const clip = await navigator.clipboard.readText();
              setText((current) => `${current}\n${clip}`.trim());
            }}
          >
            📋 Pegar del portapapeles
          </button>
        </div>
      )}

      {mode === 'playlist' && (
        <>
          <div className="field">
            <label htmlFor="add-playlist">Dirección de la lista, canal o perfil</label>
            <input
              id="add-playlist"
              className="input"
              autoFocus
              value={playlistUrl}
              placeholder="https://www.youtube.com/@canal o .../playlist?list=…"
              onChange={(event) => setPlaylistUrl(event.target.value)}
            />
            <span className="hint">Necesita yt-dlp instalado. Se creará una colección con el nombre de la lista.</span>
          </div>
          <div className="field">
            <label htmlFor="add-limit">Máximo de vídeos a importar</label>
            <input
              id="add-limit"
              className="input"
              type="number"
              min={1}
              max={5000}
              value={playlistLimit}
              onChange={(event) => setPlaylistLimit(Number(event.target.value))}
            />
          </div>
        </>
      )}

      {mode === 'folder' && (
        <>
          <div className="field">
            <label>Carpeta con vídeos</label>
            <div className="row">
              <input className="input" readOnly value={folder} placeholder="Ninguna carpeta seleccionada" />
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  const picked = await api.import.pickFolder();
                  if (picked) setFolder(picked);
                }}
              >
                Elegir…
              </button>
            </div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={recursive} onChange={(event) => setRecursive(event.target.checked)} />
            <span>Incluir subcarpetas</span>
          </label>
        </>
      )}

      <div className="field" style={{ marginTop: 16 }}>
        <label>Etiquetas para todo lo importado</label>
        <TagPicker
          selected={selectedTags}
          onChange={(ids) => setSelectedTags(ids.map((id) => tags.find((tag) => tag.id === id)!).filter(Boolean))}
        />
      </div>

      <div className="field">
        <label htmlFor="add-collection">Añadir a la colección</label>
        <select id="add-collection" className="select" value={collectionId} onChange={(event) => setCollectionId(event.target.value)}>
          <option value="">— ninguna —</option>
          {collections
            .filter((collection) => collection.kind === 'manual')
            .map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name}
              </option>
            ))}
        </select>
      </div>
    </Modal>
  );
}
