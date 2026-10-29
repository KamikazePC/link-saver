// Core logic shared by the popup, the saved-links page and the background worker.
// Plain script (no modules) so it loads the same way in all three and in the test page.
// Everything is exposed on globalThis.LinkSaver.
(function (root) {
  'use strict';

  const KEY_PREFIX = 'link:';
  const LIMITS = Object.freeze({ title: 500, note: 2000, tags: 20, tagLength: 40 });

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
        ? 'Storage is full, so this couldn\'t be saved. Delete some saved links and try again.'
        : `Couldn't ${action} because browser storage didn't respond. Try again in a moment.`);
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

  // Returns a canonical form of a web URL used to spot duplicates, or null if it isn't http(s).
  // The URL parser already lowercases the host and drops default ports. On top of that we drop
  // the #fragment (the same page scrolled to a different heading) but keep "#/..." and "#!..."
  // because single-page apps use those as their route.
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

  // Decides whether a tab (as returned by chrome.tabs) can be saved.
  // Returns { ok: true, url, title } or { ok: false, reason } with a message for the user.
  function checkSavable(tab) {
    if (!tab) {
      return { ok: false, reason: 'No active tab was found. Click on a web page and try again.' };
    }
    // Chrome hides the address of pages the extension isn't allowed to touch
    // (the Web Store, other extensions' pages, some internal pages).
    if (!tab.url) {
      return {
        ok: false,
        reason: 'Chrome doesn\'t let extensions read this page, so it can\'t be saved. '
          + 'This happens on browser pages such as Settings, New Tab and the Chrome Web Store.',
      };
    }
    let protocol = '';
    try {
      protocol = new URL(tab.url).protocol;
    } catch {
      return { ok: false, reason: 'This page\'s address isn\'t a valid web address, so it can\'t be saved.' };
    }
    if (INTERNAL_SCHEMES.has(protocol)) {
      return { ok: false, reason: 'This is a browser page, not a website, so it can\'t be saved.' };
    }
    if (protocol === 'file:') {
      return { ok: false, reason: 'Files on your computer can\'t be saved. Only web pages (http and https) can.' };
    }
    const url = normalizeUrl(tab.url);
    if (!url) {
      return { ok: false, reason: 'Only web pages (http and https) can be saved.' };
    }
    return { ok: true, url, title: cleanText(tab.title) || url };
  }

  // ---------- Input cleanup ----------

  function cleanText(value) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  }

  // Accepts "a, b, #c" or ["a", "b"]. Returns lowercase, de-duplicated tags without '#'.
  function parseTags(input) {
    const parts = Array.isArray(input) ? input : String(input == null ? '' : input).split(',');
    const tags = [];
    for (const part of parts) {
      const tag = cleanText(String(part)).replace(/^#+/, '').toLowerCase();
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
    return tags;
  }

  // Cleans note and tags, throwing ValidationError if they're over the limits.
  function cleanDetails({ note, tags } = {}) {
    const cleanNote = typeof note === 'string' ? note.trim() : '';
    if (cleanNote.length > LIMITS.note) {
      throw new ValidationError(
        `Notes can be up to ${LIMITS.note.toLocaleString('en-US')} characters. This one is ${cleanNote.length.toLocaleString('en-US')}.`,
        'note-too-long');
    }
    const cleanTags = parseTags(tags);
    if (cleanTags.length > LIMITS.tags) {
      throw new ValidationError(`You can add up to ${LIMITS.tags} tags. Remove ${cleanTags.length - LIMITS.tags} and try again.`, 'too-many-tags');
    }
    const longTag = cleanTags.find((t) => t.length > LIMITS.tagLength);
    if (longTag) {
      throw new ValidationError(`Tags can be up to ${LIMITS.tagLength} characters. Shorten “${longTag.slice(0, 20)}…”.`, 'tag-too-long');
    }
    return { note: cleanNote, tags: cleanTags };
  }

  // ---------- Storage ----------

  // Wraps a chrome.storage area (chrome.storage.local in the extension, a stub in tests).
  // Each link is stored under its own key, "link:" + normalized URL, so saving the same URL
  // twice lands on the same key and two windows can't overwrite each other's lists.
  function createStore(area) {
    async function call(action, fn) {
      if (!area) throw new StorageError(action, new Error('storage unavailable'));
      try {
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

    return {
      // All saved links, newest first.
      async list() {
        return call('load your saved links', async () => {
          const all = (await area.get(null)) || {};
          return Object.keys(all)
            .filter((k) => k.startsWith(KEY_PREFIX))
            .map((k) => all[k])
            .filter((item) => item && typeof item.url === 'string')
            .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
        });
      },

      // The saved link for this URL (after normalizing), or null.
      async find(url) {
        const key = keyFor(url);
        return call('check whether this page is saved', async () => {
          const found = await area.get(key);
          return (found && found[key]) || null;
        });
      },

      // Saves a new link. If the URL is already saved, nothing changes and
      // { status: 'duplicate', item: <existing> } is returned instead of { status: 'saved', item }.
      async save({ url, title, note, tags } = {}, { now = new Date() } = {}) {
        const key = keyFor(url);
        const details = cleanDetails({ note, tags });
        return call('save this page', async () => {
          const existing = (await area.get(key))[key];
          if (existing) return { status: 'duplicate', item: existing };
          const item = {
            url: key.slice(KEY_PREFIX.length),
            title: (cleanText(title) || key.slice(KEY_PREFIX.length)).slice(0, LIMITS.title),
            note: details.note,
            tags: details.tags,
            savedAt: now.toISOString(),
          };
          await area.set({ [key]: item });
          return { status: 'saved', item };
        });
      },

      // Changes the note and tags of a saved link. Keeps the original save date.
      async update(url, { note, tags } = {}, { now = new Date() } = {}) {
        const key = keyFor(url);
        const details = cleanDetails({ note, tags });
        return call('update this link', async () => {
          const existing = (await area.get(key))[key];
          if (!existing) throw new ValidationError('This link isn\'t saved any more. It may have been deleted in another window.', 'not-found');
          const item = { ...existing, ...details, updatedAt: now.toISOString() };
          await area.set({ [key]: item });
          return item;
        });
      },

      // Deletes a saved link and returns it (so it can be restored), or null if it wasn't saved.
      async remove(url) {
        const key = keyFor(url);
        return call('delete this link', async () => {
          const existing = (await area.get(key))[key] || null;
          await area.remove(key);
          return existing;
        });
      },

      // Puts back an item returned by remove() exactly as it was (for Undo).
      async restore(item) {
        const key = keyFor(item && item.url);
        return call('restore this link', async () => {
          await area.set({ [key]: item });
          return item;
        });
      },

      // True if a chrome.storage change event touched saved links.
      isLinkChange(changes) {
        return Object.keys(changes || {}).some((k) => k.startsWith(KEY_PREFIX));
      },
    };
  }

  // ---------- Search ----------

  // Lowercase and strip accents so "cafe" finds "Café".
  function fold(text) {
    return String(text == null ? '' : text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  // Every word in the query must appear in the title, URL, note or tags.
  // A word starting with # must match a tag exactly ("#recipes").
  function search(items, query) {
    const terms = fold(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return items.slice();
    return items.filter((item) => {
      const tags = (item.tags || []).map(fold);
      const haystack = fold([item.title, item.url, item.note, tags.join(' ')].join('\n'));
      return terms.every((term) => {
        if (term.startsWith('#') && term.length > 1) return tags.includes(term.slice(1));
        return haystack.includes(term);
      });
    });
  }

  // ---------- Display helpers ----------

  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'an unknown date';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  // Tiny DOM builder used by the UI so user data only ever goes in via textContent.
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (key in el && typeof value !== 'string') el[key] = value;
      else el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child == null || child === false) continue;
      el.append(child instanceof Node ? child : String(child));
    }
    return el;
  }

  root.LinkSaver = {
    KEY_PREFIX, LIMITS, ValidationError, StorageError,
    normalizeUrl, checkSavable, parseTags, cleanDetails, createStore, search, fold, formatDate, hostOf, h,
  };
})(globalThis);
