import { useEffect, useMemo, useRef, useState } from 'react';
import { api, mediaUrl, thumbnailSrc } from '../api.ts';
import { useLibrary } from '../store/useLibrary.ts';
import { embedUrl, parseVideoUrl } from '../../core/platforms/detect.ts';
import { formatCount, formatDate, formatDuration, formatRelative, formatSize } from '../../shared/query/values.ts';
import { CustomFieldEditor } from './CustomFieldEditor.tsx';
import { hasCustomCover, imageFromClipboard, pickImage, prepareCover } from '../covers.ts';
import { TagPicker } from './TagPicker.tsx';
import { PLATFORM_COLORS, PLATFORM_LABELS, type Collection, type Video, type VideoBookmark } from '../../shared/types.ts';

function Stars({ value, onChange }: { value: number; onChange(next: number): void }) {
  return (
    <span className="stars">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          data-on={star <= value}
          title={`${star} de 5`}
          onClick={() => onChange(star === value ? 0 : star)}
        >
          ★
        </button>
      ))}
    </span>
  );
}

/** Keeps the box exactly as tall as the text inside it. */
function grow(node: HTMLTextAreaElement): void {
  node.style.height = 'auto';
  node.style.height = `${node.scrollHeight}px`;
}

/**
 * The title doubles as its own editor.
 *
 * Instagram — and any platform that will not hand over its metadata — leaves a
 * video named after its id, which says nothing about what is in it. Renaming
 * has to be one tap away, right where the name is shown.
 */
