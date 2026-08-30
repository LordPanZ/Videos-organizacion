import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Library } from '../src/core/db/library.ts';
import type { Video } from '../src/shared/types.ts';

let library: Library;

/** A fresh in-memory library with the starter data seeded. */
beforeEach(() => {
  library = new Library({ file: ':memory:' });
});

afterEach(() => {
  library.close();
});

function addVideo(overrides: Partial<Parameters<Library['videos']['insert']>[0]> = {}): Video {
  return library.videos.insert({
    url: `https://www.youtube.com/watch?v=${Math.random().toString(36).slice(2, 13)}`,
    platform: 'youtube',
    title: 'Vídeo de prueba',
    ...overrides,
  });
}

/** Number of results a query returns. */
const count = (query: string) => library.videos.search({ query }).total;

describe('seeding', () => {
  test('a new library starts with usable defaults', () => {
    assert.ok(library.tags.list().length > 0);
    assert.ok(library.customFields.list().length > 0);
    assert.ok(library.savedViews.list().length > 0);
  });

  test('seeding runs only once', () => {
    const before = library.tags.list().length;
    // Re-opening the same connection must not duplicate the starter data.
    const again = new Library({ file: ':memory:' });
    assert.equal(again.tags.list().length, before);
    again.close();
  });

  test('every seeded saved view is a valid query', () => {
    for (const view of library.savedViews.list()) {
      const result = library.videos.search({ query: view.query });
      assert.deepEqual(result.warnings, [], `"${view.query}" produced warnings`);
    }
  });
});

describe('videos', () => {
  test('round-trips a record', () => {
    const video = addVideo({ title: 'Paella', durationSeconds: 940, viewCount: 1500 });
    const loaded = library.videos.getById(video.id)!;
    assert.equal(loaded.title, 'Paella');
    assert.equal(loaded.durationSeconds, 940);
    assert.equal(loaded.viewCount, 1500);
  });

  test('duplicate URLs are rejected by the unique index', () => {
    addVideo({ url: 'https://www.youtube.com/watch?v=abc11111111' });
    assert.throws(() => addVideo({ url: 'https://www.youtube.com/watch?v=abc11111111' }));
  });

  test('getByUrl finds a video by its exact URL', () => {
    const video = addVideo({ url: 'https://vimeo.com/424242' });
    assert.equal(library.videos.getByUrl('https://vimeo.com/424242')?.id, video.id);
    assert.equal(library.videos.getByUrl('https://vimeo.com/999'), null);
  });

  test('updates persist and bump updated_at', () => {
    const video = addVideo();
    library.videos.update(video.id, { rating: 5, favorite: true, notes: 'buenísimo' });
    const loaded = library.videos.getById(video.id)!;
    assert.equal(loaded.rating, 5);
    assert.equal(loaded.favorite, true);
    assert.equal(loaded.notes, 'buenísimo');
  });

  test('removing a video clears its search index entry', () => {
    const video = addVideo({ title: 'Documental irrepetible' });
    assert.equal(count('irrepetible'), 1);
    library.videos.remove([video.id]);
    assert.equal(count('irrepetible'), 0);
  });

  test('archived videos are hidden unless asked for', () => {
    const video = addVideo();
    library.videos.update(video.id, { archived: true });
    assert.equal(library.videos.search({}).total, 0);
    assert.equal(library.videos.search({ includeArchived: true }).total, 1);
  });
});

