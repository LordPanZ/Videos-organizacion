import { build } from 'esbuild';
import { rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const outdir = path.join(root, 'dist', 'main');
const watch = process.argv.includes('--watch');
const dev = watch || process.argv.includes('--dev');

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

/** Shared esbuild options for everything that runs inside Electron's Node side. */
const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  minify: !dev,
  define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
  // Native modules and Electron itself must stay external and be resolved at runtime.
  external: ['electron', 'better-sqlite3'],
  logLevel: 'info',
};

const targets = [
  {
    ...common,
    entryPoints: [path.join(root, 'electron', 'main.ts')],
    outfile: path.join(outdir, 'main.js'),
    format: 'cjs',
  },
  {
    ...common,
    // The preload runs in a sandboxed-ish context: CommonJS is required.
    entryPoints: [path.join(root, 'electron', 'preload.ts')],
    outfile: path.join(outdir, 'preload.js'),
    format: 'cjs',
  },
];

if (watch) {
  const { context } = await import('esbuild');
  for (const options of targets) {
    const ctx = await context(options);
    await ctx.watch();
  }
  console.log('[build-main] watching...');
} else {
  await Promise.all(targets.map((options) => build(options)));
  console.log('[build-main] done');
}
