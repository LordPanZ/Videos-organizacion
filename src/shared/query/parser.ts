import { TRUE_NODE, type ParsedQuery, type QueryNode } from './ast.ts';
import { tokenize, type Token } from './tokenizer.ts';

/**
 * Canonical field names plus the aliases the search bar accepts. Aliases keep
 * the language forgiving in both Spanish and English.
 */
export const FIELD_ALIASES: Record<string, string> = {
  p: 'platform',
  plataforma: 'platform',
  platform: 'platform',
  t: 'tag',
  tag: 'tag',
  etiqueta: 'tag',
  tags: 'tag',
  author: 'author',
  autor: 'author',
  channel: 'author',
  canal: 'author',
  by: 'author',
  creator: 'author',
  title: 'title',
  titulo: 'title',
  'título': 'title',
  desc: 'description',
  description: 'description',
  descripcion: 'description',
  'descripción': 'description',
  notes: 'notes',
  notas: 'notes',
  rating: 'rating',
  stars: 'rating',
  estrellas: 'rating',
  nota: 'rating',
  duration: 'duration',
  dur: 'duration',
  duracion: 'duration',
  'duración': 'duration',
  length: 'duration',
  added: 'added',
  agregado: 'added',
  'añadido': 'added',
  published: 'published',
  publicado: 'published',
  date: 'published',
  fecha: 'published',
  year: 'year',
  ano: 'year',
  'año': 'year',
  views: 'views',
  vistas: 'views',
  likes: 'likes',
  megusta: 'likes',
  is: 'is',
  es: 'is',
  has: 'has',
  tiene: 'has',
  collection: 'collection',
  col: 'collection',
  coleccion: 'collection',
  'colección': 'collection',
  lang: 'language',
  language: 'language',
  idioma: 'language',
  size: 'size',
  peso: 'size',
  tamano: 'size',
  'tamaño': 'size',
  url: 'url',
  status: 'status',
  estado: 'status',
  opened: 'opened',
  abierto: 'opened',
  cf: 'cf',
  campo: 'cf',
  field: 'cf',
};

/** Values accepted by `is:` — each maps to a stored predicate. */
export const IS_VALUES = [
  'favorite',
  'favorito',
  'downloaded',
  'descargado',
  'watched',
  'visto',
  'unwatched',
  'nuevo',
  'watching',
  'viendo',
  'short',
  'corto',
  'live',
  'vivo',
  'archived',
  'archivado',
  'untagged',
  'sinetiquetas',
  'unavailable',
  'nodisponible',
  'local',
  'rated',
  'valorado',
] as const;

/** Values accepted by `has:`. */
export const HAS_VALUES = [
  'notes',
  'notas',
  'file',
  'archivo',
  'thumbnail',
  'miniatura',
  'bookmarks',
  'marcadores',
  'description',
  'descripcion',
  'tags',
  'etiquetas',
  'author',
  'autor',
] as const;

const KNOWN_FIELDS = new Set(Object.values(FIELD_ALIASES));

interface ParserState {
  tokens: Token[];
  pos: number;
  warnings: string[];
  /** Custom-field keys the library currently defines. */
  customKeys: Set<string>;
}

function peek(state: ParserState): Token | undefined {
  return state.tokens[state.pos];
}

function next(state: ParserState): Token | undefined {
  return state.tokens[state.pos++];
}

function flatten(type: 'and' | 'or', children: QueryNode[]): QueryNode {
  const useful = children.filter((c) => c.type !== 'true');
  if (useful.length === 0) return TRUE_NODE;
  if (useful.length === 1) return useful[0];
  const merged: QueryNode[] = [];
  for (const child of useful) {
    if (child.type === type) merged.push(...child.children);
    else merged.push(child);
  }
  return { type, children: merged };
}

/** expression := orExpr */
function parseExpression(state: ParserState): QueryNode {
  return parseOr(state);
}

