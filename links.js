// Core logic shared by the popup, the library, the background worker and the tests.
// Plain script (no modules) so it loads the same way everywhere. Needs kinds.js first.
// Everything is exposed on globalThis.Stash.
(function (root) {
  'use strict';
  const { detectKind, KIND_IDS, kindById } = root.StashKinds;

  const KEY_PREFIX = 'link:';
  const COLLECTIONS_KEY = 'collections';
  const SCHEMA_KEY = 'schema';
  const SCHEMA = 2;
  const LIMITS = Object.freeze({ title: 500, note: 2000, collectionName: 40, collections: 100 });

  // ---------- Errors ----------

  // Something the user typed or chose can't be saved as-is. The message is shown to them.
  class ValidationError extends Error {
    constructor(message, code) {
      super(message);
      this.name = 'ValidationError';
      this.code = code;
    }
  }

  // Browser storage failed. The message is shown to them; the original error is kept on `cause`.
  class StorageError extends Error {
    constructor(action, cause) {
      const raw = String((cause && cause.message) || cause || '');
      const isQuota = /quota/i.test(raw);
      super(isQuota
        ? 'Storage is full. Delete some saves, then save again.'
        : `Couldn’t ${action} because browser storage didn’t respond. Try again in a moment.`);
      this.name = 'StorageError';
      this.code = isQuota ? 'quota' : 'storage';
      this.cause = cause;
    }
  }

  // ---------- URLs ----------

  const INTERNAL_SCHEMES = new Set([
    'about:', 'chrome:', 'chrome-extension:', 'chrome-search:', 'chrome-untrusted:', 'devtools:',
    'edge:', 'brave:', 'opera:', 'vivaldi:', 'view-source:', 'extension:', 'moz-extension:',
  ]);

  // Canonical form of a web URL used to spot duplicates, or null if it isn't http(s).
  // Drops the #fragment (same page, different heading) but keeps "#/…" and "#!…" app routes.
  function normalizeUrl(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    let url;
    try {
      url = new URL(raw.trim());
    } catch {
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.hash && !/^#[!/]/.test(url.hash)) url.hash = '';
    return url.href;
  }

  // Whether a tab (as returned by chrome.tabs) can be saved: { ok, url, title } or { ok:false, reason }.
  function checkSavable(tab) {
    if (!tab) return { ok: false, reason: 'No active tab was found. Click on a web page and try again.' };
    if (!tab.url) {
      return { ok: false, reason: 'Chrome keeps its own pages, like Settings, New Tab and the Web Store, off limits to extensions.' };
    }
    let protocol = '';
    try {
      protocol = new URL(tab.url).protocol;
    } catch {
      return { ok: false, reason: 'This page’s address isn’t a valid web address, so it can’t be saved.' };
    }
    if (INTERNAL_SCHEMES.has(protocol)) {
      return { ok: false, reason: 'This is a browser page, not a website. Chrome keeps pages like Settings and New Tab off limits to extensions.' };
    }
    if (protocol === 'file:') return { ok: false, reason: 'Files on your computer can’t be saved. Only web pages (http and https) can.' };
    const url = normalizeUrl(tab.url);
    if (!url) return { ok: false, reason: 'Only web pages (http and https) can be saved.' };
    return { ok: true, url, title: cleanText(tab.title) || url };
  }

  // ---------- Input cleanup ----------

  function cleanText(value) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  }

  function cleanNote(note) {
    const n = typeof note === 'string' ? note.trim() : '';
    if (n.length > LIMITS.note) {
      throw new ValidationError(
        `Notes can be up to ${LIMITS.note.toLocaleString('en-US')} characters. This one is ${n.length.toLocaleString('en-US')}.`,
        'note-too-long');
    }
    return n;
  }

  function cleanCollectionName(name) {
    const n = cleanText(name);
    if (!n) throw new ValidationError('Give the collection a name.', 'collection-name-empty');
    if (n.length > LIMITS.collectionName) {
      throw new ValidationError(`Collection names can be up to ${LIMITS.collectionName} characters.`, 'collection-name-too-long');
    }
    return n;
  }

  const validKind = (k) => (KIND_IDS.includes(k) ? k : null);
  const uniq = (arr) => [...new Set((arr || []).filter((x) => typeof x === 'string' && x))];

  // Fills in fields that older saves don't have, so every item has the same shape.
  function normalizeItem(raw) {
    const item = { ...raw };
    item.kind = validKind(item.kind) || detectKind(item.url);
    item.collections = uniq(item.collections);
    item.note = typeof item.note === 'string' ? item.note : '';
    item.pinned = !!item.pinned;
    item.visits = Number.isFinite(item.visits) ? item.visits : 0;
    delete item.tags;
    return item;
  }

  let idCounter = 0;
  const newId = () => `c_${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  // ---------- Migration (schema 1 → 2): tags become collections ----------

  async function migrate(area, { now = new Date() } = {}) {
    const all = (await area.get(null)) || {};
    if ((all[SCHEMA_KEY] || 1) >= SCHEMA) return { migrated: false };
    const collections = Array.isArray(all[COLLECTIONS_KEY]) ? all[COLLECTIONS_KEY].slice() : [];
    const byName = new Map(collections.map((c) => [c.name.toLowerCase(), c]));
    const updates = {};
    let created = 0;
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(KEY_PREFIX) || !value || typeof value.url !== 'string') continue;
      const ids = uniq(value.collections);
      for (const tag of Array.isArray(value.tags) ? value.tags : []) {
        const name = cleanText(String(tag)).slice(0, LIMITS.collectionName);
        if (!name) continue;
        let c = byName.get(name.toLowerCase());
        if (!c) { c = { id: newId(), name, createdAt: now.toISOString() }; collections.push(c); byName.set(name.toLowerCase(), c); created++; }
        ids.push(c.id);
      }
      updates[key] = normalizeItem({ ...value, collections: ids });
    }
    await area.set({ ...updates, [COLLECTIONS_KEY]: collections, [SCHEMA_KEY]: SCHEMA });
    return { migrated: true, collections: created, items: Object.keys(updates).length };
  }

  // ---------- Storage ----------

  function createStore(area) {
    let ready = null;

    async function call(action, fn) {
      if (!area) throw new StorageError(action, new Error('storage unavailable'));
      try {
        if (!ready) ready = migrate(area).catch((err) => { ready = null; throw err; });
        await ready;
        return await fn();
      } catch (err) {
        if (err instanceof ValidationError || err instanceof StorageError) throw err;
        throw new StorageError(action, err);
      }
    }

    function keyFor(url) {
      const normalized = normalizeUrl(url);
      if (!normalized) throw new ValidationError('Only web pages (http and https) can be saved.', 'not-savable');
      return KEY_PREFIX + normalized;
    }

    const getItem = async (key) => { const raw = (await area.get(key))[key]; return raw ? normalizeItem(raw) : null; };
    const getCollections = async () => { const c = (await area.get(COLLECTIONS_KEY))[COLLECTIONS_KEY]; return Array.isArray(c) ? c : []; };

    return {
      // Every save, newest first.
      async list() {
        return call('load your library', async () => {
          const all = (await area.get(null)) || {};
          return Object.keys(all)
            .filter((k) => k.startsWith(KEY_PREFIX) && all[k] && typeof all[k].url === 'string')
            .map((k) => normalizeItem(all[k]))
            .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
        });
      },

      async find(url) {
        const key = keyFor(url);
        return call('check whether this page is saved', () => getItem(key));
      },

      // Saves a new link. A URL that's already saved is never saved twice:
      // returns { status: 'duplicate', item } instead of { status: 'saved', item }.
      async save({ url, title, kind, collections, note, pinned } = {}, { now = new Date() } = {}) {
        const key = keyFor(url);
        const n = cleanNote(note);
        return call('save this page', async () => {
          const existing = await getItem(key);
          if (existing) return { status: 'duplicate', item: existing };
          const clean = key.slice(KEY_PREFIX.length);
          const item = normalizeItem({
            url: clean,
            title: (cleanText(title) || clean).slice(0, LIMITS.title),
            kind: validKind(kind) || detectKind(clean),
            collections: uniq(collections),
            note: n,
            pinned: !!pinned,
            visits: 0,
            savedAt: now.toISOString(),
          });
          await area.set({ [key]: item });
          return { status: 'saved', item };
        });
      },

      // Changes title, note, kind, collections or pinned. Keeps the save date.
      async update(url, patch = {}, { now = new Date() } = {}) {
        const key = keyFor(url);
        const changes = {};
        if ('note' in patch) changes.note = cleanNote(patch.note);
        if ('title' in patch) { const t = cleanText(patch.title).slice(0, LIMITS.title); if (t) changes.title = t; }
        if ('kind' in patch) { if (!validKind(patch.kind)) throw new ValidationError('Pick one of the kinds in the list.', 'bad-kind'); changes.kind = patch.kind; }
        if ('collections' in patch) changes.collections = uniq(patch.collections);
        if ('pinned' in patch) changes.pinned = !!patch.pinned;
        return call('update this save', async () => {
          const existing = await getItem(key);
          if (!existing) throw new ValidationError('This link isn’t in your library any more. It may have been deleted in another window.', 'not-found');
          const item = { ...existing, ...changes, updatedAt: now.toISOString() };
          await area.set({ [key]: item });
          return item;
        });
      },

      // Counts an open. Quietly does nothing if the link was deleted meanwhile.
      async recordVisit(url, { now = new Date() } = {}) {
        const key = keyFor(url);
        return call('count this visit', async () => {
          const existing = await getItem(key);
          if (!existing) return null;
          const item = { ...existing, visits: existing.visits + 1, lastOpenedAt: now.toISOString() };
          await area.set({ [key]: item });
          return item;
        });
      },

      // Deletes a save and returns it (for Undo), or null if it wasn't saved.
      async remove(url) {
        const key = keyFor(url);
        return call('delete this save', async () => {
          const existing = await getItem(key);
          await area.remove(key);
          return existing;
        });
      },

      // Puts back an item returned by remove() exactly as it was.
      async restore(item) {
        const key = keyFor(item && item.url);
        return call('restore this save', async () => {
          await area.set({ [key]: normalizeItem(item) });
          return item;
        });
      },

      // ---------- Collections ----------

      async listCollections() {
        return call('load your collections', getCollections);
      },

      // Creates a collection, or returns the existing one with the same name.
      async createCollection(name, { now = new Date() } = {}) {
        const n = cleanCollectionName(name);
        return call('create this collection', async () => {
          const list = await getCollections();
          const same = list.find((c) => c.name.toLowerCase() === n.toLowerCase());
          if (same) return same;
          if (list.length >= LIMITS.collections) throw new ValidationError(`You can have up to ${LIMITS.collections} collections.`, 'too-many-collections');
          const c = { id: newId(), name: n, createdAt: now.toISOString() };
          await area.set({ [COLLECTIONS_KEY]: [...list, c] });
          return c;
        });
      },

      async renameCollection(id, name) {
        const n = cleanCollectionName(name);
        return call('rename this collection', async () => {
          const list = await getCollections();
          const c = list.find((x) => x.id === id);
          if (!c) throw new ValidationError('This collection doesn’t exist any more.', 'not-found');
          if (list.some((x) => x.id !== id && x.name.toLowerCase() === n.toLowerCase())) {
            throw new ValidationError(`You already have a collection called “${n}”.`, 'collection-name-taken');
          }
          const renamed = { ...c, name: n };
          await area.set({ [COLLECTIONS_KEY]: list.map((x) => (x.id === id ? renamed : x)) });
          return renamed;
        });
      },

      // Deletes the collection only; its saves stay in the library.
      // Returns a snapshot that restoreCollection() can put back (for Undo).
      async deleteCollection(id) {
        return call('delete this collection', async () => {
          const all = (await area.get(null)) || {};
          const list = Array.isArray(all[COLLECTIONS_KEY]) ? all[COLLECTIONS_KEY] : [];
          const collection = list.find((x) => x.id === id);
          if (!collection) return null;
          const updates = { [COLLECTIONS_KEY]: list.filter((x) => x.id !== id) };
          const urls = [];
          for (const [k, v] of Object.entries(all)) {
            if (!k.startsWith(KEY_PREFIX) || !v || !Array.isArray(v.collections) || !v.collections.includes(id)) continue;
            updates[k] = { ...v, collections: v.collections.filter((x) => x !== id) };
            urls.push(v.url);
          }
          await area.set(updates);
          return { collection, urls };
        });
      },

      async restoreCollection(snapshot) {
        return call('restore this collection', async () => {
          const all = (await area.get(null)) || {};
          const list = Array.isArray(all[COLLECTIONS_KEY]) ? all[COLLECTIONS_KEY] : [];
          const updates = { [COLLECTIONS_KEY]: list.some((x) => x.id === snapshot.collection.id) ? list : [...list, snapshot.collection] };
          for (const url of snapshot.urls) {
            const k = KEY_PREFIX + normalizeUrl(url); const v = all[k];
            if (v) updates[k] = { ...v, collections: uniq([...(v.collections || []), snapshot.collection.id]) };
          }
          await area.set(updates);
          return snapshot.collection;
        });
      },

      // True if a chrome.storage change touched saves or collections.
      isLibraryChange(changes) {
        return Object.keys(changes || {}).some((k) => k.startsWith(KEY_PREFIX) || k === COLLECTIONS_KEY);
      },
    };
  }

  // ---------- Search and filters ----------

  // Lowercase and strip accents so "cafe" finds "Café".
  function fold(text) {
    return String(text == null ? '' : text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return String(url || '');
    }
  }

  const FIELD_LABELS = { title: 'the title', site: 'the site', note: 'your note', kind: 'the kind', collection: 'a collection' };

  // Every word must appear somewhere. Returns [{ item, matchedIn: ['title','note',…], terms }].
  function searchWithMatches(items, query, { collections = [] } = {}) {
    const terms = fold(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return items.map((item) => ({ item, matchedIn: [], terms }));
    const names = new Map(collections.map((c) => [c.id, c.name]));
    const out = [];
    for (const item of items) {
      const fields = {
        title: fold(item.title),
        site: fold(`${hostOf(item.url)} ${item.url}`),
        note: fold(item.note),
        kind: fold(kindById(item.kind).label),
        collection: fold((item.collections || []).map((id) => names.get(id) || '').join(' ')),
      };
      const matchedIn = new Set();
      const ok = terms.every((term) => {
        let hit = false;
        for (const [field, text] of Object.entries(fields)) if (text.includes(term)) { hit = true; matchedIn.add(field); }
        return hit;
      });
      if (ok) out.push({ item, matchedIn: Object.keys(fields).filter((f) => matchedIn.has(f)), terms });
    }
    return out;
  }

  function search(items, query, opts) {
    return searchWithMatches(items, query, opts).map((r) => r.item);
  }

  // "Matched in the title and your note"
  function describeMatch(matchedIn) {
    const parts = matchedIn.map((f) => FIELD_LABELS[f]);
    if (!parts.length) return '';
    if (parts.length === 1) return `Matched in ${parts[0]}`;
    return `Matched in ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  }

  const monthOf = (iso) => String(iso || '').slice(0, 7);

  // All filters are optional; each one narrows the list.
  function filterItems(items, { kind, collectionId, host, month } = {}) {
    return items.filter((i) => (!kind || i.kind === kind)
      && (!collectionId || (i.collections || []).includes(collectionId))
      && (!host || hostOf(i.url) === host)
      && (!month || monthOf(i.savedAt) === month));
  }

  // Counts for the sidebar.
  function summarize(items) {
    const kinds = Object.fromEntries(KIND_IDS.map((k) => [k, 0]));
    const hosts = new Map(), months = new Map(), collections = new Map();
    for (const i of items) {
      kinds[i.kind] = (kinds[i.kind] || 0) + 1;
      const h = hostOf(i.url); hosts.set(h, (hosts.get(h) || 0) + 1);
      const m = monthOf(i.savedAt); months.set(m, (months.get(m) || 0) + 1);
      for (const c of i.collections || []) collections.set(c, (collections.get(c) || 0) + 1);
    }
    return {
      total: items.length,
      kinds,
      hosts: [...hosts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
      months: [...months.entries()].sort((a, b) => b[0].localeCompare(a[0])),
      collections,
    };
  }

  // Kinds inside a set of items, most common first: [['look', 22], ['read', 9]].
  function kindMix(items) {
    const m = new Map(); for (const i of items) m.set(i.kind, (m.get(i.kind) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }

  // ---------- Display helpers ----------

  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'an unknown date';
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  function formatMonth(ym) {
    const [y, m] = String(ym).split('-').map(Number);
    if (!y || !m) return 'Unknown';
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  }

  function visitsText(n) {
    if (!n) return 'Not opened yet';
    return n === 1 ? 'Opened once' : `Opened ${n} times`;
  }

  root.Stash = {
    KEY_PREFIX, COLLECTIONS_KEY, SCHEMA_KEY, SCHEMA, LIMITS, ValidationError, StorageError,
    normalizeUrl, checkSavable, cleanNote, cleanCollectionName, normalizeItem, migrate, createStore,
    fold, hostOf, search, searchWithMatches, describeMatch, filterItems, summarize, kindMix,
    formatDate, formatMonth, visitsText, monthOf,
  };
})(globalThis);