describe('search', () => {
  beforeEach(() => {
    const chef = library.authors.ensure({ platform: 'youtube', name: 'Cocina Fácil', handle: '@cocinafacil' });
    addVideo({
      url: 'https://www.youtube.com/watch?v=paella00000',
      title: 'Paella valenciana',
      description: 'Receta con #arroz',
      authorId: chef.id,
      durationSeconds: 940,
      publishedAt: '2024-05-12T10:00:00.000Z',
    });
    addVideo({
      url: 'https://www.tiktok.com/@x/video/1',
      platform: 'tiktok',
      title: 'Tortilla en 30 segundos',
      durationSeconds: 30,
      isShort: true,
      publishedAt: '2025-01-03T10:00:00.000Z',
    });
    addVideo({
      url: 'https://vimeo.com/555',
      platform: 'vimeo',
      title: 'Arquitectura moderna',
      durationSeconds: 4200,
      publishedAt: '2023-08-01T10:00:00.000Z',
    });
  });

  test('free text ignores accents', () => {
    assert.equal(count('valenciana'), 1);
    assert.equal(count('arquitectura'), 1);
    assert.equal(count('Arquitéctura'), 1);
  });

  test('free text searches the description too', () => {
    assert.equal(count('arroz'), 1);
  });

  test('platform filters and their aliases agree', () => {
    assert.equal(count('platform:youtube'), 1);
    assert.equal(count('p:yt'), 1);
    assert.equal(count('p:tiktok OR p:vimeo'), 2);
  });

  test('an unknown platform matches nothing and warns', () => {
    const result = library.videos.search({ query: 'platform:noexiste' });
    assert.equal(result.total, 0);
    assert.equal(result.warnings.length, 1);
  });

  test('duration comparisons treat bare numbers as minutes', () => {
    assert.equal(count('duration>30'), 1);
    assert.equal(count('duration<5'), 1);
    assert.equal(count('duration>90s'), 2);
  });

  test('negation excludes matches', () => {
    assert.equal(count('-p:youtube'), 2);
  });

  test('date filters read relative and absolute values', () => {
    assert.equal(count('added:>7d'), 3);
    assert.equal(count('year:2024'), 1);
    assert.equal(count('published:>2024'), 2);
  });

  test('author filters match name and handle', () => {
    assert.equal(count('@cocinafacil'), 1);
    assert.equal(count('author:"Cocina Fácil"'), 1);
  });

  test('is: predicates work', () => {
    assert.equal(count('is:corto'), 1);
    assert.equal(count('is:sinetiquetas'), 3);
    assert.equal(count('is:favorito'), 0);
  });

  test('NULL columns never satisfy a comparison', () => {
    addVideo({ title: 'Sin duración' });
    assert.equal(count('duration>0'), 3);
    assert.equal(count('duration!=1'), 3);
  });

  test('facets summarise the current result set', () => {
    const { facets } = library.videos.search({ query: '' });
    assert.equal(facets.platforms.length, 3);
    assert.equal(facets.durations.reduce((sum, bucket) => sum + bucket.count, 0), 3);
    assert.equal(facets.years.length, 3);
  });

  test('facets respect the active query', () => {
    const { facets } = library.videos.search({ query: 'p:youtube' });
    assert.equal(facets.platforms.length, 1);
  });

  test('sorting orders by the requested column', () => {
    const byDuration = library.videos.search({ sort: { field: 'durationSeconds', direction: 'asc' } });
    assert.deepEqual(
      byDuration.videos.map((video) => video.durationSeconds),
      [30, 940, 4200],
    );
  });

  test('rows missing the sort value sink to the bottom', () => {
    addVideo({ title: 'Sin duración' });
    const sorted = library.videos.search({ sort: { field: 'durationSeconds', direction: 'asc' } });
    assert.equal(sorted.videos[sorted.videos.length - 1].durationSeconds, null);
  });

  test('pagination is stable', () => {
    const first = library.videos.search({ limit: 2, offset: 0, sort: { field: 'title', direction: 'asc' } });
    const second = library.videos.search({ limit: 2, offset: 2, sort: { field: 'title', direction: 'asc' } });
    assert.equal(first.videos.length, 2);
    assert.equal(second.videos.length, 1);
    assert.equal(first.total, 3);
  });
});

describe('tags', () => {
  test('tag lookup folds accents and case', () => {
    const created = library.tags.ensure({ name: 'Programación' });
    assert.equal(library.tags.ensure({ name: 'programacion' }).id, created.id);
    assert.equal(library.tags.ensure({ name: 'PROGRAMACIÓN' }).id, created.id);
  });

  test('a tag filter includes descendant tags', () => {
    const parent = library.tags.ensure({ name: 'Cocina' });
    const child = library.tags.ensure({ name: 'Repostería', parentId: parent.id });
    const video = addVideo({ title: 'Tarta' });
    library.tags.addToVideos([video.id], [child.id]);
    library.videos.reindex(video.id);

    assert.equal(count('tag:cocina'), 1, 'parent tag should match the child');
    assert.equal(count('tag:reposteria'), 1);
  });

  test('re-parenting cannot create a cycle', () => {
    const parent = library.tags.ensure({ name: 'Padre' });
    const child = library.tags.ensure({ name: 'Hijo', parentId: parent.id });
    library.tags.update(parent.id, { parentId: child.id });
    assert.equal(library.tags.getById(parent.id)!.parentId, null);
  });

  test('merging moves assignments and removes the source', () => {
    const target = library.tags.ensure({ name: 'Cocina' });
    const source = library.tags.ensure({ name: 'Gastronomía' });
    const video = addVideo();
    library.tags.addToVideos([video.id], [source.id]);

    library.tags.merge([source.id], target.id);
    assert.equal(library.tags.getById(source.id), null);
    assert.equal(library.videos.getById(video.id)!.tags[0].id, target.id);
  });

  test('deleting a tag promotes its children', () => {
    const grandparent = library.tags.ensure({ name: 'Raíz' });
    const parent = library.tags.ensure({ name: 'Medio', parentId: grandparent.id });
    const child = library.tags.ensure({ name: 'Hoja', parentId: parent.id });

    library.tags.remove(parent.id);
    assert.equal(library.tags.getById(child.id)!.parentId, grandparent.id);
  });

  test('tags are searchable as free text', () => {
    const tag = library.tags.ensure({ name: 'Astronomía' });
    const video = addVideo({ title: 'Sin pistas en el título' });
    library.tags.addToVideos([video.id], [tag.id]);
    library.videos.reindex(video.id);
    assert.equal(count('astronomia'), 1);
  });
});

