import { useState } from 'react';
import { api } from '../api.ts';
import { useLibrary } from '../store/useLibrary.ts';
import { Modal } from './Modal.tsx';
import type { CustomField, CustomFieldOption, CustomFieldType } from '../../shared/types.ts';

const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Texto corto',
  longtext: 'Texto largo',
  number: 'Número',
  boolean: 'Sí / No',
  date: 'Fecha',
  select: 'Lista (una opción)',
  multiselect: 'Lista (varias opciones)',
  rating: 'Valoración (1–5)',
  url: 'Enlace',
  duration: 'Duración',
};

const TYPES_WITH_OPTIONS: CustomFieldType[] = ['select', 'multiselect'];

const SUGGESTED_ICONS = ['🧩', '🔥', '📁', '⭐', '🎯', '📍', '🔁', '💡', '🎓', '🧠', '💼', '🎬', '📌', '🏆'];

/**
 * Create and manage user-defined parameters.
 *
 * A field created here is immediately usable everywhere: as a filter in the
 * search bar (`clave:valor`), as a facet in the sidebar, as a column in the
 * table view and as a bulk-edit target.
 */
export function FieldsDialog({ onClose }: { onClose(): void }) {
  const { fields, reloadMeta, toast } = useLibrary();
  const [editing, setEditing] = useState<CustomField | null>(null);
  const [creating, setCreating] = useState(false);

  const [label, setLabel] = useState('');
  const [type, setType] = useState<CustomFieldType>('text');
  const [icon, setIcon] = useState('🧩');
  const [description, setDescription] = useState('');
  const [showInCard, setShowInCard] = useState(false);
  const [showInFacets, setShowInFacets] = useState(true);
  const [options, setOptions] = useState<CustomFieldOption[]>([]);
  const [optionDraft, setOptionDraft] = useState('');

  const startCreate = () => {
    setEditing(null);
    setCreating(true);
    setLabel('');
    setType('text');
    setIcon('🧩');
    setDescription('');
    setShowInCard(false);
    setShowInFacets(true);
    setOptions([]);
  };

  const startEdit = (field: CustomField) => {
    setCreating(false);
    setEditing(field);
    setLabel(field.label);
    setType(field.type);
    setIcon(field.icon ?? '🧩');
    setDescription(field.description ?? '');
    setShowInCard(field.showInCard);
    setShowInFacets(field.showInFacets);
    setOptions(field.options);
  };

  const close = () => {
    setCreating(false);
    setEditing(null);
  };

  const save = async () => {
    if (!label.trim()) {
      toast('error', 'Ponle un nombre al campo.');
      return;
    }

    if (editing) {
      await api.fields.update(editing.id, {
        label: label.trim(),
        icon,
        description: description || null,
        showInCard,
        showInFacets,
        options,
      });
      toast('success', `Campo «${label.trim()}» actualizado.`);
    } else {
      const created = await api.fields.create({
        label: label.trim(),
        type,
        icon,
        description: description || null,
        showInCard,
        showInFacets,
        options,
      });
      toast('success', `Campo creado. Ya puedes filtrar con ${created.key}:valor`);
    }

    await reloadMeta();
    close();
  };

  const addOption = () => {
    const value = optionDraft.trim();
    if (!value) return;
    const key = value.toLowerCase().replace(/\s+/g, '-');
    if (options.some((option) => option.value === key)) return;
    setOptions((current) => [...current, { value: key, label: value }]);
    setOptionDraft('');
  };

  const isForm = creating || editing !== null;

  return (
    <Modal
      title={isForm ? (editing ? 'Editar campo' : 'Nuevo campo personalizado') : 'Campos personalizados'}
      onClose={isForm ? close : onClose}
      wide={!isForm}
      footer={
        isForm ? (
          <>
            <button type="button" className="btn" onClick={close}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void save()}>
              {editing ? 'Guardar cambios' : 'Crear campo'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Cerrar
            </button>
            <button type="button" className="btn btn-primary" onClick={startCreate}>
              + Nuevo campo
            </button>
          </>
        )
      }
    >
      {!isForm && (
        <>
          <p className="muted" style={{ marginTop: 0, fontSize: 13, lineHeight: 1.6 }}>
            Los campos personalizados son parámetros que defines tú. Cada uno se convierte al instante en un filtro de
            búsqueda (<span className="mono">clave:valor</span>), una faceta del panel lateral y una columna de la tabla.
          </p>

          {fields.length === 0 && (
            <div className="empty" style={{ padding: '36px 0' }}>
              <span className="emoji">🧩</span>
              <h2>Aún no hay campos</h2>
              <p>Crea el primero: «Estado de ánimo», «Cliente», «Nivel de dificultad»… lo que necesites.</p>
            </div>
          )}

          {fields.map((field) => (
            <div key={field.id} className="panel" style={{ padding: '12px 14px', marginBottom: 8 }}>
              <div className="row">
                <span style={{ fontSize: 17 }}>{field.icon ?? '🧩'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 550 }}>{field.label}</div>
                  <div className="dim" style={{ fontSize: 12 }}>
                    {TYPE_LABELS[field.type]} · filtra con <span className="mono">{field.key}:valor</span>
                    {field.options.length > 0 && ` · ${field.options.length} opciones`}
                  </div>
                </div>
                <button type="button" className="btn btn-sm" onClick={() => startEdit(field)}>
                  Editar
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={async () => {
                    if (!window.confirm(`¿Eliminar el campo «${field.label}» y todos sus valores?`)) return;
                    await api.fields.remove(field.id);
                    await reloadMeta();
                  }}
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {isForm && (
        <>
          <div className="field">
            <label htmlFor="field-label">Nombre del campo</label>
            <input
              id="field-label"
              className="input"
              autoFocus
              value={label}
              placeholder="Prioridad, Cliente, Nivel…"
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="field-type">Tipo de dato</label>
            <select
              id="field-type"
              className="select"
              value={type}
              disabled={editing !== null}
              onChange={(event) => setType(event.target.value as CustomFieldType)}
            >
              {(Object.keys(TYPE_LABELS) as CustomFieldType[]).map((value) => (
                <option key={value} value={value}>
                  {TYPE_LABELS[value]}
                </option>
              ))}
            </select>
            {editing && <span className="hint">El tipo no se puede cambiar: los valores ya guardados dejarían de encajar.</span>}
          </div>

          <div className="field">
            <label>Icono</label>
            <div className="row row-wrap" style={{ gap: 5 }}>
              {SUGGESTED_ICONS.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  className="btn btn-sm"
                  style={{ borderColor: icon === candidate ? 'var(--accent)' : undefined }}
                  onClick={() => setIcon(candidate)}
                >
                  {candidate}
                </button>
              ))}
            </div>
          </div>

          {TYPES_WITH_OPTIONS.includes(type) && (
            <div className="field">
              <label>Opciones disponibles</label>
              <div className="row row-wrap" style={{ gap: 5, marginBottom: 7 }}>
                {options.map((option) => (
                  <span key={option.value} className="chip">
                    <span className="chip-label">{option.label}</span>
                    <button type="button" onClick={() => setOptions((current) => current.filter((item) => item.value !== option.value))}>
                      ✕
                    </button>
                  </span>
                ))}
              </div>
              <div className="row">
                <input
                  className="input"
                  value={optionDraft}
                  placeholder="Escribe una opción y pulsa Intro"
                  onChange={(event) => setOptionDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addOption();
                    }
                  }}
                />
                <button type="button" className="btn" onClick={addOption}>
                  Añadir
                </button>
              </div>
            </div>
          )}

          <div className="field">
            <label htmlFor="field-description">Descripción (opcional)</label>
            <input
              id="field-description"
              className="input"
              value={description}
              placeholder="Para qué sirve este campo"
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <label className="switch">
            <input type="checkbox" checked={showInCard} onChange={(event) => setShowInCard(event.target.checked)} />
            <span>Mostrar como columna en la vista de tabla</span>
          </label>
          <label className="switch">
            <input type="checkbox" checked={showInFacets} onChange={(event) => setShowInFacets(event.target.checked)} />
            <span>Mostrar en el panel lateral para filtrar</span>
          </label>
        </>
      )}
    </Modal>
  );
}
