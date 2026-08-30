import { app } from 'electron';
import path from 'node:path';

/** Every filesystem location the app owns, resolved once at startup. */
export interface AppPaths {
  userData: string;
  database: string;
  thumbnails: string;
  tools: string;
  defaultDownloads: string;
  backups: string;
}

export function resolvePaths(): AppPaths {
  const userData = app.getPath('userData');
  return {
    userData,
    database: path.join(userData, 'videoteca.db'),
    thumbnails: path.join(userData, 'thumbnails'),
    tools: path.join(userData, 'tools'),
    backups: path.join(userData, 'backups'),
    defaultDownloads: path.join(app.getPath('videos'), 'Videoteca'),
  };
}
