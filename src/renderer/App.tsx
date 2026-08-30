import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, isMac } from './api.ts';
import { subscribeToMain, useLibrary } from './store/useLibrary.ts';
import { Sidebar } from './components/Sidebar.tsx';
import { Toolbar } from './components/Toolbar.tsx';
import { LibraryView } from './components/LibraryView.tsx';
import { DetailPanel } from './components/DetailPanel.tsx';
import { Dashboard } from './components/Dashboard.tsx';
import { DownloadsPanel } from './components/DownloadsPanel.tsx';
import { DuplicatesView } from './components/DuplicatesView.tsx';
import { AddDialog } from './components/AddDialog.tsx';
import { SettingsDialog } from './components/SettingsDialog.tsx';
import { FieldsDialog } from './components/FieldsDialog.tsx';
import { HelpDialog } from './components/HelpDialog.tsx';
import { CommandPalette, type Command } from './components/CommandPalette.tsx';
import { BulkBar } from './components/BulkBar.tsx';
import { BulkCollectionDialog, BulkFieldDialog, BulkTagDialog } from './components/BulkDialogs.tsx';
import { Toasts } from './components/Toasts.tsx';
import { Modal } from './components/Modal.tsx';
import type { LayoutMode } from '../shared/types.ts';

const LAYOUT_LABELS: Record<LayoutMode, string> = {
  grid: 'cuadrícula',
  masonry: 'mosaico',
  list: 'lista',
  table: 'tabla',
  compact: 'compacta',
};

type Dialog =
  | { kind: 'none' }
  | { kind: 'add'; text?: string }
  | { kind: 'settings' }
  | { kind: 'fields' }
  | { kind: 'help' }
  | { kind: 'palette' }
  | { kind: 'bulk-tags' }
  | { kind: 'bulk-field' }
  | { kind: 'bulk-collection' }
  | { kind: 'collection'; id: string | null };

