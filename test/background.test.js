// The quick-save keyboard shortcut handled by background.js.
// index.html loads background.js with a stub `chrome` (see the setup there),
// so these tests drive it through the registered command listener.
(function () {
  'use strict';
  const { test, assert, until } = T;
  const bg = globalThis.backgroundChrome;
  const fire = (tab) => bg.commandListeners.forEach((fn) => fn('quick-save', tab));
  const lastBadge = () => bg.badges[bg.badges.length - 1];
  const reset = () => {
    for (const k of Object.keys(bg.data)) delete bg.data[k];
    bg.badges.length = 0;
    Object.keys(bg.failures).forEach((k) => { bg.failures[k] = null; });
  };

  test('shortcut: saves the page and shows a ✓ badge', async () => {
    reset();
    fire({ id: 3, url: 'https://example.com/x', title: 'X' });
    await until(() => bg.badges.length, 'badge');
    assert.deepEqual(lastBadge(), { tabId: 3, text: '✓' });
    assert.equal(bg.data['link:https://example.com/x'].title, 'X');
    assert.equal(bg.lastTitle.title, 'Saved to Link Saver');
  });

  test('shortcut: a second save of the same page reports "Already saved"', async () => {
    reset();
    fire({ id: 3, url: 'https://example.com/x', title: 'X' });
    await until(() => bg.badges.length === 1, 'first badge');
    fire({ id: 3, url: 'https://example.com/x#part-2', title: 'X again' });
    await until(() => bg.badges.length === 2, 'second badge');
    assert.includes(bg.lastTitle.title, 'Already saved on');
    assert.equal(Object.keys(bg.data).length, 1);
    assert.equal(bg.data['link:https://example.com/x'].title, 'X');
  });

  test('shortcut: a restricted page shows ! with the reason', async () => {
    reset();
    fire({ id: 4, url: 'chrome://settings' });
    await until(() => bg.badges.length, 'badge');
    assert.deepEqual(lastBadge(), { tabId: 4, text: '!' });
    assert.includes(bg.lastTitle.title, 'browser page');
    assert.equal(Object.keys(bg.data).length, 0);
  });

  test('shortcut: a storage failure shows ! with the error', async () => {
    reset();
    bg.failures.set = new Error('IO error');
    fire({ id: 5, url: 'https://example.com/y', title: 'Y' });
    await until(() => bg.badges.length, 'badge');
    assert.equal(lastBadge().text, '!');
    assert.includes(bg.lastTitle.title, 'Couldn\'t save this page');
    reset();
  });
})();
