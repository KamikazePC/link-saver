// background.js: the quick-save shortcut and the install-time migration.
// index.html loads background.js with a stub `chrome`, so these tests drive its listeners.
(function () {
  'use strict';
  const { test, assert, until } = T;
  const bg = globalThis.backgroundChrome;
  const fire = (tab) => bg.commandListeners.forEach((fn) => fn('quick-save', tab));
  const last = () => bg.badges[bg.badges.length - 1];
  const reset = () => { for (const k of Object.keys(bg.data)) delete bg.data[k]; bg.data.schema = 2; bg.data.collections = []; bg.badges.length = 0; Object.keys(bg.failures).forEach((k) => { bg.failures[k] = null; }); };

  test('shortcut: saves the page with its kind and shows a ✓ badge', async () => {
    reset();
    fire({ id: 3, url: 'https://www.youtube.com/watch?v=1', title: 'Talk' });
    await until(() => bg.badges.length, 'badge');
    assert.deepEqual(last(), { tabId: 3, text: '✓' });
    assert.equal(bg.data['link:https://www.youtube.com/watch?v=1'].kind, 'watch');
    assert.includes(bg.lastTitle.title, 'as Watch');
  });

  test('shortcut: a second save reports “Already in your library” with ★, never a colour', async () => {
    reset();
    fire({ id: 3, url: 'https://example.com/x', title: 'X' }); await until(() => bg.badges.length === 1, 'first');
    fire({ id: 3, url: 'https://example.com/x#part', title: 'X again' }); await until(() => bg.badges.length === 2, 'second');
    assert.equal(last().text, '★'); assert.includes(bg.lastTitle.title, 'Already in your library');
    assert.ok(['#111111', '#FFFFFF'].includes(bg.lastBadgeColor), 'badge stays neutral');
  });

  test('shortcut: restricted pages and storage failures show ! with a way forward', async () => {
    reset();
    fire({ id: 4, url: 'chrome://settings' }); await until(() => bg.badges.length, 'badge');
    assert.equal(last().text, '!'); assert.includes(bg.lastTitle.title, 'Can’t save this page');
    reset(); bg.failures.set = new Error('QUOTA_BYTES quota exceeded');
    fire({ id: 5, url: 'https://example.com/y', title: 'Y' }); await until(() => bg.badges.length, 'badge');
    assert.equal(last().text, '!'); assert.includes(bg.lastTitle.title, 'Delete some saves, then save again');
    reset();
  });

  test('install: old tags become collections', async () => {
    for (const k of Object.keys(bg.data)) delete bg.data[k];
    bg.data['link:https://a.com/'] = { url: 'https://a.com/', title: 'A', tags: ['reading'], savedAt: '2026-01-01T00:00:00.000Z' };
    bg.installedListeners.forEach((fn) => fn({ reason: 'update' }));
    await until(() => bg.data.schema === 2, 'migrated');
    assert.equal(bg.data.collections[0].name, 'reading');
    assert.deepEqual(bg.data['link:https://a.com/'].collections, [bg.data.collections[0].id]);
    reset();
  });
})();
