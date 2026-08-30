import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../src/shared/query/parser.ts';
import { tokenize } from '../src/shared/query/tokenizer.ts';
import { collectFields, isEmptyQuery, type QueryNode } from '../src/shared/query/ast.ts';

/** Convenience: the single field filter a query produces. */
function onlyField(input: string) {
  const { root } = parseQuery(input);
  const fields = collectFields(root);
  assert.equal(fields.length, 1, `expected one field in "${input}"`);
  return fields[0];
}

describe('tokenizer', () => {
  test('splits bare words', () => {
    assert.deepEqual(tokenize('hola mundo'), [
      { kind: 'word', value: 'hola' },
      { kind: 'word', value: 'mundo' },
    ]);
  });

  test('keeps accented and non-latin words whole', () => {
    assert.deepEqual(tokenize('programación'), [{ kind: 'word', value: 'programación' }]);
    assert.deepEqual(tokenize('料理'), [{ kind: 'word', value: '料理' }]);
  });

  test('reads quoted phrases, including unterminated ones', () => {
    assert.deepEqual(tokenize('"paella valenciana"'), [{ kind: 'phrase', value: 'paella valenciana' }]);
    assert.deepEqual(tokenize('"sin cerrar'), [{ kind: 'phrase', value: 'sin cerrar' }]);
  });

  test('recognizes # and @ shorthands', () => {
    const [tag] = tokenize('#cocina');
    assert.deepEqual(tag, { kind: 'field', field: 'tag', op: ':', value: 'cocina', raw: '#cocina' });
    const [author] = tokenize('@midudev');
    assert.equal(author.kind === 'field' && author.field, 'author');
  });

  test('treats a leading dash as negation but keeps inner dashes', () => {
    assert.deepEqual(tokenize('-spam'), [{ kind: 'not' }, { kind: 'word', value: 'spam' }]);
    assert.deepEqual(tokenize('e-mail'), [{ kind: 'word', value: 'e-mail' }]);
  });

  test('AND/OR/NOT only count as operators when standalone', () => {
    assert.equal(tokenize('a OR b')[1].kind, 'or');
    assert.deepEqual(tokenize('ORQUESTA'), [{ kind: 'word', value: 'ORQUESTA' }]);
  });
});

describe('parser', () => {
  test('an empty query constrains nothing', () => {
    assert.ok(isEmptyQuery(parseQuery('').root));
    assert.ok(isEmptyQuery(parseQuery('   ').root));
  });

  test('resolves field aliases in both languages', () => {
    for (const input of ['platform:youtube', 'p:youtube', 'plataforma:youtube']) {
      assert.equal(onlyField(input).field, 'platform');
    }
    for (const input of ['duration>10', 'dur>10', 'duración>10']) {
      assert.equal(onlyField(input).field, 'duration');
    }
  });

  test('accepts a colon before a comparison operator', () => {
    assert.deepEqual(
      { field: onlyField('duration:>10m').field, op: onlyField('duration:>10m').op, value: onlyField('duration:>10m').value },
      { field: 'duration', op: '>', value: '10m' },
    );
    assert.equal(onlyField('rating:>=4').op, '>=');
    assert.equal(onlyField('added:<7d').op, '<');
  });

  test('juxtaposition means AND, and OR binds looser', () => {
    const { root } = parseQuery('p:youtube OR p:vimeo #cocina');
    assert.equal(root.type, 'or');
    const or = root as Extract<QueryNode, { type: 'or' }>;
    assert.equal(or.children.length, 2);
    assert.equal(or.children[1].type, 'and');
  });

  test('parentheses group as written', () => {
    const { root } = parseQuery('(p:tiktok OR p:vimeo) -is:corto');
    assert.equal(root.type, 'and');
    const and = root as Extract<QueryNode, { type: 'and' }>;
    assert.equal(and.children[0].type, 'or');
    assert.equal(and.children[1].type, 'not');
  });

  test('unknown prefixes degrade to free text instead of vanishing', () => {
    const { root } = parseQuery('inventado:algo');
    assert.equal(collectFields(root).length, 0);
    assert.deepEqual(root, { type: 'text', value: 'inventado:algo', phrase: false });
  });

  test('custom field keys resolve once declared', () => {
    const { root } = parseQuery('prioridad:alta', { customFieldKeys: ['prioridad'] });
    assert.equal(collectFields(root)[0].field, 'cf.prioridad');
  });

  test('malformed input warns but still parses', () => {
    const unbalanced = parseQuery('(p:tiktok');
    assert.equal(unbalanced.warnings.length, 1);
    assert.equal(collectFields(unbalanced.root).length, 1);

    assert.equal(parseQuery('tag:').warnings.length, 1);
    assert.equal(parseQuery('a OR').warnings.length, 1);
  });

  test('never throws on hostile input', () => {
    const inputs = ['((((', '""""', ')))', '-', '#', '@', ':::', 'a:b:c:d', '\\', '   -   '];
    for (const input of inputs) {
      assert.doesNotThrow(() => parseQuery(input), `threw on ${JSON.stringify(input)}`);
    }
  });
});
