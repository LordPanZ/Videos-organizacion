/**
 * Minimal promise wrapper around IndexedDB.
 *
 * The library is small enough (a personal collection, not a catalogue) that the
 * whole thing is held in memory and IndexedDB is used purely as durable
 * storage. That keeps querying simple and fast, and avoids maintaining a second
 * set of indexes in the browser.
 */

/**
 * Records are stored denormalized: a video carries its own tag ids and custom
 * field values, and a collection carries its ordered video ids. On the desktop
 * those are join tables because SQL needs them; in the browser the whole
 * library lives in memory, so the joins would only cost work without buying
 * anything.
 */
export const STORES = [
  'videos',
  'tags',
  'authors',
  'collections',
  'customFields',
  'bookmarks',
  'savedViews',
  'rules',
  'settings',
] as const;

export type StoreName = (typeof STORES)[number];

const DB_NAME = 'videoteca';
const DB_VERSION = 1;

function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    source.onsuccess = () => resolve(source.result);
    source.onerror = () => reject(source.error ?? new Error('Error de IndexedDB'));
  });
}

/** Opens (and if needed creates) the database. */
export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);

    open.onupgradeneeded = () => {
      const db = open.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          // Every record carries its own `id`, except settings which is keyed
          // by name so a single row can be replaced in place.
          db.createObjectStore(name, { keyPath: name === 'settings' ? 'key' : 'id' });
        }
      }
    };

    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error('No se pudo abrir la base de datos'));
    open.onblocked = () => reject(new Error('Hay otra pestaña de Videoteca abierta con una versión distinta.'));
  });
}

/** Reads every record from a store. */
export async function readAll<T>(db: IDBDatabase, store: StoreName): Promise<T[]> {
  const tx = db.transaction(store, 'readonly');
  return request(tx.objectStore(store).getAll() as IDBRequest<T[]>);
}

/** Writes records, replacing any with the same key. */
export function putMany(db: IDBDatabase, store: StoreName, records: unknown[]): Promise<void> {
  if (records.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const objectStore = tx.objectStore(store);
    for (const record of records) objectStore.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Error al guardar'));
    tx.onabort = () => reject(tx.error ?? new Error('Guardado cancelado'));
  });
}

export function deleteMany(db: IDBDatabase, store: StoreName, keys: string[]): Promise<void> {
  if (keys.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const objectStore = tx.objectStore(store);
    for (const key of keys) objectStore.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Error al borrar'));
  });
}

export function clearStore(db: IDBDatabase, store: StoreName): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Error al vaciar'));
  });
}

/**
 * Asks the browser to keep the data even under storage pressure. Without this,
 * a phone low on space can silently evict the library.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Rough usage figures for the settings screen. */
export async function storageEstimate(): Promise<{ usage: number; quota: number }> {
  if (!navigator.storage?.estimate) return { usage: 0, quota: 0 };
  try {
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return { usage: 0, quota: 0 };
  }
}
