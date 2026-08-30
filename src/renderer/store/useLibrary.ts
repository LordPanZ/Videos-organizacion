import { create } from 'zustand';
import { api } from '../api.ts';
import { DEFAULT_SETTINGS } from '../../shared/settings.ts';
import type {
  AppSettings,
  Collection,
  CustomField,
  DownloadJob,
  Facets,
  LayoutMode,
  QueryResult,
  SavedView,
  SortSpec,
  Tag,
  Video,
} from '../../shared/types.ts';

const EMPTY_FACETS: Facets = {
  platforms: [],
  tags: [],
  authors: [],
  years: [],
  ratings: [],
  watchStatus: [],
  durations: [],
  availability: [],
  customFields: {},
};

export type Screen = 'library' | 'dashboard' | 'downloads' | 'duplicates';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
}

interface ImportState {
  active: boolean;
  done: number;
  total: number;
  added: number;
  duplicates: number;
  failed: number;
  current: string;
}

interface LibraryState {
  // data
  videos: Video[];
  total: number;
  facets: Facets;
  warnings: string[];
  tags: Tag[];
  collections: Collection[];
  fields: CustomField[];
  views: SavedView[];
  downloads: DownloadJob[];
  settings: AppSettings;

  // view state
  screen: Screen;
  query: string;
  sort: SortSpec;
  layout: LayoutMode;
  cardSize: number;
  collectionId: string | null;
  selection: Set<string>;
  lastClicked: string | null;
  detailId: string | null;
  loading: boolean;
  page: number;
  hasMore: boolean;
  sidebarVisible: boolean;
  toasts: Toast[];
  importState: ImportState;

  // actions
  bootstrap(): Promise<void>;
  refresh(options?: { keepPage?: boolean }): Promise<void>;
  loadMore(): Promise<void>;
  reloadMeta(): Promise<void>;
  setQuery(query: string): void;
  runQuery(query: string): Promise<void>;
  setSort(sort: SortSpec): Promise<void>;
  setLayout(layout: LayoutMode): void;
  setCardSize(size: number): void;
  setScreen(screen: Screen): void;
  setCollection(id: string | null): Promise<void>;
  select(id: string, mode: 'replace' | 'toggle' | 'range'): void;
  selectAll(): Promise<void>;
  clearSelection(): void;
  openDetail(id: string | null): void;
  patchVideo(id: string, patch: Partial<Video>): void;
  applySettings(patch: Partial<AppSettings>): Promise<void>;
  toast(kind: Toast['kind'], message: string): void;
  dismissToast(id: number): void;
  toggleSidebar(): void;
}

const PAGE_SIZE = 120;

let toastId = 0;

