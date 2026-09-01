# 🎬 Videoteca

**Tu biblioteca personal de vídeos de YouTube, TikTok, Instagram, Vimeo y +1000 plataformas.**
Disponible en dos formas: una **app web instalable** para el móvil y una **aplicación de escritorio**
para Windows, macOS y Linux. Todo local, sin cuentas, sin nube, sin telemetría.

## 📱 En el móvil

### 👉 **https://lordpanz.github.io/Videos-organizacion/**

Se abre en el navegador y se instala en la pantalla de inicio como cualquier otra app:

- **Android (Chrome)**: menú ⋮ → *Añadir a la pantalla de inicio*
- **iPhone (Safari)**: botón compartir → *Añadir a pantalla de inicio*

A partir de ahí se abre a pantalla completa, sin barra del navegador, y **funciona sin conexión**.
La biblioteca se guarda en el propio teléfono; nada se envía a ningún servidor.

Lo único que la versión web no puede hacer es **descargar los vídeos**: eso necesita un programa
externo que solo puede ejecutarse en un ordenador. Todo lo demás —catalogar, etiquetar, buscar,
organizar— funciona igual.

## 💻 En el ordenador

Instaladores para Windows, macOS y Linux en la
[página de versiones](https://github.com/LordPanZ/Videos-organizacion/releases).

---

## Qué hace

Pegas un enlace y Videoteca se encarga del resto: descarga la miniatura, lee el título, el autor, la
duración y la fecha, genera etiquetas automáticamente y lo coloca en tu biblioteca. A partir de ahí
puedes encontrarlo por lo que sea: plataforma, temática, creador, duración, año, valoración… o por
los parámetros que tú mismo inventes.

### Miniaturas siempre

- YouTube y Vimeo dan su miniatura sin ninguna petición: se deduce de la propia dirección.
- Con **yt-dlp** instalado (escritorio) se obtiene la de casi cualquier sitio, Instagram incluido.
- **Instagram sin yt-dlp**: se intenta leer su página de inserción, que es la única vía que no
  requiere cuenta. No siempre responde, porque Instagram cambia lo que sirve a visitantes sin sesión.
- Cuando nada de lo anterior da resultado, **puedes poner tu propia imagen**: una captura del móvil,
  una foto, o pegar una imagen del portapapeles. Se reescala y se guarda en el dispositivo.
- Y si aún así no hay imagen, la tarjeta no queda en blanco: se dibuja una **portada generada** a
  partir del propio vídeo, teñida con el color de su plataforma, distinta para cada uno.

### Muy visual

- **Cuadrícula de miniaturas** con tamaño ajustable de 150 a 420 px, para reconocer un vídeo de un vistazo.
- Distintivo con el **color de marca de cada plataforma**, duración, barra de progreso y estrellas sobre la propia miniatura.
- Cuatro vistas: **cuadrícula**, **mosaico**, **lista** y **tabla** (hoja de cálculo con columnas ordenables).
- Las miniaturas se **guardan en local**: al hacer scroll nunca esperas a la red.
- Tema **oscuro y claro**, con ocho colores de acento.

### Etiquetado automático

Cada vídeo que entra recibe etiquetas sin que hagas nada:

| Origen | Ejemplo |
|---|---|
| Plataforma | `YouTube`, `TikTok`, `Instagram` |
| Creador | `Cocina Fácil` |
| Año de publicación | `2024` |
| Franja de duración | `Menos de 1 min`, `5 – 20 min`, `Más de 1 h` |
| Hashtags del título y la descripción | `#paella` → `paella` |
| Etiquetas y categorías de la propia plataforma | `cocina`, `arroz`, `Howto` |

Además puedes definir **reglas propias**: «si el título contiene *tutorial*, etiqueta como
`Aprendizaje` y pon Prioridad = Alta». Las palabras genéricas (`viral`, `fyp`, `parati`…) se
descartan para que no acaben etiquetando media biblioteca.

Las etiquetas son **jerárquicas**: si `Repostería` cuelga de `Cocina`, buscar `#cocina` también
encuentra la repostería.

### Tantos parámetros como quieras

Los **campos personalizados** son la pieza central: creas los tuyos y el resto de la aplicación se
adapta sola. Hay diez tipos: texto, texto largo, número, sí/no, fecha, lista de una opción, lista de
varias, valoración, enlace y duración.

En cuanto creas un campo llamado *Cliente*, al instante:

- se puede filtrar escribiendo `cliente:acme` en la barra de búsqueda;
- aparece como faceta en el panel lateral, con recuento por valor;
- se puede añadir como columna en la vista de tabla;
- se puede asignar en bloque a cientos de vídeos a la vez.

### Búsqueda de verdad

Un lenguaje de consulta completo sobre un índice de texto **FTS5** que ignora acentos
(*programacion* encuentra *Programación*):

```
paella                        texto libre en título, descripción, autor, etiquetas y notas
"paella valenciana"           frase exacta
platform:youtube              solo de YouTube (o p:yt, p:tiktok, p:instagram…)
#cocina                       etiqueta «cocina», incluidas sus subetiquetas
-#spam                        excluye una etiqueta
@midudev                      por creador
duration>10                   más de 10 minutos (un número suelto son minutos)
duration<90s                  menos de 90 segundos
rating>=4                     cuatro estrellas o más
added:>7d                     añadidos en los últimos 7 días
published:2024                publicados en 2024
views>100000                  más de cien mil visualizaciones
size>500mb                    archivos descargados grandes
is:favorito                   favorito · descargado · visto · pendiente · corto · sinetiquetas · nodisponible
has:notas                     notas · archivo · miniatura · marcadores · etiquetas
prioridad:alta                cualquier campo personalizado tuyo
col:"Ver luego"               dentro de una colección
(p:youtube OR p:vimeo) -is:visto      paréntesis, OR y negación
```

Los alias funcionan en español y en inglés: `duración>10`, `año:2024`, `etiqueta:cocina`,
`autor:midu` son equivalentes a sus formas inglesas. Si te equivocas, la aplicación avisa con un
mensaje concreto en lugar de devolver cero resultados en silencio.

### Organización

- **Colecciones manuales** con orden propio, para listas curadas.
- **Colecciones inteligentes**: guardas una búsqueda y se mantiene al día sola.
- **Vistas guardadas** en el panel lateral (ocho vienen ya hechas).
- **Panel lateral con facetas** y recuentos en vivo: plataformas, etiquetas, creadores, campos
  personalizados, duración y años.
- **Miniaturas para X**: X no publica miniatura por la vía habitual, así que se consulta su propio
  servicio de incrustación, que además devuelve el texto del post como título. Es a la primera:
  si el servicio no responde, el vídeo se queda con la portada de su cuenta y nada más cambia.
  En el contenedor hay un botón *Buscar miniaturas* para los que aún no tengan.
- **Portada inventada con sentido**: cuando la plataforma no da ninguna imagen, la portada lleva
  las iniciales de la cuenta, no las de la plataforma — si no, todos los vídeos de X saldrían con
  las mismas dos letras. Y con 🖼 en la propia tarjeta se le pone una captura tuya.
- **Compartir por WhatsApp**: cada vídeo tiene su botón, que manda el nombre y el enlace original.
  Donde el móvil ofrece su propio menú de compartir, hay además un botón para cualquier otra
  aplicación. Viaja el enlace, no una copia del vídeo.
- **Título editable**: pulsa sobre el nombre de un vídeo y escribe otro. Instagram y otras
  plataformas no entregan sus datos, así que llegan con un nombre provisional; una vez renombrado,
  el buscador lo encuentra por el nombre nuevo.
- **Marcadores con marca de tiempo** dentro de cada vídeo, y notas libres.
- **Edición en bloque**: etiquetar, valorar, asignar campos, mover a colecciones o descargar cientos
  de vídeos de una vez.
- **Detección de duplicados**, con un botón para conservar la copia buena.
- **Contenedor**: al pegar un enlace puedes marcar la casilla *Contenedor* y ese vídeo se guarda
  aparte. No sale en la portada, ni en la biblioteca, ni en las búsquedas, ni en las estadísticas,
  ni en los recuentos del panel lateral. Para verlo hay que abrir *Contenedor* y escribir la clave
  (**9441**), que vuelve a pedirse cada vez que se abre la aplicación. Es una tapa contra miradas
  ajenas en un móvil compartido, **no cifrado**: los vídeos se guardan como todos los demás y
  siguen apareciendo en las copias de seguridad que exportes.

### Guardar de verdad

Con [yt-dlp](https://github.com/yt-dlp/yt-dlp) instalado (se instala **con un clic desde Ajustes**),
Videoteca descarga los vídeos: elección de calidad hasta 4K, solo audio, subtítulos y miniatura
incrustados, cola con progreso real, velocidad y tiempo restante, y reanudación tras reiniciar.

Sin yt-dlp la aplicación sigue funcionando: usa los puntos oEmbed públicos y las etiquetas Open Graph
de cada sitio para sacar título, autor y miniatura.

### Además

- **Importación masiva**: pega cientos de enlaces de golpe, importa una lista o un canal entero,
  arrastra y suelta enlaces o archivos sobre la ventana, o escanea una carpeta de vídeos locales.
- **Paleta de comandos** con `Ctrl/Cmd + K` y atajos para todo.
- **Panel de estadísticas**: duración total, distribución por plataforma y etiqueta, crecimiento por
  mes, uso de disco.
- **Comprobación de enlaces rotos**: marca lo que ya no está disponible, es privado o está bloqueado.
- **Exportación** a JSON, CSV, HTML (una página navegable con miniaturas), TXT y M3U. Y reimportación.
- **Copias de seguridad** en un clic.

---

## Instalación

Descarga el instalador de tu sistema desde la sección *Releases*, o compílalo tú:

```bash
git clone https://github.com/LordPanZ/Videos-organizacion.git
cd Videos-organizacion
npm install
npm run dev        # desarrollo, con recarga en caliente
```

Para generar los instaladores:

```bash
npm run dist:win     # Windows: instalador NSIS (x64 y ARM64) + versión portable
npm run dist:mac     # macOS: DMG (Intel y Apple Silicon)
npm run dist:linux   # Linux: AppImage y .deb
```

Los archivos aparecen en `release/<versión>/`.

> **Requisitos:** Node.js 20 o superior para compilar. La aplicación ya compilada no necesita nada.
> `yt-dlp` y `ffmpeg` son opcionales y se detectan solos si ya los tienes en el sistema.

---

## Dónde se guardan tus datos

Todo vive en la carpeta de datos de la aplicación, que puedes ver en *Ajustes → Datos*:

| Ruta | Contenido |
|---|---|
| `videoteca.db` | Base de datos SQLite con vídeos, etiquetas, colecciones y campos |
| `thumbnails/` | Miniaturas cacheadas |
| `tools/` | `yt-dlp` si lo instalas desde la aplicación |
| `backups/` | Copias de seguridad |

Los vídeos descargados van a `Vídeos/Videoteca` por omisión, y esa carpeta se puede cambiar.

Nada sale de tu equipo salvo las peticiones necesarias para leer metadatos y bajar miniaturas de las
plataformas de origen.

---

## Cómo está hecho

| Capa | Tecnología |
|---|---|
| Escritorio | Electron 43 con aislamiento de contexto y sin integración de Node en la interfaz |
| Móvil / web | App web instalable (PWA) con service worker para uso sin conexión |
| Interfaz | React 19 + TypeScript, con Zustand para el estado — **la misma en ambas versiones** |
| Datos (escritorio) | SQLite mediante better-sqlite3, en modo WAL, con índice FTS5 |
| Datos (móvil) | IndexedDB, con la biblioteca en memoria y escritura continua |
| Empaquetado | Vite, esbuild para el proceso principal, electron-builder para los instaladores |
| Metadatos | Escritorio: yt-dlp → oEmbed → Open Graph → URL. Móvil: oEmbed → URL |

```
electron/          proceso principal, precarga, IPC, menú
src/core/          lógica de dominio (base de datos, metadatos, servicios) — sin Electron
src/shared/        tipos y lenguaje de consulta compartidos por todas las versiones
src/renderer/      interfaz React, común a escritorio y móvil
src/web/           almacén IndexedDB, motor de búsqueda en memoria y puente del navegador
test/              118 pruebas
```

El `src/core` no importa Electron en ningún punto: por eso puede probarse con Node a secas, y por eso
las 118 pruebas se ejecutan en menos de un segundo.

### Una misma interfaz en dos mundos

La interfaz nunca habla con la base de datos: siempre llama a `window.videoteca`. En el escritorio ese
objeto lo instala el *preload* de Electron; en el navegador lo instala `src/web/bridge.ts`. Como ambos
implementan el mismo contrato, **los componentes de React son literalmente los mismos** en las dos
versiones, sin condicionales por plataforma repartidos por el código.

El lenguaje de búsqueda se comparte igual: el analizador vive en `src/shared/query/`, y solo cambia
qué hace con el resultado —el escritorio lo compila a SQL, el móvil lo evalúa en memoria— con
semánticas deliberadamente idénticas, para que la misma consulta dé el mismo resultado en ambos.

### Decisiones que quizá te interesen

- **Un `vt-media://` propio** sirve miniaturas y archivos locales a la interfaz. Rechaza cualquier
  ruta fuera del caché o de la carpeta de descargas, así que la interfaz nunca toca el disco directamente.
- **El índice de búsqueda se mantiene a mano**, no con disparadores de SQLite, porque un cambio de
  etiqueta o de autor también tiene que refrescar el documento y un disparador sobre `videos` no se
  enteraría.
- **La fila del vídeo se escribe antes de pedir los metadatos**, de modo que pegar 300 enlaces llena
  la cuadrícula al instante y los datos van entrando solos.
- **Los parámetros de seguimiento se eliminan de las URL** (`si`, `igshid`, `fbclid`…) antes de
  guardar: es lo que permite detectar que dos enlaces distintos son el mismo vídeo.
- **`parseQuery` nunca lanza excepciones.** Ante una consulta rota devuelve el mejor árbol posible más
  un aviso, porque quedarse sin resultados mientras escribes es peor que un resultado aproximado.

---

## Comandos

```bash
npm run dev          # escritorio, con recarga en caliente
npm run dev:web      # app web, con recarga en caliente
npm test             # 118 pruebas
npm run typecheck    # TypeScript en modo estricto, interfaz y Node
npm run build        # compila la app de escritorio a dist/
npm run build:web    # compila la app web a dist/web/
npm run dist         # instaladores para la plataforma actual
```

---

## Atajos

| Atajo | Acción |
|---|---|
| `Ctrl/Cmd + K` | Paleta de comandos |
| `Ctrl/Cmd + F` | Ir a la búsqueda |
| `Ctrl/Cmd + N` | Añadir vídeos |
| `Ctrl/Cmd + Shift + V` | Importar enlaces del portapapeles |
| `Ctrl/Cmd + A` | Seleccionar todo |
| `Ctrl/Cmd + 1…4` | Cambiar de vista |
| `Ctrl/Cmd + D` | Estadísticas |
| `Ctrl/Cmd + J` | Descargas |
| `Espacio` | Panel de detalle |
| `Intro` | Reproducir |
| `Supr` | Eliminar la selección |
| `Esc` | Cerrar o limpiar la selección |

---

## Licencia

MIT. Videoteca es un organizador: descarga solo lo que tú le pidas y respeta los términos de servicio
de cada plataforma, que eres tú quien debe cumplir.
