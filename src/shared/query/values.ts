/**
 * Value parsers for the query language. Shared so the search bar can validate
 * what the user types with exactly the same rules the SQL compiler applies.
 */

/** A half-open interval [start, end) in milliseconds since the epoch. */
export interface DateRange {
  start: number | null;
  end: number | null;
}

const DURATION_UNITS: Record<string, number> = {
  s: 1,
  sec: 1,
  secs: 1,
  seg: 1,
  segs: 1,
  segundo: 1,
  segundos: 1,
  m: 60,
  min: 60,
  mins: 60,
  minuto: 60,
  minutos: 60,
  h: 3600,
  hr: 3600,
  hrs: 3600,
  hour: 3600,
  hours: 3600,
  hora: 3600,
  horas: 3600,
  d: 86400,
  day: 86400,
  days: 86400,
  dia: 86400,
  dias: 86400,
};

/**
 * Parses a duration into seconds.
 *
 * Accepts `90s`, `10m`, `1h30m`, `2h`, `1:30` (mm:ss), `1:30:00` (hh:mm:ss).
 * A bare number is read as **minutes**, because `duration>10` almost always
 * means "longer than ten minutes" rather than ten seconds.
 */
export function parseDuration(input: string): number | null {
  const value = input.trim().toLowerCase();
  if (value === '') return null;

  // Clock notation: mm:ss or hh:mm:ss
  if (value.includes(':')) {
    const parts = value.split(':');
    if (parts.length > 3 || parts.some((p) => p === '' || !/^\d+(\.\d+)?$/.test(p))) return null;
    const numbers = parts.map(Number);
    if (numbers.some(Number.isNaN)) return null;
    return numbers.reduce((total, n) => total * 60 + n, 0);
  }

  // Bare number → minutes.
  if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value) * 60);

  // Compound: 1h30m10s (spaces between parts are allowed). The anchored test
  // rejects leftovers such as "10mfoo" before any summing happens.
  const compact = value.replace(/\s+/g, '');
  if (!/^(?:\d+(?:\.\d+)?[a-z]+)+$/.test(compact)) return null;

  let total = 0;
  const pattern = /(\d+(?:\.\d+)?)([a-z]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(compact)) !== null) {
    const unit = DURATION_UNITS[match[2]];
    if (unit === undefined) return null;
    total += Number(match[1]) * unit;
  }
  return Math.round(total);
}

/** Renders seconds as `1:02:03` / `4:05`. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Renders seconds as a human sentence, e.g. `3 h 12 min`. */
export function formatDurationLong(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '0 min';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  if (m > 0) return `${m} min`;
  return `${Math.round(seconds)} s`;
}

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  byte: 1,
  bytes: 1,
  k: 1024,
  kb: 1024,
  kib: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  mib: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
  gib: 1024 ** 3,
  t: 1024 ** 4,
  tb: 1024 ** 4,
  tib: 1024 ** 4,
};

/** Parses `500mb`, `1.5gb`, `2048` (bare number = bytes) into bytes. */
export function parseSize(input: string): number | null {
  const value = input.trim().toLowerCase().replace(/\s+/g, '');
  if (value === '') return null;
  const match = /^(\d+(?:\.\d+)?)([a-z]*)$/.exec(value);
  if (!match) return null;
  const unit = match[2] === '' ? 1 : SIZE_UNITS[match[2]];
  if (unit === undefined) return null;
  return Math.round(Number(match[1]) * unit);
}

