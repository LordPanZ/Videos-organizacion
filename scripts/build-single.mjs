/**
 * Folds the built web app into one HTML file.
 *
 * Two outputs come from the same bundle: a standalone page that opens straight
 * from disk, and a body-only fragment for hosts that supply their own document
 * shell.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const built = path.join(root, 'dist', 'single');
const out = path.join(root, 'dist', 'bundle');

const [js, css] = await Promise.all([
  readFile(path.join(built, 'app.js'), 'utf8'),
  readFile(path.join(built, 'app.css'), 'utf8').catch(() => ''),
]);

// A closing script tag inside a string literal would end the inline block early.
const safeJs = js.replace(/<\/script>/gi, '<\\/script>');

const splash = `
<div id="splash">
  <div>
    <div class="splash-mark">🎬</div>
    <div>Abriendo tu videoteca…</div>
  </div>
</div>
<div id="root"></div>`;

const splashCss = `
#splash {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: #0d0f14;
  color: #e7eaf0;
  font: 15px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  z-index: 999;
  padding: 24px;
  text-align: center;
}
.splash-mark {
  width: 64px;
  height: 64px;
  border-radius: 18px;
  margin: 0 auto 18px;
  background: linear-gradient(135deg, #4c8dff, #b04cff);
  display: grid;
  place-items: center;
  font-size: 30px;
}
.splash-error h1 { font-size: 17px; margin: 0 0 10px; }
.splash-error p { margin: 0 0 8px; opacity: .8; max-width: 420px; }
.splash-hint { font-size: 13px; opacity: .6 !important; }`;

const body = `<title>Videoteca</title>
<style>
${css}
${splashCss}
</style>
${splash}
<script type="module">
${safeJs}
</script>`;

const standalone = `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0d0f14">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Videoteca">
<meta name="description" content="Organiza y guarda vídeos de YouTube, TikTok, Instagram y más. Todo en tu propio dispositivo.">
</head>
<body>
${body}
</body>
</html>`;

await mkdir(out, { recursive: true });
await writeFile(path.join(out, 'videoteca.html'), standalone, 'utf8');
await writeFile(path.join(out, 'videoteca.body.html'), body, 'utf8');

const kb = (text) => `${Math.round(Buffer.byteLength(text, 'utf8') / 1024)} kB`;
console.log(`videoteca.html       ${kb(standalone)}`);
console.log(`videoteca.body.html  ${kb(body)}`);
