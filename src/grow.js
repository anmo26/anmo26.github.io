#!/usr/bin/env node
/**
 * grow.js — turn a folder into a website.
 *
 * Walks a directory tree and writes an index.html into every folder. Where a
 * folder has Finder icon positions recorded in its .DS_Store, the page lays
 * its items out at exactly those coordinates, so the site mirrors however you
 * arranged the icons in Finder. Folders without positions get a plain flow.
 *
 * Usage:  node src/grow.js [directory] [--depth N] [--dry-run] [--title NAME]
 *
 * Inspired by kevin.garden / file.gallery by Kevin N. Chen.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { parseDSStore } from './dsstore.js';
import { imageSize, videoSize } from './imagesize.js';
import { markdown, escapeHtml } from './markdown.js';
import { folderIcon, fileThumb } from './icons.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DEFAULT = path.join(__dirname, '..');

/* ------------------------------------------------------------------ config */

const ALWAYS_IGNORE = ['.git', '.DS_Store', 'index.html', '.gardenignore',
                       'node_modules', 'garden-assets', 'src', '*.sh',
                       'garden.config.json', '.nojekyll', '.gitignore',
                       '.garden-cache'];

const EXT = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg', '.bmp'],
  video: ['.mp4', '.mov', '.webm', '.m4v', '.ogv'],
  audio: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.aiff'],
  markdown: ['.md', '.markdown', '.mdown'],
  text: ['.txt', '.text', '.log', '.csv', '.tsv', '.json', '.js', '.mjs', '.jsx', '.ts',
         '.tsx', '.py', '.sh', '.zsh', '.bash', '.css', '.yml', '.yaml', '.toml', '.ini',
         '.rb', '.go', '.rs', '.c', '.h', '.cpp', '.java', '.sql', '.r', '.ejs', '.conf'],
};

const TOP_PADDING = 50;            // px of breathing room above the topmost item
// Writing is the point of this site, so markdown gets a generous budget.
// Plain text and source files stay modest so a stray log can't flood a page.
const INLINE_LIMIT = { markdown: 200000, text: 20000, raw: 4096 };
const ROOT_FONT_PX = 14;

// Drawn size of a folder icon. The PNG is written at 2x this for retina.
const ICON_PX = 96;
const MAX_MEDIA_PX = 24 * ROOT_FONT_PX;  // matches `max-width/height: 24em`

// Below this width the freeform positions are dropped and items simply stack.
// A phone cannot usefully pan around a 900px-wide scatter.
const FREEFORM_MIN_WIDTH = 700;

/* ------------------------------------------------------------------- utils */

function prettyBytes(n) {
  if (n < 1000) return `${n}B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let u = -1, v = n;
  do { v /= 1000; u++; } while (v >= 1000 && u < units.length - 1);
  return `${v.toFixed(v < 10 ? 2 : 1).replace(/\.?0+$/, '')}${units[u]}`;
}

function classify(name) {
  const ext = path.extname(name).toLowerCase();
  for (const [type, list] of Object.entries(EXT)) if (list.includes(ext)) return type;
  if (ext === '') return 'raw';   // CNAME, LICENSE, Makefile ...
  return 'other';
}

/** Very small glob matcher: supports `*`, `?` and a trailing `/` for dirs. */
function globToRegExp(pattern) {
  const body = pattern.replace(/\/$/, '')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${body}$`);
}

export function loadConfig(configPath) {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Builds the include/exclude rules for a site.
 *
 * `deny` wins over `allow`. If an `allow` list is present, a file must match
 * something in it to be shown at all — that's the "selectively choose what to
 * put in" mode. Directories are always allowed through so the walker can
 * descend into them; their contents are filtered on their own merits.
 */
function loadRules(root, config) {
  const deny = [...ALWAYS_IGNORE, ...(config.exclude ?? [])];
  try {
    for (const line of fs.readFileSync(path.join(root, '.gardenignore'), 'utf8').split('\n')) {
      const t = line.trim();
      if (t && !t.startsWith('#')) deny.push(t);
    }
  } catch { /* no .gardenignore, that's fine */ }

  const compile = (p) => ({ re: globToRegExp(p), dirOnly: p.endsWith('/') });
  return {
    deny: deny.map(compile),
    allow: config.include?.length ? config.include.map(compile) : null,
  };
}

function isIgnored(name, isDir, rules) {
  if (rules.deny.some(r => (!r.dirOnly || isDir) && r.re.test(name))) return true;
  if (rules.allow && !isDir && !rules.allow.some(r => r.re.test(name))) return true;
  return false;
}

function countItems(dir, rules) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => !isIgnored(d.name, d.isDirectory(), rules)).length;
  } catch { return 0; }
}

