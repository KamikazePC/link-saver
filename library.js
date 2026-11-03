// The library tab: everything you've saved. Home, search and filters, collections (folders that open
// into a stack), and an empty state. Mounted with injected dependencies so tests can drive it.
(function (root) {
  'use strict';
  const S = root.Stash, K = root.StashKinds, U = root.StashUI;
  const { h } = U;
  const VIEW_KEY = 'stash:view';

  // deps: { chrome, useHash (true in the real page), prefs (localStorage-like) }
  function mount(container, deps) {
    const { chrome } = deps;
    const store = S.createStore(chrome.storage && chrome.storage.local);
    const prefs = deps.prefs || null;
    let items = [], collections = [], loaded = false, loadError = null;
    let route = parseRoute(deps.useHash ? root.location.hash : (deps.initialRoute || '#/'));
    let openSheet = null; // url of the save opened in a collection stack
    let showAllSites = false, showAllMonths = false;
    let view = readPref(VIEW_KEY) || 'grid';

    // ---------- Shell ----------
    const searchInput = h('input', { type: 'search', placeholder: 'Search your library: titles, sites, notes, quotes', 'aria-label': 'Search your library', autocomplete: 'off' });
    const viewSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'View' });
    const filtersBtn = h('button', { type: 'button', class: 'btn btn-small filters-btn', 'aria-expanded': 'false', 'aria-controls': 'sidebar' }, 'Filters');
    const sidebar = h('nav', { id: 'sidebar', class: 'sidebar', 'aria-label': 'Filters' });
    const main = h('main', { class: 'main', id: 'main', tabindex: '-1' });
    const live = h('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    container.replaceChildren(
      h('header', { class: 'topbar' },
        h('a', { class: 'brand', href: '#/' }, U.icon('logo'), h('span', {}, 'Stash')),
        h('label', { class: 'search' }, U.icon('search'), searchInput, h('span', { class: 'kbd', 'aria-hidden': 'true' }, '/')),
        filtersBtn, viewSeg),
      h('div', { class: 'body' }, sidebar, main), live);
    const toaster = U.createToaster(container);
    const announce = (msg) => { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 30); };

    // Internal links (#/…) route without reloading; real links open in a new tab and count a visit.
    container.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]'); if (!a) return;
      const href = a.getAttribute('href');
      if (href.startsWith('#/')) { e.preventDefault(); navigate(href); closeSidebar(); return; }
      if (a.dataset.save) countVisit(a.dataset.save);
    });
    container.addEventListener('auxclick', (e) => { const a = e.target.closest('a[data-save]'); if (a && e.button === 1) countVisit(a.dataset.save); });

    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim();
      // Kind, site and month filters stay while you search; anywhere else searches everything.
      const base = ['kind', 'site', 'month'].includes(route.type) ? { ...route } : { type: q ? 'search' : 'home' };
      navigate(buildRoute({ ...base, q }), { replace: true, keepFocus: true });
    });
    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape' && searchInput.value) { e.preventDefault(); searchInput.value = ''; searchInput.dispatchEvent(new Event('input')); } });
    root.document.addEventListener('keydown', onGlobalKey);
    function onGlobalKey(e) {
      const tag = (root.document.activeElement || {}).tagName;
      if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test(tag) && !e.defaultPrevented) { e.preventDefault(); searchInput.focus(); }
      if (e.key === 'Escape' && sidebar.classList.contains('open')) closeSidebar();
    }
    filtersBtn.addEventListener('click', () => { const open = !sidebar.classList.contains('open'); sidebar.classList.toggle('open', open); filtersBtn.setAttribute('aria-expanded', String(open)); if (open) (sidebar.querySelector('a,button') || sidebar).focus(); });
    function closeSidebar() { if (!sidebar.classList.contains('open')) return; sidebar.classList.remove('open'); filtersBtn.setAttribute('aria-expanded', 'false'); }

    for (const v of ['grid', 'list']) {
      viewSeg.append(h('button', { type: 'button', 'aria-pressed': String(view === v), dataset: { view: v }, onclick: () => { view = v; writePref(VIEW_KEY, v); for (const b of viewSeg.children) b.setAttribute('aria-pressed', String(b.dataset.view === v)); renderMain(); } }, v === 'grid' ? 'Grid' : 'List'));
    }

    const onHash = () => { route = parseRoute(root.location.hash); renderAll(); };
    if (deps.useHash) root.addEventListener('hashchange', onHash);
    const onChanged = (changes, area) => { if (area === 'local' && store.isLibraryChange(changes)) load(); };
    if (chrome.storage && chrome.storage.onChanged) chrome.storage.onChanged.addListener(onChanged);

    function navigate(hash, { replace = false, keepFocus = false } = {}) {
      if (deps.useHash) {
        if (replace) root.history.replaceState(null, '', hash); else root.location.hash = hash;
      }
      route = parseRoute(hash);
      if (route.type !== 'collection') openSheet = null;
      renderAll();
      if (!keepFocus) main.focus();
    }

    async function load() {
      try {
        [items, collections] = await Promise.all([store.list(), store.listCollections()]);
        loadError = null;
      } catch (err) { console.error('Stash: could not load the library', err); loadError = err.message; }
      loaded = true;
      renderAll();
    }
    const ready = load();

    function renderAll() {
      if (!loaded) return;
      if (route.q != null && searchInput.value.trim() !== route.q && root.document.activeElement !== searchInput) searchInput.value = route.q;
      if (!route.q && route.type !== 'search' && root.document.activeElement !== searchInput) searchInput.value = '';
      renderSidebar(); renderMain();
    }

    // ---------- Sidebar ----------
    function renderSidebar() {
      const sum = S.summarize(items);
      const empty = !items.length;
      const isCur = (r) => (route.type === r.type && (route.value || '') === (r.value || '') ? 'page' : null);
      const row = (href, label, count, lead, current) => h('a', { class: 'side-row', href, 'aria-current': current }, lead || h('span', { class: 'lead-space' }), h('span', { class: 'side-label' }, label), h('span', { class: 'mono count' }, String(count)));
      const section = (title, ...rows) => h('section', { class: 'side-section' }, h('h2', { class: 'caps' }, title), ...rows);
      const kinds = [row('#/', 'Everything', sum.total, null, route.type === 'home' || (route.type === 'search' && !route.value) ? 'page' : null)];
      for (const k of K.KINDS) kinds.push(row(`#/kind/${k.id}`, k.label, sum.kinds[k.id], h('span', { class: 'swatch', dataset: { kind: k.id } }), isCur({ type: 'kind', value: k.id })));
      const parts = [section('Kinds', ...kinds)];
      if (empty) { sidebar.replaceChildren(...parts); for (const r of sidebar.querySelectorAll('.side-row:not([aria-current])')) r.classList.add('dim'); return; }

      const newBtn = h('button', { type: 'button', class: 'side-row side-new' }, h('span', { class: 'lead-space' }), h('span', { class: 'side-label' }, '+ New collection'));
      newBtn.addEventListener('click', () => {
        const input = h('input', { class: 'side-input', type: 'text', maxlength: String(S.LIMITS.collectionName), 'aria-label': 'New collection name', placeholder: 'Collection name' });
        newBtn.replaceWith(input); input.focus();
        input.addEventListener('keydown', async (e) => {
          if (e.key === 'Escape') { e.preventDefault(); renderSidebar(); }
          if (e.key === 'Enter') { e.preventDefault(); try { const c = await store.createCollection(input.value); collections = await store.listCollections(); navigate(`#/collection/${c.id}`); } catch (err) { toaster.show(err.message); } }
        });
      });
      parts.push(section('Collections', ...collections.map((c) => row(`#/collection/${c.id}`, c.name, sum.collections.get(c.id) || 0, U.icon('folder'), isCur({ type: 'collection', value: c.id }))), newBtn));
      const sites = showAllSites ? sum.hosts : sum.hosts.slice(0, 4);
      const siteRows = sites.map(([host, n]) => row(`#/site/${encodeURIComponent(host)}`, host, n, h('span', { class: 'favicon', 'aria-hidden': 'true' }), isCur({ type: 'site', value: host })));
      if (sum.hosts.length > 4) siteRows.push(showAllToggle(showAllSites, `Show all ${sum.hosts.length} sites`, 'Show fewer sites', () => { showAllSites = !showAllSites; renderSidebar(); }));
      parts.push(section('Sites', ...siteRows));
      const months = showAllMonths ? sum.months : sum.months.slice(0, 4);
      const monthRows = months.map(([m, n]) => row(`#/month/${m}`, S.formatMonth(m), n, null, isCur({ type: 'month', value: m })));
      if (sum.months.length > 4) monthRows.push(showAllToggle(showAllMonths, 'Show all months', 'Show fewer months', () => { showAllMonths = !showAllMonths; renderSidebar(); }));
      parts.push(section('Saved', ...monthRows));
      sidebar.replaceChildren(...parts);
    }
    const showAllToggle = (on, more, less, fn) => h('button', { type: 'button', class: 'link-btn show-all', 'aria-expanded': String(on), onclick: fn }, on ? less : more);

    // ---------- Main ----------
    function renderMain() {
      if (loadError) return main.replaceChildren(h('div', { class: 'empty' }, h('h1', { class: 'display' }, 'Couldn’t load your library'), h('p', {}, loadError), h('button', { type: 'button', class: 'btn btn-primary', onclick: load }, 'Try again')));
      if (!items.length) return renderEmpty();
      if (route.type === 'collection') return renderCollection(route.value);
      if (route.type === 'home' && !route.q) return renderHome();
      return renderResults();
    }

    function renderHome() {
      const week = items.filter((i) => Date.now() - new Date(i.savedAt).getTime() < 7 * 86400000).length;
      const pinned = items.filter((i) => i.pinned).sort((a, b) => b.visits - a.visits || String(b.savedAt).localeCompare(String(a.savedAt)));
      const parts = [h('div', { class: 'page-head' }, h('h1', { class: 'display' }, 'Your library'), h('p', { class: 'mono muted' }, `${items.length} ${items.length === 1 ? 'save' : 'saves'} · ${week} this week`))];
      if (pinned.length) parts.push(sectionHead('★ Pinned', 'most opened first'), itemsBlock(pinned, 'grid'));
      parts.push(sectionHead('Collections', String(collections.length), newCollectionLink()));
      if (collections.length) parts.push(h('div', { class: 'folders' }, collections.map(folderFor)));
      else parts.push(h('p', { class: 'muted' }, 'Group saves into collections. Each one becomes a folder here.'));
      parts.push(sectionHead('Recently saved', 'newest first'), itemsBlock(items, view));
      parts.push(h('p', { class: 'muted small foot' }, 'Hover or tab to a card for quick actions, or use ⋯ on any card. Deleting shows an Undo message that stays until you close it.'));
      main.replaceChildren(...parts);
    }

    function newCollectionLink() {
      const b = h('button', { type: 'button', class: 'link-btn' }, '+ New collection');
      b.addEventListener('click', () => { filtersBtn.click(); const n = sidebar.querySelector('.side-new'); if (n) n.click(); });
      return b;
    }

    function folderFor(c) {
      const inside = items.filter((i) => i.collections.includes(c.id));
      return U.folderTile({ name: c.name, count: inside.length, kinds: S.kindMix(inside).map(([k]) => k), href: `#/collection/${c.id}` });
    }

    function renderResults() {
      const filters = routeFilters(route);
      const filtered = S.filterItems(items, filters);
      const q = route.q || '';
      const results = q ? S.searchWithMatches(filtered, q, { collections }) : filtered.map((item) => ({ item, matchedIn: [], terms: [] }));
      const title = route.type === 'kind' ? U.kindLabel(route.value)
        : route.type === 'site' ? route.value
          : route.type === 'month' ? S.formatMonth(route.value)
            : 'Search';
      const head = q ? `${results.length} ${results.length === 1 ? 'result' : 'results'} for “${q}”` : title;
      const chips = h('div', { class: 'chips' });
      if (route.type !== 'home' && route.type !== 'search') chips.append(h('a', { class: 'chip', href: buildRoute({ type: q ? 'search' : 'home', q }), dataset: route.type === 'kind' ? { kind: route.value } : {}, 'aria-label': `Remove filter: ${title}` }, `${filterLabel(route)}  ×`));
      const parts = [chips.children.length ? chips : null, h('div', { class: 'page-head' }, h('h1', { class: q ? 'title-24' : 'display' }, head))];
      if (!results.length) {
        parts.push(h('div', { class: 'empty small' }, h('p', {}, q ? `No saves match “${q}”${route.type !== 'search' ? ' with this filter' : ''}.` : 'Nothing here yet.'), q ? h('button', { type: 'button', class: 'btn', onclick: () => { searchInput.value = ''; searchInput.dispatchEvent(new Event('input')); } }, 'Clear search') : null));
      } else if (q) {
        parts.push(h('div', { class: 'results' }, results.map((r) => resultRow(r))));
      } else parts.push(itemsBlock(results.map((r) => r.item), view));
      if (q && route.type !== 'search') {
        const outside = S.searchWithMatches(items, q, { collections }).length - results.length;
        if (outside > 0) parts.push(h('div', { class: 'outside' }, h('span', {}, `${outside} more ${outside === 1 ? 'matches' : 'match'} outside this filter.`), h('a', { class: 'btn btn-small', href: buildRoute({ type: 'search', q }) }, `Show all ${outside + results.length}`)));
      }
      if (q) parts.push(h('p', { class: 'muted small' }, 'Search reads titles, sites, your notes, kinds and collection names. Try what you remember: a site, a word from your note, or a kind like “watch”.'));
      main.replaceChildren(...parts.filter(Boolean));
    }

    // ---------- Collection: a folder that opens into a stack ----------
    function renderCollection(id) {
      const c = collections.find((x) => x.id === id);
      if (!c) return main.replaceChildren(h('div', { class: 'empty' }, h('h1', { class: 'display' }, 'This collection doesn’t exist any more'), h('a', { class: 'btn', href: '#/' }, 'Back to your library')));
      const inside = items.filter((i) => i.collections.includes(id));
      const nameEl = h('h1', { class: 'folder-title' }, c.name);
      const rename = h('button', { type: 'button', class: 'link-btn' }, 'Rename');
      rename.addEventListener('click', () => {
        const input = h('input', { class: 'rename-input', type: 'text', value: c.name, maxlength: String(S.LIMITS.collectionName), 'aria-label': 'Collection name' });
        nameEl.replaceWith(input); input.focus(); input.select();
        input.addEventListener('keydown', async (e) => {
          if (e.key === 'Escape') { e.preventDefault(); renderMain(); }
          if (e.key === 'Enter') { e.preventDefault(); try { await store.renameCollection(id, input.value); collections = await store.listCollections(); renderAll(); announce('Collection renamed.'); } catch (err) { toaster.show(err.message); } }
        });
      });
      const del = h('button', { type: 'button', class: 'link-btn' }, 'Delete collection');
      del.addEventListener('click', async () => {
        try {
          const snap = await store.deleteCollection(id);
          collections = await store.listCollections(); items = await store.list();
          navigate('#/');
          toaster.show(`Deleted collection “${c.name}”. Its saves are still in your library.`, { actionLabel: 'Undo', onAction: async () => { await store.restoreCollection(snap); await load(); navigate(`#/collection/${id}`); } });
        } catch (err) { toaster.show(err.message); }
      });
      const mix = S.kindMix(inside);
      const stack = h('ol', { class: 'sheet-stack', 'aria-label': `Saves in ${c.name}` }, inside.map((item, i) => sheet(item, i, inside)));
      stack.addEventListener('keydown', (e) => {
        const heads = [...stack.querySelectorAll('.sheet-head')]; const i = heads.indexOf(root.document.activeElement);
        if (e.key === 'ArrowDown' && i >= 0) { e.preventDefault(); (heads[i + 1] || heads[i]).focus(); }
        if (e.key === 'ArrowUp' && i >= 0) { e.preventDefault(); (heads[i - 1] || heads[i]).focus(); }
        if (e.key === 'Escape' && openSheet) { e.preventDefault(); const url = openSheet; toggleSheet(url, stack); const head = stack.querySelector(`.sheet-head[data-url="${CSS.escape(url)}"]`); if (head) head.focus(); }
      });
      main.replaceChildren(
        h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Library'), h('span', { 'aria-hidden': 'true' }, '/'), h('span', { 'aria-current': 'page' }, c.name)),
        h('div', { class: 'open-folder' },
          h('div', { class: 'folder-tab' }, U.icon('folder'), nameEl, h('span', { class: 'mono muted' }, `${inside.length} ${inside.length === 1 ? 'save' : 'saves'}`)),
          h('div', { class: 'pocket' },
            h('div', { class: 'pocket-bar' }, h('span', { class: 'caps' }, 'Inside'), mix.map(([k, n]) => U.kindChip(k, { text: `${U.kindLabel(k)} · ${n}` })), h('span', { class: 'grow' }), rename, del),
            h('p', { class: 'muted small' }, 'Saves stay in your library if you delete a collection; only the folder goes.'),
            inside.length ? stack : h('p', { class: 'empty small' }, 'This folder is empty. Use ⋯ → Add to collection on any save, or pick this collection when you save a page.'),
            inside.length ? h('p', { class: 'muted small' }, 'Click or press Enter on a save to open it in place. Arrow keys move between saves; Esc tucks it back.') : null)));
    }

    function sheet(item, i, list) {
      const isOpen = openSheet === item.url;
      const bodyId = `sheet-${i}`;
      const head = h('button', { type: 'button', class: 'sheet-head', 'aria-expanded': String(isOpen), 'aria-controls': bodyId, dataset: { url: item.url } },
        U.kindChip(item.kind, { class: 'chip on-white' }), h('span', { class: 'sheet-title' }, item.title), h('span', { class: 'sheet-site' }, S.hostOf(item.url)), h('span', { class: 'mono' }, S.formatDate(item.savedAt)));
      head.addEventListener('click', () => toggleSheet(item.url, head.closest('.sheet-stack')));
      const preview = h('div', { class: 'sheet-preview' }); preview.append(U.svg(K.kindIcon(item.kind, 44)));
      const body = h('div', { class: 'sheet-body', id: bodyId, hidden: !isOpen },
        h('div', { class: 'sheet-details' },
          item.note ? h('p', { class: 'sheet-note' }, `“${item.note}”`) : h('p', { class: 'sheet-note muted-on-kind' }, 'No note yet. Use Edit to add one.'),
          h('p', { class: 'mono' }, `${S.visitsText(item.visits)}${item.lastOpenedAt ? ` · last opened ${S.formatDate(item.lastOpenedAt)}` : ''}`),
          h('div', { class: 'sheet-actions' },
            h('a', { class: 'btn btn-primary btn-small', href: item.url, target: '_blank', rel: 'noopener noreferrer', dataset: { save: item.url } }, 'Open ↗'),
            h('button', { type: 'button', class: 'btn btn-small', onclick: () => togglePin(item) }, item.pinned ? 'Unpin' : 'Pin'),
            h('button', { type: 'button', class: 'btn btn-small', onclick: () => editDialog(item) }, 'Edit'),
            h('button', { type: 'button', class: 'btn btn-small', onclick: () => toggleSheet(item.url, head.closest('.sheet-stack')) }, 'Close'))),
        preview);
      return h('li', { class: `sheet${isOpen ? ' is-open' : ''}`, dataset: { kind: item.kind } }, head, body);
    }

    // Opens a save in place; the saves below slide to make room. Only one is open at a time.
    function toggleSheet(url, stack) {
      const next = openSheet === url ? null : url;
      const sheets = () => [...stack.children];
      U.flip(sheets, () => {
        openSheet = next;
        for (const li of stack.children) {
          const head = li.querySelector('.sheet-head'), body = li.querySelector('.sheet-body');
          const on = head.dataset.url === next;
          li.classList.toggle('is-open', on); head.setAttribute('aria-expanded', String(on)); body.hidden = !on;
          if (on) body.classList.add('reveal'); else body.classList.remove('reveal');
        }
      }, { duration: next ? 220 : 160, easing: next ? 'var(--ease-out)' : 'var(--ease-in-out)' });
    }

    // ---------- Cards, rows and actions ----------
    function sectionHead(title, aside, extra) { return h('div', { class: 'section-head' }, h('h2', { class: 'title-22' }, title), aside ? h('span', { class: 'mono muted' }, aside) : null, extra || null); }

    function itemsBlock(list, mode) {
      if (mode === 'list') return h('div', { class: 'results' }, list.map((item) => resultRow({ item, matchedIn: [], terms: [] })));
      return h('div', { class: 'grid' }, list.map(card));
    }

    function card(item) {
      const preview = h('div', { class: 'card-preview', dataset: { kind: item.kind } }); preview.append(U.svg(K.kindIcon(item.kind, 44)));
      const more = h('button', { type: 'button', class: 'icon-btn round more', 'aria-label': `More actions for “${item.title}”`, 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => actionsMenu(more, item) }, U.icon('more'));
      const meta = item.visits ? S.visitsText(item.visits) : `Saved ${S.formatDate(item.savedAt)}`;
      const bar = h('div', { class: 'card-actions' },
        h('a', { class: 'pill-action primary', href: item.url, target: '_blank', rel: 'noopener noreferrer', dataset: { save: item.url }, tabindex: '-1' }, 'Open ↗'),
        h('button', { type: 'button', class: 'pill-action', tabindex: '-1', onclick: () => togglePin(item) }, item.pinned ? 'Unpin' : 'Pin'),
        h('button', { type: 'button', class: 'pill-action', tabindex: '-1', onclick: () => editDialog(item) }, 'Edit'),
        h('span', { class: 'divider', 'aria-hidden': 'true' }),
        h('button', { type: 'button', class: 'pill-action', tabindex: '-1', onclick: () => deleteItem(item) }, 'Delete'));
      return h('article', { class: 'card', dataset: { url: item.url } },
        preview, bar,
        h('div', { class: 'card-body' },
          h('div', { class: 'card-top' }, U.kindChip(item.kind), more),
          h('a', { class: 'card-title', href: item.url, target: '_blank', rel: 'noopener noreferrer', title: item.title, dataset: { save: item.url } }, item.title),
          h('div', { class: 'site' }, h('span', { class: 'favicon', 'aria-hidden': 'true' }), S.hostOf(item.url)),
          h('p', { class: 'mono muted' }, meta),
          item.note ? h('p', { class: 'card-note', title: item.note }, item.note) : null));
    }

    function resultRow({ item, matchedIn, terms }) {
      const more = h('button', { type: 'button', class: 'icon-btn round more', 'aria-label': `More actions for “${item.title}”`, 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => actionsMenu(more, item) }, U.icon('more'));
      return h('div', { class: 'row-item', dataset: { url: item.url } },
        U.kindTile(item.kind, 56),
        h('div', { class: 'row-text' },
          h('a', { class: 'row-title', href: item.url, target: '_blank', rel: 'noopener noreferrer', dataset: { save: item.url } }, marked(item.title, terms)),
          h('p', { class: 'row-meta' }, `${S.hostOf(item.url)} · saved ${S.formatDate(item.savedAt)} · ${S.visitsText(item.visits).toLowerCase()}`),
          matchedIn.length ? h('p', { class: 'mono muted' }, describeWithNote(matchedIn, item)) : null),
        U.kindChip(item.kind), more);
    }
    function describeWithNote(matchedIn, item) {
      const d = S.describeMatch(matchedIn);
      return matchedIn.includes('note') && item.note ? `${d}: “${item.note.slice(0, 60)}${item.note.length > 60 ? '…' : ''}”` : d;
    }

    // Matching words are underlined and heavier, never highlighted with colour.
    function marked(text, terms) {
      if (!terms || !terms.length) return text;
      const lower = text.toLowerCase(); const out = []; let i = 0;
      while (i < text.length) {
        let best = null;
        for (const t of terms) { const j = lower.indexOf(t, i); if (j >= 0 && (!best || j < best.j)) best = { j, t }; }
        if (!best) { out.push(text.slice(i)); break; }
        if (best.j > i) out.push(text.slice(i, best.j));
        out.push(h('span', { class: 'match' }, text.slice(best.j, best.j + best.t.length)));
        i = best.j + best.t.length;
      }
      return out;
    }

    function actionsMenu(anchor, item) {
      U.openMenu(anchor, [
        { label: 'Open in a new tab', onSelect: () => { countVisit(item.url); root.open ? root.open(item.url, '_blank', 'noopener') : chrome.tabs.create({ url: item.url }); } },
        { label: item.pinned ? 'Unpin' : 'Pin to top', onSelect: () => togglePin(item) },
        { label: 'Edit…', onSelect: () => editDialog(item) },
        { label: 'Add to collection…', onSelect: () => collectionMenu(anchor, item) },
        '-',
        { label: 'Delete', onSelect: () => deleteItem(item) },
      ], { label: 'Actions' });
    }

    function collectionMenu(anchor, item) {
      U.openMenu(anchor, [
        ...collections.map((c) => ({ label: c.name, lead: U.icon('folder'), checked: item.collections.includes(c.id), onSelect: async () => {
          const on = item.collections.includes(c.id);
          try { await store.update(item.url, { collections: on ? item.collections.filter((x) => x !== c.id) : [...item.collections, c.id] }); announce(on ? `Removed from ${c.name}.` : `Added to ${c.name}.`); toaster.show(on ? `Removed from ${c.name}` : `Added to ${c.name}`); await load(); }
          catch (err) { toaster.show(err.message); }
        } })),
        { label: 'New collection…', onSelect: () => { const name = root.prompt ? root.prompt('Name the new collection') : null; if (name) store.createCollection(name).then((c) => store.update(item.url, { collections: [...item.collections, c.id] })).then(load).catch((err) => toaster.show(err.message)); } },
      ], { label: 'Add to collection' });
    }

    async function togglePin(item) {
      try {
        const cards = () => [...main.querySelectorAll('.card, .row-item, .sheet')];
        await store.update(item.url, { pinned: !item.pinned });
        const fresh = await store.list();
        U.flip(cards, () => { items = fresh; renderMain(); }, { duration: 280 });
        announce(item.pinned ? 'Unpinned.' : 'Pinned to the top.');
      } catch (err) { toaster.show(err.message); }
    }

    async function deleteItem(item) {
      const el = main.querySelector(`[data-url="${CSS.escape(item.url)}"]`);
      try {
        const removed = await store.remove(item.url);
        const finish = () => U.flip(() => [...main.querySelectorAll('.card, .row-item')], () => { items = items.filter((i) => i.url !== item.url); renderAll(); }, { duration: 200 });
        if (el && !U.reducedMotion() && el.animate) {
          const a = el.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.97)' }], { duration: 160, easing: 'ease-out', fill: 'forwards' });
          a.onfinish = finish;
        } else finish();
        toaster.show(`Deleted “${item.title}”`, { actionLabel: 'Undo', onAction: async () => { try { await store.restore(removed || item); await load(); announce('Restored.'); } catch (err) { toaster.show(err.message); } } });
      } catch (err) { toaster.show(err.message); }
    }

    function countVisit(url) { store.recordVisit(url).catch((err) => console.warn('Stash: could not count the visit', err)); }

    // ---------- Edit dialog ----------
    function editDialog(item) {
      const state = { ...item };
      const title = h('input', { class: 'field', type: 'text', value: item.title, maxlength: String(S.LIMITS.title), id: 'edit-title' });
      const note = h('textarea', { class: 'field', id: 'edit-note', rows: '3', maxlength: String(S.LIMITS.note), placeholder: 'For the rebrand moodboard' }); note.value = item.note;
      const kinds = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Kind' }, K.KINDS.map((k) => h('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(k.id === state.kind), dataset: { kind: k.id }, onclick: (e) => { state.kind = k.id; for (const b of kinds.children) b.setAttribute('aria-checked', String(b.dataset.kind === k.id)); e.currentTarget.focus(); } }, k.label)));
      const cols = h('div', { class: 'chips', role: 'group', 'aria-label': 'Collections' }, collections.map((c) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(state.collections.includes(c.id)), onclick: (e) => { const on = state.collections.includes(c.id); state.collections = on ? state.collections.filter((x) => x !== c.id) : [...state.collections, c.id]; e.currentTarget.setAttribute('aria-pressed', String(!on)); e.currentTarget.textContent = !on ? `✓ ${c.name}` : c.name; } }, state.collections.includes(c.id) ? `✓ ${c.name}` : c.name)));
      const status = h('p', { class: 'status', role: 'status' });
      const dialog = h('dialog', { class: 'dialog', 'aria-labelledby': 'edit-heading' });
      const form = h('form', { method: 'dialog', class: 'dialog-form' },
        h('h2', { class: 'title-22', id: 'edit-heading' }, 'Edit save'),
        h('div', {}, h('label', { class: 'caps field-label', for: 'edit-title' }, 'Title'), title),
        h('div', {}, h('p', { class: 'caps field-label' }, 'Kind'), kinds),
        h('div', {}, h('label', { class: 'caps field-label', for: 'edit-note' }, 'Note · optional'), note),
        collections.length ? h('div', {}, h('p', { class: 'caps field-label' }, 'Collections'), cols) : null,
        status,
        h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, 'Cancel'), h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save changes')));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await store.update(item.url, { title: title.value, note: note.value, kind: state.kind, collections: state.collections }); dialog.close(); await load(); announce('Changes saved.'); }
        catch (err) { status.textContent = err.message; status.className = 'status status-error'; status.setAttribute('role', 'alert'); }
      });
      dialog.append(form); container.append(dialog);
      dialog.addEventListener('close', () => dialog.remove());
      if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
      title.focus();
    }

    // ---------- Empty ----------
    function renderEmpty() {
      const art = h('div', { class: 'empty-art', 'aria-hidden': 'true' }, h('span', { class: 'slot' }, '+  Your first save goes here'), h('span', { class: 'layer l1' }), h('span', { class: 'layer l2' }));
      main.replaceChildren(h('div', { class: 'empty' },
        art,
        h('h1', { class: 'display' }, 'Your library starts here.'),
        h('p', { class: 'lede' }, 'Save anything worth keeping and it lands here with the kind of thing it is and where you found it.'),
        h('ol', { class: 'ways' },
          h('li', { class: 'stagger' }, h('span', { class: 'num' }, '1'), h('strong', {}, 'Click Stash on any page'), h('span', { class: 'muted' }, 'The toolbar button saves the page you’re on.')),
          h('li', { class: 'stagger' }, h('span', { class: 'num' }, '2'), h('strong', {}, 'Press Alt+Shift+S'), h('span', { class: 'muted' }, 'Opens the save popup from any page.')),
          h('li', { class: 'stagger' }, h('span', { class: 'num' }, '3'), h('strong', {}, 'Press Alt+Shift+K'), h('span', { class: 'muted' }, 'Saves straight away, no popup.'))),
        h('p', { class: 'caps' }, 'Everything gets a colour for what it is'),
        h('div', { class: 'chips center' }, K.KINDS.map((k) => U.kindChip(k.id)))));
    }

    function readPref(k) { try { return prefs && prefs.getItem(k); } catch { return null; } }
    function writePref(k, v) { try { if (prefs) prefs.setItem(k, v); } catch { /* ignore */ } }

    return {
      ready, navigate, get route() { return route; },
      destroy() {
        root.document.removeEventListener('keydown', onGlobalKey);
        if (deps.useHash) root.removeEventListener('hashchange', onHash);
        if (chrome.storage && chrome.storage.onChanged) chrome.storage.onChanged.removeListener(onChanged);
        U.closeOpenMenu();
      },
    };
  }

  // ---------- Routes: #/ , #/search?q= , #/kind/look , #/site/are.na , #/month/2026-09 , #/collection/<id> ----------
  function parseRoute(hash) {
    const raw = String(hash || '').replace(/^#/, '') || '/';
    const [path, query = ''] = raw.split('?');
    const q = new URLSearchParams(query).get('q') || '';
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    if (!parts.length) return { type: q ? 'search' : 'home', q };
    if (['kind', 'site', 'month', 'collection'].includes(parts[0]) && parts[1]) return { type: parts[0], value: parts[1], q };
    if (parts[0] === 'search') return { type: 'search', q };
    return { type: 'home', q };
  }
  function buildRoute({ type, value, q }) {
    const qs = q ? `?q=${encodeURIComponent(q)}` : '';
    if (type === 'home') return `#/${qs}`;
    if (type === 'search') return `#/search${qs}`;
    return `#/${type}/${encodeURIComponent(value)}${qs}`;
  }
  function routeFilters(r) {
    if (r.type === 'kind') return { kind: r.value };
    if (r.type === 'site') return { host: r.value };
    if (r.type === 'month') return { month: r.value };
    return {};
  }
  function filterLabel(r) {
    if (r.type === 'kind') return `Kind: ${K.kindById(r.value).label}`;
    if (r.type === 'site') return `Site: ${r.value}`;
    if (r.type === 'month') return `Saved: ${S.formatMonth(r.value)}`;
    return '';
  }

  root.StashLibrary = { mount, parseRoute, buildRoute };

  if (root.document && document.body && document.body.dataset.page === 'library') {
    let prefs; try { prefs = root.localStorage; } catch { prefs = null; }
    mount(document.getElementById('app'), { chrome: root.chrome, useHash: true, prefs });
  }
})(globalThis);
