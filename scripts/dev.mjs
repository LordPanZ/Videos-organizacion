/**
 * Dev orchestrator: starts the Vite dev server for the renderer, rebuilds the
 * Electron main/preload bundles on change, and launches Electron once both are
 * ready. Ctrl-C tears everything down.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const children = [];

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const VITE_URL = 'http://localhost:5273';

run(npx, ['vite', '--host', '127.0.0.1']);
run(process.execPath, [path.join(root, 'scripts', 'build-main.mjs'), '--watch']);

async function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

if (!(await waitForServer(VITE_URL))) {
  console.error('[dev] Vite dev server did not start in time');
  shutdown(1);
}

// Give esbuild a moment to emit the first main.js.
await new Promise((r) => setTimeout(r, 800));

const electron = run(npx, ['electron', '.'], {
  env: { ...process.env, NODE_ENV: 'development', VITE_DEV_SERVER_URL: VITE_URL },
});
electron.on('exit', (code) => shutdown(code ?? 0));