/** Renders bytes as `1,4 GB`. */
export function formatSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1).replace('.', ',')} ${units[index]}`;
}

const RELATIVE_UNITS: Record<string, number> = {
  h: 3600_000,
  hora: 3600_000,
  horas: 3600_000,
  hour: 3600_000,
  hours: 3600_000,
  d: 86_400_000,
  dia: 86_400_000,
  dias: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  sem: 604_800_000,
  semana: 604_800_000,
  semanas: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
  m: 2_592_000_000, // 30 days
  mes: 2_592_000_000,
  meses: 2_592_000_000,
  month: 2_592_000_000,
  months: 2_592_000_000,
  y: 31_536_000_000, // 365 days
  a: 31_536_000_000,
  ano: 31_536_000_000,
  anos: 31_536_000_000,
  year: 31_536_000_000,
  years: 31_536_000_000,
};

const NAMED_RANGES = new Set([
  'today',
  'hoy',
  'yesterday',
  'ayer',
  'week',
  'semana',
  'month',
  'mes',
  'year',
  'ano',
]);

/**
 * Resolves a date expression to a half-open range.
 *
 * - `2024`, `2024-05`, `2024-05-01` → the calendar span they name.
 * - `7d`, `2w`, `3m`, `1y` → from that moment in the past until now.
 * - `today` / `hoy`, `yesterday` / `ayer`, `week`, `month`, `year`.
 *
 * With a comparison operator the caller uses `start` for `>`/`>=` and `end`
 * for `<`/`<=`, so `added:>7d` reads as "added within the last 7 days".
 */
export function parseDateValue(input: string, now: number = Date.now()): DateRange | null {
  const value = input.trim().toLowerCase().replace(/\s+/g, '').replace(/[áà]/g, 'a').replace(/[ñ]/g, 'n');
  if (value === '') return null;

  if (NAMED_RANGES.has(value)) return namedRange(value, now);

  // ISO-ish absolute dates.
  const iso = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(value);
  if (iso) {
    const year = Number(iso[1]);
    if (iso[3] !== undefined) {
      const start = Date.UTC(year, Number(iso[2]) - 1, Number(iso[3]));
      return { start, end: start + 86_400_000 };
    }
    if (iso[2] !== undefined) {
      const month = Number(iso[2]) - 1;
      return { start: Date.UTC(year, month, 1), end: Date.UTC(year, month + 1, 1) };
    }
    return { start: Date.UTC(year, 0, 1), end: Date.UTC(year + 1, 0, 1) };
  }

  // Relative offsets.
  const relative = /^(\d+(?:\.\d+)?)([a-z]+)$/.exec(value);
  if (relative) {
    const unit = RELATIVE_UNITS[relative[2]];
    if (unit === undefined) return null;
    return { start: now - Number(relative[1]) * unit, end: now };
  }

  return null;
}

function namedRange(name: string, now: number): DateRange {
  const date = new Date(now);
  const startOfDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  switch (name) {
    case 'today':
    case 'hoy':
      return { start: startOfDay, end: startOfDay + 86_400_000 };
    case 'yesterday':
    case 'ayer':
      return { start: startOfDay - 86_400_000, end: startOfDay };
    case 'week':
    case 'semana':
      return { start: now - 7 * 86_400_000, end: now };
    case 'month':
    case 'mes':
      return { start: now - 30 * 86_400_000, end: now };
    default:
      return { start: now - 365 * 86_400_000, end: now };
  }
}

/** Formats an ISO timestamp as a short localized date. */
export function formatDate(iso: string | null | undefined, locale = 'es-ES'): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Formats an ISO timestamp as "hace 3 días". */
export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '—';
  const diff = now - time;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'ahora mismo';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `hace ${days} d`;
  const months = Math.round(days / 30);
  if (months < 12) return `hace ${months} mes${months === 1 ? '' : 'es'}`;
  const years = Math.round(months / 12);
  return `hace ${years} año${years === 1 ? '' : 's'}`;
}

/** Compact view/like counts: 1.2 M, 34,5 k. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1).replace('.', ',')} k`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1).replace('.', ',')} M`;
  return `${(value / 1_000_000_000).toFixed(1).replace('.', ',')} B`;
}

/** Duration buckets used for faceting and auto-tagging. */
export const DURATION_BUCKETS = [
  { id: 'micro', label: 'Menos de 1 min', min: 0, max: 60 },
  { id: 'corto', label: '1 – 5 min', min: 60, max: 300 },
  { id: 'medio', label: '5 – 20 min', min: 300, max: 1200 },
  { id: 'largo', label: '20 – 60 min', min: 1200, max: 3600 },
  { id: 'muy-largo', label: 'Más de 1 h', min: 3600, max: Number.MAX_SAFE_INTEGER },
] as const;

export type DurationBucketId = (typeof DURATION_BUCKETS)[number]['id'];

export function durationBucket(seconds: number | null | undefined): DurationBucketId | null {
  if (seconds === null || seconds === undefined || seconds < 0) return null;
  for (const bucket of DURATION_BUCKETS) {
    if (seconds >= bucket.min && seconds < bucket.max) return bucket.id;
  }
  return 'muy-largo';
}