function EditableTitle({ value, onSave }: { value: string; onSave(next: string): void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const field = useRef<HTMLTextAreaElement | null>(null);

  // A different video, or a rename made elsewhere, replaces what is shown.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    const node = field.current;
    if (!editing || !node) return;
    node.focus();
    node.select();
    grow(node);
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    // An empty name would leave the video unidentifiable, so it stays as it was.
    if (!next || next === value) {
      setDraft(value);
      return;
    }
    onSave(next);
  };

  if (!editing) {
    return (
      <h2 className="detail-title editable" title="Pulsa para cambiar el título" onClick={() => setEditing(true)}>
        {value}
        <span className="edit-hint" aria-hidden="true">
          ✎
        </span>
      </h2>
    );
  }

  return (
    <textarea
      ref={field}
      className="detail-title title-input"
      value={draft}
      rows={1}
      aria-label="Título del vídeo"
      onChange={(event) => {
        setDraft(event.target.value);
        grow(event.target);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
        if (event.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
    />
  );
}

/** In-app playback: local file, platform embed, or the thumbnail as a poster. */
function Player({ video }: { video: Video }) {
  const [mode, setMode] = useState<'poster' | 'playing'>('poster');
  const parsed = useMemo(() => parseVideoUrl(video.url), [video.url]);
  const embed = video.filePath ? null : embedUrl(video.platform, parsed.id, parsed.canonicalUrl);
  const localSrc = mediaUrl('file', video.filePath);
  const poster = thumbnailSrc(video);

  useEffect(() => setMode('poster'), [video.id]);

  if (mode === 'playing' && localSrc) {
    return (
      <div className="detail-player">
        <video src={localSrc} controls autoPlay />
      </div>
    );
  }

  if (mode === 'playing' && embed) {
    return (
      <div className="detail-player">
        <iframe src={embed} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen title={video.title} />
      </div>
    );
  }

  return (
    <div className="detail-player">
      {poster ? <img src={poster} alt="" /> : <div style={{ height: '100%', display: 'grid', placeItems: 'center', fontSize: 34 }}>🎬</div>}
      <button
        type="button"
        className="card-play"
        style={{ opacity: 1, border: 0, cursor: 'pointer', width: '100%' }}
        title={localSrc || embed ? 'Reproducir aquí' : 'Abrir en el navegador'}
        onClick={() => {
          if (localSrc || embed) setMode('playing');
          else void api.library.openExternal(video.url);
        }}
      >
        <span>▶</span>
      </button>
    </div>
  );
}

export interface DetailPanelProps {
  videoId: string;
  onClose(): void;
}

/** Everything about one video, and every way to change it. */
export function DetailPanel({ videoId, onClose }: DetailPanelProps) {
  const { fields, patchVideo, refresh, toast, settings, containerUnlocked } = useLibrary();
  const [video, setVideo] = useState<Video | null>(null);
  const [bookmarks, setBookmarks] = useState<VideoBookmark[]>([]);
  const [inCollections, setInCollections] = useState<Collection[]>([]);
  const [notes, setNotes] = useState('');
  const [showDescription, setShowDescription] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [loaded, marks, cols] = await Promise.all([
        api.videos.get(videoId),
        api.bookmarks.forVideo(videoId),
        api.collections.forVideo(videoId),
      ]);
      if (cancelled) return;
      setVideo(loaded);
      setBookmarks(marks);
      setInCollections(cols);
      setNotes(loaded?.notes ?? '');
      setShowDescription(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  /**
   * Stores an image as this video's cover, scaling it down first.
   *
   * Declared before the early return below, because the paste listener that
   * uses it is a hook: React requires every hook to run in the same order on
   * every render, and one placed after a conditional return does not.
   */
  const setCover = async (source: File | Blob | null) => {
    if (!video) return;
    try {
      const dataUrl = source === null ? null : (await prepareCover(source)).dataUrl;
      const updated = await api.videos.setCover(video.id, dataUrl);
      if (updated) {
        setVideo(updated);
        patchVideo(updated.id, updated);
      }
      toast('success', source === null ? 'Miniatura quitada.' : 'Miniatura actualizada.');
    } catch (error) {
      toast('error', (error as Error).message);
    }
  };

  // Copy a screenshot, open the video, paste. Only while this panel is open,
  // and never while the caret is in a text field.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      const image = imageFromClipboard(event);
      if (!image) return;
      event.preventDefault();
      void setCover(image);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  if (!video) {
    return (
      <aside className="detail">
        <div className="detail-header">
          <strong>Cargando…</strong>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose}>
            ✕
          </button>
        </div>
      </aside>
    );
  }

  const attachCover = async () => {
    const file = await pickImage();
    if (file) await setCover(file);
  };

  /** Applies a change locally first, then persists it. */
  const update = async (patch: Partial<Video>) => {
    setVideo((current) => (current ? { ...current, ...patch } : current));
    patchVideo(video.id, patch);
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    await api.videos.update(video.id, patch as any);
  };

  const reloadTags = async () => {
    const fresh = await api.videos.get(video.id);
    if (fresh) {
      setVideo(fresh);
      patchVideo(fresh.id, fresh);
    }
  };

  return (
    <aside className="detail">
      <div className="detail-header">
        <div className="row" style={{ gap: 6, minWidth: 0 }}>
          <i className="dot" style={{ background: PLATFORM_COLORS[video.platform], width: 8, height: 8, borderRadius: 999 }} />
          <span className="truncate" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            {PLATFORM_LABELS[video.platform]}
          </span>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            title={video.favorite ? 'Quitar de favoritos' : 'Marcar como favorito'}
            style={{ color: video.favorite ? 'var(--danger)' : undefined }}
            onClick={() => void update({ favorite: !video.favorite })}
          >
            {video.favorite ? '♥' : '♡'}
          </button>
          <button type="button" className="btn btn-ghost btn-icon" title="Cerrar (Esc)" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      <div className="detail-scroll">
        <Player video={video} />

        <EditableTitle value={video.title} onSave={(title) => void update({ title })} />

        {video.author && (
          <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
            {video.author.name}
            {video.author.handle && <span className="dim"> · {video.author.handle}</span>}
          </p>
        )}

        <div className="row row-wrap" style={{ gap: 6, marginBottom: 12 }}>
          <button type="button" className="btn btn-sm" onClick={() => void api.videos.open(video.id)}>
            ▶ Abrir
          </button>
          <button
            type="button"
            className="btn btn-sm"
            title="Copiar el enlace"
            onClick={() => {
              void navigator.clipboard.writeText(video.url);
              toast('success', 'Enlace copiado.');
            }}
          >
            🔗 Copiar
          </button>
          {video.filePath ? (
            <button type="button" className="btn btn-sm" onClick={() => void api.videos.openFolder(video.id)}>
              📂 Carpeta
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-sm"
              title="Descargar una copia local"
              onClick={() => void api.downloads.enqueue([video.id], settings.defaultDownloadFormat)}
            >
              ⬇ Descargar
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm"
            title="Volver a leer los metadatos"
            onClick={() => void api.videos.refresh([video.id]).then(reloadTags)}
          >
            ⟳
          </button>
        </div>

        <div className="row row-wrap" style={{ gap: 6, marginBottom: 14 }}>
          {/* Only offered once the container is open, so the option never
              hints at itself to someone who has not unlocked it. */}
          {containerUnlocked && (
            <button
              type="button"
              className="btn btn-sm"
              title={
                video.hidden
                  ? 'Devolverlo a la biblioteca, donde vuelve a verse'
                  : 'Guardarlo en el contenedor, fuera de la portada y de las búsquedas'
              }
              onClick={() => void update({ hidden: !video.hidden })}
            >
              {video.hidden ? '🔓 Sacar del contenedor' : '🔒 Guardar en el contenedor'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm"
            title="Usar una imagen tuya como miniatura"
            onClick={() => void attachCover()}
          >
            🖼 {hasCustomCover(video) ? 'Cambiar miniatura' : 'Poner miniatura'}
          </button>
          {hasCustomCover(video) && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              title="Volver a la miniatura original"
              onClick={() => void setCover(null)}
            >
              Quitar
            </button>
          )}
        </div>

        <div className="detail-section">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <Stars value={video.rating} onChange={(rating) => void update({ rating })} />
            <select
              className="select"
              style={{ width: 'auto', padding: '4px 8px' }}
              value={video.watchStatus}
              onChange={(event) => void update({ watchStatus: event.target.value as Video['watchStatus'] })}
            >
              <option value="unwatched">Sin ver</option>
              <option value="in_progress">Viendo</option>
              <option value="watched">Visto</option>
            </select>
          </div>
        </div>

        <div className="detail-section">
          <h3>
            Etiquetas <span className="dim">{video.tags.length}</span>
          </h3>
          <TagPicker
            selected={video.tags}
            onChange={async (tagIds) => {
              await api.videos.setTags(video.id, tagIds);
              await reloadTags();
            }}
          />
        </div>

        {fields.length > 0 && (
          <div className="detail-section">
            <h3>Campos personalizados</h3>
            {fields.map((field) => (
              <CustomFieldEditor
                key={field.id}
                field={field}
                value={video.customFields[field.key] ?? null}
                onChange={async (value) => {
                  await api.videos.setCustomField([video.id], field.key, value);
                  await reloadTags();
                }}
              />
            ))}
          </div>
        )}

        <div className="detail-section">
          <h3>Notas</h3>
          <textarea
            className="textarea"
            value={notes}
            placeholder="Tus apuntes sobre este vídeo…"
            onChange={(event) => setNotes(event.target.value)}
            onBlur={() => {
              if (notes !== (video.notes ?? '')) void update({ notes: notes || null });
            }}
          />
        </div>

        <div className="detail-section">
          <h3>
            Marcadores
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              title="Añadir un marcador en un momento del vídeo"
              onClick={async () => {
                const answer = window.prompt('Momento del vídeo (mm:ss) y nombre, por ejemplo "12:30 Receta base"');
                if (!answer) return;
                const match = /^(\d+):(\d{1,2})\s*(.*)$/.exec(answer.trim());
                const seconds = match ? Number(match[1]) * 60 + Number(match[2]) : Number(answer);
                if (!Number.isFinite(seconds)) return;
                const created = await api.bookmarks.create(video.id, seconds, match?.[3] || 'Marcador');
                setBookmarks((list) => [...list, created].sort((a, b) => a.timeSeconds - b.timeSeconds));
              }}
            >
              +
            </button>
          </h3>
          {bookmarks.length === 0 && <p className="dim" style={{ margin: 0, fontSize: 12.5 }}>Sin marcadores.</p>}
          {bookmarks.map((bookmark) => (
            <div key={bookmark.id} className="row" style={{ padding: '3px 0', fontSize: 13 }}>
              <span className="mono" style={{ color: 'var(--accent)' }}>
                {formatDuration(bookmark.timeSeconds)}
              </span>
              <span className="truncate" style={{ flex: 1 }}>
                {bookmark.label}
              </span>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                title="Eliminar marcador"
                onClick={async () => {
                  await api.bookmarks.remove(bookmark.id);
                  setBookmarks((list) => list.filter((item) => item.id !== bookmark.id));
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {inCollections.length > 0 && (
          <div className="detail-section">
            <h3>Colecciones</h3>
            <div className="row row-wrap" style={{ gap: 5 }}>
              {inCollections.map((collection) => (
                <span key={collection.id} className="chip">
                  <span className="chip-label">{collection.name}</span>
                  <button
                    type="button"
                    title="Quitar de la colección"
                    onClick={async () => {
                      await api.collections.removeVideos(collection.id, [video.id]);
                      setInCollections((list) => list.filter((item) => item.id !== collection.id));
                    }}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {video.description && (
          <div className="detail-section">
            <h3>
              Descripción
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowDescription((value) => !value)}>
                {showDescription ? 'Ocultar' : 'Mostrar'}
              </button>
            </h3>
            {showDescription && (
              <p style={{ margin: 0, fontSize: 12.5, whiteSpace: 'pre-wrap', color: 'var(--text-muted)', userSelect: 'text' }}>
                {video.description}
              </p>
            )}
          </div>
        )}

        <div className="detail-section">
          <h3>Información</h3>
          <dl className="meta-grid">
            <dt>Duración</dt>
            <dd>{formatDuration(video.durationSeconds)}</dd>
            <dt>Publicado</dt>
            <dd>{formatDate(video.publishedAt)}</dd>
            <dt>Añadido</dt>
            <dd title={video.addedAt}>{formatRelative(video.addedAt)}</dd>
            {video.viewCount !== null && (
              <>
                <dt>Visualizaciones</dt>
                <dd>{formatCount(video.viewCount)}</dd>
              </>
            )}
            {video.likeCount !== null && (
              <>
                <dt>Me gusta</dt>
                <dd>{formatCount(video.likeCount)}</dd>
              </>
            )}
            {video.width && video.height && (
              <>
                <dt>Resolución</dt>
                <dd>
                  {video.width}×{video.height}
                </dd>
              </>
            )}
            {video.filePath && (
              <>
                <dt>Archivo</dt>
                <dd>{formatSize(video.fileSize)}</dd>
              </>
            )}
            <dt>Veces abierto</dt>
            <dd>{video.openedCount}</dd>
            <dt>Disponibilidad</dt>
            <dd>{video.availability === 'ok' ? 'Disponible' : video.availability === 'unknown' ? 'Sin comprobar' : 'Con problemas'}</dd>
          </dl>
        </div>

        <div className="detail-section">
          <button
            type="button"
            className="btn btn-sm btn-danger"
            style={{ width: '100%' }}
            onClick={async () => {
              if (settings.confirmDelete && !window.confirm('¿Eliminar este vídeo de la biblioteca?')) return;
              await api.videos.remove([video.id], false);
              onClose();
              await refresh({ keepPage: true });
            }}
          >
            🗑 Eliminar de la biblioteca
          </button>
        </div>
      </div>
    </aside>
  );
}
