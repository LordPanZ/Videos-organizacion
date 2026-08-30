import { app, BrowserWindow, nativeTheme, net, protocol, shell } from 'electron';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { AppContext } from './context.ts';
import { registerIpc } from './ipc.ts';
import { buildMenu } from './menu.ts';
import { resolvePaths } from './paths.ts';

// The main process is bundled as CommonJS, so `__dirname` is the reliable way
// to locate sibling build output — `import.meta.url` is empty in that format.
const BUNDLE_DIR = __dirname;

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? null;
const isDev = DEV_SERVER_URL !== null;

// Must be declared before `app.whenReady()`: it lets `vt-media://` behave like
// a regular http source, so <img> and <video> can stream from it.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'vt-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
  },
]);

let mainWindow: BrowserWindow | null = null;
let context: AppContext | null = null;

// Only one instance may own the library file; a second launch focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/**
 * `vt-media://` serves images and video files from the app's own directories.
 *
 * The renderer never gets filesystem access, and this handler refuses any path
 * that escapes the thumbnail cache or the configured download folder, so a
 * crafted URL cannot read arbitrary files.
 */
function registerMediaProtocol(active: AppContext): void {
  protocol.handle('vt-media', async (request) => {
    const url = new URL(request.url);
    const target = decodeURIComponent(url.pathname).replace(/^\/+/, '');

    let absolute: string;
    if (url.hostname === 'thumb') {
      absolute = active.thumbnails.absolutePath(target);
    } else if (url.hostname === 'file') {
      absolute = path.resolve(process.platform === 'win32' ? target : `/${target}`);
      const allowedRoots = [path.resolve(active.settings.downloadPath), path.resolve(active.paths.userData)];
      if (!allowedRoots.some((root) => absolute === root || absolute.startsWith(root + path.sep))) {
        return new Response('Ruta no permitida', { status: 403 });
      }
    } else {
      return new Response('No encontrado', { status: 404 });
    }

    if (!existsSync(absolute)) return new Response('No encontrado', { status: 404 });
    return net.fetch(pathToFileURL(absolute).toString());
  });
}

function createWindow(active: AppContext): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: active.settings.theme === 'light' ? '#f6f7f9' : '#0f1115',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(BUNDLE_DIR, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      webSecurity: true,
    },
  });

  window.once('ready-to-show', () => window.show());

  // External links open in the user's browser, never inside the app shell.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(new URL(url).protocol)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    const isDevServer = DEV_SERVER_URL !== null && url.startsWith(DEV_SERVER_URL);
    if (!isDevServer && !url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:$/.test(new URL(url).protocol)) void shell.openExternal(url);
    }
  });

  if (DEV_SERVER_URL) {
    void window.loadURL(DEV_SERVER_URL);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    void window.loadFile(path.join(BUNDLE_DIR, '..', 'renderer', 'index.html'));
  }

  return window;
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  context = await AppContext.create(resolvePaths());

  nativeTheme.themeSource = context.settings.theme;

  registerMediaProtocol(context);
  registerIpc(context);
  buildMenu(() => mainWindow);

  mainWindow = createWindow(context);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && context) {
      mainWindow = createWindow(context);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  context?.close();
  context = null;
});

if (isDev) {
  // Surface renderer crashes in the terminal during development.
  process.on('unhandledRejection', (reason) => console.error('[main] unhandled rejection:', reason));
}
