import { spawn } from 'node:child_process';
import { access, chmod } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ToolStatus } from '../../shared/types.ts';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  timeoutMs?: number;
  /** Called for every line written to stdout, as it arrives. */
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
  signal?: AbortSignal;
  cwd?: string;
}

/**
 * Runs an external binary and collects its output.
 *
 * Arguments are passed as an array and the shell is never involved, so URLs and
 * file paths coming from the library cannot be interpreted as shell syntax.
 */
export function run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, windowsHide: true });

    let stdout = '';
    let stderr = '';
    let stdoutRest = '';
    let stderrRest = '';
    let settled = false;

    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill();
          if (!settled) {
            settled = true;
            reject(new Error(`"${path.basename(command)}" superó el tiempo límite de ${options.timeoutMs} ms.`));
          }
        }, options.timeoutMs)
      : null;

    const abort = () => child.kill();
    options.signal?.addEventListener('abort', abort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (!options.onStdout) return;
      stdoutRest += chunk;
      const lines = stdoutRest.split(/\r?\n|\r/);
      stdoutRest = lines.pop() ?? '';
      for (const line of lines) options.onStdout(line);
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      if (!options.onStderr) return;
      stderrRest += chunk;
      const lines = stderrRest.split(/\r?\n|\r/);
      stderrRest = lines.pop() ?? '';
      for (const line of lines) options.onStderr(line);
    });

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    };

    child.on('error', (error) => {
      cleanup();
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.on('close', (code) => {
      cleanup();
      if (stdoutRest && options.onStdout) options.onStdout(stdoutRest);
      if (stderrRest && options.onStderr) options.onStderr(stderrRest);
      if (!settled) {
        settled = true;
        resolve({ code, stdout, stderr });
      }
    });
  });
}

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Directories searched in addition to PATH, covering common installs. */
function extraSearchPaths(): string[] {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return [
      path.join(home, 'AppData', 'Local', 'Programs'),
      'C:\\Program Files',
      'C:\\Program Files (x86)',
      'C:\\ProgramData\\chocolatey\\bin',
    ];
  }
  return [
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/opt/homebrew/bin',
    '/opt/local/bin',
    '/snap/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, 'bin'),
  ];
}

/**
 * Finds an external tool, preferring an explicitly configured path, then the
 * app's own managed copy, then PATH, then well-known install locations.
 */
export async function findTool(
  name: 'yt-dlp' | 'ffmpeg' | 'ffprobe',
  configuredPath: string | null,
  managedDir: string | null,
): Promise<string | null> {
  const executable = process.platform === 'win32' ? `${name}.exe` : name;

  if (configuredPath && (await isExecutable(configuredPath))) return configuredPath;

  if (managedDir) {
    const managed = path.join(managedDir, executable);
    if (await isExecutable(managed)) return managed;
  }

  // PATH lookup, without relying on `which` being present.
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of [...pathDirs, ...extraSearchPaths()]) {
    const candidate = path.join(dir, executable);
    if (await isExecutable(candidate)) return candidate;
  }

  return null;
}

/** Reports whether a tool is present and which version it reports. */
export async function toolStatus(
  name: 'yt-dlp' | 'ffmpeg' | 'ffprobe',
  configuredPath: string | null,
  managedDir: string | null,
): Promise<ToolStatus> {
  const found = await findTool(name, configuredPath, managedDir);
  if (!found) return { name, available: false, path: null, version: null };

  try {
    const result = await run(found, ['--version'], { timeoutMs: 10_000 });
    const firstLine = (result.stdout || result.stderr).split(/\r?\n/)[0]?.trim() ?? null;
    return { name, available: true, path: found, version: firstLine };
  } catch {
    return { name, available: true, path: found, version: null };
  }
}

/** Marks a downloaded binary executable on POSIX systems. */
export async function makeExecutable(file: string): Promise<void> {
  if (process.platform === 'win32') return;
  await chmod(file, 0o755);
}

/** The asset name yt-dlp publishes for the current platform. */
export function ytdlpAssetName(): string {
  if (process.platform === 'win32') return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  return 'yt-dlp';
}