/* ------------------------------------------------------- describing a file */

/**
 * The box an icon is drawn in. Finder scales a thumbnail down to fit the
 * icon square and never crops it, so a landscape photo ends up short and
 * wide -- hence carrying the drawn size around rather than assuming a square.
 */
function iconBox(thumb) {
  if (!thumb) return { iconOnly: true, icon: null };
  const scale = ICON_PX / Math.max(thumb.w, thumb.h);
  return { iconOnly: true, icon: thumb.href,
           iconW: Math.round(thumb.w * scale), iconH: Math.round(thumb.h * scale) };
}

function describe(dir, entry, rules, root, isRoot) {
  const name = entry.name;
  const full = path.join(dir, name);
  const href = encodeURI(name + (entry.isDirectory() ? '/' : ''));

  if (entry.isDirectory()) {
    const n = countItems(full, rules);
    // The icon macOS itself draws for this folder, so a custom one or a tag
    // colour carries through. null off a Mac -- the name stands alone then.
    return { name: name + '/', href, type: 'directory', iconOnly: true,
             icon: folderIcon(full, root),
             contents: `${n} item${n === 1 ? '' : 's'}` };
  }

  const stat = fs.statSync(full);
  const type = classify(name);
  const file = { name, href, type, size: prettyBytes(stat.size), bytes: stat.size };

  // The front page is the desk: whatever is lying on it is shown lying on it.
  // Inside a folder the site is a Finder window instead, so nothing is opened
  // for you -- every item is an icon you click, and the thumbnail is the one
  // QuickLook draws, so a photo still looks like that photo.
  if (!isRoot) return { ...file, ...iconBox(fileThumb(full, root)) };

  if (type === 'image' || type === 'video') {
    const d = (type === 'image' ? imageSize(full) : videoSize(full)) ??
              (type === 'video' ? { width: 480, height: 270 } : null);
    if (!d) return { ...file, type: 'other' };
    const scale = Math.min(1, MAX_MEDIA_PX / d.width, MAX_MEDIA_PX / d.height);
    return { ...file, width: d.width, height: d.height,
             drawnHeight: Math.round(d.height * scale) };
  }

  if (type === 'markdown' || type === 'text' || type === 'raw') {
    if (stat.size > INLINE_LIMIT[type]) return { ...file, type: 'other' };
    let body = '';
    try { body = fs.readFileSync(full, 'utf8'); } catch { return { ...file, type: 'other' }; }
    if (body.includes('\u0000')) return { ...file, type: 'other' };  // binary
    return { ...file, contents: body.replace(/\s+$/, ''), lines: body.split('\n').length };
  }

  return file;
}

/** Rough rendered height, used only to give the page something to scroll to. */
function estimateHeight(file) {
  const head = 26;                     // the filename line

  // An icon item is Finder's stack: the picture, then the name wrapped under
  // it in a column one icon wide. Long names take more than one line, and a
  // folder adds its item count on a line of its own.
  if (file.iconOnly) {
    const lines = Math.max(1, Math.ceil(file.name.length / 15)) +
                  (file.contents || file.size ? 1 : 0);
    return (file.icon ? (file.iconH ?? ICON_PX) + 8 : 0) + lines * 18 + 12;
  }

  switch (file.type) {
    case 'image':
    case 'video': return head + (file.drawnHeight ?? 200) + 6;
    case 'audio': return head + 48;
    case 'markdown':
    case 'text':
    case 'raw': return head + (file.lines ?? 1) * 17 + 16;
    default: return head;
  }
}

/* ----------------------------------------------------------------- the page */

