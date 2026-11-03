# Stash

Save anything worth keeping and find it again without remembering where you saw it.
A Chrome extension (Manifest V3) in plain JavaScript, HTML and CSS: no framework, no build step,
no account, no server. Everything stays on your computer.

**Why Chrome MV3:** it's the format Chrome requires for new extensions, and the same unpacked
folder also loads in Edge, Brave and other Chromium browsers.

## What it does

- **Save in one move.** Click the toolbar button or press **Alt+Shift+S** for the popup, or
  **Alt+Shift+K** to save straight away. The toolbar icon answers with ✓ (saved), ★ (already in
  your library) or ! (problem). Hover it for the details.
- **Stash remembers the details.** Title, site, the date, and the **kind** of thing it is, guessed
  from the address: Read, Watch, Look, Listen, Use, Buy or Other. Change the kind in one tap. The
  menu explains every kind.
- **Colour means kind, and nothing else.** Every kind has one colour, always shown with its name.
  Selected filters, primary buttons and badges are charcoal or white, so a colour never means two
  things.
- **Collections are folders.** File a save into any number of collections. On the library home
  each collection is a folder with a stack inside, coloured by the kinds it holds.
- **Open a collection to see a stack.** Click or press Enter on a save and it opens in place, in
  line with the others, showing its note, visit count and actions. Arrow keys move, and Esc tucks
  it back.
- **No duplicates.** A page already in your library is never saved twice. The popup shows when you
  saved it and how often you've opened it, and lets you change the note, kind, collections or pin.
- **Get back to things.** The library tab has search (titles, sites, notes, kinds and collection
  names, ignoring case and accents), and every result says where it matched. You can filter by
  kind, collection, site or month, and pin favourites to the top. Every open is counted, so the
  things you use most stay close.
- **Undo instead of "are you sure?".** Deleting a save or a collection shows an Undo message that
  stays until you close it. Deleting a collection never deletes its saves.
- **On pages that can't be saved** (Chrome settings, the Web Store, local files) the popup becomes
  a finder: search your library or open a pinned save.

### Coming in phase 2

Right-click to save a link or image without opening it, address-bar search ("stash" + a word),
page previews and highlighted quotes, dragging saves into folders, and export.

## Upgrading from Link Saver 1.x

Nothing is lost. The first time Stash runs, every **tag becomes a collection** with the same name
("recipes" and "Recipes" become one), each save gets a kind guessed from its address, and the
tags go away. This happens once and is safe to repeat.

## Permissions

| Permission | Why it's needed |
|---|---|
| `activeTab` | Read the address and title of the tab you're on, **only** when you click the toolbar button or use a shortcut. No access to any other tab, and no access to page content. |
| `storage` | Keep your library on this computer. |

No host permissions, no content scripts and no network requests.

## Install (load unpacked)

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder, the one that contains `manifest.json`.
4. Optional: pin **Stash** from the puzzle-piece menu.

After editing any file, click the reload ↻ icon on the extension's card.

## Try it by hand

1. Open a YouTube video and click Stash. The popup detects **Watch**. Pick a collection, then **Save**.
2. Click the button again. It shows "Saved on …" with your note.
3. Open `chrome://settings` and click the button. The popup becomes a finder.
4. Click **Library ↗**. Open a collection folder, then click a save to open it in place.
5. Delete a save from its ⋯ menu, then press **Undo**.

## Automated tests

No dependencies. 55 tests cover kinds, saving and duplicates, collections, the tags-to-collections
migration, search and filters, every popup state, the library views, Undo, storage failures and the
quick-save shortcut.

**In a browser:** open `test/index.html`. The first line reads `PASS 55/55 tests passed`.

**From a terminal (Windows, headless Chrome or Edge):**

```powershell
powershell -ExecutionPolicy Bypass -File test\run-tests.ps1
```

Exits 0 when everything passes. Pass `-Browser "C:\path\to\chrome.exe"` if Chrome lives somewhere
unusual.

## Design notes

- Tokens, grain and motion live in `base.css`. The paper grain is an inline SVG noise texture, and
  nothing is downloaded. Inter and IBM Plex Mono are used if installed; otherwise the system font.
- Motion: menus and toasts use a strong ease-out, layout moves use ease-in-out and transforms only,
  and the new sheet in the popup drops with a small spring. With **reduced motion** turned on, every
  movement becomes a short fade.
- Every text and background pair meets 4.5:1 contrast in light and dark mode. The lowest is ink on
  Read blue, at 4.92:1.
- Popups never exceed Chrome's 600px height limit. Undo never runs on a timer.

## Files

```
manifest.json   Extension manifest (permissions, popup, shortcuts)
kinds.js        The seven kinds, their icons and detectKind()
links.js        Storage, collections, migration, search and filters (shared by everything)
ui.js           DOM builder, kind chips, folder tiles, menus, toasts, FLIP helper
background.js   Migration on install and the Alt+Shift+K quick save
popup.*         Toolbar popup: Save, Saved, Already saved, Deleted, finder
library.*       Library tab: home, search, filters, collections, empty state
base.css        Shared tokens (light and dark), grain, controls and motion
icons/          Toolbar and store icons
test/           Test page, headless runner, chrome stub and test suites
```

## Things that can trip you up

- **Load the right folder.** *Load unpacked* needs the folder that directly contains `manifest.json`.
- **Shortcuts may not be set.** Chrome skips a suggested shortcut if it's already taken. Check
  `chrome://extensions/shortcuts`.
- **Some pages are off limits.** Chrome hides its own pages and the Web Store from extensions.
- **Removing the extension deletes your library.** Reloading or updating doesn't.
- **Requires Chrome 116 or newer.**
