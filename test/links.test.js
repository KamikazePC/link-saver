// Core logic: URL handling, input cleanup, storage (save, duplicates, delete, errors) and search.
(function () {
  'use strict';
  const { test, assert } = T;
  const L = LinkSaver;
  const newStore = (data) => {
    const chrome = createChromeStub({ data });
    return { chrome, store: L.createStore(chrome.storage.local) };
  };

  // ---------- URLs ----------

  test('normalizeUrl lowercases the host, drops default ports and plain #fragments', () => {
    assert.equal(L.normalizeUrl('HTTPS://Example.COM:443/Path?q=1#intro'), 'https://example.com/Path?q=1');
    assert.equal(L.normalizeUrl('http://example.com'), 'http://example.com/');
    assert.equal(L.normalizeUrl('  https://example.com/a  '), 'https://example.com/a');
  });

  test('normalizeUrl keeps single-page-app routes in the fragment', () => {
    assert.equal(L.normalizeUrl('https://app.example.com/#/inbox'), 'https://app.example.com/#/inbox');
    assert.equal(L.normalizeUrl('https://x.com/#!/post/1'), 'https://x.com/#!/post/1');
  });

  test('normalizeUrl rejects non-web and invalid addresses', () => {
    for (const bad of ['chrome://settings', 'file:///C:/a.txt', 'javascript:alert(1)', 'data:text/html,hi', 'not a url', '', null, 42]) {
      assert.equal(L.normalizeUrl(bad), null, String(bad));
    }
  });

  test('checkSavable accepts web pages and falls back to the URL for a missing title', () => {
    const r = L.checkSavable({ url: 'https://example.com/a#top', title: '  A   page ' });
    assert.deepEqual(r, { ok: true, url: 'https://example.com/a', title: 'A page' });
    assert.equal(L.checkSavable({ url: 'https://example.com/' }).title, 'https://example.com/');
  });

  test('checkSavable explains restricted pages instead of failing', () => {
    const cases = [
      [null, 'No active tab'],
      [{ title: 'Chrome Web Store' }, 'doesn\'t let extensions read this page'],
      [{ url: 'chrome://extensions/' }, 'browser page'],
      [{ url: 'edge://settings' }, 'browser page'],
      [{ url: 'about:blank' }, 'browser page'],
      [{ url: 'chrome-extension://abc/page.html' }, 'browser page'],
      [{ url: 'file:///C:/notes.txt' }, 'Files on your computer'],
      [{ url: 'data:text/html,hello' }, 'Only web pages'],
      [{ url: '::::' }, 'isn\'t a valid web address'],
    ];
    for (const [tab, expected] of cases) {
      const r = L.checkSavable(tab);
      assert.equal(r.ok, false, JSON.stringify(tab));
      assert.includes(r.reason, expected);
    }
  });

  // ---------- Input cleanup ----------

  test('parseTags trims, lowercases, strips # and removes duplicates', () => {
    assert.deepEqual(L.parseTags(' Work, #reading,,work , Long   Read '), ['work', 'reading', 'long read']);
    assert.deepEqual(L.parseTags(['A', '#a', 'b']), ['a', 'b']);
    assert.deepEqual(L.parseTags(undefined), []);
  });

  test('cleanDetails enforces the note and tag limits with clear messages', () => {
    const tooLongNote = () => L.cleanDetails({ note: 'x'.repeat(L.LIMITS.note + 1) });
    let err = null;
    try { tooLongNote(); } catch (e) { err = e; }
    assert.ok(err instanceof L.ValidationError);
    assert.equal(err.code, 'note-too-long');

    const manyTags = Array.from({ length: L.LIMITS.tags + 2 }, (_, i) => `t${i}`).join(',');
    try { L.cleanDetails({ tags: manyTags }); err = null; } catch (e) { err = e; }
    assert.equal(err && err.code, 'too-many-tags');
    assert.includes(err.message, 'Remove 2');

    try { L.cleanDetails({ tags: 'y'.repeat(L.LIMITS.tagLength + 1) }); err = null; } catch (e) { err = e; }
    assert.equal(err && err.code, 'tag-too-long');

    assert.deepEqual(L.cleanDetails({ note: '  hi  ', tags: 'a' }), { note: 'hi', tags: ['a'] });
  });

  // ---------- Save ----------

  test('save stores URL, title, note, tags and save date', async () => {
    const { chrome, store } = newStore();
    const now = new Date('2026-10-29T12:00:00Z');
    const r = await store.save({ url: 'https://example.com/a', title: 'A', note: ' read later ', tags: 'x, y' }, { now });
    assert.equal(r.status, 'saved');
    assert.deepEqual(chrome.data['link:https://example.com/a'], {
      url: 'https://example.com/a', title: 'A', note: 'read later', tags: ['x', 'y'], savedAt: '2026-10-29T12:00:00.000Z',
    });
  });

  test('save works without a note or tags and uses the URL when the title is blank', async () => {
    const { store } = newStore();
    const r = await store.save({ url: 'https://example.com/b', title: '   ' });
    assert.equal(r.item.title, 'https://example.com/b');
    assert.equal(r.item.note, '');
    assert.deepEqual(r.item.tags, []);
  });

  test('save refuses non-web URLs without touching storage', async () => {
    const { chrome, store } = newStore();
    chrome.failures.get = new Error('storage should not be called');
    await assert.rejects(store.save({ url: 'chrome://settings' }), (e) => assert.equal(e.code, 'not-savable'));
  });

  test('save rejects invalid input before touching storage', async () => {
    const { chrome, store } = newStore();
    chrome.failures.get = new Error('storage should not be called');
    await assert.rejects(store.save({ url: 'https://e.com/', note: 'x'.repeat(5000) }), (e) => assert.ok(e instanceof L.ValidationError));
  });

  // ---------- Duplicates ----------

  test('saving the same URL twice keeps the first save and reports a duplicate', async () => {
    const { chrome, store } = newStore();
    await store.save({ url: 'https://example.com/a', title: 'First', note: 'keep me' }, { now: new Date('2026-01-01T00:00:00Z') });
    const r = await store.save({ url: 'https://example.com/a', title: 'Second', note: 'not me' });
    assert.equal(r.status, 'duplicate');
    assert.equal(r.item.title, 'First');
    assert.equal(r.item.savedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(chrome.data['link:https://example.com/a'].note, 'keep me');
    assert.equal((await store.list()).length, 1);
  });

  test('URLs that differ only by host case, default port or #heading count as duplicates', async () => {
    const { store } = newStore();
    await store.save({ url: 'https://example.com/post' });
    for (const variant of ['https://EXAMPLE.com/post', 'https://example.com:443/post', 'https://example.com/post#comments']) {
      assert.equal((await store.save({ url: variant })).status, 'duplicate', variant);
    }
    // Different query string or path is a different page.
    assert.equal((await store.save({ url: 'https://example.com/post?page=2' })).status, 'saved');
    assert.equal((await store.save({ url: 'https://example.com/Post' })).status, 'saved');
    assert.equal((await store.list()).length, 3);
  });

  test('find returns the saved item for any form of its URL, or null', async () => {
    const { store } = newStore();
    await store.save({ url: 'https://example.com/a', title: 'A' });
    assert.equal((await store.find('https://Example.com/a#x')).title, 'A');
    assert.equal(await store.find('https://example.com/other'), null);
  });

  // ---------- List, update, delete ----------

  test('list returns links newest first and ignores unrelated storage keys', async () => {
    const { store } = newStore({ settings: { theme: 'dark' } });
    await store.save({ url: 'https://a.com/' }, { now: new Date('2026-01-01') });
    await store.save({ url: 'https://c.com/' }, { now: new Date('2026-03-01') });
    await store.save({ url: 'https://b.com/' }, { now: new Date('2026-02-01') });
    assert.deepEqual((await store.list()).map((i) => i.url), ['https://c.com/', 'https://b.com/', 'https://a.com/']);
  });

  test('update changes note and tags but keeps the save date', async () => {
    const { store } = newStore();
    await store.save({ url: 'https://a.com/', note: 'old' }, { now: new Date('2026-01-01T00:00:00Z') });
    const item = await store.update('https://a.com/', { note: 'new', tags: 'z' }, { now: new Date('2026-02-01T00:00:00Z') });
    assert.equal(item.note, 'new');
    assert.deepEqual(item.tags, ['z']);
    assert.equal(item.savedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(item.updatedAt, '2026-02-01T00:00:00.000Z');
  });

  test('update of a link deleted elsewhere says so', async () => {
    const { store } = newStore();
    await assert.rejects(store.update('https://gone.com/', { note: 'x' }), (e) => assert.equal(e.code, 'not-found'));
  });

  test('remove deletes a link and returns it; restore puts it back unchanged', async () => {
    const { chrome, store } = newStore();
    const { item } = await store.save({ url: 'https://a.com/', note: 'n', tags: 't' });
    const removed = await store.remove('https://a.com/#frag');
    assert.deepEqual(removed, item);
    assert.equal('link:https://a.com/' in chrome.data, false);
    assert.equal((await store.list()).length, 0);
    await store.restore(removed);
    assert.deepEqual(await store.find('https://a.com/'), item);
  });

  test('remove of a link that is not saved returns null', async () => {
    const { store } = newStore();
    assert.equal(await store.remove('https://never.com/'), null);
  });

  // ---------- Storage errors ----------

  test('a failing storage read becomes a StorageError with a friendly message', async () => {
    const { chrome, store } = newStore();
    const cause = new Error('IO error: LOCK file busy');
    chrome.failures.get = cause;
    const err = await assert.rejects(store.list());
    assert.ok(err instanceof L.StorageError);
    assert.equal(err.code, 'storage');
    assert.includes(err.message, 'Couldn\'t load your saved links');
    assert.equal(err.cause, cause, 'original error is kept');
  });

  test('a failing write is reported and nothing is half-saved', async () => {
    const { chrome, store } = newStore();
    chrome.failures.set = new Error('disk unavailable');
    const err = await assert.rejects(store.save({ url: 'https://a.com/' }));
    assert.ok(err instanceof L.StorageError);
    assert.includes(err.message, 'Couldn\'t save this page');
    chrome.failures.set = null;
    assert.equal((await store.list()).length, 0);
    assert.equal((await store.save({ url: 'https://a.com/' })).status, 'saved', 'works again once storage recovers');
  });

  test('a full storage quota gets its own message', async () => {
    const { chrome, store } = newStore();
    chrome.failures.set = new Error('QUOTA_BYTES quota exceeded');
    const err = await assert.rejects(store.save({ url: 'https://a.com/' }));
    assert.equal(err.code, 'quota');
    assert.includes(err.message, 'Storage is full');
  });

  test('failing delete leaves the link in place', async () => {
    const { chrome, store } = newStore();
    await store.save({ url: 'https://a.com/' });
    chrome.failures.remove = new Error('nope');
    await assert.rejects(store.remove('https://a.com/'), (e) => assert.ok(e instanceof L.StorageError));
    chrome.failures.remove = null;
    assert.equal((await store.list()).length, 1);
  });

  test('a missing storage area is reported, not thrown as a TypeError', async () => {
    const store = L.createStore(undefined);
    await assert.rejects(store.list(), (e) => assert.ok(e instanceof L.StorageError));
  });

  // ---------- Search ----------

  const sample = [
    { url: 'https://cooking.example/pasta', title: 'Fresh Pasta at Home', note: 'Try on Sunday', tags: ['recipes', 'weekend'] },
    { url: 'https://dev.example/js-closures', title: 'Understanding Closures', note: '', tags: ['javascript', 'work'] },
    { url: 'https://cafe.example/menu', title: 'Café Menu', note: 'Good espresso', tags: [] },
  ];
  const titles = (items) => items.map((i) => i.title);

  test('search with an empty query returns everything', () => {
    assert.equal(L.search(sample, '').length, 3);
    assert.equal(L.search(sample, '   ').length, 3);
  });

  test('search matches title, URL, note and tags, ignoring case', () => {
    assert.deepEqual(titles(L.search(sample, 'PASTA')), ['Fresh Pasta at Home']);
    assert.deepEqual(titles(L.search(sample, 'dev.example')), ['Understanding Closures']);
    assert.deepEqual(titles(L.search(sample, 'espresso')), ['Café Menu']);
    assert.deepEqual(titles(L.search(sample, 'javascript')), ['Understanding Closures']);
  });

  test('search requires every word to match', () => {
    assert.deepEqual(titles(L.search(sample, 'pasta sunday')), ['Fresh Pasta at Home']);
    assert.deepEqual(L.search(sample, 'pasta closures'), []);
  });

  test('search ignores accents', () => {
    assert.deepEqual(titles(L.search(sample, 'cafe')), ['Café Menu']);
    assert.deepEqual(titles(L.search(sample, 'CAFÉ')), ['Café Menu']);
  });

  test('#word in a search matches a tag exactly', () => {
    assert.deepEqual(titles(L.search(sample, '#work')), ['Understanding Closures']);
    assert.deepEqual(L.search(sample, '#wor'), []);
    assert.deepEqual(titles(L.search(sample, '#recipes fresh')), ['Fresh Pasta at Home']);
  });

  test('search returns nothing when nothing matches', () => {
    assert.deepEqual(L.search(sample, 'zebra'), []);
    assert.deepEqual(L.search([], 'anything'), []);
  });
})();
