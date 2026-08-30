import { contextBridge, ipcRenderer } from 'electron';
import { EVENT_NAMES, IPC_CHANNELS } from '../src/shared/ipc.ts';

/**
 * The renderer runs with context isolation and no Node integration. This
 * bridge is the only surface it can reach, and every entry is an explicit,
 * allow-listed channel — the renderer can never name a channel of its own.
 */
type Nested = Record<string, unknown>;

const api: Nested = {};

for (const channel of IPC_CHANNELS) {
  const [namespace, method] = channel.split('.');
  if (!namespace || !method) continue;
  const group = (api[namespace] ??= {}) as Nested;
  group[method] = (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
}

/** Subscribes to a main-process event; returns an unsubscribe function. */
api.on = (event: string, listener: (payload: unknown) => void): (() => void) => {
  if (!EVENT_NAMES.includes(event as never)) {
    throw new Error(`Evento desconocido: ${event}`);
  }
  const wrapped = (_: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
  ipcRenderer.on(event, wrapped);
  return () => ipcRenderer.off(event, wrapped);
};

api.platform = process.platform;

contextBridge.exposeInMainWorld('videoteca', api);