function renderBody(f) {
  switch (f.type) {
    // A folder is one line: its name and how much is inside. The point is
    // that it reads like a row in a Finder window, not a card.
    case 'directory': return '';
    case 'image':
      return `<a href="${f.href}"><img src="${f.href}" alt="${escapeHtml(f.name)}" ` +
             `width="${f.width}" height="${f.height}" loading="lazy"></a>`;
    case 'video':
      return `<video width="${f.width}" height="${f.height}" controls preload="metadata">` +
             `<source src="${f.href}"></video>`;
    case 'audio':
      return `<audio controls preload="none"><source src="${f.href}"></audio>`;
    case 'markdown':
      return `<div class="md">${markdown(f.contents)}</div>`;
    case 'text':
    case 'raw':
      return `<pre>${escapeHtml(f.contents)}</pre>`;
    default:
      return `<a href="${f.href}">download</a>`;
  }
}

/**
 * One item: the filename, clickable through to the real file, what it
 * weighs, and then the thing itself. No frame around it -- the page is the
 * folder, and the items are lying on it.
 */
function renderItem(f, i, assetPrefix = '') {
  const meta = f.type === 'directory' ? f.contents : (f.size ?? '');
  const body = renderBody(f);

  // The icon and the name are one link, because in Finder they are one thing.
  const icon = f.icon
    ? `<a class="icon" href="${f.href}" tabindex="-1" aria-hidden="true">` +
      `<img src="${assetPrefix}${f.icon}" alt="" width="${ICON_PX}" height="${ICON_PX}"></a>\n        `
    : '';

  return `      <div class="item kind-${f.type}" id="p${i}" data-key="${escapeHtml(f.name)}">
        ${icon}<h3><a href="${f.href}">${escapeHtml(f.name)}</a>` +
          (meta ? ` <span class="meta">(${escapeHtml(meta)})</span>` : '') + `</h3>` +
          (body ? `\n        ${body}` : '') + `
      </div>`;
}


/* -------------------------------------------------------------------- music
   The music/ folder is the playlist list: one text file per playlist, each
   holding a Spotify link (see music/README.txt). No audio is ever hosted --
   playback happens inside Spotify's own embed, so nothing here is a copy.
   ------------------------------------------------------------------------ */

const MUSIC_EXT = ['.txt', '.md', '.markdown', '.mdown'];
const COVER_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'];
const SPOTIFY_KINDS = ['playlist', 'album', 'track', 'artist', 'episode', 'show'];

/** Pulls {kind, id} out of a Spotify URL, a spotify: URI, or a bare id. */
function parseSpotify(raw) {
  const str = String(raw ?? '').trim();
  if (!str) return null;

  const uri = str.match(/^spotify:([a-z]+):([A-Za-z0-9]+)/i);
  if (uri && SPOTIFY_KINDS.includes(uri[1].toLowerCase())) {
    return { kind: uri[1].toLowerCase(), id: uri[2] };
  }
  const url = str.match(/open\.spotify\.com\/(?:embed\/)?(?:intl-[a-z-]+\/)?([a-z]+)\/([A-Za-z0-9]+)/i);
  if (url && SPOTIFY_KINDS.includes(url[1].toLowerCase())) {
    return { kind: url[1].toLowerCase(), id: url[2] };
  }
  if (/^[A-Za-z0-9]{16,30}$/.test(str)) return { kind: 'playlist', id: str };
  return null;
}

const slug = (str) => String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Reads music/ into the list the player expects. Returns [] when the folder
 * isn't there, which is the signal not to draw the player at all. Covers come
 * back relative to the site root, e.g. "music/covers/x.jpg".
 */
