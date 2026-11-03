// Service worker: runs the one-time migration (tags → collections) and the "quick-save" shortcut,
// which saves the current page without the popup and answers on the toolbar icon's badge.
// Badges use a symbol and a tooltip, never a colour, because every colour in Stash means a kind.
importScripts('kinds.js', 'links.js');

const store = Stash.createStore(chrome.storage.local);
const BADGE_MS = 4000;
const DEFAULT_TITLE = 'Save to Stash (Alt+Shift+S)';
const BADGES = {
  saved: { text: '✓', color: '#111111', textColor: '#FFFFFF' },
  duplicate: { text: '★', color: '#FFFFFF', textColor: '#111111' },
  error: { text: '!', color: '#111111', textColor: '#FFFFFF' },
};

async function flash(tabId, kind, title) {
  const b = BADGES[kind];
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: b.color });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ tabId, color: b.textColor });
    await chrome.action.setBadgeText({ tabId, text: b.text });
    await chrome.action.setTitle({ tabId, title });
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
      chrome.action.setTitle({ tabId, title: DEFAULT_TITLE }).catch(() => {});
    }, BADGE_MS);
  } catch (err) {
    console.warn('Stash: could not update the badge', err);
  }
}

async function quickSave(tab) {
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  const check = Stash.checkSavable(tab);
  if (!check.ok) return flash(tab.id, 'error', `Can’t save this page. ${check.reason}`);
  try {
    const result = await store.save({ url: check.url, title: check.title, kind: StashKinds.detectKind(check.url) });
    if (result.status === 'duplicate') return flash(tab.id, 'duplicate', `Already in your library, saved on ${Stash.formatDate(result.item.savedAt)}`);
    return flash(tab.id, 'saved', `Saved to your library as ${StashKinds.kindById(result.item.kind).label}`);
  } catch (err) {
    console.error('Stash: quick save failed', err);
    return flash(tab.id, 'error', err.message || 'Couldn’t save this page. Try again.');
  }
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'quick-save') quickSave(tab);
});

// Upgrade older libraries: every tag becomes a collection. Safe to run more than once.
if (chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    Stash.migrate(chrome.storage.local).catch((err) => console.error('Stash: migration failed', err));
  });
}
