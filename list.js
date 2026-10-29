// The saved-links page: every saved link, newest first, with search, open and delete (with Undo).
(function (root) {
  'use strict';
  const { h, createStore, search, formatDate, hostOf, normalizeUrl } = root.LinkSaver;
  const UNDO_MS = 6000;

  // deps: { chrome }
  function mount(container, deps) {
    const { chrome } = deps;
    const area = chrome.storage && chrome.storage.local;
    const store = createStore(area);
    let items = [];
    let loaded = false;
    let loadError = null;
    let undoTimer = null;

    const count = h('p', { class: 'count muted', 'aria-live': 'polite' });
    const searchInput = h('input', {
      type: 'search', id: 'search', placeholder: 'Search titles, addresses, notes and #tags',
      autocomplete: 'off', 'aria-label': 'Search saved links', oninput: render,
    });
    const list = h('ul', { class: 'links', 'aria-label': 'Saved links' });
    const empty = h('div', { class: 'empty', hidden: true });
    const toast = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite', hidden: true });

    container.replaceChildren(
      h('header', { class: 'top' },
        h('div', { class: 'title-row' }, h('h1', {}, 'Saved links'), count),
        searchInput),
      list, empty, toast);

    // "/" jumps to search, like many sites.
    root.document.addEventListener('keydown', (e) => {
      if (e.key === '/' && root.document.activeElement !== searchInput
          && !/^(INPUT|TEXTAREA)$/.test((root.document.activeElement || {}).tagName)) {
        e.preventDefault();
        searchInput.focus();
      }
    });

    // Reflect saves and deletes made in the popup or another tab.
    const onChanged = (changes, areaName) => {
      if (areaName === 'local' && store.isLinkChange(changes)) load();
    };
    if (chrome.storage && chrome.storage.onChanged) chrome.storage.onChanged.addListener(onChanged);

    const ready = load();
    searchInput.focus();

    async function load() {
      try {
        items = await store.list();
        loadError = null;
      } catch (err) {
        console.error('Link Saver: could not load links', err);
        loadError = err.message;
      }
      loaded = true;
      render();
    }

    function render() {
      if (!loaded) return;
      const query = searchInput.value.trim();
      const shown = search(items, query);

      count.textContent = loadError ? '' : countText(items.length, shown.length, query);
      list.replaceChildren(...shown.map(renderItem));
      list.hidden = shown.length === 0;

      if (loadError) {
        showEmpty('Couldn\'t load your saved links', loadError,
          h('button', { type: 'button', class: 'primary', onclick: load }, 'Try again'));
      } else if (!items.length) {
        showEmpty('Nothing saved yet',
          'Open any web page and click the Link Saver button in the toolbar, or press Alt+Shift+S, to save it here.');
      } else if (!shown.length) {
        showEmpty('No matches', `No saved links match “${query}”. Check the spelling or try fewer words.`,
          h('button', { type: 'button', onclick: clearSearch }, 'Clear search'));
      } else {
        empty.hidden = true;
      }
    }

    function showEmpty(heading, message, action) {
      empty.replaceChildren(h('h2', {}, heading), h('p', {}, message), action || null);
      empty.hidden = false;
    }

    function clearSearch() {
      searchInput.value = '';
      render();
      searchInput.focus();
    }

    function filterByTag(tag) {
      searchInput.value = `#${tag}`;
      render();
    }

    function renderItem(item) {
      // Only link to web addresses, even though only those are ever stored.
      const href = normalizeUrl(item.url) ? item.url : null;
      const title = item.title || item.url;
      return h('li', { class: 'link', dataset: { url: item.url } },
        h('div', { class: 'link-main' },
          href
            ? h('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'link-title' }, title)
            : h('span', { class: 'link-title' }, title),
          h('p', { class: 'meta muted' }, `${hostOf(item.url)} · Saved ${formatDate(item.savedAt)}`),
          item.note ? h('p', { class: 'note' }, item.note) : null,
          item.tags && item.tags.length
            ? h('ul', { class: 'tags', 'aria-label': 'Tags' }, item.tags.map((tag) => h('li', {},
              h('button', { type: 'button', class: 'tag', title: `Show links tagged ${tag}`, onclick: () => filterByTag(tag) }, `#${tag}`))))
            : null),
        h('button', {
          type: 'button', class: 'danger-quiet delete', 'aria-label': `Delete “${title}”`,
          onclick: (e) => onDelete(item, e.currentTarget),
        }, 'Delete'));
    }

    async function onDelete(item, button) {
      button.disabled = true;
      try {
        const removed = await store.remove(item.url);
        items = items.filter((i) => i.url !== item.url);
        render();
        showToast(`Deleted “${item.title || item.url}”.`, removed ? () => onUndo(removed) : null);
      } catch (err) {
        console.error('Link Saver: delete failed', err);
        button.disabled = false;
        showToast(err.message, null, true);
      }
    }

    async function onUndo(item) {
      try {
        await store.restore(item);
        if (!items.some((i) => i.url === item.url)) items.push(item);
        items.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
        render();
        showToast('Link restored.');
      } catch (err) {
        console.error('Link Saver: undo failed', err);
        showToast(err.message, () => onUndo(item), true);
      }
    }

    function showToast(message, undo, isError) {
      clearTimeout(undoTimer);
      toast.className = `toast${isError ? ' toast-error' : ''}`;
      toast.setAttribute('role', isError ? 'alert' : 'status');
      toast.replaceChildren(h('span', {}, message),
        undo ? h('button', { type: 'button', class: 'link-button', onclick: undo }, isError ? 'Try again' : 'Undo') : null);
      toast.hidden = false;
      undoTimer = setTimeout(() => { toast.hidden = true; }, UNDO_MS);
    }

    return {
      ready,
      destroy() {
        clearTimeout(undoTimer);
        if (chrome.storage && chrome.storage.onChanged) chrome.storage.onChanged.removeListener(onChanged);
      },
    };
  }

  function countText(total, shown, query) {
    const noun = (n) => `${n} saved link${n === 1 ? '' : 's'}`;
    return query ? `${shown} of ${noun(total)}` : noun(total);
  }

  root.LinkSaverList = { mount };

  if (root.document && document.body && document.body.dataset.page === 'list') {
    mount(document.getElementById('app'), { chrome: root.chrome });
  }
})(globalThis);
