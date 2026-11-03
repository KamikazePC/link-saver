// The popup: Save, kind picker, collections, Saved + Undo, Already saved, Deleted + Undo, finder, errors and drafts.
(function () {
  'use strict';
  const { test, assert, until, fixture } = T;
  const PIN = { id: 7, url: 'https://www.pinterest.com/pin/123#top', title: 'Swiss Style posters' };
  const PIN_URL = 'https://www.pinterest.com/pin/123';
  const COLS = { schema: 2, collections: [{ id: 'c1', name: 'Rebrand inspo', createdAt: '2026-01-01T00:00:00.000Z' }, { id: 'c2', name: 'Recipes', createdAt: '2026-01-02T00:00:00.000Z' }] };
  const saved = (extra = {}) => ({ url: PIN_URL, title: 'Swiss Style posters', kind: 'look', note: 'for the rebrand', collections: ['c1'], pinned: false, visits: 3, savedAt: '2026-09-14T10:00:00.000Z', ...extra });

  async function openPopup({ tab = PIN, data = COLS, drafts = createMemoryStorage(), chrome } = {}) {
    chrome = chrome || createChromeStub({ tab, data });
    const root = fixture(); let closed = 0;
    await StashPopup.mount(root, { chrome, drafts, close: () => { closed += 1; } });
    const $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)];
    const button = (text) => $$('button').find((b) => b.textContent.trim() === text);
    return { chrome, root, drafts, $, $$, button, get closed() { return closed; }, text: () => root.textContent,
      type(sel, v) { const el = $(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); },
      submit: () => $('form').requestSubmit() };
  }
  const menuItems = () => [...document.querySelectorAll('.menu [role^="menuitem"]')];

  test('popup: save detects the kind, labels the note, and files into the chosen collection', async () => {
    const p = await openPopup();
    assert.equal(p.$('.kind-chip').textContent, 'Look ▾');
    assert.equal(p.$('.preview').dataset.kind, 'look');
    assert.equal(p.$('.title').textContent, 'Swiss Style posters');
    assert.includes(p.$('.site').textContent, 'pinterest.com');
    const note = p.$('textarea'); assert.equal(p.$(`label[for="${note.id}"]`).textContent, 'Note · optional');
    assert.equal(p.$('button[type=submit]').textContent, 'Save');
    p.type('textarea', 'Layout ideas');
    p.button('Rebrand inspo').click();
    assert.equal(p.$('button[type=submit]').textContent, 'Save to Rebrand inspo');
    p.button('☆ Pin to top').click();
    p.submit();
    await until(() => p.$('.screen-saved'), 'saved screen');
    const s = p.chrome.data[`link:${PIN_URL}`];
    assert.equal(s.kind, 'look'); assert.equal(s.note, 'Layout ideas'); assert.deepEqual(s.collections, ['c1']); assert.equal(s.pinned, true);
    assert.equal(p.$('.headline').textContent, 'Filed in Rebrand inspo');
    assert.equal(p.$('.new-sheet').dataset.kind, 'look');
  });

  test('popup: the Saved screen never closes on a timer, and Undo puts everything back', async () => {
    const p = await openPopup();
    p.type('textarea', 'keep me'); p.submit();
    await until(() => p.$('.screen-saved'), 'saved screen');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(p.closed, 0, 'no auto-close');
    p.button('Undo').click();
    await until(() => p.$('.screen-save'), 'back to the form');
    assert.equal(p.chrome.data[`link:${PIN_URL}`], undefined, 'save removed');
    assert.equal(p.$('textarea').value, 'keep me');
    assert.includes(p.$('.status').textContent, 'Not saved');
  });

  test('popup: the kind chip opens a menu that explains every kind and changes it', async () => {
    const p = await openPopup();
    const chip = p.$('.kind-chip'); chip.click();
    const items = menuItems();
    assert.equal(items.length, 7);
    assert.includes(items[2].textContent, 'images, posters, moodboards');
    assert.equal(document.activeElement, items[2], 'focus starts on the current kind');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    assert.equal(document.activeElement, items[1]);
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(menuItems().length, 0); assert.equal(document.activeElement, chip, 'focus returns to the chip');
    assert.equal(p.closed, 0, 'Escape closed the menu, not the popup');
    chip.click(); menuItems().find((b) => b.textContent.startsWith('Watch')).click();
    assert.equal(p.$('.kind-chip').textContent, 'Watch ▾'); assert.equal(p.$('.preview').dataset.kind, 'watch');
    p.submit(); await until(() => p.$('.screen-saved'), 'saved');
    assert.equal(p.chrome.data[`link:${PIN_URL}`].kind, 'watch');
  });

  test('popup: "+ New" creates a collection and selects it', async () => {
    const p = await openPopup();
    p.button('+ New').click();
    const input = p.$('.chip-input'); input.value = 'Posters';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await until(() => p.button('✓ Posters'), 'new chip selected');
    assert.ok(p.chrome.data.collections.some((c) => c.name === 'Posters'));
    assert.equal(p.$('button[type=submit]').textContent, 'Save to Posters');
  });

  test('popup: the title can be edited with the Edit title button', async () => {
    const p = await openPopup();
    p.$('[aria-label="Edit title"]').click();
    const input = p.$('.title-input'); assert.equal(input.hidden, false);
    input.value = 'My posters'; input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(p.$('.title').textContent, 'My posters');
    p.submit(); await until(() => p.$('.screen-saved'), 'saved');
    assert.equal(p.chrome.data[`link:${PIN_URL}`].title, 'My posters');
  });

  test('popup: an already-saved page shows when, how often, and lets you change it', async () => {
    const p = await openPopup({ data: { ...COLS, [`link:${PIN_URL}`]: saved() } });
    assert.ok(p.$('.screen-already'));
    assert.includes(p.$('.saved-badge').textContent, 'Saved on');
    assert.includes(p.text(), 'Opened 3 times');
    assert.equal(p.$('textarea').value, 'for the rebrand');
    assert.ok(p.button('✓ Rebrand inspo'));
    p.type('textarea', 'updated'); p.button('Recipes').click();
    p.button('Save changes').click();
    await until(() => /Changes saved/.test(p.$('.status').textContent), 'confirmation');
    const s = p.chrome.data[`link:${PIN_URL}`];
    assert.equal(s.note, 'updated'); assert.deepEqual(s.collections, ['c1', 'c2']); assert.equal(s.savedAt, '2026-09-14T10:00:00.000Z');
  });

  test('popup: Delete from library shows Deleted, and Undo restores it with its note', async () => {
    const p = await openPopup({ data: { ...COLS, [`link:${PIN_URL}`]: saved() } });
    p.button('Delete from library').click();
    await until(() => p.$('.screen-deleted'), 'deleted screen');
    assert.equal(p.chrome.data[`link:${PIN_URL}`], undefined);
    assert.includes(p.text(), '“Swiss Style posters” and its note are gone');
    await new Promise((r) => setTimeout(r, 200)); assert.ok(p.button('Undo'), 'Undo does not time out');
    p.button('Undo').click();
    await until(() => p.$('.screen-already'), 'restored');
    assert.equal(p.chrome.data[`link:${PIN_URL}`].note, 'for the rebrand');
    assert.includes(p.$('.status').textContent, 'Restored');
  });

  test('popup: a page saved elsewhere while the popup was open is reported, not copied', async () => {
    const p = await openPopup();
    p.chrome.data[`link:${PIN_URL}`] = saved({ note: 'from another window' });
    p.submit();
    await until(() => p.$('.screen-already'), 'already screen');
    assert.includes(p.$('.status').textContent, 'already in your library');
    assert.equal(Object.keys(p.chrome.data).filter((k) => k.startsWith('link:')).length, 1);
  });

  test('popup: on pages that can’t be saved it becomes a finder', async () => {
    const data = { ...COLS, 'link:https://a.com/': saved({ url: 'https://a.com/', title: 'Brutalist index', pinned: true, visits: 5 }), 'link:https://b.com/': saved({ url: 'https://b.com/', title: 'Grid systems', kind: 'read', pinned: false }) };
    const p = await openPopup({ tab: { id: 1, url: 'chrome://settings/' }, data });
    assert.includes(p.$('.notice').textContent, 'This page can’t be saved');
    assert.equal(p.$('form'), null);
    assert.equal(p.$('.finder-list').children.length, 1, 'pinned first');
    p.type('input[type=search]', 'grid');
    assert.includes(p.$('.finder-list').textContent, 'Grid systems');
    p.$('.finder-row').click();
    await until(() => p.chrome.createdTabs.length === 1, 'opened');
    assert.equal(p.chrome.createdTabs[0].url, 'https://b.com/');
    assert.equal(p.chrome.data['link:https://b.com/'].visits, 4, 'visit counted');
    assert.equal(p.closed, 1);
  });

  test('popup: if the tab can’t be read at all it explains instead of failing', async () => {
    const chrome = createChromeStub({ tab: PIN, data: COLS }); chrome.failures.query = new Error('tabs unavailable');
    const p = await openPopup({ chrome });
    assert.includes(p.$('.notice').textContent, 'No active tab');
  });

  test('popup: a storage failure on save keeps everything typed and can be retried', async () => {
    const p = await openPopup();
    p.type('textarea', 'important thoughts'); p.button('Rebrand inspo').click();
    p.chrome.failures.set = new Error('IO error');
    p.submit();
    const err = await until(() => p.$('.status-error'), 'error');
    assert.equal(err.getAttribute('role'), 'alert'); assert.includes(err.textContent, 'Couldn’t save this page');
    assert.equal(p.$('textarea').value, 'important thoughts');
    assert.includes(p.drafts.getItem(StashPopup.DRAFT_KEY), 'important thoughts');
    p.chrome.failures.set = null; p.submit();
    await until(() => p.$('.screen-saved'), 'saved after retry');
    assert.equal(p.drafts.getItem(StashPopup.DRAFT_KEY), null, 'draft cleared');
  });

  test('popup: a full storage quota says how to recover', async () => {
    const p = await openPopup();
    p.chrome.failures.set = new Error('QUOTA_BYTES quota exceeded');
    p.submit();
    assert.includes((await until(() => p.$('.status-error'), 'error')).textContent, 'Delete some saves, then save again');
  });

  test('popup: an unsaved draft comes back on the same page only', async () => {
    const drafts = createMemoryStorage();
    const a = await openPopup({ drafts }); a.type('textarea', 'half-written'); a.button('Recipes').click();
    const b = await openPopup({ drafts });
    assert.equal(b.$('textarea').value, 'half-written'); assert.ok(b.button('✓ Recipes'));
    const c = await openPopup({ drafts, tab: { id: 2, url: 'https://other.com/', title: 'Other' } });
    assert.equal(c.$('textarea').value, '');
  });

  test('popup: Library ↗ opens the library tab; Escape closes the popup', async () => {
    const p = await openPopup();
    p.root.firstChild.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(p.closed, 1);
    p.button('Library ↗').click();
    await until(() => p.chrome.createdTabs.length === 1, 'tab');
    assert.equal(p.chrome.createdTabs[0].url, 'chrome-extension://test-id/library.html');
  });

  test('popup: works when localStorage is unavailable', async () => {
    const p = await openPopup({ drafts: createMemoryStorage({ broken: true }) });
    p.type('textarea', 'still fine'); p.submit();
    await until(() => p.$('.screen-saved'), 'saved');
  });
})();
