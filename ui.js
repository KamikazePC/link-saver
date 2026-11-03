// Shared UI building blocks for the popup and the library. Needs kinds.js and links.js first.
// User data only ever reaches the page through textContent (see h()).
(function (root) {
  'use strict';
  const { kindById, kindIcon } = root.StashKinds;

  // Tiny DOM builder. Strings become text nodes, never HTML.
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key === 'style') el.setAttribute('style', value);
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

  // Inline SVG from our own static markup (never from user data).
  function svg(markup) {
    const t = document.createElement('template');
    t.innerHTML = markup.trim();
    return t.content.firstChild;
  }

  const ICONS = {
    logo: '<svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="15.5" fill="#C6FF00" stroke="#111"/><path d="M11 9.5h10v13.5l-5-3.6-5 3.6z" fill="#111"/></svg>',
    search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    folder: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    more: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  };
  const icon = (name) => svg(ICONS[name]);

  const kindLabel = (k) => kindById(k).label;
  const kindChip = (k, { text, tag = 'span', ...props } = {}) => h(tag, { class: 'chip', dataset: { kind: k }, ...props }, text || kindLabel(k));
  const kindTile = (k, size = 28) => {
    const t = h('span', { class: 'kind-tile', dataset: { kind: k }, style: `width:${size}px;height:${size}px` });
    t.append(svg(kindIcon(k, Math.round(size * 0.6))));
    return t;
  };

  // A collection as a folder: paper-white folder, a stack of up to three kind-coloured sheets inside.
  function folderTile({ name, count, kinds, href, onClick, label }) {
    const sheets = (kinds.length ? kinds : ['other']).slice(0, 3);
    while (sheets.length < 3) sheets.push(sheets[sheets.length - 1]);
    const summary = `${count} ${count === 1 ? 'save' : 'saves'}${kinds.length ? ` · ${summarizeKinds(kinds)}` : ''}`;
    const tag = href ? 'a' : onClick ? 'button' : 'div';
    const el = h(tag, { class: 'folder', href, type: tag === 'button' ? 'button' : null, onclick: onClick, 'aria-label': tag === 'div' ? null : (label || `${name}, ${summary}`) },
      h('span', { class: 'back', 'aria-hidden': 'true' }),
      h('span', { class: 'tab', 'aria-hidden': 'true' }),
      sheets.map((k, i) => h('span', { class: 'sheet', dataset: { kind: k }, 'aria-hidden': 'true', style: `top:${18 + i * 7.7}%` })),
      h('span', { class: 'front' }, h('span', { class: 'name' }, name), h('span', { class: 'summary' }, summary)));
    return el;
  }

  // "mostly Look" or "Watch and Read"
  function summarizeKinds(kinds) {
    const unique = [...new Set(kinds)].map(kindLabel);
    if (unique.length === 1) return `mostly ${unique[0]}`;
    if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
    return unique.slice(0, 3).join(', ');
  }

  // ---------- Toasts: stay until closed (they carry Undo) ----------
  function createToaster(container) {
    const region = h('div', { class: 'toast-region', role: 'status', 'aria-live': 'polite' });
    container.append(region);
    function show(message, { actionLabel, onAction } = {}) {
      region.replaceChildren();
      const close = () => toast.remove();
      const toast = h('div', { class: 'toast motion-toast' },
        h('span', {}, message),
        actionLabel ? h('button', { type: 'button', class: 'link-btn', onclick: () => { close(); onAction(); } }, actionLabel) : null,
        h('button', { type: 'button', class: 'close', 'aria-label': 'Close message', onclick: close }, '×'));
      region.append(toast);
      return { close, el: toast };
    }
    return { show, region };
  }

  // ---------- Menus: arrow keys, Enter, Escape, click outside; focus returns to the trigger ----------
  function openMenu(anchor, items, { label = 'Menu', onClose } = {}) {
    closeOpenMenu();
    const menu = h('div', { class: 'menu motion-menu', role: 'menu', 'aria-label': label });
    const buttons = [];
    for (const it of items) {
      if (it === '-') { menu.append(h('hr')); continue; }
      const b = h('button', {
        type: 'button', role: it.checked == null ? 'menuitem' : 'menuitemradio', 'aria-checked': it.checked == null ? null : String(!!it.checked), tabindex: '-1',
        onclick: () => { close(); it.onSelect(); },
      }, it.lead || null, h('span', {}, it.label, it.sub ? h('span', { class: 'sub' }, it.sub) : null));
      buttons.push(b); menu.append(b);
    }
    document.body.append(menu);
    const r = anchor.getBoundingClientRect();
    const top = Math.min(r.bottom + 6, window.innerHeight - menu.offsetHeight - 8);
    const left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8);
    menu.style.top = `${Math.max(8, top)}px`;
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.transformOrigin = `${r.left + r.width / 2 - Math.max(8, left)}px ${r.bottom - Math.max(8, top)}px`;
    anchor.setAttribute('aria-expanded', 'true');
    const focusAt = (i) => buttons[(i + buttons.length) % buttons.length].focus();
    const start = buttons.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    focusAt(start >= 0 ? start : 0);
    function onKey(e) {
      const i = buttons.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(i + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(i - 1); }
      else if (e.key === 'Home') { e.preventDefault(); focusAt(0); }
      else if (e.key === 'End') { e.preventDefault(); focusAt(-1); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(); }
    }
    function onDown(e) { if (!menu.contains(e.target) && e.target !== anchor) close(false); }
    function close(restoreFocus = true) {
      menu.remove(); anchor.setAttribute('aria-expanded', 'false');
      document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onDown, true);
      openMenu.current = null; if (restoreFocus) anchor.focus(); if (onClose) onClose();
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    openMenu.current = close;
    return { menu, close };
  }
  function closeOpenMenu() { if (openMenu.current) openMenu.current(false); }

  // ---------- Motion helpers ----------
  const reducedMotion = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // FLIP: measure, change the layout, then animate each element from its old place with transform.
  function flip(elements, mutate, { duration = 200, easing = 'var(--ease-in-out)' } = {}) {
    const before = new Map(elements().map((el) => [el, el.getBoundingClientRect()]));
    mutate();
    if (reducedMotion()) return;
    for (const el of elements()) {
      const a = before.get(el); if (!a) continue;
      const b = el.getBoundingClientRect();
      const dx = a.left - b.left, dy = a.top - b.top;
      if (!dx && !dy) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration, easing: easing.startsWith('var(') ? getComputedStyle(document.documentElement).getPropertyValue(easing.slice(4, -1)).trim() || 'ease-in-out' : easing });
    }
  }

  root.StashUI = { h, svg, icon, kindChip, kindTile, kindLabel, folderTile, summarizeKinds, createToaster, openMenu, closeOpenMenu, flip, reducedMotion };
})(globalThis);
