/** Browser-like identification; some sites reject unknown clients outright. */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export interface FetchTextOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Stop reading after this many bytes; HTML pages can be enormous. */
  maxBytes?: number;
}

/** Fetches a URL as text, with a timeout and a hard size cap. */
export async function fetchText(url: string, options: FetchTextOptions = {}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        ...options.headers,
      },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status} al abrir ${url}`);

    const maxBytes = options.maxBytes ?? 2_000_000;
    if (!response.body) return await response.text();

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let text = '';
    let received = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (received >= maxBytes) {
        await reader.cancel();
        break;
      }
    }
    return text + decoder.decode();
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/** Fetches and parses a JSON endpoint. */
export async function fetchJson<T>(url: string, options: FetchTextOptions = {}): Promise<T> {
  const text = await fetchText(url, { maxBytes: 1_000_000, ...options });
  return JSON.parse(text) as T;
}

/** Downloads binary content, refusing anything over `maxBytes`. */
export async function fetchBuffer(
  url: string,
  options: { signal?: AbortSignal; timeoutMs?: number; maxBytes?: number } = {},
): Promise<{ data: Buffer; contentType: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} al descargar ${url}`);

    const maxBytes = options.maxBytes ?? 12_000_000;
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > maxBytes) throw new Error('El archivo supera el tamaño permitido.');

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw new Error('El archivo supera el tamaño permitido.');

    return { data: buffer, contentType: response.headers.get('content-type') };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