/** orExpr := andExpr ( OR andExpr )* */
function parseOr(state: ParserState): QueryNode {
  const children = [parseAnd(state)];
  while (peek(state)?.kind === 'or') {
    next(state);
    if (peek(state) === undefined) {
      state.warnings.push('Se esperaba un término después de "OR".');
      break;
    }
    children.push(parseAnd(state));
  }
  return flatten('or', children);
}

/** andExpr := unary ( AND? unary )* — juxtaposition means AND. */
function parseAnd(state: ParserState): QueryNode {
  const children: QueryNode[] = [];
  for (;;) {
    const token = peek(state);
    if (token === undefined || token.kind === 'or' || token.kind === 'rparen') break;
    if (token.kind === 'and') {
      next(state);
      continue;
    }
    children.push(parseUnary(state));
  }
  if (children.length === 0) return TRUE_NODE;
  return flatten('and', children);
}

/** unary := NOT unary | primary */
function parseUnary(state: ParserState): QueryNode {
  if (peek(state)?.kind === 'not') {
    next(state);
    const child = parseUnary(state);
    if (child.type === 'true') {
      state.warnings.push('Se esperaba un término después de la negación.');
      return TRUE_NODE;
    }
    return { type: 'not', child };
  }
  return parsePrimary(state);
}

/** primary := '(' expression ')' | field | text */
function parsePrimary(state: ParserState): QueryNode {
  const token = next(state);
  if (token === undefined) return TRUE_NODE;

  switch (token.kind) {
    case 'lparen': {
      const inner = parseExpression(state);
      const closing = peek(state);
      if (closing?.kind === 'rparen') next(state);
      else state.warnings.push('Falta un paréntesis de cierre ")".');
      return inner;
    }
    case 'rparen':
      state.warnings.push('Paréntesis de cierre ")" sin abrir.');
      return TRUE_NODE;
    case 'word':
      return { type: 'text', value: token.value, phrase: false };
    case 'phrase':
      return { type: 'text', value: token.value, phrase: true };
    case 'field': {
      const canonical = resolveField(token.field, state);
      if (canonical === null) {
        // Unknown prefix: treat the whole thing as free text instead of
        // silently dropping the user's input.
        return { type: 'text', value: token.raw, phrase: false };
      }
      if (token.value === '') {
        state.warnings.push(`El filtro "${token.field}" necesita un valor.`);
        return TRUE_NODE;
      }
      return { type: 'field', field: canonical, op: token.op, value: token.value, raw: token.raw };
    }
    case 'and':
    case 'or':
      // Dangling operator: ignore it.
      return TRUE_NODE;
    case 'not':
      return parseUnary(state);
    default:
      return TRUE_NODE;
  }
}

/**
 * Maps a user-typed prefix to a canonical field. Custom fields are addressable
 * either as `cf:key:value` or directly by their key once defined.
 */
function resolveField(raw: string, state: ParserState): string | null {
  const lower = raw.toLowerCase();
  const alias = FIELD_ALIASES[lower];
  if (alias) return alias;
  if (state.customKeys.has(lower)) return `cf.${lower}`;
  return null;
}

export interface ParseOptions {
  /** Keys of user-defined custom fields, so `mykey:value` resolves. */
  customFieldKeys?: string[];
}

/**
 * Parses a search string into an AST. Parsing is total: malformed input
 * produces warnings and a best-effort tree, never an exception.
 */
export function parseQuery(input: string, options: ParseOptions = {}): ParsedQuery {
  const state: ParserState = {
    tokens: tokenize(input ?? ''),
    pos: 0,
    warnings: [],
    customKeys: new Set((options.customFieldKeys ?? []).map((k) => k.toLowerCase())),
  };

  if (state.tokens.length === 0) return { root: TRUE_NODE, warnings: [] };

  const root = parseExpression(state);

  // Consume any trailing junk so nothing is silently ignored.
  while (state.pos < state.tokens.length) {
    const leftover = next(state);
    if (leftover?.kind === 'rparen') state.warnings.push('Paréntesis de cierre ")" sin abrir.');
  }

  return { root, warnings: state.warnings };
}

/** Canonical field names, for autocomplete in the search bar. */
export function knownFields(): string[] {
  return [...KNOWN_FIELDS].sort();
}
