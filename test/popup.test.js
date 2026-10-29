// The popup: saving, duplicate notice, restricted pages and storage failures.
(function () {
  'use strict';
  const { test, assert, until, fixture } = T;
  const PAGE = { id: 7, url: 'https://example.com/article#intro', title: 'An Article' };

  async function openPopup({ tab = PAGE, data, drafts = createMemoryStorage(), chrome } = {}) {
    chrome = chrome || createChromeStub({ tab, data });
    const root = fixture();
    let closed = 0;
    await LinkSaverPopup.mount(root, { chrome, drafts, close: () => { closed += 1; } });
    const $ = (sel) => root.querySelector(sel);
    return {
      chrome, root, drafts, $,
      get closed() { return closed; },
      text: () => root.textContent,
      heading: () => $('h1').textContent,
      submit: () => $('form').requestSubmit(),
      type(sel, value) {
        $(sel).value = value;
        $(sel).dispatchEvent(new Event('input', { bubbles: true }));
      },
    };
  }

  test('popup: saves the current page with a note and tags', async () => {
    const p = await openPopup();
    assert.equal(p.heading(), 'Save page');
    assert.equal(p.$('#title').value, 'An Article');
    assert.includes(p.$('.url').textContent, 'https://example.com/article');
    assert.equal(p.$('button[type=submit]').textContent, 'Save');
    p.type('#note', 'For the weekend');
    p.type('#tags', 'Reading, long');
    p.submit();
    await until(() => p.$('.status-success'), 'success message');
    const saved = p.chrome.data['link:https://example.com/article'];
    assert.equal(saved.title, 'An Article');
    assert.equal(saved.note, 'For the weekend');
    assert.deepEqual(saved.tags, ['reading', 'long']);
    assert.ok(saved.savedAt);
    assert.equal(p.heading(), 'Saved');
    await until(() => p.closed === 1, 'popup to close itself');
  });

  test('popup: the title can be edited before saving', async () => {
    const p = await openPopup();
    p.type('#title', 'My own title');
    p.submit();
    await until(() => p.$('.status-success'), 'success message');
    assert.equal(p.chrome.data['link:https://example.com/article'].title, 'My own title');
  });

  test('popup: an already-saved page says so and offers Update and Remove', async () => {
    const data = { 'link:https://example.com/article': {
      url: 'https://example.com/article', title: 'An Article', note: 'old note', tags: ['a', 'b'], savedAt: '2026-03-04T10:00:00.000Z',
    } };
    const p = await openPopup({ data });
    assert.equal(p.heading(), 'Already saved');
    assert.includes(p.$('.notice').textContent, 'You saved this page on');
    assert.includes(p.$('.notice').textContent, '2026');
    assert.equal(p.$('#note').value, 'old note');
    assert.equal(p.$('#tags').value, 'a, b');
    assert.equal(p.$('#title').readOnly, true);
    assert.equal(p.$('button[type=submit]').textContent, 'Update');
    assert.equal(p.$('.danger-quiet').hidden, false);

    p.type('#note', 'new note');
    p.submit();
    await until(() => p.$('.status-success'), 'update confirmation');
    const item = p.chrome.data['link:https://example.com/article'];
    assert.equal(item.note, 'new note');
    assert.equal(item.savedAt, '2026-03-04T10:00:00.000Z', 'save date unchanged');
    assert.equal(Object.keys(p.chrome.data).length, 1, 'no second copy');
  });

  test('popup: a page saved by another window while open is reported as a duplicate, keeping what was typed', async () => {
    const p = await openPopup();
    p.type('#note', 'my note');
    // Simulate a save from elsewhere after the popup opened.
    p.chrome.data['link:https://example.com/article'] = {
      url: 'https://example.com/article', title: 'Other', note: '', tags: [], savedAt: '2026-01-01T00:00:00.000Z',
    };
    p.submit();
    await until(() => p.$('.status-info'), 'duplicate message');
    assert.includes(p.$('.status').textContent, 'already saved');
    assert.equal(p.$('#note').value, 'my note');
    assert.equal(p.$('button[type=submit]').textContent, 'Update');
    assert.equal(p.closed, 0);
  });

  test('popup: Remove deletes the saved page', async () => {
    const data = { 'link:https://example.com/article': {
      url: 'https://example.com/article', title: 'An Article', note: '', tags: [], savedAt: '2026-03-04T10:00:00.000Z',
    } };
    const p = await openPopup({ data });
    p.$('.danger-quiet').click();
    await until(() => p.$('.status-success'), 'removed message');
    assert.equal(Object.keys(p.chrome.data).length, 0);
    assert.equal(p.$('button[type=submit]').textContent, 'Save');
  });

  test('popup: restricted pages show a clear message instead of a form', async () => {
    for (const [tab, expected] of [
      [{ id: 1, title: 'Chrome Web Store' }, 'Chrome Web Store'],
      [{ id: 1, url: 'chrome://settings/' }, 'browser page'],
      [{ id: 1, url: 'file:///C:/a.pdf' }, 'Files on your computer'],
      [null, 'No active tab'],
    ]) {
      const p = await openPopup({ tab });
      assert.equal(p.heading(), 'Can\'t save this page');
      assert.includes(p.$('.notice-warn').textContent, expected);
      assert.equal(p.$('form'), null);
      assert.ok(p.$('button.primary'), 'offers a way to the saved links');
    }
  });

  test('popup: if the tab can\'t be read at all it still shows a message', async () => {
    const chrome = createChromeStub({ tab: PAGE });
    chrome.failures.query = new Error('tabs API unavailable');
    const p = await openPopup({ chrome });
    assert.includes(p.$('.notice-warn').textContent, 'No active tab');
  });

  test('popup: a storage failure on save shows an error and keeps everything typed', async () => {
    const p = await openPopup();
    p.type('#note', 'important thoughts');
    p.type('#tags', 'keep');
    p.chrome.failures.set = new Error('IO error');
    p.submit();
    const error = await until(() => p.$('.status-error'), 'error message');
    assert.equal(error.getAttribute('role'), 'alert');
    assert.includes(error.textContent, 'Couldn\'t save this page');
    assert.equal(p.$('#note').value, 'important thoughts');
    assert.equal(p.$('#tags').value, 'keep');
    assert.equal(p.$('button[type=submit]').disabled, false, 'can retry');
    assert.equal(p.closed, 0);
    // The draft survives closing the popup.
    assert.includes(p.drafts.getItem(LinkSaverPopup.DRAFT_KEY), 'important thoughts');

    // Retry once storage works again.
    p.chrome.failures.set = null;
    p.submit();
    await until(() => p.$('.status-success'), 'success after retry');
    assert.equal(p.chrome.data['link:https://example.com/article'].note, 'important thoughts');
    assert.equal(p.drafts.getItem(LinkSaverPopup.DRAFT_KEY), null, 'draft cleared after saving');
  });

  test('popup: a full storage quota is explained', async () => {
    const p = await openPopup();
    p.chrome.failures.set = new Error('QUOTA_BYTES quota exceeded');
    p.submit();
    const error = await until(() => p.$('.status-error'), 'quota message');
    assert.includes(error.textContent, 'Storage is full');
  });

  test('popup: an unsaved draft comes back when the popup reopens on the same page', async () => {
    const drafts = createMemoryStorage();
    const first = await openPopup({ drafts });
    first.type('#note', 'half-written');
    first.type('#tags', 'later');
    const again = await openPopup({ drafts });
    assert.equal(again.$('#note').value, 'half-written');
    assert.equal(again.$('#tags').value, 'later');
    // A different page doesn't get it.
    const other = await openPopup({ drafts, tab: { id: 2, url: 'https://other.com/', title: 'Other' } });
    assert.equal(other.$('#note').value, '');
  });

  test('popup: a lookup failure still lets you try to save', async () => {
    const chrome = createChromeStub({ tab: PAGE });
    chrome.failures.get = new Error('read failed');
    const p = await openPopup({ chrome });
    assert.ok(p.$('form'), 'form is shown');
    assert.includes(p.$('.status-error').textContent, 'You can still try saving');
  });

  test('popup: a note over the limit is refused with a message', async () => {
    const p = await openPopup();
    // maxlength stops typing past the limit; this checks the save-time check too.
    p.$('#note').removeAttribute('maxlength');
    p.type('#note', 'x'.repeat(LinkSaver.LIMITS.note + 5));
    p.submit();
    const error = await until(() => p.$('.status-error'), 'validation message');
    assert.includes(error.textContent, 'Notes can be up to');
    assert.equal(Object.keys(p.chrome.data).length, 0);
  });

  test('popup: "All saved links" opens the list page', async () => {
    const p = await openPopup();
    p.$('.link-button').click();
    await until(() => p.chrome.createdTabs.length === 1, 'new tab');
    assert.equal(p.chrome.createdTabs[0].url, 'chrome-extension://test-id/list.html');
    assert.equal(p.closed, 1);
  });

  test('popup: works when localStorage is unavailable', async () => {
    const p = await openPopup({ drafts: createMemoryStorage({ broken: true }) });
    p.type('#note', 'still fine');
    p.submit();
    await until(() => p.$('.status-success'), 'success message');
  });
})();