function readMusic(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const base = path.basename(dir);

  // Index covers/ once so a cover can be matched by name alone.
  const covers = new Map();
  try {
    for (const c of fs.readdirSync(path.join(dir, 'covers'))) {
      const ext = path.extname(c).toLowerCase();
      if (COVER_EXT.includes(ext)) covers.set(slug(path.basename(c, ext)), `covers/${c}`);
    }
  } catch { /* no covers/, which is fine */ }

  const musicFiles = entries
    .filter(e => e.isFile() &&
                 MUSIC_EXT.includes(path.extname(e.name).toLowerCase()) &&
                 !e.name.startsWith('.') &&
                 !/^readme\b/i.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));

  const out = [];
  for (const e of musicFiles) {
    let body;
    try { body = fs.readFileSync(path.join(dir, e.name), 'utf8'); } catch { continue; }

    // Liberal parse: "key: value" lines, plus any bare URL / URI / id line.
    const fields = {};
    const loose = [];
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      if (/^spotify:[a-z]+:/i.test(line)) { loose.push(line); continue; }
      const kv = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(\S.*)$/);
      if (kv && !/^https?$/i.test(kv[1])) { fields[kv[1].toLowerCase()] = kv[2].trim(); continue; }
      loose.push(line);
    }

    const found = [fields.spotify, fields.url, fields.link, fields.playlist,
                   fields.album, fields.track, ...loose]
      .map(v => parseSpotify(v)).find(Boolean);
    if (!found) continue;

    const stem = path.basename(e.name, path.extname(e.name));
    const name = stem.replace(/^\d{1,3}[\s._)-]+\s*/, '').trim() || stem;

    const rel = (fields.cover || covers.get(slug(name)) || covers.get(slug(stem)) || '')
      .replace(/^\.\//, '');

    out.push({
      name,
      file: e.name,
      kind: found.kind,
      id: found.id,
      embed: `https://open.spotify.com/embed/${found.kind}/${found.id}?utm_source=generator`,
      link: `https://open.spotify.com/${found.kind}/${found.id}`,
      cover: rel ? encodeURI(`${base}/${rel}`) : null,
      note: fields.note || fields.caption || '',
    });
  }
  return out;
}

function musicWindow(music) {
  const n = music.length;
  return `      <div class="item kind-ipod" id="music" data-key="__music">
        <h3>music <span class="meta">(${n} playlist${n === 1 ? '' : 's'})</span></h3>
          <div class="ipod" id="ipod" role="group" aria-label="iPod music player"
               data-view="list" data-player="off">

            <div class="ipod-screen">
              <div class="ipod-bar">
                <button class="ipod-back" type="button"
                        aria-label="menu, back to the playlist list">&#8249; menu</button>
                <span class="ipod-bar-title" aria-live="polite">playlists</span>
                <span class="ipod-battery" aria-hidden="true"></span>
              </div>

              <div class="ipod-view ipod-view-list">
                <div class="ipod-list" role="listbox" tabindex="0" aria-label="playlists"></div>
              </div>

              <div class="ipod-view ipod-view-player">
                <div class="ipod-stage"></div>
                <div class="ipod-paused">
                  <strong class="ipod-paused-name">paused</strong>
                  <span>press &#9654;&#10073;&#10073; to start it again</span>
                </div>
              </div>

              <div class="ipod-view ipod-view-empty">
                <div class="ipod-empty">
                  <strong>no music yet</strong>
                  <span>put a Spotify link in a text file in <code>music/</code> and regrow.</span>
                </div>
              </div>
            </div>

            <p class="ipod-ticker" aria-live="polite"></p>

            <div class="ipod-wheel">
              <button class="ipod-btn ipod-btn-menu" type="button" data-act="menu"
                      aria-label="menu, back to the playlist list">menu</button>
              <button class="ipod-btn ipod-btn-prev" type="button" data-act="prev"
                      aria-label="previous playlist">&#8249;&#8249;</button>
              <button class="ipod-btn ipod-btn-next" type="button" data-act="next"
                      aria-label="next playlist">&#8250;&#8250;</button>
              <button class="ipod-btn ipod-btn-play" type="button" data-act="play"
                      aria-label="play or pause">&#9654;&#10073;&#10073;</button>
              <button class="ipod-btn ipod-btn-select" type="button" data-act="select"
                      aria-label="select, play the highlighted playlist"></button>
            </div>

            <p class="ipod-noscript">this player needs JavaScript.</p>
          </div>
      </div>`;
}

function guestbookWindow() {
  return `      <div class="win kind-guestbook" data-key="__guestbook" id="guestbook">
        <div class="win-bar">
          <span class="win-title">leave a note</span>
          <span class="win-meta">guestbook</span>
          <button class="win-btn js-collapse" type="button" title="roll up">_</button>
        </div>
        <div class="win-body">
          <form class="gb-form" id="gb-form">
            <input name="name" type="text" maxlength="40" placeholder="your name (optional)" autocomplete="off">
            <textarea name="body" maxlength="800" placeholder="say something. drag your note anywhere." required></textarea>
            <button type="submit">post it</button>
          </form>
          <p class="gb-status" id="gb-status"></p>
        </div>
      </div>`;
}

