import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Build for the browser (the installable web app).
 *
 * `base` has to match where the site is served from. GitHub Pages puts a
 * project site under /<repo>/, so it is taken from an environment variable and
 * defaults to that path.
 */
export default defineConfig({
  base: process.env.VIDEOTECA_BASE ?? '/Videos-organizacion/',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@renderer': fileURLToPath(new URL('./src/renderer', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Keep React in its own file so an app update does not force the whole
        // bundle to download again over mobile data.
        manualChunks: { react: ['react', 'react-dom'] },
      },
    },
  },
  server: { port: 5274, host: true },
});
