import type { CompareOp } from './ast.ts';

export type Token =
  | { kind: 'word'; value: string }
  | { kind: 'phrase'; value: string }
  | { kind: 'field'; field: string; op: CompareOp; value: string; raw: string }
  | { kind: 'and' }
  | { kind: 'or' }
  | { kind: 'not' }
  | { kind: 'lparen' }
  | { kind: 'rparen' };

/**
 * Identifier that could be a field name, e.g. `duration` in `duration>10`.
 *
 * Unicode letters are allowed so the Spanish aliases (`duración`, `año`,
 * `título`) are reachable at all. A name matching nothing known falls back
 * to free text, so widening this cannot swallow a user's search terms.
 */
const FIELD_NAME = /[\p{L}_][\p{L}\p{N}_.-]*/uy;

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function isTermBoundary(ch: string | undefined): boolean {
  return ch === undefined || isSpace(ch) || ch === '(' || ch === ')';
}

/**
 * Reads a value that may be bare, "double quoted" or 'single quoted'.
 * Returns the decoded value and the index just past it.
 */
function readValue(input: string, start: number): { value: string; end: number } {
  const quote = input[start];
  if (quote === '"' || quote === "'") {
    let out = '';
    let i = start + 1;
    while (i < input.length) {
      const ch = input[i];
      if (ch === '\\' && i + 1 < input.length) {
        out += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) return { value: out, end: i + 1 };
      out += ch;
      i += 1;
    }
    // Unterminated quote: take the rest of the string rather than failing.
    return { value: out, end: input.length };
  }
  let i = start;
  while (i < input.length && !isTermBoundary(input[i])) i += 1;
  return { value: input.slice(start, i), end: i };
}

/**
 * Reads a comparison operator at `i`, or null when there is none.
 *
 * A colon may precede a comparison, so `duration:>10m` and `duration>10m` are
 * the same filter — people reach for the colon out of habit.
 */
function readOp(input: string, i: number): { op: CompareOp; end: number } | null {
  let start = i;
  const following = input[i + 1];
  if (input[i] === ':' && (following === '>' || following === '<' || following === '!' || following === '=')) {
    start += 1;
  }

  const two = input.slice(start, start + 2);
  if (two === '>=' || two === '<=' || two === '!=') return { op: two as CompareOp, end: start + 2 };

  const one = input[start];
  if (one === ':' || one === '=' || one === '>' || one === '<') return { op: one as CompareOp, end: start + 1 };
  return null;
}

/**
 * Turns a raw search string into tokens. Never throws: anything unparseable
 * degrades into free-text words so the user always gets results.
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (isSpace(ch)) {
      i += 1;
      continue;
    }

    if (ch === '(') {
      tokens.push({ kind: 'lparen' });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen' });
      i += 1;
      continue;
    }

    // A leading `-` or `!` negates the term that follows it.
    if ((ch === '-' || ch === '!') && !isTermBoundary(input[i + 1])) {
      tokens.push({ kind: 'not' });
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const { value, end } = readValue(input, i);
      if (value) tokens.push({ kind: 'phrase', value });
      i = end;
      continue;
    }

    // `#tag` shorthand.
    if (ch === '#') {
      const { value, end } = readValue(input, i + 1);
      if (value) tokens.push({ kind: 'field', field: 'tag', op: ':', value, raw: `#${value}` });
      i = end === i + 1 ? i + 1 : end;
      continue;
    }

    // `@author` shorthand.
    if (ch === '@') {
      const { value, end } = readValue(input, i + 1);
      if (value) tokens.push({ kind: 'field', field: 'author', op: ':', value, raw: `@${value}` });
      i = end === i + 1 ? i + 1 : end;
      continue;
    }

    // Try `name<op>value`. Only an ASCII identifier immediately followed by a
    // comparison operator counts as a field; everything else is free text.
    FIELD_NAME.lastIndex = i;
    const match = FIELD_NAME.exec(input);
    if (match) {
      const word = match[0];
      const afterWord = i + word.length;
      const op = readOp(input, afterWord);
      if (op) {
        const { value, end } = readValue(input, op.end);
        tokens.push({
          kind: 'field',
          field: word.toLowerCase(),
          op: op.op,
          value,
          raw: input.slice(i, end),
        });
        i = end;
        continue;
      }
      // Keyword operators are only meaningful as standalone terms.
      if (isTermBoundary(input[afterWord])) {
        const upper = word.toUpperCase();
        if (upper === 'AND') {
          tokens.push({ kind: 'and' });
          i = afterWord;
          continue;
        }
        if (upper === 'OR') {
          tokens.push({ kind: 'or' });
          i = afterWord;
          continue;
        }
        if (upper === 'NOT') {
          tokens.push({ kind: 'not' });
          i = afterWord;
          continue;
        }
      }
    }

    // Plain term. Read to the term boundary so accented and non-Latin words
    // ("café", "料理") stay in one piece.
    const { value, end } = readValue(input, i);
    if (value) tokens.push({ kind: 'word', value });
    i = end > i ? end : i + 1;
  }

  return tokens;
}
