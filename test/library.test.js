// The library tab: empty state, home, routes and filters, search, collections (stack + in-place open),
// card actions with Undo, edit dialog, errors and live updates.
(function () {
  'use strict';
  const { test, assert, until, fixture } = T;
  const it = (n, kind, extra = {}) => ({ url: `https://site${n}.example/p${n}`, title: `Item ${n}`, kind, note: '', collections: [], pinned: false, visits: 0, savedAt: `2026-0${n}-01T00:00:00.000Z`, ...extra });
  const DATA = () => {
    const items = [
      it(1, 'look', { title: 'Blue risograph poster series', note: 'for the rebrand', collections: ['c1'], pinned: true, visits: 3 }),
      it(2, 'read', { title: 'Grid systems in graphic design', collections: ['c1'] }),
      it(3, 'watch', { title: 'Kinetic type reel', pinned: true, visits: 9 }),
      it(4, 'buy', { title: 'Linen overshirt' }),
      it(5, 'look', { title: 'Isometric stack construction', collections: ['c1'] }),
    ];
    return { schema: 2, collections: [{ id: 'c1', name: 'Rebrand inspo', createdAt: '2026-01-01T00:00:00.000Z' }, { id: 'c2', name: 'Recipes', createdAt: '2026-01-02T00:00:00.000Z' }], ...Object.fromEntries(items.map((i) => [`link:${i.url}`, i])) };
  };

  async function openLibrary(data = DATA(), { route = '#/', chrome } = {}) {
    chrome = chrome || createChromeStub({ data });
    const root = fixture();
    // Keep real links from navigating the test page; the library still counts the visit.
    root.addEventListener('click', (e) => { const a = e.target.closest('a[href^="http"]'); if (a) e.preventDefault(); }, true);
    const lib = StashLibrary.mount(root, { chrome, initialRoute: route, prefs: createMemoryStorage() });
    await lib.ready;
    const $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)];
    return { chrome, root, lib, $, $$,
      main: () => root.querySelector('.main'),
      titles: () => $$('.card-title, .row-title, .sheet-title').map((e) => e.textContent),
      btn: (text, scope = root) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === text),
      search(q) { const i = $('.topbar input'); i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); },
      done() { lib.destroy(); document.querySelectorAll('.menu, .toast-region').forEach((m) => m.remove()); } };
  }
  const menuItem = (text) => [...document.querySelectorAll('.menu [role^="menuitem"]')].find((b) => b.textContent.startsWith(text));

  test('library: an empty library teaches the ways to save and the kind colours', async () => {
    const l = await openLibrary({ schema: 2, collections: [] });
    assert.includes(l.main().textContent, 'Your library starts here.');
    assert.equal(l.$$('.ways li').length, 3);
    assert.equal(l.$$('.empty .chip[data-kind]').length, 7);
    assert.ok(l.$$('.side-row.dim').length >= 7, 'empty kind filters are dimmed');
    l.done();
  });

  test('library: home shows pinned by most opened, collections as folders, then everything', async () => {
    const l = await openLibrary();
    assert.includes(l.$('.display').textContent, 'Your library');
    const sections = l.$$('.section-head h2').map((h) => h.textContent);
    assert.deepEqual(sections, ['★ Pinned', 'Collections', 'Recently saved']);
    const pinned = [...l.$$('.grid')[0].querySelectorAll('.card-title')].map((a) => a.textContent);
    assert.deepEqual(pinned, ['Kinetic type reel', 'Blue risograph poster series']);
    const folders = l.$$('.folder');
    assert.equal(folders.length, 2);
    assert.includes(folders[0].textContent, 'Rebrand inspo'); assert.includes(folders[0].textContent, '3 saves');
    assert.equal(folders[0].getAttribute('href'), '#/collection/c1');
    assert.ok(folders[0].querySelector('.sheet[data-kind="look"]'), 'stack shows the kinds inside');
    assert.includes(l.$('.side-row[href="#/kind/look"]').textContent, '2');
    l.done();
  });

  test('library: cards show the kind in words, keep long titles reachable, and count opens', async () => {
    const l = await openLibrary();
    const card = l.$$('.card').find((c) => c.dataset.url === 'https://site4.example/p4');
    assert.equal(card.querySelector('.chip[data-kind]').textContent, 'Buy');
    const a = card.querySelector('.card-title');
    assert.equal(a.target, '_blank'); assert.equal(a.title, 'Linen overshirt');
    assert.equal(card.querySelector('.more').getAttribute('aria-label'), 'More actions for “Linen overshirt”');
    a.click();
    await until(() => l.chrome.data['link:https://site4.example/p4'].visits === 1, 'visit counted');
    l.done();
  });

  test('library: kind filter route lists only that kind and marks the sidebar', async () => {
    const l = await openLibrary(DATA(), { route: '#/kind/look' });
    assert.deepEqual(l.titles().sort(), ['Blue risograph poster series', 'Isometric stack construction']);
    assert.equal(l.$('.side-row[href="#/kind/look"]').getAttribute('aria-current'), 'page');
    assert.includes(l.$('.chips .chip').textContent, 'Kind: Look');
    l.done();
  });

  test('library: search says where it matched, underlines words, and admits what a filter hides', async () => {
    const l = await openLibrary();
    l.search('rebrand');
    // Two saves match through the “Rebrand inspo” collection name, one through its note.
    assert.includes(l.$('.page-head h1').textContent, '3 results for “rebrand”');
    assert.includes(l.main().textContent, 'Matched in your note and a collection: “for the rebrand”');
    assert.includes(l.main().textContent, 'Matched in a collection');
    l.search('poster');
    assert.equal(l.$('.row-title .match').textContent, 'poster');
    l.lib.navigate('#/kind/read?q=s');
    assert.ok(l.$('.outside'), 'matches outside the filter are mentioned');
    l.done();
  });

  test('library: a search with no results says so and can be cleared', async () => {
    const l = await openLibrary();
    l.search('zebra');
    assert.includes(l.main().textContent, 'No saves match “zebra”');
    l.btn('Clear search').click();
    assert.equal(l.$('.topbar input').value, '');
    assert.includes(l.$('.display').textContent, 'Your library');
    l.done();
  });

  test('library: a collection opens as a stack; a save opens in place and Escape tucks it back', async () => {
    const l = await openLibrary(DATA(), { route: '#/collection/c1' });
    assert.equal(l.$('.folder-title').textContent, 'Rebrand inspo');
    assert.includes(l.$('.pocket-bar').textContent, 'Look · 2');
    const heads = l.$$('.sheet-head');
    assert.equal(heads.length, 3);
    heads[1].click();
    assert.equal(heads[1].getAttribute('aria-expanded'), 'true');
    assert.equal(l.$(`#${heads[1].getAttribute('aria-controls')}`).hidden, false);
    heads[0].click();
    assert.equal(l.$$('.sheet-head[aria-expanded="true"]').length, 1, 'only one open at a time');
    heads[0].focus();
    heads[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.equal(document.activeElement, heads[1]);
    heads[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(l.$$('.sheet-head[aria-expanded="true"]').length, 0);
    assert.equal(document.activeElement, heads[0], 'focus returns to the save that was open');
    l.done();
  });

  test('library: rename a collection, then delete it with Undo; saves stay', async () => {
    const l = await openLibrary(DATA(), { route: '#/collection/c1' });
    l.btn('Rename').click();
    const input = l.$('.rename-input'); input.value = 'Brand refresh';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await until(() => l.chrome.data.collections[0].name === 'Brand refresh', 'renamed');
    await until(() => l.$('.folder-title') && l.$('.folder-title').textContent === 'Brand refresh', 'heading updated');
    l.btn('Delete collection').click();
    await until(() => l.lib.route.type === 'home', 'back home');
    assert.equal(l.chrome.data.collections.length, 1);
    assert.equal(Object.keys(l.chrome.data).filter((k) => k.startsWith('link:')).length, 5, 'saves stay');
    const toast = await until(() => document.querySelector('.toast'), 'toast');
    assert.includes(toast.textContent, 'Its saves are still in your library');
    l.btn('Undo', toast).click();
    await until(() => l.chrome.data.collections.some((c) => c.id === 'c1'), 'restored');
    l.done();
  });

  test('library: delete from the ⋯ menu shows an Undo message that stays until closed', async () => {
    const l = await openLibrary();
    l.$$('.card').find((c) => c.dataset.url === 'https://site4.example/p4').querySelector('.more').click();
    menuItem('Delete').click();
    await until(() => !l.chrome.data['link:https://site4.example/p4'], 'deleted');
    const toast = await until(() => document.querySelector('.toast'), 'toast');
    assert.includes(toast.textContent, 'Deleted “Linen overshirt”');
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(document.querySelector('.toast'), 'no timer');
    l.btn('Undo', toast).click();
    await until(() => l.chrome.data['link:https://site4.example/p4'], 'restored');
    l.done();
  });

  test('library: pin and add to collection from the ⋯ menu', async () => {
    const l = await openLibrary();
    const more = () => l.$$('.card').find((c) => c.dataset.url === 'https://site4.example/p4').querySelector('.more');
    more().click(); menuItem('Pin to top').click();
    await until(() => l.chrome.data['link:https://site4.example/p4'].pinned, 'pinned');
    more().click(); menuItem('Add to collection').click();
    menuItem('Recipes').click();
    await until(() => (l.chrome.data['link:https://site4.example/p4'].collections || []).includes('c2'), 'added');
    l.done();
  });

  test('library: the edit dialog changes title, kind and note', async () => {
    const l = await openLibrary();
    l.$$('.card').find((c) => c.dataset.url === 'https://site4.example/p4').querySelector('.more').click();
    menuItem('Edit').click();
    const dialog = l.$('dialog');
    dialog.querySelector('#edit-title').value = 'Linen overshirt, sage';
    dialog.querySelector('#edit-note').value = 'size M';
    dialog.querySelector('.chip[data-kind="look"]').click();
    dialog.querySelector('form').requestSubmit();
    await until(() => l.chrome.data['link:https://site4.example/p4'].note === 'size M', 'saved');
    const s = l.chrome.data['link:https://site4.example/p4'];
    assert.equal(s.title, 'Linen overshirt, sage'); assert.equal(s.kind, 'look');
    l.done();
  });

  test('library: a load failure explains itself and Try again recovers', async () => {
    const chrome = createChromeStub({ data: DATA() }); chrome.failures.get = new Error('IO');
    const l = await openLibrary(undefined, { chrome });
    assert.includes(l.main().textContent, 'Couldn’t load your library');
    chrome.failures.get = null; l.btn('Try again').click();
    await until(() => l.$('.card'), 'cards');
    l.done();
  });

  test('library: saves made elsewhere appear without reloading; List view shows rows', async () => {
    const l = await openLibrary();
    await Stash.createStore(l.chrome.storage.local).save({ url: 'https://new.example/', title: 'Fresh save' });
    await until(() => l.titles().includes('Fresh save'), 'live update');
    l.btn('List').click();
    assert.ok(l.$$('.row-item').length >= 5);
    l.done();
  });

  test('library: new collection from the sidebar, and Show all sites', async () => {
    const data = DATA();
    for (const n of [6, 7]) data[`link:https://site${n}.example/p${n}`] = it(n, 'other');
    const l = await openLibrary(data);
    l.btn('+ New collection', l.$('.sidebar')).click();
    const input = l.$('.side-input'); input.value = 'Lisbon trip';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await until(() => l.lib.route.type === 'collection', 'opened the new collection');
    assert.ok(l.chrome.data.collections.some((c) => c.name === 'Lisbon trip'));
    const showAll = l.btn('Show all 7 sites'); assert.ok(showAll);
    showAll.click();
    assert.equal(l.$$('.side-row .favicon').length, 7);
    l.done();
  });

  test('library: routes parse and build both ways', () => {
    const { parseRoute, buildRoute } = StashLibrary;
    for (const r of [{ type: 'home', q: '' }, { type: 'search', q: 'blue poster' }, { type: 'kind', value: 'look', q: '' }, { type: 'site', value: 'are.na', q: 'x' }, { type: 'collection', value: 'c_1', q: '' }]) {
      assert.deepEqual(parseRoute(buildRoute(r)), r);
    }
  });
})();
