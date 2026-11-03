// The seven kinds of saved thing. Colour in Stash only ever means kind, and a kind
// always appears with its name. Shared by the popup, library, background and tests.
(function (root) {
  'use strict';

  // Icons use currentColor so CSS decides the colour.
  const ICON_PATHS = {
    read: '<path d="M5 7h14M5 12h14M5 17h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    watch: '<path d="M9 6.5l9 5.5-9 5.5z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    look: '<rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" stroke-width="2"/><path d="M4.5 16.5l5-5 4 4 2-2 4 4" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="15.5" cy="9.5" r="1.5" fill="currentColor"/>',
    listen: '<path d="M4 10v4M8 7v10M12 9v6M16 5v14M20 10v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    use: '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    buy: '<path d="M4 12.5V5h7.5l8.5 8.5-7.5 7.5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="8.5" cy="9" r="1.5" fill="currentColor"/>',
    other: '<path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  };

  const KINDS = [
    { id: 'read', label: 'Read', examples: 'articles, essays, threads' },
    { id: 'watch', label: 'Watch', examples: 'videos, reels, talks' },
    { id: 'look', label: 'Look', examples: 'images, posters, moodboards' },
    { id: 'listen', label: 'Listen', examples: 'podcasts, music, mixes' },
    { id: 'use', label: 'Use', examples: 'tools, docs, repos' },
    { id: 'buy', label: 'Buy', examples: 'products, wishlists' },
    { id: 'other', label: 'Other', examples: 'anything else' },
  ];
  const KIND_IDS = KINDS.map((k) => k.id);
  const kindById = (id) => KINDS.find((k) => k.id === id) || KINDS[KINDS.length - 1];

  // Sites that almost always hold one kind of thing. Subdomains match too.
  const HOSTS = {
    watch: ['youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv', 'tiktok.com', 'loom.com', 'dailymotion.com', 'ted.com'],
    listen: ['spotify.com', 'soundcloud.com', 'podcasts.apple.com', 'music.apple.com', 'bandcamp.com', 'overcast.fm', 'pocketcasts.com', 'mixcloud.com'],
    look: ['pinterest.com', 'pinterest.co.uk', 'are.na', 'dribbble.com', 'behance.net', 'cosmos.so', 'savee.it', 'unsplash.com', 'instagram.com', 'flickr.com', 'artstation.com', 'inspora.design', 'mobbin.com', 'siteinspire.com'],
    buy: ['etsy.com', 'ebay.com', 'ebay.co.uk', 'aliexpress.com', 'ikea.com', 'myshopify.com'],
    use: ['github.com', 'gitlab.com', 'npmjs.com', 'figma.com', 'codepen.io', 'codesandbox.io', 'stackoverflow.com', 'developer.mozilla.org', 'vercel.com', 'coolors.co'],
    read: ['medium.com', 'substack.com', 'wikipedia.org', 'nytimes.com', 'theguardian.com', 'bbc.co.uk', 'news.ycombinator.com', 'dev.to', 'smashingmagazine.com', 'css-tricks.com', 'theverge.com'],
  };
  const ORDER = ['watch', 'listen', 'look', 'buy', 'use', 'read'];

  const hostIs = (host, domain) => host === domain || host.endsWith(`.${domain}`);

  // Best guess at what a page is, from its address alone. People can change it in one tap.
  function detectKind(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return 'other';
    }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.toLowerCase();

    if (/\.(png|jpe?g|gif|webp|avif|svg)$/.test(path)) return 'look';
    if (/\.(mp4|webm|mov)$/.test(path)) return 'watch';
    if (/\.(mp3|m4a|wav|ogg|flac)$/.test(path)) return 'listen';
    if (/\.pdf$/.test(path)) return 'read';

    for (const kind of ORDER) if (HOSTS[kind].some((d) => hostIs(host, d))) return kind;
    if (/(^|\.)amazon\.[a-z.]+$/.test(host)) return 'buy';

    if (/^(docs|developer|developers|api)\./.test(host) || /^\/(docs?|reference|api)(\/|$)/.test(path)) return 'use';
    if (/^(shop|store)\./.test(host) || /\/(products?|shop|item|dp)\//.test(path)) return 'buy';
    if (/\/(watch|videos?)\//.test(path)) return 'watch';
    if (/^blog\./.test(host) || /\/(blog|posts?|articles?|news|essays?|p)\//.test(path)) return 'read';
    return 'other';
  }

  function kindIcon(id, size = 24) {
    const inner = ICON_PATHS[id] || ICON_PATHS.other;
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
  }

  root.StashKinds = { KINDS, KIND_IDS, kindById, detectKind, kindIcon };
})(globalThis);
