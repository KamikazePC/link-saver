// Service worker: handles the "quick-save" keyboard shortcut, which saves the current page
// without opening the popup and reports the result on the toolbar icon's badge.
importScripts('links.js');

const store = LinkSaver.createStore(chrome.storage.local);
const BADGE_MS = 4000;
const DEFAULT_TITLE = 'Save this page (Alt+Shift+S)';

const BADGES = {
  saved: { text: '✓', color: '#1a7f37' },
  duplicate: { text: '✓', color: '#0969da' },
  error: { text: '!', color: '#cf222e' },
};

async function flash(tabId, kind, title) {
  const badge = BADGES[kind];
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color });
    await chrome.action.setBadgeText({ tabId, text: badge.text });
    await chrome.action.setTitle({ tabId, title });
    setTimeout(() => {
      // The tab may have closed by now; that's fine.
      chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
      chrome.action.setTitle({ tabId, title: DEFAULT_TITLE }).catch(() => {});
    }, BADGE_MS);
  } catch (err) {
    console.warn('Link Saver: could not update the badge', err);
  }
}

async function quickSave(tab) {
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;

  const check = LinkSaver.checkSavable(tab);
  if (!check.ok) return flash(tab.id, 'error', check.reason);

  try {
    const result = await store.save({ url: check.url, title: check.title });
    if (result.status === 'duplicate') {
      return flash(tab.id, 'duplicate', `Already saved on ${LinkSaver.formatDate(result.item.savedAt)}`);
    }
    return flash(tab.id, 'saved', 'Saved to Link Saver');
  } catch (err) {
    console.error('Link Saver: quick save failed', err);
    return flash(tab.id, 'error', err.message || 'Couldn\'t save this page.');
  }
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'quick-save') quickSave(tab);
});