function renderPage({ siteName, title, files, positioned, description, socialImage,
                      assetPrefix, isRoot, tagline, marquee, guestbook, music }) {
  const items = files.map((f, i) => renderItem(f, i, assetPrefix)).join('\n');

  // A guestbook needs a server to hold visitor notes, which GitHub Pages
  // cannot do. Off until there is a backend; flip "enabled" in the config.
  const showGuestbook = isRoot && guestbook && guestbook.enabled === true;

  // Covers are stored relative to the site root; a subpage needs the prefix.
  const musicData = (music ?? []).map(t =>
    t.cover ? { ...t, cover: assetPrefix + t.cover } : t);
  const showMusic = isRoot && musicData.length > 0;

  // Freeform positions live in a media query so phones get the plain stack
  // defined in the base stylesheet and wide screens get the Finder layout.
  let freeform = '';

  if (!positioned && files.length) {
    // Deterministic scatter: same names always land in the same places, so
    // the page doesn't reshuffle on every rebuild.
    let hash = (str) => {
      let h = 2166136261;
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
      return (h >>> 0) / 4294967295;
    };
    let y = 0;
    const laid = files.map((f, i) => {
      const x = Math.round(hash(f.name) * 620);
      const row = Math.floor(i / 3);
      const jitter = Math.round(hash(f.name + '#y') * 90);
      return { i, x, y: row * 300 + jitter };
    });
    const maxY = Math.max(...laid.map(l => l.y + 260));
    const rules = laid.map(l =>
      `      #p${l.i} { top: ${l.y}px; left: ${l.x}px; }`).join('\n');

    // The player has no icon in .DS_Store to inherit a spot from, so it sits
    // below the scatter -- pushing it off to the right would put it past the
    // window edge, and the body clips horizontally.
    const musicRule = showMusic ? `\n      #music { top: ${maxY}px; left: 0px; }` : '';
    const bedHeight = showMusic ? maxY + 560 : maxY;

    freeform = `
    @media (min-width: 560px) {
      .plantbed { min-height: ${bedHeight}px; max-width: 68rem; margin: 0 auto; }
${rules}${musicRule}
    }`;
  }

  if (positioned) {
    const xs = files.map(f => f.x);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...files.map(f => f.y));
    const halfWidth = Math.round((maxX - minX) / 2);
    const height = Math.round(
      Math.max(...files.map(f => f.y - minY + TOP_PADDING + estimateHeight(f)))) + 40;

    const rules = files.map((f, i) =>
      `      #p${i} { top: ${f.y - minY + TOP_PADDING}px; left: ${f.x - minX}px; }`).join('\n');

    // The player has no icon in .DS_Store to inherit a spot from, so it sits
    // below the arrangement -- pushing it off to the right would put it past
    // the window edge, and the body clips horizontally.
    const musicRule = showMusic ? `\n      #music { top: ${height}px; left: 0px; }` : '';
    const bedHeight = showMusic ? height + 560 : height;

    freeform = `
    @media (min-width: 560px) {
      .plantbed { min-height: ${bedHeight}px; margin-left: max(0px, calc(50% - ${halfWidth}px - 13rem)); }
${rules}${musicRule}
    }`;
  }

  const head = isRoot
    ? `    <header class="masthead">
      <h1>${escapeHtml(siteName)}</h1>
      <p>${escapeHtml(tagline || description || '')}</p>
      <div class="rule"></div>
    </header>
    <div class="marquee"><span>${escapeHtml(marquee)}</span></div>
`
    : `    <header class="masthead">
      <h1>${escapeHtml(title.replace(/\/$/, ''))}</h1>
      <p><a href="..">&larr; back to ${escapeHtml(siteName)}</a></p>
      <div class="rule"></div>
    </header>
`;

  const pageTitle = `${escapeHtml(siteName)}${title ? '/' + escapeHtml(title) : ''}`;
  const desc = escapeHtml(description || `${siteName} is a site grown from a folder.`);
  const og = socialImage
    ? `\n  <meta property="og:image" content="${escapeHtml(socialImage)}">` +
      `\n  <meta name="twitter:card" content="summary_large_image">`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<!-- generated by src/grow.js — do not edit; rerun the generator instead -->
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <meta name="description" content="${desc}">
  <meta property="og:title" content="${pageTitle}">
  <meta property="og:description" content="${desc}">
  <meta property="og:type" content="website">${og}
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ctext y='13' font-size='13'%3E%F0%9F%8C%B1%3C/text%3E%3C/svg%3E">
  <link rel="stylesheet" href="${assetPrefix}garden-assets/style.css">