export const useLibrary = create<LibraryState>((set, get) => ({
  videos: [],
  total: 0,
  facets: EMPTY_FACETS,
  warnings: [],
  tags: [],
  collections: [],
  fields: [],
  views: [],
  downloads: [],
  settings: DEFAULT_SETTINGS,

  screen: 'library',
  query: '',
  sort: DEFAULT_SETTINGS.sort,
  layout: DEFAULT_SETTINGS.layout,
  cardSize: DEFAULT_SETTINGS.cardSize,
  collectionId: null,
  selection: new Set(),
  lastClicked: null,
  detailId: null,
  loading: true,
  page: 0,
  hasMore: false,
  // On a phone the sidebar is a drawer, so it starts closed; on a wide screen
  // it is a permanent column.
  sidebarVisible: typeof window === 'undefined' ? true : window.innerWidth > 860,
  toasts: [],
  importState: { active: false, done: 0, total: 0, added: 0, duplicates: 0, failed: 0, current: '' },

  async bootstrap() {
    const settings = await api.settings.get();
    set({
      settings,
      sort: settings.sort,
      layout: settings.layout,
      cardSize: settings.cardSize,
    });
    document.documentElement.dataset.theme = settings.theme === 'system' ? '' : settings.theme;
    document.documentElement.style.setProperty('--accent', settings.accentColor);

    await Promise.all([get().reloadMeta(), get().refresh()]);
  },

  async reloadMeta() {
    const [tags, collections, fields, views, downloads] = await Promise.all([
      api.tags.list(),
      api.collections.list(),
      api.fields.list(),
      api.views.list(),
      api.downloads.list(),
    ]);
    set({ tags, collections, fields, views, downloads });
  },

  async refresh(options = {}) {
    const { query, sort, collectionId, page } = get();
    const targetPage = options.keepPage ? page : 0;
    set({ loading: true });

    const result: QueryResult = await api.videos.search({
      query,
      sort,
      collectionId: collectionId ?? undefined,
      limit: PAGE_SIZE * (targetPage + 1),
      offset: 0,
    });

    set({
      videos: result.videos,
      total: result.total,
      facets: result.facets,
      warnings: result.warnings,
      loading: false,
      page: targetPage,
      hasMore: result.videos.length < result.total,
    });
  },

  async loadMore() {
    const { query, sort, collectionId, videos, hasMore, loading } = get();
    if (!hasMore || loading) return;
    set({ loading: true });

    const result = await api.videos.search({
      query,
      sort,
      collectionId: collectionId ?? undefined,
      limit: PAGE_SIZE,
      offset: videos.length,
    });

    set((state) => ({
      videos: [...state.videos, ...result.videos],
      total: result.total,
      loading: false,
      page: state.page + 1,
      hasMore: state.videos.length + result.videos.length < result.total,
    }));
  },

  setQuery(query) {
    set({ query });
  },

  async runQuery(query) {
    set({ query, page: 0 });
    await get().refresh();
  },

  async setSort(sort) {
    set({ sort });
    await api.settings.set({ sort });
    await get().refresh();
  },

  setLayout(layout) {
    set({ layout });
    void api.settings.set({ layout });
  },

  setCardSize(cardSize) {
    set({ cardSize });
    void api.settings.set({ cardSize });
  },

  setScreen(screen) {
    set({ screen });
  },

  async setCollection(collectionId) {
    set({ collectionId, page: 0, screen: 'library' });
    await get().refresh();
  },

  /**
   * Selection follows the conventions of a file manager: plain click replaces,
   * ctrl/cmd toggles, shift extends from the last clicked item.
   */
  select(id, mode) {
    const { selection, videos, lastClicked } = get();
    const next = new Set(selection);

    if (mode === 'replace') {
      next.clear();
      next.add(id);
    } else if (mode === 'toggle') {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    } else {
      const from = videos.findIndex((video) => video.id === lastClicked);
      const to = videos.findIndex((video) => video.id === id);
      if (from === -1 || to === -1) {
        next.add(id);
      } else {
        const [start, end] = from < to ? [from, to] : [to, from];
        for (let index = start; index <= end; index += 1) next.add(videos[index].id);
      }
    }

    set({ selection: next, lastClicked: id });
  },

  async selectAll() {
    const { query, sort, collectionId } = get();
    const ids = await api.videos.searchIds({ query, sort, collectionId: collectionId ?? undefined });
    set({ selection: new Set(ids) });
  },

  clearSelection() {
    set({ selection: new Set() });
  },

  openDetail(detailId) {
    set({ detailId });
  },

  /** Optimistic local update so toggles feel instant. */
  patchVideo(id, patch) {
    set((state) => ({
      videos: state.videos.map((video) => (video.id === id ? { ...video, ...patch } : video)),
    }));
  },

  async applySettings(patch) {
    const settings = await api.settings.set(patch);
    set({ settings });
    if (patch.theme !== undefined) {
      document.documentElement.dataset.theme = settings.theme === 'system' ? '' : settings.theme;
    }
    if (patch.accentColor !== undefined) {
      document.documentElement.style.setProperty('--accent', settings.accentColor);
    }
  },

  toast(kind, message) {
    if (!message) return;
    const id = ++toastId;
    set((state) => ({ toasts: [...state.toasts, { id, kind, message }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : 4000);
  },

  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  toggleSidebar() {
    set((state) => ({ sidebarVisible: !state.sidebarVisible }));
  },
}));

/** Wires main-process events into the store. Called once at startup. */
export function subscribeToMain(): () => void {
  const store = useLibrary.getState;

  const unsubscribers = [
    api.on('toast', ({ kind, message }) => store().toast(kind, message)),

    api.on('downloads:changed', (downloads) => useLibrary.setState({ downloads })),

    api.on('library:changed', () => {
      void store().refresh({ keepPage: true });
      void store().reloadMeta();
    }),

    api.on('import:progress', (progress) => {
      useLibrary.setState({
        importState: {
          active: true,
          done: progress.done,
          total: progress.total,
          added: progress.added,
          duplicates: progress.duplicates,
          failed: progress.failed,
          current: progress.lastTitle ?? progress.current,
        },
      });
    }),

    api.on('import:done', (report) => {
      useLibrary.setState((state) => ({ importState: { ...state.importState, active: false } }));
      const parts = [`${report.added} añadidos`];
      if (report.duplicates > 0) parts.push(`${report.duplicates} duplicados`);
      if (report.failed.length > 0) parts.push(`${report.failed.length} con error`);
      store().toast(report.added > 0 ? 'success' : 'info', parts.join(' · '));
    }),
  ];

  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}
