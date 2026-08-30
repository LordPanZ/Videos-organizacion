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

/** The preload bridge. Every call crosses into the main process. */
export const api: Bridge = window.videoteca;

export const isMac = api?.platform === 'darwin';

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
