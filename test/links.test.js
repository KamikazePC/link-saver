// Core: URLs, kinds, saving and duplicates, collections, migration from tags, storage errors, search and filters.
(function () {
  'use strict';
  const { test, assert } = T;
  const S = Stash, K = StashKinds;
  const newStore = (data) => { const chrome = createChromeStub({ data }); return { chrome, store: S.createStore(chrome.storage.local) }; };
  const linkKey = (u) => `link:${u}`;

  // ---------- URLs ----------
  test('normalizeUrl lowercases the host, drops default ports and plain #fragments, keeps app routes', () => {
    assert.equal(S.normalizeUrl('HTTPS://Example.COM:443/Path?q=1#intro'), 'https://example.com/Path?q=1');
    assert.equal(S.normalizeUrl('https://app.example.com/#/inbox'), 'https://app.example.com/#/inbox');
    for (const bad of ['chrome://settings', 'file:///C:/a.txt', 'javascript:alert(1)', 'not a url', '', null]) assert.equal(S.normalizeUrl(bad), null, String(bad));
  });

  test('checkSavable explains restricted pages instead of failing', () => {
    for (const [tab, expected] of [[null, 'No active tab'], [{ title: 'Web Store' }, 'off limits'], [{ url: 'chrome://extensions/' }, 'browser page'], [{ url: 'file:///C:/n.txt' }, 'Files on your computer'], [{ url: 'data:text/html,hi' }, 'Only web pages']]) {
      const r = S.checkSavable(tab); assert.equal(r.ok, false); assert.includes(r.reason, expected);
    }
    assert.deepEqual(S.checkSavable({ url: 'https://example.com/a#top', title: '  A   page ' }), { ok: true, url: 'https://example.com/a', title: 'A page' });
  });

  // ---------- Kinds ----------
  test('detectKind guesses the kind from the address', () => {
    const cases = [
      ['https://www.youtube.com/watch?v=1', 'watch'], ['https://vimeo.com/123', 'watch'],
      ['https://open.spotify.com/episode/x', 'listen'], ['https://podcasts.apple.com/us/podcast/x', 'listen'],
      ['https://www.pinterest.com/pin/1', 'look'], ['https://www.are.na/block/1', 'look'], ['https://example.com/poster.jpg', 'look'],
      ['https://github.com/user/repo', 'use'], ['https://docs.python.org/3/', 'use'], ['https://www.figma.com/file/x', 'use'],
      ['https://www.amazon.co.uk/dp/B000', 'buy'], ['https://shop.example.com/x', 'buy'], ['https://brand.example/products/shirt', 'buy'],
      ['https://medium.com/@a/post', 'read'], ['https://example.com/blog/hello', 'read'], ['https://en.wikipedia.org/wiki/X', 'read'],
      ['https://example.com/', 'other'], ['nonsense', 'other'],
    ];
    for (const [url, kind] of cases) assert.equal(K.detectKind(url), kind, url);
  });

  test('every kind has a label, examples and an icon', () => {
    assert.equal(K.KINDS.length, 7);
    for (const k of K.KINDS) { assert.ok(k.label && k.examples); assert.includes(K.kindIcon(k.id), 'currentColor'); }
    assert.equal(K.kindById('nope').id, 'other');
  });

  // ---------- Save and duplicates ----------
  test('save stores the link with its kind, collections, pin and save date', async () => {
    const { chrome, store } = newStore();
    const r = await store.save({ url: 'https://www.pinterest.com/pin/1', title: 'Posters', note: ' rebrand ', collections: ['c1'], pinned: true }, { now: new Date('2026-11-02T10:00:00Z') });
    assert.equal(r.status, 'saved');
    const stored = chrome.data[linkKey('https://www.pinterest.com/pin/1')];
    assert.equal(stored.kind, 'look'); assert.equal(stored.note, 'rebrand'); assert.deepEqual(stored.collections, ['c1']);
    assert.equal(stored.pinned, true); assert.equal(stored.visits, 0); assert.equal(stored.savedAt, '2026-11-02T10:00:00.000Z');
    assert.equal('tags' in stored, false);
  });

  test('a chosen kind beats the guess; a missing title falls back to the URL', async () => {
    const { store } = newStore();
    const r = await store.save({ url: 'https://example.com/x', title: '  ', kind: 'watch' });
    assert.equal(r.item.kind, 'watch'); assert.equal(r.item.title, 'https://example.com/x');
  });

  test('the same page is never saved twice, even with a different #section or capital letters', async () => {
    const { store } = newStore();
    await store.save({ url: 'https://example.com/post', note: 'first' });
    for (const v of ['https://EXAMPLE.com/post', 'https://example.com:443/post', 'https://example.com/post#comments']) {
      const r = await store.save({ url: v, note: 'second' }); assert.equal(r.status, 'duplicate', v); assert.equal(r.item.note, 'first');
    }
    assert.equal((await store.list()).length, 1);
  });

  test('save refuses non-web URLs and over-long notes before touching storage', async () => {
    const { chrome, store } = newStore(); chrome.failures.get = new Error('should not be called');
    await assert.rejects(store.save({ url: 'chrome://settings' }), (e) => assert.equal(e.code, 'not-savable'));
    await assert.rejects(store.save({ url: 'https://e.com/', note: 'x'.repeat(5000) }), (e) => assert.equal(e.code, 'note-too-long'));
  });

  test('update changes title, note, kind, collections and pin but keeps the save date', async () => {
    const { store } = newStore();
    await store.save({ url: 'https://a.com/', note: 'old' }, { now: new Date('2026-01-01T00:00:00Z') });
    const item = await store.update('https://a.com/', { title: 'New', note: 'new', kind: 'read', collections: ['c1', 'c1'], pinned: true });
    assert.equal(item.title, 'New'); assert.equal(item.kind, 'read'); assert.deepEqual(item.collections, ['c1']); assert.equal(item.pinned, true);
    assert.equal(item.savedAt, '2026-01-01T00:00:00.000Z');
    await assert.rejects(store.update('https://a.com/', { kind: 'podcast' }), (e) => assert.equal(e.code, 'bad-kind'));
    await assert.rejects(store.update('https://gone.com/', { note: 'x' }), (e) => assert.equal(e.code, 'not-found'));
  });

  test('recordVisit counts opens and remembers when; missing links are ignored', async () => {
    const { store } = newStore();
    await store.save({ url: 'https://a.com/' });
    await store.recordVisit('https://a.com/', { now: new Date('2026-11-01T00:00:00Z') });
    const item = await store.recordVisit('https://a.com/#x');
    assert.equal(item.visits, 2); assert.ok(item.lastOpenedAt);
    assert.equal(await store.recordVisit('https://never.com/'), null);
  });

  test('remove returns the save and restore puts it back unchanged', async () => {
    const { store } = newStore();
    const { item } = await store.save({ url: 'https://a.com/', note: 'n', collections: ['c1'] });
    const removed = await store.remove('https://a.com/');
    assert.deepEqual(removed, item); assert.equal((await store.list()).length, 0);
    await store.restore(removed); assert.deepEqual(await store.find('https://a.com/'), item);
  });

  // ---------- Collections ----------
  test('collections can be created, renamed and listed; names are unique and limited', async () => {
    const { store } = newStore();
    const a = await store.createCollection('  Rebrand   inspo ');
    assert.equal(a.name, 'Rebrand inspo');
    assert.equal((await store.createCollection('rebrand INSPO')).id, a.id, 'same name returns the existing one');
    const b = await store.createCollection('Recipes');
    await assert.rejects(store.renameCollection(b.id, 'Rebrand inspo'), (e) => assert.equal(e.code, 'collection-name-taken'));
    assert.equal((await store.renameCollection(b.id, 'Food')).name, 'Food');
    await assert.rejects(store.createCollection(''), (e) => assert.equal(e.code, 'collection-name-empty'));
    await assert.rejects(store.createCollection('x'.repeat(41)), (e) => assert.equal(e.code, 'collection-name-too-long'));
    assert.deepEqual((await store.listCollections()).map((c) => c.name), ['Rebrand inspo', 'Food']);
  });

  test('deleting a collection keeps its saves, and Undo puts it back', async () => {
    const { store } = newStore();
    const c = await store.createCollection('Rebrand');
    await store.save({ url: 'https://a.com/', collections: [c.id] });
    await store.save({ url: 'https://b.com/', collections: [c.id, 'other'] });
    const snap = await store.deleteCollection(c.id);
    assert.equal((await store.listCollections()).length, 0);
    const list = await store.list();
    assert.equal(list.length, 2, 'saves stay');
    assert.ok(list.every((i) => !i.collections.includes(c.id)));
    await store.restoreCollection(snap);
    assert.equal((await store.listCollections())[0].id, c.id);
    assert.ok((await store.find('https://a.com/')).collections.includes(c.id));
  });

  // ---------- Migration ----------
  test('migration turns tags into collections, fills in kinds and is safe to run twice', async () => {
    const old = {
      'link:https://www.youtube.com/watch?v=1': { url: 'https://www.youtube.com/watch?v=1', title: 'Video', note: '', tags: ['recipes', 'Weekend'], savedAt: '2026-01-02T00:00:00.000Z' },
      'link:https://a.com/': { url: 'https://a.com/', title: 'A', note: 'n', tags: ['Recipes'], savedAt: '2026-01-01T00:00:00.000Z' },
      settings: { keep: true },
    };
    const chrome = createChromeStub({ data: old });
    const r = await S.migrate(chrome.storage.local);
    assert.equal(r.migrated, true); assert.equal(r.collections, 2, 'recipes and Recipes are one collection');
    const cols = chrome.data.collections; const recipes = cols.find((c) => c.name.toLowerCase() === 'recipes');
    const video = chrome.data['link:https://www.youtube.com/watch?v=1'];
    assert.equal(video.kind, 'watch'); assert.equal(video.collections.length, 2); assert.equal('tags' in video, false);
    assert.deepEqual(chrome.data['link:https://a.com/'].collections, [recipes.id]);
    assert.equal(chrome.data['link:https://a.com/'].note, 'n', 'nothing else lost');
    assert.deepEqual(chrome.data.settings, { keep: true });
    assert.equal((await S.migrate(chrome.storage.local)).migrated, false, 'second run does nothing');
  });

  test('the store migrates old data the first time it is used', async () => {
    const { store } = newStore({ 'link:https://a.com/': { url: 'https://a.com/', title: 'A', tags: ['x'], savedAt: '2026-01-01T00:00:00.000Z' } });
    const [item] = await store.list();
    assert.equal(item.collections.length, 1); assert.equal((await store.listCollections())[0].name, 'x');
  });

  // ---------- Storage errors ----------
  test('storage failures become friendly errors, keep the cause, and nothing is half-saved', async () => {
    const { chrome, store } = newStore();
    await store.list(); // migrate first
    chrome.failures.set = new Error('disk unavailable');
    const err = await assert.rejects(store.save({ url: 'https://a.com/' }));
    assert.ok(err instanceof S.StorageError); assert.includes(err.message, 'Couldn’t save this page'); assert.equal(err.cause.message, 'disk unavailable');
    chrome.failures.set = null; assert.equal((await store.list()).length, 0);
    chrome.failures.get = new Error('IO');
    await assert.rejects(store.list(), (e) => assert.includes(e.message, 'Couldn’t load your library'));
  });

  test('a full storage quota says how to recover', async () => {
    const { chrome, store } = newStore(); await store.list();
    chrome.failures.set = new Error('QUOTA_BYTES quota exceeded');
    await assert.rejects(store.save({ url: 'https://a.com/' }), (e) => { assert.equal(e.code, 'quota'); assert.includes(e.message, 'Delete some saves, then save again'); });
  });

  test('a missing storage area is reported, not thrown as a TypeError', async () => {
    await assert.rejects(S.createStore(undefined).list(), (e) => assert.ok(e instanceof S.StorageError));
  });

  // ---------- Search and filters ----------
  const sample = [
    { url: 'https://www.are.na/block/1', title: 'Blue risograph poster series', note: 'for the rebrand', kind: 'look', collections: ['c1'], savedAt: '2026-09-14T00:00:00Z', visits: 3 },
    { url: 'https://www.youtube.com/watch?v=2', title: 'Kinetic type reel', note: '', kind: 'watch', collections: [], savedAt: '2026-10-03T00:00:00Z', visits: 0 },
    { url: 'https://cafe.example/menu', title: 'Café menu', note: 'good espresso', kind: 'other', collections: [], savedAt: '2026-10-20T00:00:00Z', visits: 1 },
  ];
  const cols = [{ id: 'c1', name: 'Rebrand inspo' }];
  const titles = (r) => r.map((x) => (x.item || x).title);

  test('search matches title, site, note, kind and collection names, ignoring case and accents', () => {
    assert.deepEqual(titles(S.search(sample, 'POSTER')), ['Blue risograph poster series']);
    assert.deepEqual(titles(S.search(sample, 'youtube')), ['Kinetic type reel']);
    assert.deepEqual(titles(S.search(sample, 'espresso')), ['Café menu']);
    assert.deepEqual(titles(S.search(sample, 'cafe')), ['Café menu']);
    assert.deepEqual(titles(S.search(sample, 'watch')), ['Kinetic type reel']);
    assert.deepEqual(titles(S.search(sample, 'inspo', { collections: cols })), ['Blue risograph poster series']);
    assert.deepEqual(S.search(sample, 'blue zebra'), [], 'every word must match');
    assert.equal(S.search(sample, '  ').length, 3);
  });

  test('search says where it matched', () => {
    const [r] = S.searchWithMatches(sample, 'blue rebrand');
    assert.deepEqual(r.matchedIn, ['title', 'note']);
    assert.equal(S.describeMatch(r.matchedIn), 'Matched in the title and your note');
  });

  test('filters narrow by kind, collection, site and month; summarize counts them', () => {
    assert.deepEqual(titles(S.filterItems(sample, { kind: 'look' })), ['Blue risograph poster series']);
    assert.deepEqual(titles(S.filterItems(sample, { collectionId: 'c1' })), ['Blue risograph poster series']);
    assert.deepEqual(titles(S.filterItems(sample, { host: 'youtube.com' })), ['Kinetic type reel']);
    assert.deepEqual(titles(S.filterItems(sample, { month: '2026-10' })), ['Kinetic type reel', 'Café menu']);
    const sum = S.summarize(sample);
    assert.equal(sum.total, 3); assert.equal(sum.kinds.look, 1); assert.equal(sum.collections.get('c1'), 1);
    assert.deepEqual(sum.months.map((m) => m[0]), ['2026-10', '2026-09']);
    assert.equal(S.visitsText(0), 'Not opened yet'); assert.equal(S.visitsText(1), 'Opened once'); assert.equal(S.visitsText(6), 'Opened 6 times');
  });
})();
