// The toolbar popup. States: Save, Saved, Already saved, Deleted, and a finder on pages that can't be saved.
// Mounted into a container with injected dependencies so the tests can drive it with a fake chrome.
(function (root) {
  'use strict';
  const S = root.Stash, K = root.StashKinds, U = root.StashUI;
  const { h } = U;
  const DRAFT_KEY = 'stash:draft';
  const LAST_COLLECTION_KEY = 'stash:lastCollection';

  // deps: { chrome, drafts (localStorage-like), close() }
  async function mount(container, deps) {
    const { chrome } = deps;
    const store = S.createStore(chrome.storage && chrome.storage.local);
    const drafts = safeStorage(deps.drafts);
    const close = deps.close || (() => {});
    const libraryUrl = (hash = '') => chrome.runtime.getURL('library.html') + hash;
    let total = 0, collections = [];

    container.replaceChildren(h('p', { class: 'muted', role: 'status' }, 'Loading…'));
    container.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) close(); });

    let tab;
    try { [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); } catch (err) { console.error('Stash: could not read the current tab', err); }
    const check = S.checkSavable(tab);

    let loadError = null;
    try { [total, collections] = await Promise.all([store.list().then((l) => l.length), store.listCollections()]); }
    catch (err) { console.error('Stash: could not load the library', err); loadError = err.message; }

    if (!check.ok) return renderFinder(check.reason);
    let existing = null;
    try { existing = await store.find(check.url); } catch (err) { loadError = loadError || err.message; }
    if (existing) return renderAlready(existing);
    return renderSave({ loadError });

    // ---------- Shared pieces ----------

    function topBar() {
      return h('header', { class: 'top' },
        U.icon('logo'),
        h('span', { class: 'brand' }, 'Stash'),
        h('span', { class: 'chip' }, `${total} ${total === 1 ? 'save' : 'saves'}`),
        h('button', { type: 'button', class: 'link-btn small', onclick: () => openLibrary() }, 'Library ↗'));
    }

    async function openLibrary(hash) {
      try { await chrome.tabs.create({ url: libraryUrl(hash) }); close(); } catch (err) { console.error('Stash: could not open the library', err); }
    }

    function screen(name, ...children) {
      container.replaceChildren(h('div', { class: `screen screen-${name}` }, topBar(), ...children));
    }

    // Preview card: kind colour + icon (page previews arrive in phase 2), kind chip, title with edit, site.
    function previewCard(state, { onKind, badge } = {}) {
      const tile = h('div', { class: 'preview', dataset: { kind: state.kind } });
      tile.append(U.svg(K.kindIcon(state.kind, 40)));
      const chip = h('button', { type: 'button', class: 'chip kind-chip', dataset: { kind: state.kind }, 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `Kind: ${U.kindLabel(state.kind)}. Change kind` }, `${U.kindLabel(state.kind)} ▾`);
      chip.addEventListener('click', () => {
        U.openMenu(chip, K.KINDS.map((k) => ({
          label: k.label, sub: k.examples, lead: U.kindTile(k.id, 26), checked: k.id === state.kind,
          onSelect: () => {
            state.kind = k.id; onKind && onKind(k.id);
            tile.dataset.kind = k.id; tile.replaceChildren(U.svg(K.kindIcon(k.id, 40)), chip, ...(badge ? [badge] : []));
            chip.dataset.kind = k.id; chip.textContent = `${k.label} ▾`; chip.setAttribute('aria-label', `Kind: ${k.label}. Change kind`);
          },
        })), { label: 'Kind' });
      });
      tile.append(chip);
      if (badge) tile.append(badge);

      const title = h('span', { class: 'title' }, state.title);
      const input = h('input', { class: 'title-input', type: 'text', value: state.title, maxlength: String(S.LIMITS.title), 'aria-label': 'Title', hidden: true });
      const edit = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Edit title', title: 'Edit title' }, U.icon('edit'));
      const finish = () => { state.title = input.value.trim() || state.title; title.textContent = state.title; input.hidden = true; title.hidden = false; edit.hidden = false; };
      edit.addEventListener('click', () => { title.hidden = true; edit.hidden = true; input.hidden = false; input.focus(); input.select(); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(); edit.focus(); } if (e.key === 'Escape') { e.preventDefault(); input.value = state.title; finish(); edit.focus(); } });
      input.addEventListener('blur', finish);
      input.addEventListener('input', () => { state.title = input.value; state.onInput && state.onInput(); });

      return h('div', { class: 'preview-card' }, tile,
        h('div', { class: 'details' },
          h('div', { class: 'title-row' }, title, input, edit),
          h('div', { class: 'site' }, h('span', { class: 'favicon', 'aria-hidden': 'true' }), S.hostOf(state.url))));
    }

    function noteField(state) {
      const id = `note-${Math.random().toString(36).slice(2, 7)}`;
      const ta = h('textarea', { id, class: 'field', rows: '2', maxlength: String(S.LIMITS.note), placeholder: 'For the rebrand moodboard' });
      ta.value = state.note || '';
      ta.addEventListener('input', () => { state.note = ta.value; state.onInput && state.onInput(); });
      return { el: h('div', {}, h('label', { class: 'caps field-label', for: id }, 'Note · optional'), ta), ta };
    }

    // Collection chips: toggle any number; "+ New" turns into a name field.
    function collectionPicker(state, onChange) {
      const wrap = h('div', { class: 'collections', role: 'group', 'aria-label': 'Collections' });
      const label = h('p', { class: 'caps' }, 'Collection');
      function render() {
        wrap.replaceChildren(...collections.map((c) => {
          const on = state.collections.includes(c.id);
          return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(on), onclick: () => {
            state.collections = on ? state.collections.filter((x) => x !== c.id) : [...state.collections, c.id];
            render(); onChange(); wrap.querySelector(`[data-id="${c.id}"]`).focus();
          }, dataset: { id: c.id } }, on ? `✓ ${c.name}` : c.name);
        }), newChip());
      }
      function newChip() {
        const b = h('button', { type: 'button', class: 'chip dashed' }, '+ New');
        b.addEventListener('click', () => {
          const input = h('input', { class: 'chip-input', type: 'text', maxlength: String(S.LIMITS.collectionName), placeholder: 'Collection name', 'aria-label': 'New collection name' });
          b.replaceWith(input); input.focus();
          const done = async (commit) => {
            if (commit && input.value.trim()) {
              try {
                const c = await store.createCollection(input.value);
                if (!collections.some((x) => x.id === c.id)) collections = [...collections, c];
                if (!state.collections.includes(c.id)) state.collections = [...state.collections, c.id];
                onChange();
              } catch (err) { setStatus(err.message, 'error'); }
            }
            render();
          };
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') { e.preventDefault(); done(false); } });
          input.addEventListener('blur', () => done(true), { once: true });
        });
        return b;
      }
      render();
      return h('div', {}, label, wrap);
    }

    function pinToggle(state, onChange) {
      const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(!!state.pinned) });
      const sync = () => { b.textContent = state.pinned ? '★ Pinned to top' : '☆ Pin to top'; b.setAttribute('aria-pressed', String(!!state.pinned)); };
      b.addEventListener('click', () => { state.pinned = !state.pinned; sync(); onChange && onChange(); });
      sync();
      return b;
    }

    function statusEl() { return container.querySelector('.status'); }
    function setStatus(message, kind) {
      const s = statusEl(); if (!s) return;
      s.textContent = message || '';
      s.className = `status${kind === 'error' ? ' status-error' : ''}`;
      s.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    }
    function nameOf(id) { return (collections.find((c) => c.id === id) || {}).name; }
    function saveLabel(ids) { return ids.length === 1 ? `Save to ${nameOf(ids[0])}` : ids.length > 1 ? `Save to ${ids.length} collections` : 'Save'; }

    // ---------- Save ----------

    function renderSave({ loadError, restored } = {}) {
      const draft = drafts.read(DRAFT_KEY);
      const last = drafts.raw(LAST_COLLECTION_KEY);
      const base = restored || (draft && draft.url === check.url ? draft : null);
      const state = {
        url: check.url,
        title: (base && base.title) || check.title,
        kind: (base && base.kind) || K.detectKind(check.url),
        note: (base && base.note) || '',
        collections: base ? (base.collections || []).filter((id) => collections.some((c) => c.id === id)) : (last && collections.some((c) => c.id === last) ? [last] : []),
        pinned: !!(base && base.pinned),
      };
      state.onInput = () => drafts.write(DRAFT_KEY, { url: state.url, title: state.title, kind: state.kind, note: state.note, collections: state.collections, pinned: state.pinned });

      const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, saveLabel(state.collections));
      const sync = () => { submit.textContent = saveLabel(state.collections); state.onInput(); };
      const note = noteField(state);
      note.ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); } });
      const form = h('form', { class: 'stack-form', novalidate: true },
        previewCard(state, { onKind: sync }),
        h('p', { class: 'mono muted hint' }, `Detected as ${U.kindLabel(state.kind)} from the address. Change it with the chip.`),
        note.el,
        collectionPicker(state, sync),
        h('div', { class: 'row' }, pinToggle(state, sync), h('span', { class: 'mono muted' }, 'Ctrl+Enter saves · Esc closes')),
        h('p', { class: 'status', role: 'status' }),
        submit);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (submit.disabled) return;
        submit.disabled = true; submit.textContent = 'Saving…'; setStatus('');
        try {
          const result = await store.save({ url: state.url, title: state.title, kind: state.kind, note: state.note, collections: state.collections, pinned: state.pinned });
          if (result.status === 'duplicate') { drafts.clear(DRAFT_KEY); return renderAlready(result.item, 'This page was already in your library, so nothing was copied.'); }
          drafts.clear(DRAFT_KEY);
          if (state.collections.length) drafts.setRaw(LAST_COLLECTION_KEY, state.collections[0]);
          total += 1;
          return renderSaved(result.item, state);
        } catch (err) {
          if (!(err instanceof S.ValidationError)) console.error('Stash: save failed', err);
          state.onInput(); // nothing typed is lost
          submit.disabled = false; submit.textContent = saveLabel(state.collections);
          setStatus(err.message || 'Something went wrong. Try again.', 'error');
        }
      });
      screen('save', form);
      if (loadError) setStatus(`${loadError} You can still try saving.`, 'error');
      if (restored) setStatus('Not saved. Everything you typed is still here.');
      submit.focus();
    }

    // ---------- Saved: the new sheet drops onto its collection's stack ----------

    async function renderSaved(item, state) {
      const cid = item.collections[0];
      let count = total, kinds = [item.kind];
      try {
        const all = await store.list();
        const inside = cid ? all.filter((i) => i.collections.includes(cid)) : all;
        count = inside.length; kinds = S.kindMix(inside).map(([k]) => k);
      } catch { /* the confirmation still makes sense without counts */ }
      const name = cid ? nameOf(cid) : 'Your library';
      const folder = U.folderTile({ name, count, kinds });
      const newSheet = h('div', { class: 'new-sheet drop', dataset: { kind: item.kind } },
        h('span', { class: 'caps on-kind' }, `New · ${U.kindLabel(item.kind)}`),
        h('span', { class: 'new-title' }, item.title));
      const art = h('div', { class: 'saved-art', 'aria-hidden': 'true' }, folder, newSheet);
      const undo = h('button', { type: 'button', class: 'btn' }, 'Undo');
      undo.addEventListener('click', async () => {
        undo.disabled = true;
        try { await store.remove(item.url); total -= 1; renderSave({ restored: { ...state, url: item.url } }); }
        catch (err) { undo.disabled = false; setStatus(err.message, 'error'); }
      });
      screen('saved', art,
        h('h1', { class: 'headline' }, cid ? `Filed in ${name}` : 'Saved to your library'),
        h('p', { class: 'mono muted' }, `${count} ${count === 1 ? 'save' : 'saves'}${cid ? ` in ${name}` : ''} · Esc closes this`),
        h('p', { class: 'status', role: 'status' }),
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => openLibrary(cid ? `#/collection/${cid}` : '') }, 'Open library'), undo));
      undo.focus();
    }

    // ---------- Already saved ----------

    function renderAlready(item, notice) {
      const state = { ...item };
      const badge = h('span', { class: 'saved-badge' }, `★ Saved on ${S.formatDate(item.savedAt)}`);
      const note = noteField(state);
      const save = h('button', { type: 'button', class: 'btn btn-primary' }, 'Save changes');
      save.addEventListener('click', async () => {
        save.disabled = true; setStatus('');
        try {
          await store.update(item.url, { title: state.title, note: state.note, kind: state.kind, collections: state.collections, pinned: state.pinned });
          setStatus('Changes saved.');
        } catch (err) { setStatus(err.message, 'error'); }
        save.disabled = false;
      });
      const del = h('button', { type: 'button', class: 'link-btn small' }, 'Delete from library');
      del.addEventListener('click', async () => {
        del.disabled = true;
        try { const removed = await store.remove(item.url); total -= 1; renderDeleted(removed || item); }
        catch (err) { del.disabled = false; setStatus(err.message, 'error'); }
      });
      const last = item.lastOpenedAt ? ` · last opened ${relativeDay(item.lastOpenedAt)}` : '';
      screen('already',
        previewCard(state, { badge }),
        h('div', { class: 'row' }, h('span', { class: 'mono muted' }, `${S.visitsText(item.visits)}${last}`), pinToggle(state)),
        note.el,
        collectionPicker(state, () => {}),
        h('p', { class: 'status', role: 'status' }),
        h('div', { class: 'actions' }, save, h('button', { type: 'button', class: 'btn', onclick: () => openLibrary(`#/search?q=${encodeURIComponent(item.title)}`) }, 'Open in library')),
        h('p', { class: 'center' }, del));
      if (notice) setStatus(notice);
      save.focus();
    }

    // ---------- Deleted: Undo never times out ----------

    function renderDeleted(item) {
      const undo = h('button', { type: 'button', class: 'btn btn-primary' }, 'Undo');
      undo.addEventListener('click', async () => {
        undo.disabled = true;
        try { await store.restore(item); total += 1; renderAlready(item, 'Restored, with its note.'); }
        catch (err) { undo.disabled = false; setStatus(err.message, 'error'); }
      });
      screen('deleted',
        h('h1', { class: 'headline' }, 'Deleted from your library'),
        h('p', {}, `“${item.title}” and its note are gone. Changed your mind?`),
        h('p', { class: 'status', role: 'status' }),
        h('div', { class: 'actions' }, undo, h('button', { type: 'button', class: 'btn', onclick: () => openLibrary() }, 'Open library')));
      undo.focus();
    }

    // ---------- Can't save: the popup becomes a finder ----------

    async function renderFinder(reason) {
      let items = [];
      try { items = await store.list(); } catch (err) { loadError = err.message; }
      const list = h('div', { class: 'finder-list' });
      const heading = h('p', { class: 'caps' });
      const input = h('input', { type: 'search', placeholder: 'Search your library', 'aria-label': 'Search your library' });
      function show() {
        const q = input.value.trim();
        let rows;
        if (q) { rows = S.search(items, q, { collections }).slice(0, 5); heading.textContent = rows.length ? 'Matches' : ''; }
        else {
          const pinned = items.filter((i) => i.pinned).sort((a, b) => b.visits - a.visits);
          rows = (pinned.length ? pinned : items).slice(0, 3);
          heading.textContent = pinned.length ? 'Pinned' : (rows.length ? 'Recent' : '');
        }
        list.replaceChildren(...(rows.length ? rows.map(row) : [h('p', { class: 'muted' }, q ? `Nothing in your library matches “${q}”.` : 'Your library is empty. Save a web page to start it.')]));
      }
      function row(item) {
        return h('button', { type: 'button', class: 'finder-row', onclick: async () => {
          try { await store.recordVisit(item.url); } catch { /* opening matters more than counting */ }
          await chrome.tabs.create({ url: item.url }); close();
        } }, U.kindTile(item.kind, 26), h('span', { class: 'finder-text' }, h('span', { class: 'finder-title' }, item.title), h('span', { class: 'muted small' }, S.hostOf(item.url))), h('span', { class: 'mono muted' }, U.kindLabel(item.kind)));
      }
      input.addEventListener('input', show);
      screen('finder',
        h('div', { class: 'notice' }, h('h1', { class: 'headline small' }, 'This page can’t be saved'), h('p', {}, reason)),
        h('p', { class: 'caps' }, 'Find something instead'),
        h('label', { class: 'search' }, U.icon('search'), input),
        heading, list,
        loadError ? h('p', { class: 'status status-error', role: 'alert' }, loadError) : null,
        h('button', { type: 'button', class: 'btn btn-block', onclick: () => openLibrary() }, 'Open library'));
      show();
      input.focus();
    }
  }

  function relativeDay(iso) {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
  }

  // localStorage wrapper; failures are ignored so a blocked storage never breaks saving.
  function safeStorage(storage) {
    return {
      read(key) { try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; } },
      write(key, value) { try { storage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } },
      clear(key) { try { storage.removeItem(key); } catch { /* ignore */ } },
      raw(key) { try { return storage.getItem(key); } catch { return null; } },
      setRaw(key, value) { try { storage.setItem(key, value); } catch { /* ignore */ } },
    };
  }

  root.StashPopup = { mount, DRAFT_KEY };

  if (root.document && document.body && document.body.dataset.page === 'popup') {
    let drafts;
    try { drafts = root.localStorage; } catch { drafts = null; }
    mount(document.getElementById('app'), { chrome: root.chrome, drafts, close: () => root.close() });
  }
})(globalThis);
