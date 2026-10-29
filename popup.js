// The toolbar popup: saves the current page with an optional note and tags,
// or, if it's already saved, shows when and lets you update or remove it.
(function (root) {
  'use strict';
  const { h, checkSavable, createStore, formatDate, LIMITS, ValidationError } = root.LinkSaver;
  const DRAFT_KEY = 'linksaver:draft';
  const CLOSE_AFTER_SAVE_MS = 1200;

  // deps: { chrome, drafts (localStorage-like), close() }
  async function mount(container, deps) {
    const { chrome } = deps;
    const store = createStore(chrome.storage && chrome.storage.local);
    const drafts = safeDrafts(deps.drafts);
    const close = deps.close || (() => {});

    container.replaceChildren(h('p', { class: 'muted', role: 'status' }, 'Loading…'));

    let tab;
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (err) {
      console.error('Link Saver: could not read the current tab', err);
    }

    const check = checkSavable(tab);
    if (!check.ok) return renderBlocked(check.reason);

    let existing = null;
    let loadError = null;
    try {
      existing = await store.find(check.url);
    } catch (err) {
      console.error('Link Saver: lookup failed', err);
      loadError = err.message;
    }

    const draft = drafts.read(check.url);
    renderForm({
      url: check.url,
      title: (draft && draft.title) || (existing && existing.title) || check.title,
      note: draft ? draft.note : (existing ? existing.note : ''),
      tags: draft ? draft.tags : (existing ? existing.tags.join(', ') : ''),
      existing,
      loadError,
    });

    // ---------- Views ----------

    function header(heading) {
      return h('header', { class: 'bar' },
        h('h1', {}, heading),
        h('button', { type: 'button', class: 'link-button', onclick: openList }, 'All saved links'));
    }

    function renderBlocked(reason) {
      container.replaceChildren(
        header('Can\'t save this page'),
        h('div', { class: 'notice notice-warn', role: 'status' }, reason),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'primary', onclick: openList }, 'View saved links')));
    }

    function renderForm(state) {
      let mode = state.existing ? 'update' : 'save';
      let savedItem = state.existing;

      const heading = h('h1', {});
      const notice = h('div', { class: 'notice', hidden: true });
      const titleInput = h('input', {
        id: 'title', name: 'title', type: 'text', value: state.title, maxlength: String(LIMITS.title), autocomplete: 'off',
      });
      const noteInput = h('textarea', {
        id: 'note', name: 'note', rows: '3', maxlength: String(LIMITS.note), placeholder: 'Why are you saving this?',
      });
      noteInput.value = state.note || '';
      const tagsInput = h('input', {
        id: 'tags', name: 'tags', type: 'text', value: state.tags || '', autocomplete: 'off',
        placeholder: 'reading, work', 'aria-describedby': 'tags-hint',
      });
      const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
      const submit = h('button', { type: 'submit', class: 'primary' });
      const removeBtn = h('button', { type: 'button', class: 'danger-quiet', onclick: onRemove }, 'Remove');

      const form = h('form', { novalidate: true, onsubmit: onSubmit, oninput: saveDraft },
        h('header', { class: 'bar' }, heading,
          h('button', { type: 'button', class: 'link-button', onclick: openList }, 'All saved links')),
        notice,
        h('div', { class: 'field' }, h('label', { for: 'title' }, 'Title'), titleInput,
          h('p', { class: 'url', title: state.url }, state.url)),
        h('div', { class: 'field' }, h('label', { for: 'note' }, 'Note ', h('span', { class: 'optional' }, '(optional)')), noteInput),
        h('div', { class: 'field' }, h('label', { for: 'tags' }, 'Tags ', h('span', { class: 'optional' }, '(optional)')), tagsInput,
          h('p', { id: 'tags-hint', class: 'hint' }, 'Separate tags with commas.')),
        status,
        h('div', { class: 'actions' }, removeBtn, submit));

      // Ctrl+Enter / Cmd+Enter saves from inside the note box.
      noteInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          form.requestSubmit();
        }
      });

      container.replaceChildren(form);
      applyMode();
      if (state.loadError) setStatus(`${state.loadError} You can still try saving.`, 'error');
      noteInput.focus();

      function applyMode() {
        const isUpdate = mode === 'update';
        heading.textContent = isUpdate ? 'Already saved' : 'Save page';
        submit.textContent = isUpdate ? 'Update' : 'Save';
        removeBtn.hidden = !isUpdate;
        titleInput.readOnly = isUpdate;
        notice.hidden = !isUpdate;
        notice.className = 'notice notice-info';
        notice.textContent = isUpdate
          ? `You saved this page on ${formatDate(savedItem.savedAt)}. You can change its note and tags.`
          : '';
      }

      function setStatus(message, kind) {
        status.textContent = message;
        status.className = `status ${kind ? `status-${kind}` : ''}`;
        // Errors interrupt; success and progress are announced politely.
        status.setAttribute('role', kind === 'error' ? 'alert' : 'status');
      }

      function busy(on, label) {
        submit.disabled = on;
        removeBtn.disabled = on;
        form.setAttribute('aria-busy', on ? 'true' : 'false');
        if (on) submit.textContent = label;
        else applyMode();
      }

      function values() {
        return { url: state.url, title: titleInput.value, note: noteInput.value, tags: tagsInput.value };
      }

      function saveDraft() {
        drafts.write(values());
      }

      async function onSubmit(event) {
        event.preventDefault();
        if (submit.disabled) return;
        const v = values();
        busy(true, mode === 'update' ? 'Updating…' : 'Saving…');
        setStatus('', null);
        try {
          if (mode === 'update') {
            savedItem = await store.update(v.url, { note: v.note, tags: v.tags });
            drafts.clear();
            busy(false);
            setStatus('Changes saved.', 'success');
            return;
          }
          const result = await store.save(v);
          if (result.status === 'duplicate') {
            // Saved in another window (or by the shortcut) while this popup was open.
            mode = 'update';
            savedItem = result.item;
            busy(false);
            setStatus('This page was already saved. Your note and tags aren\'t stored yet — click Update to add them.', 'info');
            return;
          }
          drafts.clear();
          mode = 'update';
          savedItem = result.item;
          busy(false);
          heading.textContent = 'Saved';
          notice.hidden = true;
          setStatus('Saved. You\'ll find it under All saved links.', 'success');
          setTimeout(close, CLOSE_AFTER_SAVE_MS);
        } catch (err) {
          if (!(err instanceof ValidationError)) console.error('Link Saver: save failed', err);
          // Nothing typed is lost: the fields keep their values and the draft stays stored.
          saveDraft();
          busy(false);
          setStatus(err.message || 'Something went wrong. Try again.', 'error');
        }
      }

      async function onRemove() {
        busy(true, 'Removing…');
        try {
          await store.remove(state.url);
          mode = 'save';
          savedItem = null;
          titleInput.readOnly = false;
          busy(false);
          setStatus('Removed from your saved links. Click Save to add it back.', 'success');
        } catch (err) {
          console.error('Link Saver: remove failed', err);
          busy(false);
          setStatus(err.message, 'error');
        }
      }
    }

    async function openList() {
      try {
        await chrome.tabs.create({ url: chrome.runtime.getURL('list.html') });
        close();
      } catch (err) {
        console.error('Link Saver: could not open the list', err);
      }
    }
  }

  // Unsaved form values, kept in the popup's own localStorage so closing the popup
  // or a storage failure never loses what was typed. Failures here are ignored.
  function safeDrafts(storage) {
    return {
      read(url) {
        try {
          const draft = JSON.parse(storage.getItem(DRAFT_KEY) || 'null');
          return draft && draft.url === url ? draft : null;
        } catch {
          return null;
        }
      },
      write(values) {
        try { storage.setItem(DRAFT_KEY, JSON.stringify(values)); } catch { /* ignore */ }
      },
      clear() {
        try { storage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      },
    };
  }

  root.LinkSaverPopup = { mount, DRAFT_KEY };

  // Running as the real popup (not inside the test page).
  if (root.document && document.body && document.body.dataset.page === 'popup') {
    let drafts;
    try { drafts = root.localStorage; } catch { drafts = null; }
    mount(document.getElementById('app'), { chrome: root.chrome, drafts, close: () => root.close() });
  }
})(globalThis);
