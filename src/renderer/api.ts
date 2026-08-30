import type { EventMap, EventName, VideotecaApi } from '../shared/ipc.ts';

type Bridge = VideotecaApi & {
  on<K extends EventName>(event: K, listener: (payload: EventMap[K]) => void): () => void;
  platform: NodeJS.Platform;
};

declare global {
  interface Window {
    videoteca: Bridge;
  }
}

/**
 * The bridge the interface talks to.
 *
 * It is installed by whatever hosts the app — Electron's preload on the
 * desktop, `src/web/bridge.ts` in the browser — and this module must not care
 * when that happens. Capturing `window.videoteca` at module-evaluation time
 * made the app depend on the host running first, which held only as long as
 * the entry point could force the order with a dynamic import; a bundler that
 * inlines those imports quietly broke it. Resolving on each access removes the
 * ordering question entirely.
 */
export const api: Bridge = new Proxy({} as Bridge, {
  get(_target, property) {
    const bridge = window.videoteca;
    if (!bridge) {
      throw new Error('Videoteca todavía no ha terminado de arrancar.');
    }
    return Reflect.get(bridge, property) as unknown;
  },
});

/** True on macOS, where shortcuts use ⌘ instead of Ctrl. */
export function onMac(): boolean {
  return window.videoteca?.platform === 'darwin';
}

/** Builds a `vt-media://` URL the renderer can put in an <img> or <video>. */
export function mediaUrl(kind: 'thumb' | 'file', target: string | null): string | null {
  if (!target) return null;
  const encoded = target.split(/[\\/]/).map(encodeURIComponent).join('/');
  return `vt-media://${kind}/${encoded}`;
}

/** Best available image for a video: the cached copy, else the remote one. */
export function thumbnailSrc(video: { thumbnailPath: string | null; thumbnailUrl: string | null }): string | null {
  return mediaUrl('thumb', video.thumbnailPath) ?? video.thumbnailUrl;
}