/** Small dialog for creating or renaming a collection. */
function CollectionDialog({ id, onClose }: { id: string | null; onClose(): void }) {
  const { collections, reloadMeta, setCollection } = useLibrary();
  const existing = collections.find((collection) => collection.id === id) ?? null;
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [query, setQuery] = useState(existing?.query ?? '');
  const [smart, setSmart] = useState(existing?.kind === 'smart');

  return (
    <Modal
      title={existing ? 'Editar colección' : 'Nueva colección'}
      onClose={onClose}
      footer={
        <>
          {existing && (
            <button
              type="button"
              className="btn btn-danger"
              style={{ marginRight: 'auto' }}
              onClick={async () => {
                if (!window.confirm(`¿Eliminar la colección «${existing.name}»? Los vídeos se conservan.`)) return;
                await api.collections.remove(existing.id);
                await reloadMeta();
                await setCollection(null);
                onClose();
              }}
            >
              Eliminar
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={async () => {
              if (!name.trim()) return;
              const payload = {
                name: name.trim(),
                description: description || null,
                kind: smart ? ('smart' as const) : ('manual' as const),
                query: smart ? query : null,
              };
              if (existing) await api.collections.update(existing.id, payload);
              else await api.collections.create(payload);
              await reloadMeta();
              onClose();
            }}
          >
            {existing ? 'Guardar' : 'Crear'}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="collection-name">Nombre</label>
        <input id="collection-name" className="input" autoFocus value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="collection-description">Descripción</label>
        <input
          id="collection-description"
          className="input"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <label className="switch">
        <input type="checkbox" checked={smart} disabled={existing !== null} onChange={(event) => setSmart(event.target.checked)} />
        <span>Colección inteligente (se actualiza sola con una búsqueda)</span>
      </label>
      {smart && (
        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="collection-query">Búsqueda</label>
          <input
            id="collection-query"
            className="input mono"
            value={query}
            placeholder="platform:youtube #cocina rating>=4"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      )}
    </Modal>
  );
}

/** Progress strip shown while an import is running. */
function ImportStrip() {
  const { importState } = useLibrary();
  if (!importState.active) return null;
  const percent = importState.total > 0 ? Math.round((importState.done / importState.total) * 100) : 0;

  return (
    <div className="import-strip">
      <span>
        Importando {importState.done} / {importState.total}
      </span>
      <div className="progress-bar">
        <span style={{ width: `${percent}%` }} />
      </div>
      <span className="truncate" style={{ flex: 1, color: 'var(--text-muted)' }}>
        {importState.current}
      </span>
      <span className="dim">
        {importState.added} añadidos · {importState.duplicates} repetidos · {importState.failed} errores
      </span>
      <button type="button" className="btn btn-sm" onClick={() => void api.import.cancel()}>
        Cancelar
      </button>
    </div>
  );
}

export function App() {
  const store = useLibrary();
  const {
    screen,
    detailId,
    selection,
    sidebarVisible,
    warnings,
    bootstrap,
    openDetail,
    clearSelection,
    selectAll,
    setLayout,
    setScreen,
    runQuery,
    refresh,
    settings,
  } = store;

  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });
  const searchRef = useRef<HTMLInputElement>(null);
  const closeDialog = useCallback(() => setDialog({ kind: 'none' }), []);

  useEffect(() => {
    void bootstrap();
    return subscribeToMain();
  }, [bootstrap]);

  const commands = useMemo<Command[]>(() => {
    const ids = [...selection];
    return [
      { id: 'add', icon: '➕', label: 'Añadir vídeos', shortcut: '⌘N', group: 'Biblioteca', run: () => setDialog({ kind: 'add' }) },
      {
        id: 'paste',
        icon: '📋',
        label: 'Importar enlaces del portapapeles',
        shortcut: '⌘⇧V',
        group: 'Biblioteca',
        run: () => void api.import.clipboard(),
      },
      {
        id: 'scan',
        icon: '📂',
        label: 'Escanear una carpeta de vídeos',
        group: 'Biblioteca',
        run: async () => {
          const folder = await api.import.pickFolder();
          if (folder) await api.import.scanFolder({ folder, recursive: true });
        },
      },
      { id: 'fields', icon: '🧩', label: 'Gestionar campos personalizados', group: 'Organización', run: () => setDialog({ kind: 'fields' }) },
      { id: 'collection', icon: '📁', label: 'Nueva colección', group: 'Organización', run: () => setDialog({ kind: 'collection', id: null }) },
      { id: 'dashboard', icon: '📊', label: 'Ver estadísticas', shortcut: '⌘D', group: 'Navegación', run: () => setScreen('dashboard') },
      { id: 'downloads', icon: '⬇', label: 'Ver descargas', shortcut: '⌘J', group: 'Navegación', run: () => setScreen('downloads') },
      { id: 'duplicates', icon: '🔁', label: 'Buscar duplicados', group: 'Navegación', run: () => setScreen('duplicates') },
      { id: 'settings', icon: '⚙', label: 'Ajustes', group: 'Aplicación', run: () => setDialog({ kind: 'settings' }) },
      { id: 'help', icon: '❓', label: 'Ayuda de búsqueda y atajos', group: 'Aplicación', run: () => setDialog({ kind: 'help' }) },
      { id: 'export', icon: '💾', label: 'Exportar la biblioteca', group: 'Aplicación', run: () => void api.library.export({ format: 'json' }) },
      { id: 'backup', icon: '🛟', label: 'Crear copia de seguridad', group: 'Aplicación', run: () => void api.library.backup() },
      { id: 'install', icon: '🔧', label: 'Instalar yt-dlp', group: 'Aplicación', run: () => void api.settings.installYtdlp() },
      ...(ids.length > 0
        ? [
            { id: 'bulk-tag', icon: '🏷', label: `Etiquetar ${ids.length} seleccionados`, group: 'Selección', run: () => setDialog({ kind: 'bulk-tags' }) },
            { id: 'bulk-field', icon: '🧩', label: `Asignar campo a ${ids.length}`, group: 'Selección', run: () => setDialog({ kind: 'bulk-field' }) },
            {
              id: 'bulk-download',
              icon: '⬇',
              label: `Descargar ${ids.length} seleccionados`,
              group: 'Selección',
              run: () => void api.downloads.enqueue(ids, settings.defaultDownloadFormat),
            },
            {
              id: 'bulk-refresh',
              icon: '⟳',
              label: `Actualizar metadatos de ${ids.length}`,
              group: 'Selección',
              run: () => void api.videos.refresh(ids).then(() => refresh({ keepPage: true })),
            },
          ]
        : []),
      ...(['grid', 'masonry', 'list', 'table'] as LayoutMode[]).map((mode) => ({
        id: `layout-${mode}`,
        icon: '▦',
        label: `Vista: ${LAYOUT_LABELS[mode]}`,
        group: 'Vista',
        run: () => setLayout(mode),
      })),
    ];
  }, [selection, setScreen, setLayout, refresh, settings.defaultDownloadFormat]);

  // Menu items dispatch a DOM event so the main process can drive the UI.
  useEffect(() => {
    const onCommand = (event: Event) => {
      const command = (event as CustomEvent<string>).detail;
      if (command.startsWith('layout:')) {
        setLayout(command.slice(7) as LayoutMode);
        return;
      }
      const map: Record<string, () => void> = {
        add: () => setDialog({ kind: 'add' }),
        paste: () => void api.import.clipboard(),
        scan: () =>
          void api.import.pickFolder().then((folder) => {
            if (folder) void api.import.scanFolder({ folder, recursive: true });
          }),
        settings: () => setDialog({ kind: 'settings' }),
        help: () => setDialog({ kind: 'help' }),
        shortcuts: () => setDialog({ kind: 'help' }),
        palette: () => setDialog({ kind: 'palette' }),
        dashboard: () => setScreen('dashboard'),
        downloads: () => setScreen('downloads'),
        export: () => void api.library.export({ format: 'json' }),
        import: () => void api.library.import(),
        backup: () => void api.library.backup(),
        'install-ytdlp': () => void api.settings.installYtdlp(),
        'focus-search': () => searchRef.current?.focus(),
      };
      map[command]?.();
    };

    window.addEventListener('videoteca:command', onCommand);
    return () => window.removeEventListener('videoteca:command', onCommand);
  }, [setLayout, setScreen]);

  // Global keyboard shortcuts. Typing in a field never triggers them.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
      const mod = isMac ? event.metaKey : event.ctrlKey;

      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setDialog({ kind: 'palette' });
        return;
      }
      if (mod && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setDialog({ kind: 'add' });
        return;
      }
      if (mod && event.key.toLowerCase() === 'a' && !typing) {
        event.preventDefault();
        void selectAll();
        return;
      }
      if (mod && ['1', '2', '3', '4'].includes(event.key)) {
        event.preventDefault();
        setLayout((['grid', 'masonry', 'list', 'table'] as LayoutMode[])[Number(event.key) - 1]);
        return;
      }
      if (mod && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        setScreen('dashboard');
        return;
      }
      if (mod && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        setScreen('downloads');
        return;
      }

      if (typing) return;

      if (event.key === 'Escape') {
        if (dialog.kind !== 'none') closeDialog();
        else if (detailId) openDetail(null);
        else clearSelection();
        return;
      }

      const first = [...selection][0];
      if (event.key === ' ' && first) {
        event.preventDefault();
        openDetail(first);
      }
      if (event.key === 'Enter' && first) {
        event.preventDefault();
        void api.videos.open(first);
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selection.size > 0) {
        event.preventDefault();
        if (!settings.confirmDelete || window.confirm(`¿Eliminar ${selection.size} vídeo(s)?`)) {
          void api.videos.remove([...selection], false).then(() => {
            clearSelection();
            void refresh({ keepPage: true });
          });
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog.kind, detailId, selection, settings.confirmDelete, closeDialog, openDetail, clearSelection, selectAll, setLayout, setScreen, refresh]);

  // Dropping links or files anywhere in the window imports them.
  useEffect(() => {
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      const text = event.dataTransfer?.getData('text/uri-list') || event.dataTransfer?.getData('text/plain') || '';
      const files = [...(event.dataTransfer?.files ?? [])]
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        .map((file) => (file as any).path as string | undefined)
        .filter((path): path is string => Boolean(path));
      const payload = [text, ...files].filter(Boolean).join('\n');
      if (payload.trim()) setDialog({ kind: 'add', text: payload.trim() });
    };
    const onDragOver = (event: DragEvent) => event.preventDefault();

    window.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onDragOver);
    return () => {
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', onDragOver);
    };
  }, []);

  const ids = [...selection];

  return (
    <div className="app" data-sidebar={sidebarVisible ? 'visible' : 'hidden'}>
      {sidebarVisible && (
        <Sidebar
          onManageFields={() => setDialog({ kind: 'fields' })}
          onManageTags={() => setDialog({ kind: 'fields' })}
          onNewCollection={() => setDialog({ kind: 'collection', id: null })}
          onEditCollection={(id) => setDialog({ kind: 'collection', id })}
        />
      )}

      <div className="main">
        <Toolbar
          searchRef={searchRef}
          onAdd={() => setDialog({ kind: 'add' })}
          onOpenHelp={() => setDialog({ kind: 'help' })}
          onOpenSettings={() => setDialog({ kind: 'settings' })}
        />

        <ImportStrip />

        {warnings.length > 0 && screen === 'library' && (
          <div className="warning-strip">
            <span>⚠</span>
            <span>{warnings.join(' ')}</span>
          </div>
        )}

        <div className="content" style={{ position: 'relative' }}>
          <div className="content-scroll">
            {screen === 'library' && <LibraryView onAdd={() => setDialog({ kind: 'add' })} />}
            {screen === 'dashboard' && <Dashboard />}
            {screen === 'downloads' && <DownloadsPanel />}
            {screen === 'duplicates' && <DuplicatesView />}
          </div>

          {detailId && <DetailPanel videoId={detailId} onClose={() => openDetail(null)} />}

          <BulkBar
            onAddTags={() => setDialog({ kind: 'bulk-tags' })}
            onSetField={() => setDialog({ kind: 'bulk-field' })}
            onAddToCollection={() => setDialog({ kind: 'bulk-collection' })}
          />
        </div>
      </div>

      {dialog.kind === 'add' && <AddDialog onClose={closeDialog} initialText={dialog.text} />}
      {dialog.kind === 'settings' && <SettingsDialog onClose={closeDialog} />}
      {dialog.kind === 'fields' && <FieldsDialog onClose={closeDialog} />}
      {dialog.kind === 'collection' && <CollectionDialog id={dialog.id} onClose={closeDialog} />}
      {dialog.kind === 'palette' && <CommandPalette commands={commands} onClose={closeDialog} />}
      {dialog.kind === 'bulk-tags' && <BulkTagDialog ids={ids} onClose={closeDialog} />}
      {dialog.kind === 'bulk-field' && <BulkFieldDialog ids={ids} onClose={closeDialog} />}
      {dialog.kind === 'bulk-collection' && <BulkCollectionDialog ids={ids} onClose={closeDialog} />}
      {dialog.kind === 'help' && (
        <HelpDialog
          onClose={closeDialog}
          onRunExample={(query) => {
            closeDialog();
            setScreen('library');
            void runQuery(query);
          }}
        />
      )}

      <Toasts />
    </div>
  );
}
