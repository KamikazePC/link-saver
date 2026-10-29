// An in-memory stand-in for the parts of the chrome.* API Link Saver uses.
// Each call to createChromeStub() returns an independent fake browser.
//
//   const chrome = createChromeStub({ tab: { url, title } });
//   chrome.failures.set = new Error('boom');   // every storage.local.set now rejects
//   chrome.failures.set = null;                // back to normal
(function (root) {
  'use strict';

  function createChromeStub({ tab = null, data = {} } = {}) {
    const store = JSON.parse(JSON.stringify(data));
    const listeners = new Set();
    const failures = { get: null, set: null, remove: null, query: null };
    const copy = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
    const emit = (changes) => setTimeout(() => listeners.forEach((fn) => fn(changes, 'local')));
    const maybeFail = async (op) => {
      if (failures[op]) throw failures[op];
    };

    const stub = {
      failures,
      data: store,            // inspect directly in tests
      currentTab: tab,
      createdTabs: [],
      badges: [],
      commandListeners: [],

      storage: {
        local: {
          async get(keys) {
            await maybeFail('get');
            const wanted = keys == null ? Object.keys(store) : [].concat(keys);
            const out = {};
            for (const k of wanted) if (k in store) out[k] = copy(store[k]);
            return out;
          },
          async set(items) {
            await maybeFail('set');
            const changes = {};
            for (const [k, v] of Object.entries(items)) {
              changes[k] = { oldValue: copy(store[k]), newValue: copy(v) };
              store[k] = copy(v);
            }
            emit(changes);
          },
          async remove(keys) {
            await maybeFail('remove');
            const changes = {};
            for (const k of [].concat(keys)) {
              if (k in store) changes[k] = { oldValue: copy(store[k]) };
              delete store[k];
            }
            emit(changes);
          },
        },
        onChanged: {
          addListener: (fn) => listeners.add(fn),
          removeListener: (fn) => listeners.delete(fn),
        },
      },

      tabs: {
        async query() {
          await maybeFail('query');
          return stub.currentTab ? [copy(stub.currentTab)] : [];
        },
        async create(props) {
          stub.createdTabs.push(props);
          return { id: 99, ...props };
        },
      },

      runtime: {
        getURL: (path) => `chrome-extension://test-id/${path}`,
      },

      action: {
        async setBadgeText({ tabId, text }) { stub.badges.push({ tabId, text }); },
        async setBadgeBackgroundColor() {},
        async setTitle({ tabId, title }) { stub.lastTitle = { tabId, title }; },
      },

      commands: {
        onCommand: { addListener: (fn) => stub.commandListeners.push(fn) },
      },
    };
    return stub;
  }

  // A localStorage-like object for popup drafts. Pass { broken: true } to make every call throw.
  function createMemoryStorage({ broken = false } = {}) {
    const map = new Map();
    const guard = () => { if (broken) throw new Error('localStorage is disabled'); };
    return {
      getItem(k) { guard(); return map.has(k) ? map.get(k) : null; },
      setItem(k, v) { guard(); map.set(k, String(v)); },
      removeItem(k) { guard(); map.delete(k); },
    };
  }

  root.createChromeStub = createChromeStub;
  root.createMemoryStorage = createMemoryStorage;
})(globalThis);