${showMusic ? `  <link rel="stylesheet" href="${assetPrefix}garden-assets/ipod.css">\n` : ''}\
  <style>${freeform}
  </style>
</head>

<body>
  <div id="clock-shell" title="click to change format">
    <pre id="clock"></pre>
    <p id="clock-date"></p>
  </div>

  <main>
${head}
    <div class="plantbed${positioned ? ' freeform' : ' scattered'}">
${items}${showMusic ? '\n' + musicWindow(musicData) : ''}
    </div>
${showGuestbook ? `
    <section class="guestbed" id="gb-notes">
      <div class="gb-header">
        <h2>guestbook</h2>
        <p>leave a note. drag it wherever you like. it stays where you put it.</p>
      </div>
${guestbookWindow()}
    </section>` : ''}
  </main>

  <nav class="taskbar">
    <span class="start">${escapeHtml(siteName)}</span>
    <span id="taskbar-toggles" style="display:contents"></span>
    <span class="spacer"></span>
    <span class="clock" id="taskbar-clock">drag things around &rarr;</span>
  </nav>

  <script>window.GARDEN_CONFIG = ${JSON.stringify({ siteName, guestbook })};</script>
  <script src="${assetPrefix}garden-assets/app.js"></script>
${showMusic ? `  <script>window.GARDEN_MUSIC = ${JSON.stringify(musicData).replace(/</g, '\\u003c')};</script>
  <script src="${assetPrefix}garden-assets/ipod.js"></script>\n` : ''}\
