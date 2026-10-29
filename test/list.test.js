// The saved-links page: listing, empty states, search, open, delete with Undo, and errors.
(function () {
  'use strict';
  const { test, assert, until, fixture } = T;

  const item = (n, extra = {}) => ({
    url: `https://site${n}.example/page`, title: `Page ${n}`, note: '', tags: [],
    savedAt: `2026-0${n}-01T00:00:00.000Z`, ...extra,
  });
  const dataFor = (...items) => Object.fromEntries(items.map((i) => [`link:${i.url}`, i]));

  async function openList(data = {}, chrome = createChromeStub({ data })) {
    const root = fixture();
    const page = LinkSaverList.mount(root, { chrome });
    await page.ready;
    const $ = (sel) => root.querySelector(sel);
    const $$ = (sel) => [...root.querySelectorAll(sel)];
    return {
      chrome, root, $, $$, page,
      titles: () => $$('.link-title').map((a) => a.textContent),
      search(q) {
        $('#search').value = q;
        $('#search').dispatchEvent(new Event('input', { bubbles: true }));
      },
      done: () => page.destroy(),
    };
  }

  test('list: shows a helpful message when nothing is saved', async () => {
    const l = await openList();
    assert.includes(l.$('.empty').textContent, 'Nothing saved yet');
    assert.includes(l.$('.empty').textContent, 'Alt+Shift+S');
    assert.equal(l.$('.links').hidden, true);
    l.done();
  });

  test('list: shows every link newest first with its details', async () => {
    const l = await openList(dataFor(
      item(1), item(3, { note: 'A note', tags: ['work'] }), item(2)));
    assert.deepEqual(l.titles(), ['Page 3', 'Page 2', 'Page 1']);
    assert.equal(l.$('.count').textContent, '3 saved links');
    const first = l.$('.link');
    assert.includes(first.querySelector('.meta').textContent, 'site3.example');
    assert.includes(first.querySelector('.meta').textContent, 'Saved');
    assert.equal(first.querySelector('.note').textContent, 'A note');
    assert.equal(first.querySelector('.tag').textContent, '#work');
    assert.equal(l.$('.empty').hidden, true);
    l.done();
  });

  test('list: each title opens the page in a new tab', async () => {
    const l = await openList(dataFor(item(1)));
    const a = l.$('a.link-title');
    assert.equal(a.getAttribute('href'), 'https://site1.example/page');
    assert.equal(a.target, '_blank');
    assert.includes(a.rel, 'noopener');
    l.done();
  });

  test('list: user text is shown as text, never as HTML', async () => {
    const l = await openList(dataFor(item(1, { title: '<img src=x onerror=alert(1)>', note: '<b>bold</b>' })));
    assert.equal(l.$('img'), null);
    assert.equal(l.$('.link-title').textContent, '<img src=x onerror=alert(1)>');
    l.done();
  });

  test('list: search filters as you type and updates the count', async () => {
    const l = await openList(dataFor(item(1, { title: 'Pasta recipe' }), item(2, { title: 'Closures in JS' })));
    l.search('pasta');
    assert.deepEqual(l.titles(), ['Pasta recipe']);
    assert.equal(l.$('.count').textContent, '1 of 2 saved links');
    l.search('');
    assert.equal(l.titles().length, 2);
    l.done();
  });

  test('list: a search with no results says so and can be cleared', async () => {
    const l = await openList(dataFor(item(1), item(2)));
    l.search('zebra');
    assert.equal(l.titles().length, 0);
    assert.includes(l.$('.empty').textContent, 'No saved links match “zebra”');
    l.$('.empty button').click();
    assert.equal(l.$('#search').value, '');
    assert.equal(l.titles().length, 2);
    l.done();
  });

  test('list: clicking a tag filters by that tag', async () => {
    const l = await openList(dataFor(item(1, { tags: ['work'] }), item(2, { tags: ['home'] })));
    l.$$('.tag').find((b) => b.textContent === '#home').click();
    assert.equal(l.$('#search').value, '#home');
    assert.deepEqual(l.titles(), ['Page 2']);
    l.done();
  });

  test('list: delete removes the link from storage and the page, and Undo brings it back', async () => {
    const original = item(1, { note: 'n', tags: ['t'] });
    const l = await openList(dataFor(original, item(2)));
    const row = l.$$('.link').find((li) => li.dataset.url === original.url);
    row.querySelector('.delete').click();
    await until(() => !l.titles().includes('Page 1'), 'row to disappear');
    assert.equal(`link:${original.url}` in l.chrome.data, false);
    assert.includes(l.$('.toast').textContent, 'Deleted “Page 1”');

    l.$('.toast button').click();
    await until(() => l.titles().includes('Page 1'), 'row to come back');
    assert.deepEqual(l.chrome.data[`link:${original.url}`], original, 'restored exactly');
    assert.deepEqual(l.titles(), ['Page 2', 'Page 1'], 'back in date order');
    l.done();
  });

  test('list: deleting the last link shows the empty state', async () => {
    const l = await openList(dataFor(item(1)));
    l.$('.delete').click();
    await until(() => !l.$('.empty').hidden, 'empty state');
    assert.includes(l.$('.empty').textContent, 'Nothing saved yet');
    l.done();
  });

  test('list: a failed delete keeps the link and shows an error', async () => {
    const l = await openList(dataFor(item(1)));
    l.chrome.failures.remove = new Error('IO error');
    l.$('.delete').click();
    const toast = await until(() => (l.$('.toast-error') && !l.$('.toast').hidden ? l.$('.toast') : null), 'error toast');
    assert.includes(toast.textContent, 'Couldn\'t delete this link');
    assert.equal(toast.getAttribute('role'), 'alert');
    assert.deepEqual(l.titles(), ['Page 1']);
    assert.equal(l.$('.delete').disabled, false, 'can try again');
    l.done();
  });

  test('list: a load failure explains itself and Try again recovers', async () => {
    const chrome = createChromeStub({ data: dataFor(item(1)) });
    chrome.failures.get = new Error('IO error');
    const l = await openList(undefined, chrome);
    assert.includes(l.$('.empty').textContent, 'Couldn\'t load your saved links');
    chrome.failures.get = null;
    l.$('.empty button').click();
    await until(() => l.titles().length === 1, 'links after retry');
    assert.equal(l.$('.empty').hidden, true);
    l.done();
  });

  test('list: links saved elsewhere appear without reloading', async () => {
    const l = await openList();
    await LinkSaver.createStore(l.chrome.storage.local).save({ url: 'https://new.example/', title: 'Fresh' });
    await until(() => l.titles().includes('Fresh'), 'new link to appear');
    assert.equal(l.$('.empty').hidden, true);
    l.done();
  });
})();
