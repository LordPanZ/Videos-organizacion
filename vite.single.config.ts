import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Builds the web app as one self-contained page: no code splitting, no
 * separate asset files, everything ready to be folded into a single HTML file.
 */
export default defineConfig({
  base: './',
  define: { 'import.meta.env.VITE_SINGLE_FILE': JSON.stringify('true') },
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@renderer': fileURLToPath(new URL('./src/renderer', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist/single',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    // Fold every image and font into the JavaScript rather than emitting files.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
});