</body>
<!--
a file.gallery in the spirit of kevin.garden by Kevin N. Chen (CC BY-NC 4.0)
https://kevin.garden
-->
</html>
`;
}

/* ------------------------------------------------------------------- walker */

function grow(dir, ctx) {
  const { root, rules, depth, maxDepth, dryRun, written } = ctx;

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (!ctx.quiet) console.warn(`  ! cannot read ${dir}: ${e.message}`);
    return;
  }

  entries = entries
    .filter(e => e.isDirectory() || e.isFile())
    .filter(e => !isIgnored(e.name, e.isDirectory(), rules))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));

  const positions = parseDSStore(path.join(dir, '.DS_Store'));

  const files = entries.map(e => {
    const f = describe(dir, e, rules, ctx.root);
    const loc = positions[e.name]?.Iloc;
    if (loc) { f.x = loc.x; f.y = loc.y; }
    return f;
  });

  // A folder is laid out freeform only if Finder gave us positions for most of
  // it; anything unpositioned gets tucked into a column off to the right.
  const withPos = files.filter(f => f.x !== undefined);
  const positioned = withPos.length > 0 && withPos.length >= files.length / 2;

  if (positioned) {
    const maxX = Math.max(...withPos.map(f => f.x));
    const minY = Math.min(...withPos.map(f => f.y));
    let stack = 0;
    for (const f of files) {
      if (f.x === undefined) { f.x = maxX + 280; f.y = minY + stack; stack += 40; }
    }
  }

  const rel = path.relative(root, dir);
  const firstImage = files.find(f => f.type === 'image');
  const depthFromRoot = rel ? rel.split(path.sep).length : 0;

  const html = renderPage({
    siteName: ctx.siteName,
    title: rel ? rel + '/' : null,
    files,
    positioned,
    description: ctx.description,
    socialImage: rel ? null : firstImage?.href,
    assetPrefix: '../'.repeat(depthFromRoot),
    isRoot: depthFromRoot === 0,
    tagline: ctx.tagline,
    marquee: ctx.marquee,
    guestbook: ctx.guestbook,
    music: ctx.music,
  });

  const out = path.join(dir, 'index.html');
  const label = `${path.relative(root, out) || 'index.html'}  ` +
                `(${files.length} items, ${positioned ? 'freeform' : 'flow'})`;

  if (dryRun) {
    if (!ctx.quiet) console.log(`  would write ${label}`);
  } else {
    // Only touch the disk when the page actually changed, so the file watcher
    // doesn't retrigger itself and git stays quiet on no-op rebuilds.
    let previous = null;
    try { previous = fs.readFileSync(out, 'utf8'); } catch { /* new page */ }
    if (previous !== html) {
      fs.writeFileSync(out, html);
      if (!ctx.quiet) console.log(`  ${label}`);
      ctx.written.changed = (ctx.written.changed ?? 0) + 1;
    }
  }
  written.count++;

  if (depth < maxDepth) {
    for (const e of entries) {
      if (e.isDirectory()) grow(path.join(dir, e.name), { ...ctx, depth: depth + 1 });
    }
  }
}

/* ------------------------------------------------------------------ assets */

/**
 * Copies the stylesheet and script into <root>/garden-assets/ so the site is
 * self-contained and can be pushed anywhere. Only writes on change, to keep
 * the file watcher from chasing its own tail.
 */
function copyAssets(root) {
  const from = path.join(__dirname, 'assets');
  const to = path.join(root, 'garden-assets');
  fs.mkdirSync(to, { recursive: true });

  for (const name of fs.readdirSync(from)) {
    const src = fs.readFileSync(path.join(from, name));
    const dst = path.join(to, name);
    let current = null;
    try { current = fs.readFileSync(dst); } catch { /* new file */ }
    if (!current || !current.equals(src)) fs.writeFileSync(dst, src);
  }
}

/* -------------------------------------------------------------- entry point */

export function growSite(opts = {}) {
  const configPath = opts.config ?? path.join(ROOT_DEFAULT, 'garden.config.json');
  const config = loadConfig(configPath);

  const root = path.resolve(
    opts.root ?? config.source ?? ROOT_DEFAULT
  ).replace(/^~/, process.env.HOME ?? '~');

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`not a directory: ${root}`);
  }

  copyAssets(root);

  const ctx = {
    root,
    rules: loadRules(root, config),
    tagline: config.tagline,
    marquee: config.marquee ??
      'welcome to my garden  *  drag things around  *  everything here is a real file  *  best viewed with curiosity  *',
    siteName: opts.title ?? config.title ?? path.basename(root),
    description: config.description,

    // Handed straight to window.GARDEN_CONFIG. The guestbook stays hidden
    // until it is { "enabled": true, "mode": "remote", "url": "https://..." }
    // pointing at a real backend -- GitHub Pages cannot store visitor notes.
    guestbook: config.guestbook,

    // One text file per playlist in music/; the player is drawn from these.
    music: readMusic(path.join(root, 'music')),
    depth: 0,
    maxDepth: opts.depth ?? config.depth ?? 3,
    dryRun: opts.dryRun ?? false,
    quiet: opts.quiet ?? false,
    written: { count: 0 },
  };

  grow(root, ctx);
  return {
    root,
    pages: ctx.written.count,
    changed: ctx.written.changed ?? 0,
    siteName: ctx.siteName,
  };
}

/* ---------------------------------------------------------------------- cli */

const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const argv = process.argv.slice(2);
  const VALUE_FLAGS = ['--depth', '--title', '--config'];
  const flag = (name, fallback) => {
    const i = argv.indexOf(name);
    return i === -1 ? fallback : argv[i + 1];
  };
  const positional = argv.filter((a, i) =>
    !a.startsWith('--') && !(i > 0 && VALUE_FLAGS.includes(argv[i - 1])));

  const depthArg = flag('--depth', null);

  try {
    const opts = {
      root: positional[0],
      config: flag('--config', undefined),
      title: flag('--title', undefined),
      depth: depthArg === null ? undefined : parseInt(depthArg, 10),
      dryRun: argv.includes('--dry-run'),
    };
    console.log('growing...');
    const { root, pages, changed, siteName } = growSite(opts);
    console.log(`grew ${siteName} from ${root}`);
    console.log(opts.dryRun
      ? `would write ${pages} page${pages === 1 ? '' : 's'}`
      : `${pages} page${pages === 1 ? '' : 's'} visited, ${changed} written`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
