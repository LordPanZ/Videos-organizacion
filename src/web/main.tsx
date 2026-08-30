import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { WebLibrary } from './store.ts';
import { createWebBridge } from './bridge.ts';
import { requestPersistence } from './idb.ts';
import '../renderer/styles/global.css';
import './mobile.css';

/**
 * Web entry point.
 *
 * The interface talks to `window.videoteca`, which the desktop build receives
 * from Electron's preload. Here the browser bridge is installed under the same
 * name *before* the application module is loaded, so every component runs
 * unchanged. The dynamic import is what guarantees that ordering.
 */
async function start(): Promise<void> {
  const container = document.getElementById('root');
  if (!container) throw new Error('No se ha encontrado el contenedor raíz.');

  const splash = document.getElementById('splash');

  try {
    const library = new WebLibrary();
    await library.open();
    if (library.isEmpty) library.seed();

    // Ask the browser not to evict the library when storage runs low. Declined
    // permission is fine: the app still works, it is just more fragile.
    void requestPersistence();

    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    (window as any).videoteca = createWebBridge(library);

    const { App } = await import('../renderer/App.tsx');
    splash?.remove();

    createRoot(container).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  } catch (error) {
    // A failure here means no storage at all (private mode on some browsers),
    // so say what happened instead of showing an empty page forever.
    if (splash) {
      splash.innerHTML = `
        <div class="splash-error">
          <h1>No se ha podido abrir la biblioteca</h1>
          <p>${(error as Error).message}</p>
          <p class="splash-hint">
            Si estás en una ventana privada o de incógnito, ábrela en una ventana normal:
            Videoteca necesita guardar los datos en el navegador.
          </p>
        </div>`;
    }
    throw error;
  }
}

void start();

// The service worker keeps the app and its thumbnails available offline. The
// single-file build has no separate worker to register, so it opts out.
if ('serviceWorker' in navigator && import.meta.env.PROD && import.meta.env.VITE_SINGLE_FILE !== 'true') {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Offline support is a bonus; the app works without it.
    });
  });
}
