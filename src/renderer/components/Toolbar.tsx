import { useEffect, useRef, useState } from 'react';
import { useLibrary } from '../store/useLibrary.ts';
import type { LayoutMode, SortField } from '../../shared/types.ts';
import type { Screen } from '../store/useLibrary.ts';

const LAYOUTS: { value: LayoutMode; icon: string; title: string }[] = [
  { value: 'grid', icon: '▦', title: 'Cuadrícula (Ctrl+1)' },
  { value: 'masonry', icon: '▤', title: 'Mosaico (Ctrl+2)' },
  { value: 'list', icon: '☰', title: 'Lista (Ctrl+3)' },
  { value: 'table', icon: '▤', title: 'Tabla (Ctrl+4)' },
];

const SORTS: { value: SortField; label: string }[] = [
  { value: 'addedAt', label: 'Fecha de adición' },
  { value: 'publishedAt', label: 'Fecha de publicación' },
  { value: 'title', label: 'Título' },
  { value: 'durationSeconds', label: 'Duración' },
  { value: 'rating', label: 'Valoración' },
  { value: 'viewCount', label: 'Visualizaciones' },
  { value: 'author', label: 'Autor' },
  { value: 'platform', label: 'Plataforma' },
  { value: 'lastOpenedAt', label: 'Visto por última vez' },
  { value: 'openedCount', label: 'Veces abierto' },
  { value: 'fileSize', label: 'Tamaño de archivo' },
  { value: 'random', label: 'Aleatorio' },
];

export interface ToolbarProps {
  onAdd(): void;
  onOpenHelp(): void;
  onOpenSettings(): void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  /** False on screens that do not show the grid, where sorting and layout have nothing to act on. */
  browsing: boolean;
}

/** Search box, sorting, layout switch and the primary add action. */
export function Toolbar({ onAdd, onOpenHelp, onOpenSettings, searchRef, browsing }: ToolbarProps) {
  const {
    query, setQuery, runQuery, sort, setSort, layout, setLayout, cardSize, setCardSize,
    total, loading, toggleSidebar, screen, setScreen,
  } = useLibrary();
  const [draft, setDraft] = useState(query);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Where searching took us away from, so emptying the box can put us back.
  const cameFrom = useRef<Screen | null>(null);

  // Keep the box in sync when the sidebar or a saved view rewrites the query.
  useEffect(() => {
    setDraft(query);
  }, [query]);

  const commit = (value: string, immediate = false) => {
    setDraft(value);
    setQuery(value);

    // Results are shown by the grid, so a search from anywhere else has to go
    // there — otherwise typing looks like it does nothing at all. The
    // container is left alone: a search must not tip someone out of it.
    if (value.trim() !== '' && screen !== 'library' && screen !== 'container') {
      cameFrom.current = screen;
      setScreen('library');
    } else if (value.trim() === '' && screen === 'library' && cameFrom.current !== null) {
      setScreen(cameFrom.current);
      cameFrom.current = null;
    }
    if (debounce.current) clearTimeout(debounce.current);
    if (immediate) {
      void runQuery(value);
      return;
    }
    debounce.current = setTimeout(() => void runQuery(value), 260);
  };

  return (
    <div className="topbar">
      <button type="button" className="btn btn-ghost btn-icon" title="Mostrar u ocultar el panel lateral" onClick={toggleSidebar}>
        ☰
      </button>

      <div className="search">
        <span className="search-icon">🔍</span>
        <input
          ref={searchRef}
          value={draft}
          placeholder="Busca o filtra: platform:youtube #cocina duration>10 rating>=4"
          spellCheck={false}
          onChange={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit(draft, true);
            if (event.key === 'Escape') {
              commit('', true);
              event.currentTarget.blur();
            }
          }}
        />
        {draft && (
          <button type="button" className="clear" title="Limpiar búsqueda" onClick={() => commit('', true)}>
            ✕
          </button>
        )}
      </div>

      <button type="button" className="btn btn-ghost btn-icon" title="Ayuda de búsqueda" onClick={onOpenHelp}>
        ?
      </button>

      <span className="dim" style={{ fontSize: 12.5, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
        {loading ? '…' : `${total.toLocaleString('es-ES')} vídeos`}
      </span>

      <div className="spacer" />

      {browsing && (layout === 'grid' || layout === 'masonry') && (
        <input
          type="range"
          min={150}
          max={420}
          step={10}
          value={cardSize}
          title="Tamaño de las miniaturas"
          onChange={(event) => setCardSize(Number(event.target.value))}
          style={{ width: 90 }}
        />
      )}

      {browsing && (
        <>
          <select
            className="select"
            style={{ width: 'auto', height: 32, padding: '0 8px' }}
            value={sort.field}
            title="Ordenar por"
            onChange={(event) => void setSort({ field: event.target.value as SortField, direction: sort.direction })}
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="btn btn-icon"
            title={sort.direction === 'asc' ? 'Ascendente' : 'Descendente'}
            onClick={() => void setSort({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}
          >
            {sort.direction === 'asc' ? '↑' : '↓'}
          </button>

          <div className="segmented">
            {LAYOUTS.map((option) => (
              <button
                key={option.value}
                type="button"
                title={option.title}
                aria-pressed={layout === option.value}
                onClick={() => setLayout(option.value)}
              >
                {option.icon}
              </button>
            ))}
          </div>
        </>
      )}

      <button type="button" className="btn btn-ghost btn-icon" title="Ajustes" onClick={onOpenSettings}>
        ⚙
      </button>

      <button type="button" className="btn btn-primary" onClick={onAdd} title="Añadir vídeos (Ctrl+N)">
        + Añadir
      </button>
    </div>
  );
}
