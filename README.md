# Link Saver

A Chrome extension (Manifest V3) for saving the page you're on to come back to later.
Plain JavaScript, HTML and CSS: no framework, no build step, no account, no server.

**Why Chrome MV3:** it's the format Chrome requires for new extensions, and the same unpacked
folder also loads in Edge, Brave and other Chromium browsers.

## What it does

- **Save the current page** with one click on the toolbar button, or press **Alt+Shift+S**
  to open the save popup. Title, URL and save date are filled in; add an optional note and
  comma-separated tags, then press **Save** (or **Ctrl+Enter** in the note box).
- **Quick save:** **Alt+Shift+K** saves right away without the popup. The toolbar icon shows
  a green ✓ (saved), a blue ✓ (already saved) or a red ! (couldn't save); hover it for details.
- **No duplicates.** Saving a page that's already saved doesn't create a second copy. The
  popup says *Already saved* with the date and lets you update the note and tags or remove it.
  `https://Example.com/post`, `https://example.com:443/post` and `https://example.com/post#comments`
  all count as the same page. Different paths or query strings (`?page=2`) are different pages.
  App-style routes in the fragment (`#/inbox`, `#!/post`) are kept, since they are different pages.
- **All saved links:** click *All saved links* in the popup. Links are listed newest first.
  - Search matches titles, addresses, notes and tags, ignores case and accents, and requires every
    word to match. `#tag` matches a tag exactly. Press **/** to jump to the search box.
  - Click a title to open it in a new tab, click a tag to filter by it, **Delete** to remove
    (with **Undo** for 6 seconds).
  - Changes made in the popup or another tab show up immediately.
- **Local, persistent storage** in `chrome.storage.local`. It survives restarts and browser
  updates. It's removed only if you uninstall the extension.

### Limits

Notes up to 2,000 characters, up to 20 tags of up to 40 characters each. Chrome gives
`storage.local` 10 MB, which is room for tens of thousands of links.

## Permissions

| Permission | Why it's needed |
|---|---|
| `activeTab` | Read the URL and title of the tab you're on, **only** when you click the toolbar button or use a shortcut. No access to any other tab, and no access to page content. |
| `storage` | Keep your saved links on this computer. |

No host permissions, no content scripts, no `tabs` permission, and no network requests.
Installing it doesn't show a "read your data on all websites" warning.

## Install (load unpacked)

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this `link-saver` folder, the one that contains `manifest.json`.
4. Optional: click the puzzle-piece icon in the toolbar and pin **Link Saver**.

After editing any file, click the reload ↻ icon on the extension's card in `chrome://extensions`.

## Try it by hand

1. Open any website (for example `https://example.com`) and click the Link Saver button.
   Add a note and tags, then **Save**.
2. Click the button again: it now says *Already saved*.
3. Open `chrome://settings` and click the button: it explains that browser pages can't be saved.
4. On another website, press **Alt+Shift+K**: the icon shows a green ✓.
5. Click **All saved links**: search, filter by a tag, delete and undo.

## Automated tests

The tests have no dependencies. 60 tests cover saving, duplicate detection, search,
delete/undo, restricted pages, input limits, storage failures (read, write, delete, full quota,
missing storage), draft recovery, empty states and the quick-save shortcut.

**In a browser:** open `test/index.html` (double-click it, or drag it into Chrome). The first
line reads `PASS 60/60 tests passed`, with any failures in red below.

**From a terminal (Windows, headless Chrome or Edge):**

```powershell
powershell -ExecutionPolicy Bypass -File test\run-tests.ps1
```

Exits with code 0 when all tests pass and 1 otherwise, so it can run in CI. Pass
`-Browser "C:\path\to\chrome.exe"` if Chrome is installed somewhere unusual. On macOS or Linux, run:

```bash
google-chrome --headless=new --virtual-time-budget=60000 --dump-dom "file://$PWD/test/index.html" | grep -o 'id="summary"[^<]*'
```

Tests use an in-memory stand-in for `chrome.*` (`test/chrome-stub.js`) that can be told to
fail, which is how storage errors are tested. The popup and list page are mounted into the
test page the same way the real extension pages mount them.

## How storage errors are handled

- Every storage call is wrapped. Failures become a `StorageError` with a plain message
  (*"Couldn't save this page because browser storage didn't respond. Try again in a moment."*,
  or *"Storage is full…"* when the quota is hit). The original error is logged to the console.
- In the popup, a failed save leaves every field as typed and the **Save** button ready to retry.
  What you type is also kept as a draft in the popup's own `localStorage`, so it's still there if
  you close the popup and come back to the same page. The draft is cleared once the save succeeds.
- On the list page, a failed load shows **Try again**. A failed delete leaves the link in place
  and shows an error. A failed Undo offers **Try again**.

## Files

```
link-saver/
├── manifest.json      Extension manifest (permissions, popup, shortcuts)
├── links.js           Core logic: URL checks, duplicates, storage, search (shared by everything)
├── background.js      Service worker for the Alt+Shift+K quick-save shortcut
├── popup.html/.js/.css  Toolbar popup: save, already-saved, restricted-page views
├── list.html/.js/.css   All saved links: search, open, delete, undo
├── base.css           Shared colors (light and dark) and controls
├── icons/             16, 32, 48 and 128 px icons
└── test/
    ├── index.html     Test page (open in a browser)
    ├── run-tests.ps1  Headless runner for the terminal
    ├── harness.js     Tiny test runner
    ├── chrome-stub.js Fake chrome.* API with failure switches
    └── *.test.js      Tests for core logic, popup, list page and shortcut
```

## Things that can trip you up

- **Load the right folder.** *Load unpacked* needs the folder that directly contains
  `manifest.json` (`link-saver`), not its parent.
- **Shortcuts may not be set.** Chrome skips a suggested shortcut if another extension or
  Chrome already uses it, and it never changes shortcuts on reload. Check or set them at
  `chrome://extensions/shortcuts`.
- **Some pages are off limits.** Chrome hides the address of its own pages, other extensions'
  pages and the Chrome Web Store from extensions. Link Saver says so instead of saving.
  Local files (`file://`) aren't saved either, by design.
- **Reload doesn't reopen the popup.** After reloading the extension, close and reopen the
  popup, and refresh any open *Saved links* tab.
- **Removing the extension deletes your links.** `chrome.storage.local` belongs to the
  extension. Uninstalling it clears the data. Reloading or updating doesn't.
- **Requires Chrome 116 or newer** (set in `minimum_chrome_version`).
