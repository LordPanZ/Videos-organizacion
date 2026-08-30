/**
 * Custom cover images.
 *
 * Some platforms — Instagram above all — expose no predictable thumbnail URL
 * and refuse to be read from a browser, so there is no way to derive a picture
 * automatically. Letting the user attach one (a screenshot, typically) closes
 * that gap for any video, on any platform.
 */

/** Longest edge of a stored cover. Beyond this the extra pixels are wasted. */
const MAX_EDGE = 720;
const QUALITY = 0.82;

export interface PreparedCover {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Downscales and re-encodes an image so a 4 MB phone screenshot becomes a
 * cover worth storing. Returns a JPEG data URL.
 */
export function prepareCover(file: File | Blob): Promise<PreparedCover> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);

      const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('El navegador no ha podido procesar la imagen.'));
        return;
      }

      // A white ground keeps transparent PNGs from turning black as JPEG.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);

      const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
      resolve({ dataUrl, width, height, bytes: Math.round((dataUrl.length * 3) / 4) });
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Ese archivo no es una imagen que se pueda leer.'));
    };

    image.src = url;
  });
}

/**
 * Opens the device's image picker. On a phone this offers the camera and the
 * photo library, which is exactly where a screenshot lives.
 */
export function pickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/** Pulls the first image out of a paste event, if there is one. */
export function imageFromClipboard(event: ClipboardEvent): File | null {
  for (const item of event.clipboardData?.items ?? []) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

/**
 * A deterministic cover for videos with no picture at all.
 *
 * Derived from the video's own id so it stays the same across sessions, and
 * tinted with the platform colour so a grid of them still reads as sorted
 * rather than broken.
 */
export function generatedCover(id: string, platformColor: string): { background: string } {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  const angle = hash % 360;
  const tilt = 120 + (hash % 90);

  return {
    background: `
      radial-gradient(120% 90% at ${20 + (hash % 60)}% ${15 + ((hash >> 3) % 50)}%,
        color-mix(in srgb, ${platformColor} 42%, transparent) 0%,
        transparent 62%),
      linear-gradient(${tilt}deg,
        hsl(${angle} 28% 18%) 0%,
        hsl(${(angle + 40) % 360} 24% 12%) 100%)`,
  };
}

/** Two-letter monogram for the generated cover. */
export function initialsFor(title: string): string {
  const words = title
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * True when the picture on screen is one the user attached.
 *
 * The two builds store it differently — the browser hands back an object URL,
 * the desktop a file in the cache — so both shapes are recognised here rather
 * than leaking the difference into the components.
 */
export function hasCustomCover(video: { thumbnailUrl: string | null; thumbnailPath: string | null }): boolean {
  if (video.thumbnailPath?.includes('cover-')) return true;
  return video.thumbnailUrl?.startsWith('blob:') ?? false;
}
