import { useMemo, useState } from 'react';
import { api } from '../api.ts';
import { useLibrary } from '../store/useLibrary.ts';
import type { Tag } from '../../shared/types.ts';

export interface TagPickerProps {
  selected: Tag[];
  onChange(tagIds: string[]): Promise<void> | void;
  placeholder?: string;
}

/** Chip editor with autocomplete; unknown names create the tag on the fly. */
export function TagPicker({ selected, onChange, placeholder = 'Añadir etiqueta…' }: TagPickerProps) {
  const { tags, reloadMeta } = useLibrary();
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);

  const selectedIds = useMemo(() => new Set(selected.map((tag) => tag.id)), [selected]);

  const suggestions = useMemo(() => {
    const needle = draft.trim().toLowerCase();
    return tags
      .filter((tag) => !selectedIds.has(tag.id) && (needle === '' || tag.name.toLowerCase().includes(needle)))
      .slice(0, 8);
  }, [tags, draft, selectedIds]);

  const add = async (tag: Tag) => {
    setDraft('');
    await onChange([...selected.map((item) => item.id), tag.id]);
  };

  const create = async () => {
    const name = draft.trim();
    if (!name) return;
    const existing = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      await add(existing);
      return;
    }
    const created = await api.tags.create({ name });
    setDraft('');
    await onChange([...selected.map((item) => item.id), created.id]);
    await reloadMeta();
  };

  return (
    <div>
      <div className="row row-wrap" style={{ gap: 5, marginBottom: 7 }}>
        {selected.map((tag) => (
          <span
            key={tag.id}
            className="chip"
            style={tag.color ? { background: `color-mix(in srgb, ${tag.color} 22%, transparent)`, color: tag.color } : undefined}
          >
            <span className="chip-label">{tag.name}</span>
            <button
              type="button"
              title="Quitar etiqueta"
              onClick={() => void onChange(selected.filter((item) => item.id !== tag.id).map((item) => item.id))}
            >
              ✕
            </button>
          </span>
        ))}
      </div>

      <div style={{ position: 'relative' }}>
        <input
          className="input"
          value={draft}
          placeholder={placeholder}
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 140)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (suggestions.length > 0 && draft.trim()) void add(suggestions[0]);
              else void create();
            }
            if (event.key === 'Backspace' && draft === '' && selected.length > 0) {
              void onChange(selected.slice(0, -1).map((item) => item.id));
            }
          }}
        />

        {open && (suggestions.length > 0 || draft.trim()) && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: 4,
              background: 'var(--surface)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-sm)',
              boxShadow: 'var(--shadow-lg)',
              zIndex: 20,
              maxHeight: 220,
              overflowY: 'auto',
              padding: 4,
            }}
          >
            {suggestions.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className="nav-item"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void add(tag)}
              >
                {tag.color ? <i className="dot" style={{ background: tag.color }} /> : <span className="icon">{tag.icon ?? '🏷'}</span>}
                <span className="label">{tag.name}</span>
                <span className="count">{tag.videoCount ?? 0}</span>
              </button>
            ))}
            {draft.trim() && !tags.some((tag) => tag.name.toLowerCase() === draft.trim().toLowerCase()) && (
              <button type="button" className="nav-item" onMouseDown={(event) => event.preventDefault()} onClick={() => void create()}>
                <span className="icon">+</span>
                <span className="label">
                  Crear «<strong>{draft.trim()}</strong>»
                </span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
