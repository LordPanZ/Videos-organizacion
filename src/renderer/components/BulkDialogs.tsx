import { useState } from 'react';
import { api } from '../api.ts';
import { useLibrary } from '../store/useLibrary.ts';
import { Modal } from './Modal.tsx';
import { TagPicker } from './TagPicker.tsx';
import { CustomFieldEditor } from './CustomFieldEditor.tsx';
import type { CustomFieldValue, Tag } from '../../shared/types.ts';

/** Applies tags to every selected video. */
export function BulkTagDialog({ ids, onClose }: { ids: string[]; onClose(): void }) {
  const { tags, refresh, reloadMeta, toast } = useLibrary();
  const [selected, setSelected] = useState<Tag[]>([]);
  const [mode, setMode] = useState<'add' | 'remove'>('add');

  const apply = async () => {
    const tagIds = selected.map((tag) => tag.id);
    if (tagIds.length === 0) return;
    if (mode === 'add') await api.videos.addTags(ids, tagIds);
    else await api.videos.removeTags(ids, tagIds);
    await Promise.all([refresh({ keepPage: true }), reloadMeta()]);
    toast('success', `${ids.length} vídeos actualizados.`);
    onClose();
  };

  return (
    <Modal
      title={`Etiquetar ${ids.length} vídeo(s)`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void apply()}>
            {mode === 'add' ? 'Añadir etiquetas' : 'Quitar etiquetas'}
          </button>
        </>
      }
    >
      <div className="segmented" style={{ marginBottom: 16, width: '100%' }}>
        <button type="button" style={{ flex: 1, width: 'auto' }} aria-pressed={mode === 'add'} onClick={() => setMode('add')}>
          Añadir
        </button>
        <button type="button" style={{ flex: 1, width: 'auto' }} aria-pressed={mode === 'remove'} onClick={() => setMode('remove')}>
          Quitar
        </button>
      </div>
      <TagPicker
        selected={selected}
        onChange={(tagIds) => setSelected(tagIds.map((id) => tags.find((tag) => tag.id === id)!).filter(Boolean))}
      />
    </Modal>
  );
}

/** Sets one custom field on every selected video. */
export function BulkFieldDialog({ ids, onClose }: { ids: string[]; onClose(): void }) {
  const { fields, refresh, toast } = useLibrary();
  const [fieldId, setFieldId] = useState(fields[0]?.id ?? '');
  const [value, setValue] = useState<CustomFieldValue>(null);
  const field = fields.find((item) => item.id === fieldId);

  if (fields.length === 0) {
    return (
      <Modal title="Campos personalizados" onClose={onClose}>
        <p className="muted">Todavía no has creado ningún campo. Créalo desde el panel lateral, en «Campos personalizados».</p>
      </Modal>
    );
  }

  return (
    <Modal
      title={`Asignar campo a ${ids.length} vídeo(s)`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={async () => {
              if (!field) return;
              await api.videos.setCustomField(ids, field.key, value);
              await refresh({ keepPage: true });
              toast('success', `«${field.label}» aplicado a ${ids.length} vídeos.`);
              onClose();
            }}
          >
            Aplicar
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="bulk-field">Campo</label>
        <select
          id="bulk-field"
          className="select"
          value={fieldId}
          onChange={(event) => {
            setFieldId(event.target.value);
            setValue(null);
          }}
        >
          {fields.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {field && <CustomFieldEditor field={field} value={value} onChange={setValue} />}
      <p className="hint">Deja el valor vacío para borrar el campo en los vídeos seleccionados.</p>
    </Modal>
  );
}

/** Adds the selection to a collection, creating one if needed. */
export function BulkCollectionDialog({ ids, onClose }: { ids: string[]; onClose(): void }) {
  const { collections, reloadMeta, toast } = useLibrary();
  const manual = collections.filter((collection) => collection.kind === 'manual');
  const [collectionId, setCollectionId] = useState(manual[0]?.id ?? '');
  const [newName, setNewName] = useState('');

  const apply = async () => {
    let target = collectionId;
    if (newName.trim()) {
      const created = await api.collections.create({ name: newName.trim() });
      target = created.id;
    }
    if (!target) return;
    const added = await api.collections.addVideos(target, ids);
    await reloadMeta();
    toast('success', `${added} vídeos añadidos a la colección.`);
    onClose();
  };

  return (
    <Modal
      title={`Añadir ${ids.length} vídeo(s) a una colección`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void apply()}>
            Añadir
          </button>
        </>
      }
    >
      {manual.length > 0 && (
        <div className="field">
          <label htmlFor="bulk-collection">Colección existente</label>
          <select id="bulk-collection" className="select" value={collectionId} onChange={(event) => setCollectionId(event.target.value)}>
            {manual.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label htmlFor="bulk-new-collection">…o crear una nueva</label>
        <input
          id="bulk-new-collection"
          className="input"
          value={newName}
          placeholder="Nombre de la nueva colección"
          onChange={(event) => setNewName(event.target.value)}
        />
      </div>
    </Modal>
  );
}
