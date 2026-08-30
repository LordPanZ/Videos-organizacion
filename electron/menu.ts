import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';

/** Tells the renderer to run a command; the UI owns what each one means. */
function send(window: BrowserWindow | null, command: string): void {
  window?.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent('videoteca:command', { detail: ${JSON.stringify(command)} }))`,
  ).catch(() => {
    /* the window closed mid-dispatch */
  });
}

/** Builds and installs the application menu, including its accelerators. */
export function buildMenu(getWindow: () => BrowserWindow | null): void {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about', label: 'Acerca de Videoteca' },
              { type: 'separator' },
              { label: 'Ajustes…', accelerator: 'Cmd+,', click: () => send(getWindow(), 'settings') },
              { type: 'separator' },
              { role: 'hide', label: 'Ocultar Videoteca' },
              { role: 'hideOthers', label: 'Ocultar otras' },
              { role: 'unhide', label: 'Mostrar todo' },
              { type: 'separator' },
              { role: 'quit', label: 'Salir de Videoteca' },
            ],
          },
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'Archivo',
      submenu: [
        { label: 'Añadir vídeos…', accelerator: 'CmdOrCtrl+N', click: () => send(getWindow(), 'add') },
        { label: 'Pegar enlaces del portapapeles', accelerator: 'CmdOrCtrl+Shift+V', click: () => send(getWindow(), 'paste') },
        { label: 'Escanear carpeta…', accelerator: 'CmdOrCtrl+Shift+O', click: () => send(getWindow(), 'scan') },
        { type: 'separator' },
        { label: 'Exportar biblioteca…', click: () => send(getWindow(), 'export') },
        { label: 'Importar biblioteca…', click: () => send(getWindow(), 'import') },
        { label: 'Copia de seguridad', click: () => send(getWindow(), 'backup') },
        { type: 'separator' },
        ...(isMac ? [] : ([{ label: 'Ajustes…', accelerator: 'Ctrl+,', click: () => send(getWindow(), 'settings') }] as MenuItemConstructorOptions[])),
        isMac ? { role: 'close', label: 'Cerrar' } : { role: 'quit', label: 'Salir' },
      ],
    },
    {
      label: 'Edición',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' },
        { type: 'separator' },
        { label: 'Buscar', accelerator: 'CmdOrCtrl+F', click: () => send(getWindow(), 'focus-search') },
        { label: 'Paleta de comandos', accelerator: 'CmdOrCtrl+K', click: () => send(getWindow(), 'palette') },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { label: 'Cuadrícula', accelerator: 'CmdOrCtrl+1', click: () => send(getWindow(), 'layout:grid') },
        { label: 'Mosaico', accelerator: 'CmdOrCtrl+2', click: () => send(getWindow(), 'layout:masonry') },
        { label: 'Lista', accelerator: 'CmdOrCtrl+3', click: () => send(getWindow(), 'layout:list') },
        { label: 'Tabla', accelerator: 'CmdOrCtrl+4', click: () => send(getWindow(), 'layout:table') },
        { type: 'separator' },
        { label: 'Panel de estadísticas', accelerator: 'CmdOrCtrl+D', click: () => send(getWindow(), 'dashboard') },
        { label: 'Descargas', accelerator: 'CmdOrCtrl+J', click: () => send(getWindow(), 'downloads') },
        { type: 'separator' },
        { role: 'reload', label: 'Recargar' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Tamaño real' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
      ],
    },
    {
      label: 'Ventana',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        ...(isMac ? ([{ role: 'zoom', label: 'Zoom' }, { type: 'separator' }, { role: 'front', label: 'Traer todo al frente' }] as MenuItemConstructorOptions[]) : []),
      ],
    },
    {
      role: 'help',
      label: 'Ayuda',
      submenu: [
        { label: 'Guía de búsqueda', click: () => send(getWindow(), 'help') },
        { label: 'Atajos de teclado', click: () => send(getWindow(), 'shortcuts') },
        { type: 'separator' },
        { label: 'Instalar yt-dlp', click: () => send(getWindow(), 'install-ytdlp') },
        { label: 'Sitio de yt-dlp', click: () => void shell.openExternal('https://github.com/yt-dlp/yt-dlp') },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