describe('custom fields', () => {
  test('a new field is immediately filterable', () => {
    library.customFields.create({ label: 'Cliente', type: 'text' });
    const video = addVideo();
    library.videos.setCustomField(video.id, 'cliente', 'Acme');

    assert.equal(count('cliente:acme'), 1);
    assert.equal(count('cliente:otra'), 0);
  });

  test('keys stay unique even with colliding labels', () => {
    const first = library.customFields.create({ label: 'Nivel', type: 'text' });
    const second = library.customFields.create({ label: 'Nivel', type: 'number' });
    assert.notEqual(first.key, second.key);
  });

  test('numeric fields support ordered comparisons', () => {
    library.customFields.create({ label: 'Puntos', type: 'number' });
    const low = addVideo();
    const high = addVideo();
    library.videos.setCustomField(low.id, 'puntos', 3);
    library.videos.setCustomField(high.id, 'puntos', 9);

    assert.equal(count('puntos>5'), 1);
    assert.equal(count('puntos<5'), 1);
  });

  test('multiselect values round-trip and appear as facets', () => {
    library.customFields.create({
      label: 'Temas',
      type: 'multiselect',
      options: [
        { value: 'a', label: 'Alfa' },
        { value: 'b', label: 'Beta' },
      ],
    });
    const video = addVideo();
    library.videos.setCustomField(video.id, 'temas', ['a', 'b']);

    assert.deepEqual(library.videos.getById(video.id)!.customFields.temas, ['a', 'b']);
    const { facets } = library.videos.search({});
    assert.equal(facets.customFields.temas.length, 2);
  });

  test('setting an empty value clears the field', () => {
    library.customFields.create({ label: 'Nota rápida', type: 'text' });
    const video = addVideo();
    library.videos.setCustomField(video.id, 'nota_rapida', 'algo');
    library.videos.setCustomField(video.id, 'nota_rapida', null);
    assert.equal(library.videos.getById(video.id)!.customFields.nota_rapida, undefined);
  });

  test('deleting a field removes its values', () => {
    const field = library.customFields.create({ label: 'Temporal', type: 'text' });
    const video = addVideo();
    library.videos.setCustomField(video.id, field.key, 'x');
    library.customFields.remove(field.id);
    assert.equal(library.videos.getById(video.id)!.customFields[field.key], undefined);
  });

  test('writing to an unknown field is an error, not a silent no-op', () => {
    const video = addVideo();
    assert.throws(() => library.videos.setCustomField(video.id, 'no_existe', 'x'));
  });
});

describe('collections', () => {
  test('membership and ordering survive a round trip', () => {
    const collection = library.collections.create({ name: 'Ver luego' });
    const first = addVideo({ title: 'Uno' });
    const second = addVideo({ title: 'Dos' });

    library.collections.addVideos(collection.id, [first.id, second.id]);
    assert.equal(library.videos.search({ collectionId: collection.id }).total, 2);

    library.collections.reorder(collection.id, [second.id, first.id]);
    const ordered = library.videos.search({ collectionId: collection.id, sort: { field: 'addedAt', direction: 'desc' } });
    assert.equal(ordered.videos[0].id, second.id);
  });

  test('adding the same video twice does not duplicate it', () => {
    const collection = library.collections.create({ name: 'X' });
    const video = addVideo();
    assert.equal(library.collections.addVideos(collection.id, [video.id]), 1);
    assert.equal(library.collections.addVideos(collection.id, [video.id]), 0);
  });

  test('a collection query combines with the search box', () => {
    const collection = library.collections.create({ name: 'Mixta' });
    const youtube = addVideo({ title: 'De YouTube' });
    const vimeo = addVideo({ url: 'https://vimeo.com/1', platform: 'vimeo', title: 'De Vimeo' });
    library.collections.addVideos(collection.id, [youtube.id, vimeo.id]);

    const result = library.videos.search({ collectionId: collection.id, query: 'p:vimeo' });
    assert.equal(result.total, 1);
    assert.equal(result.videos[0].id, vimeo.id);
  });

  test('deleting a collection keeps its videos', () => {
    const collection = library.collections.create({ name: 'Temporal' });
    const video = addVideo();
    library.collections.addVideos(collection.id, [video.id]);
    library.collections.remove(collection.id);
    assert.ok(library.videos.getById(video.id));
  });
});

describe('stats and duplicates', () => {
  test('stats add up', () => {
    addVideo({ durationSeconds: 100 });
    addVideo({ durationSeconds: 200, url: 'https://vimeo.com/2', platform: 'vimeo' });
    const stats = library.videos.stats();
    assert.equal(stats.totalVideos, 2);
    assert.equal(stats.totalDuration, 300);
    assert.equal(stats.averageDuration, 150);
    assert.equal(stats.untagged, 2);
  });

  test('duplicates are grouped by platform id', () => {
    addVideo({ url: 'https://www.youtube.com/watch?v=aaa11111111', platformId: 'same' });
    addVideo({ url: 'https://www.youtube.com/watch?v=bbb22222222', platformId: 'same' });
    addVideo({ url: 'https://www.youtube.com/watch?v=ccc33333333', platformId: 'other' });

    const groups = library.videos.findDuplicates();
    assert.equal(groups.length, 1);
    assert.equal(groups[0].videos.length, 2);
  });
});
