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
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

import { parseDSStore } from './dsstore.js';
import { liveSnapshot, positionsFor } from './finder.js';
import { imageSize, videoSize } from './imagesize.js';
import { markdown, escapeHtml } from './markdown.js';
import { folderIcon, fileThumb, webPreview, beginIconRun, sweepIcons } from './icons.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DEFAULT = path.join(__dirname, '..');

/* ------------------------------------------------------------------ config */

const ALWAYS_IGNORE = ['.git', '.DS_Store', 'index.html', '.gardenignore',
                       'node_modules', 'garden-assets', 'src', '*.sh',
                       'garden.config.json', '.nojekyll', '.gitignore',
                       '.garden-cache', '.thumbs', '.originals', '.garden',
                       '.epubs'];

// The one dotfile that is content rather than clutter. .garden.log is the
// site's own running feed -- it regrew, it pushed, it published -- and it is
// deliberately shown in the right-hand margin. The hide-every-dotfile rule
// below is right in general and would have swallowed it, so it is named back
// in here rather than via the config `include` list: that list turns into an
// exclusive whitelist for the whole site the moment it is non-empty.
const ALWAYS_SHOW = ['.garden.log'];

const EXT = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg', '.bmp'],
  video: ['.mp4', '.mov', '.webm', '.m4v', '.ogv'],
  audio: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.aiff'],
  markdown: ['.md', '.markdown', '.mdown'],
  text: ['.txt', '.text', '.log', '.csv', '.tsv', '.json', '.js', '.mjs', '.jsx', '.ts',
         '.tsx', '.py', '.sh', '.zsh', '.bash', '.css', '.yml', '.yaml', '.toml', '.ini',
         '.rb', '.go', '.rs', '.c', '.h', '.cpp', '.java', '.sql', '.r', '.ejs', '.conf'],
};

// Pictures a browser will not draw. macOS writes HEIC by default, so these
// arrive constantly from an iPhone; each gets a web-safe copy made for it.
const NEEDS_PREVIEW = ['.heic', '.heif', '.tif', '.tiff'];

// Some "files" are directories on disk -- an unzipped .epub is a folder full
// of HTML, images and metadata that happens to carry a document's extension.
// Walked normally it produces a page per internal folder, which is not a book,
// it's the book's guts spread across the site. These are treated as a single
// item instead: never walked into, packed back into one real file to link to.
const BUNDLE_EXT = ['.epub'];
const EPUB_CACHE = '.epubs';

// The plain-text convention for a folder's description (see readFolderDescription
// below): any of these names, any case, dropped inside a folder in Finder.
const DESCRIPTION_RE = /^description\.(txt|md|markdown|mdown)$/i;

// Anything wider than this gets a smaller copy made for it. The page shows
// that copy and links to the full file, so a 4000px photo does not have to
// come down the wire just to be looked at at 400px.
const THUMB_MAX_PX = 1600;
const THUMBS = '.thumbs';

const TOP_PADDING = 50;            // px of breathing room above the topmost item
// Writing is the point of this site, so markdown gets a generous budget.
// Plain text and source files stay modest so a stray log can't flood a page.
const INLINE_LIMIT = { markdown: 200000, text: 20000, raw: 4096 };

// A log is read from the bottom. Showing the whole of one would push the
// rest of the page off the screen and grow without limit.
const LOG_TAIL_LINES = 20;
const ROOT_FONT_PX = 14;

// Drawn size of a folder icon. The PNG is written at 2x this for retina.
// Finder's icon grid is 112px, so anything near that wide crowds its
// neighbours; 72 leaves the name room and the slot some air.
const ICON_PX = 72;
// The front page lays pictures out in the open, but Finder positions them on
// that same 112px grid -- a photo drawn three slots wide lands on whatever
// was placed beside it. Wide enough to look at, narrow enough to sit still.
const MAX_MEDIA_PX = 17 * ROOT_FONT_PX;

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
  const allowed = rules.allow ? rules.allow.some(r => r.re.test(name)) : false;

  // A description.txt (or .md) is meta about the folder it sits in, not
  // content of its own -- it never appears as an item, on this folder's page
  // or anyone else's. See readFolderDescription.
  if (!isDir && DESCRIPTION_RE.test(name)) return true;

  if (rules.deny.some(r => (!r.dirOnly || isDir) && r.re.test(name))) return true;

  // Finder hides everything beginning with a dot, and this site is supposed to
  // be the folder exactly as Finder shows it -- so a name the owner cannot see
  // in Finder is a name he cannot delete from Finder either. Naming them one
  // at a time was the hole: .Rhistory was never on the list, so an empty R
  // console file sat on the front page with nothing he could do about it, and
  // the next stray dotfile would have done the same. Some of what lands in a
  // folder unasked (.env, credentials, editor droppings) should never be
  // published at all, which makes this the safe default rather than a tidy-up.
  if (name.charAt(0) === '.' && !allowed && !ALWAYS_SHOW.includes(name)) return true;

  if (rules.allow && !isDir && !allowed) return true;
  return false;
}

/**
 * A symlink's own Dirent says neither isDirectory() nor isFile() -- that
 * describes the link, not what it points at -- so every reader downstream
 * treated a symlink as neither and dropped it without a word. A file dragged
 * in as an alias is still a file the owner put in the folder; it belongs on
 * the site exactly like a real one. Resolved here, once, into a plain object
 * every caller already knows how to read (same .name/.isDirectory()/.isFile()
 * shape as a real Dirent). A link that points at nothing (moved or deleted
 * target) resolves to nothing and is the one honest case left to drop --
 * there is no file behind it to show.
 */
function resolveEntries(dir, entries) {
  return entries.map(e => {
    if (!e.isSymbolicLink()) return e;
    try {
      const st = fs.statSync(path.join(dir, e.name));
      if (!st.isDirectory() && !st.isFile()) return null;
      const isDir = st.isDirectory();
      return { name: e.name, isDirectory: () => isDir, isFile: () => !isDir };
    } catch {
      return null;   // broken alias -- points at nothing
    }
  }).filter(Boolean);
}

/**
 * How much a folder actually holds, counted all the way down. Finder puts a
 * size on a folder and so should the page -- "4 items" tells you nothing
 * about whether opening it costs a megabyte or a gigabyte.
 *
 * Walks with the same rules the site is built with, so what is reported is
 * what a visitor could actually reach.
 */
function folderBytes(dir, rules, depth = 0) {
  if (depth > 12) return 0;            // a symlink loop should not hang a build
  let total = 0;

  let entries = [];
  try { entries = resolveEntries(dir, fs.readdirSync(dir, { withFileTypes: true })); } catch { return 0; }

  for (const e of entries) {
    if (isIgnored(e.name, e.isDirectory(), rules)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) total += folderBytes(full, rules, depth + 1);
    else if (e.isFile()) {
      try { total += fs.statSync(full).size; } catch { /* vanished mid-build */ }
    }
  }

  return total;
}

function countItems(dir, rules) {
  try {
    return resolveEntries(dir, fs.readdirSync(dir, { withFileTypes: true }))
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
  const ext = path.extname(name).toLowerCase();

  if (entry.isDirectory() && BUNDLE_EXT.includes(ext)) {
    // A book, not a folder: see the BUNDLE_EXT comment above. Counted like a
    // file (its whole weight, walked once) and never descended into.
    const packed = packBundle(full, root, ext);
    // packBundle hands back a path from the site root (like a thumbnail
    // does); every other href on a page is relative to that page's own
    // folder, so it has to be re-based the same way before it can be used.
    const href = encodeURI(packed
      ? path.relative(dir, path.join(root, packed)).split(path.sep).join('/')
      : name + '/');
    const bytes = folderBytes(full, rules);
    const file = { name, href, type: 'book', size: prettyBytes(bytes), bytes };
    return isRoot ? file : { ...file, ...iconBox(fileThumb(full, root)) };
  }

  const href = encodeURI(name + (entry.isDirectory() ? '/' : ''));

  if (entry.isDirectory()) {
    const n = countItems(full, rules);
    // The icon macOS itself draws for this folder, so a custom one or a tag
    // colour carries through. null off a Mac -- the name stands alone then.
    const bytes = folderBytes(full, rules);
    return { name: name + '/', href, type: 'directory', iconOnly: true,
             icon: folderIcon(full, root),
             contents: `${n} item${n === 1 ? '' : 's'}` +
                       (bytes ? `, ${prettyBytes(bytes)}` : '') };
  }

  const stat = fs.statSync(full);
  const type = classify(name);
  const file = { name, href, type, size: prettyBytes(stat.size), bytes: stat.size };

  // A Finder clipping: dragging a text selection out of an app writes one of
  // these. The text inside is not stored as text -- it's a field in a binary
  // property list -- so reading it takes decoding rather than a plain read.
  // Shown as a snippet next to the size, the same place every other item's
  // size sits, rather than as a body: everything inside a folder is an icon
  // here, and a clipping is no exception.
  if (ext === '.textclipping') {
    const text = textClippingText(full);
    const snippet = text && text.length > 200 ? text.slice(0, 200).trim() + '…' : text;
    const clip = snippet ? { ...file, type: 'clipping', contents: snippet } : { ...file, type: 'other' };
    return isRoot ? clip : { ...clip, ...iconBox(fileThumb(full, root)) };
  }

  // The front page is the desk: whatever is lying on it is shown lying on it.
  // Inside a folder the site is a Finder window instead, so nothing is opened
  // for you -- every item is an icon you click, and the thumbnail is the one
  // QuickLook draws, so a photo still looks like that photo.
  if (!isRoot) return { ...file, ...iconBox(fileThumb(full, root)) };

  // A HEIC is a photograph the front page should simply show, but no browser
  // will render one. Stand a converted copy in its place; the name still
  // links to the file that is actually in the folder.
  if (NEEDS_PREVIEW.includes(path.extname(name).toLowerCase())) {
    const p = webPreview(full, root);
    if (!p) return { ...file, type: 'other' };
    const scale = Math.min(1, MAX_MEDIA_PX / p.w, MAX_MEDIA_PX / p.h);
    return { ...file, type: 'image', previewHref: p.href,
             width: p.w, height: p.h, drawnHeight: Math.round(p.h * scale) };
  }

  if (type === 'image' || type === 'video') {
    const d = (type === 'image' ? imageSize(full) : videoSize(full)) ??
              (type === 'video' ? { width: 480, height: 270 } : null);
    if (!d) return { ...file, type: 'other' };
    const scale = Math.min(1, MAX_MEDIA_PX / d.width, MAX_MEDIA_PX / d.height);
    return { ...file, width: d.width, height: d.height,
             thumbHref: type === 'image' ? thumbFor(full, root, d.width) : null,
             drawnHeight: Math.round(d.height * scale) };
  }

  if (type === 'markdown' || type === 'text' || type === 'raw') {
    if (stat.size > INLINE_LIMIT[type]) return { ...file, type: 'other' };
    let body = '';
    try { body = fs.readFileSync(full, 'utf8'); } catch { return { ...file, type: 'other' }; }
    if (body.includes('\u0000')) return { ...file, type: 'other' };  // binary
    // Keep only the tail of a log: it is a live feed, not a document.
    let text = body.replace(/\s+$/, '');
    if (/\.log$/i.test(name)) {
      const all = text.split('\n');
      if (all.length > LOG_TAIL_LINES) {
        text = all.slice(-LOG_TAIL_LINES).join('\n');
      }
    }

    return { ...file, contents: text, lines: text.split('\n').length };
  }

  return file;
}

/**
 * The text behind a Finder clipping. A .textClipping is a binary property
 * list, not text on disk -- `plutil -extract` pulls the one field that holds
 * it back out as plain UTF-8. Returns null (never throws) when this isn't a
 * Mac, the file isn't actually a clipping, or the field just isn't there.
 */
function textClippingText(fullPath) {
  if (process.platform !== 'darwin') return null;
  const r = spawnSync('plutil',
    ['-extract', 'UTI-Data.public\\.utf8-plain-text', 'raw', '-o', '-', fullPath],
    { encoding: 'utf8', timeout: 10000 });
  if (r.status !== 0) return null;
  const text = r.stdout.replace(/\s+$/, '');
  return text || null;
}

/**
 * Repacks a directory that is actually an unzipped .epub (see BUNDLE_EXT)
 * back into one real file, so there is something a visitor can click and
 * actually receive. Written into <root>/.epubs/, mirroring the source path,
 * and reused across builds the same way a thumbnail is -- only remade when
 * something inside is newer than the last packed copy.
 *
 * Returns the packed file's path relative to the site root, or null when
 * packing isn't possible here (no `zip`, no `mimetype` entry, not a Mac) --
 * the caller falls back to linking the folder itself.
 */
let bundleClaimed = new Set();

function newestMtime(dir) {
  let latest = 0;
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else { try { latest = Math.max(latest, fs.statSync(full).mtimeMs); } catch {} }
    }
  };
  walk(dir);
  return latest;
}

/**
 * A book folder that got walked into by an older build has an index.html (or
 * several, one per level) sitting inside it that do not belong there -- pages
 * this generator wrote for folders that no longer exist as folders. Those are
 * this tool's own leftovers, not the owner's content (the exception the
 * "never touch his files" rule already carves out), so they're the one thing
 * safe to clear out of a bundle before packing it.
 */
function cleanStrayIndexes(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) cleanStrayIndexes(full);
    else if (e.isFile() && e.name === 'index.html') {
      // Only ever remove a page this generator wrote itself -- checked by the
      // signature comment every page carries, never by the name alone. A
      // real book could legitimately ship its own index.html; that one is
      // owner content and must not be touched.
      try {
        const head = fs.readFileSync(full, 'utf8').slice(0, 200);
        if (head.includes('generated by src/grow.js')) fs.unlinkSync(full);
      } catch {}
    }
  }
}

function packBundle(fullDir, root, ext) {
  cleanStrayIndexes(fullDir);
  const rel = path.relative(root, fullDir);
  const relSlash = rel.split(path.sep).join('/');
  bundleClaimed.add(relSlash);
  const out = path.join(root, EPUB_CACHE, rel);

  if (process.platform !== 'darwin' && process.platform !== 'linux') return null;
  if (!fs.existsSync(path.join(fullDir, 'mimetype'))) return null;   // not really an epub

  try {
    const src = newestMtime(fullDir);
    const dst = fs.statSync(out).mtimeMs;
    if (dst >= src) return EPUB_CACHE + '/' + relSlash;
  } catch { /* not packed yet */ }

  try { fs.mkdirSync(path.dirname(out), { recursive: true }); } catch { return null; }
  try { fs.rmSync(out, { force: true }); } catch {}

  // The epub spec requires "mimetype" first and stored uncompressed -- that's
  // what lets a reader identify the format before unzipping anything else.
  const zip1 = spawnSync('zip', ['-X', '-0', out, 'mimetype'],
    { cwd: fullDir, encoding: 'utf8', timeout: 60000 });
  if (zip1.status !== 0) return null;
  const zip2 = spawnSync('zip', ['-X', '-r', '-g', out, '.', '-x', 'mimetype', '-x', '.DS_Store'],
    { cwd: fullDir, encoding: 'utf8', timeout: 120000 });
  if (zip2.status !== 0 || !fs.existsSync(out)) return null;

  return EPUB_CACHE + '/' + relSlash;
}

/** Drops any packed epub this walk didn't ask for -- same idea as sweepThumbs. */
function sweepBundles(root) {
  let removed = 0;
  const walk = (dir, prefix) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = prefix ? prefix + '/' + e.name : e.name;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full, rel); try { fs.rmdirSync(full); } catch {} }
      else if (!bundleClaimed.has(rel)) { try { fs.unlinkSync(full); removed++; } catch {} }
    }
  };
  walk(path.join(root, EPUB_CACHE), '');
  return removed;
}

/**
 * A smaller copy of an oversized image, made once and reused. Returns its
 * path relative to the site root, or null if there is nothing to gain or the
 * conversion is not possible here.
 *
 * Regenerated only when the source is newer, so the common rebuild -- which
 * happens on every save -- costs two stats and nothing else.
 */
function thumbFor(fullPath, root, width) {
  if (process.platform !== 'darwin' || !(width > THUMB_MAX_PX)) return null;

  const rel = path.relative(root, fullPath);
  const out = path.join(root, THUMBS, rel);
  thumbsClaimed.add(rel.split(path.sep).join('/'));

  try {
    const src = fs.statSync(fullPath);
    const thumb = fs.statSync(out);
    if (thumb.mtimeMs >= src.mtimeMs) return THUMBS + '/' + rel.split(path.sep).join('/');
  } catch { /* no thumb yet, or the source vanished */ }

  try { fs.mkdirSync(path.dirname(out), { recursive: true }); } catch { return null; }
  const r = spawnSync('sips', ['-Z', String(THUMB_MAX_PX), fullPath, '--out', out],
    { encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0 || !fs.existsSync(out)) return null;

  return THUMBS + '/' + rel.split(path.sep).join('/');
}

/* Which downsized copies this build actually asked for. Unlike the icons,
   .thumbs/ is committed on purpose -- the published page points straight at
   it -- so a photo that is deleted or moved into a subfolder leaves its
   downsized copy behind in a public repo forever. Nothing else ever looks at
   these files again, so nothing else would ever notice. */
let thumbsClaimed = new Set();

/** Drops any downsized copy this walk didn't ask for. */
function sweepThumbs(root) {
  // The same reasoning as sweepIcons: only a Mac can remake these, so a build
  // anywhere else must not delete work it cannot redo.
  if (process.platform !== 'darwin') return 0;

  let removed = 0;
  const walk = (dir, prefix) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = prefix ? prefix + '/' + e.name : e.name;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, rel);
        try { fs.rmdirSync(full); } catch { /* still holds something */ }
      } else if (!thumbsClaimed.has(rel)) {
        try { fs.unlinkSync(full); removed++; } catch { /* already gone */ }
      }
    }
  };
  walk(path.join(root, THUMBS), '');
  return removed;
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

function renderBody(f, assetPrefix = '') {
  // An icon stands for the file rather than opening it, so there is no body
  // to draw -- you click it, and the real file opens.
  if (f.iconOnly) return '';

  switch (f.type) {
    case 'image': {
      // A converted stand-in when the real file is a format browsers refuse.
      const full = f.previewHref ? assetPrefix + f.previewHref : f.href;
      // Shown smaller when the original is huge; the link still goes to it.
      const shown = f.thumbHref ? assetPrefix + encodeURI(f.thumbHref) : full;
      return `<a href="${full}"><img src="${shown}" alt="${escapeHtml(f.name)}" ` +
             `width="${f.width}" height="${f.height}" loading="lazy"></a>`;
    }
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
  const meta = f.type === 'directory' ? f.contents
    : f.type === 'clipping' && f.contents ? `${f.size} — “${f.contents}”`
    : (f.size ?? '');
  const body = renderBody(f, assetPrefix);

  // The icon and the name are one link, because in Finder they are one thing.
  const icon = f.icon
    ? `<a class="icon" href="${f.href}" tabindex="-1" aria-hidden="true">` +
      `<img src="${assetPrefix}${f.icon}" alt="" ` +
      `width="${f.iconW ?? ICON_PX}" height="${f.iconH ?? ICON_PX}"></a>\n        `
    : '';

  return `      <div class="item kind-${f.type}${f.iconOnly ? ' as-icon' : ''}" id="p${i}" data-key="${escapeHtml(f.name)}">
        ${icon}<h3><a href="${f.href}">${escapeHtml(f.name)}</a>` +
          (meta ? ` <span class="meta">(${escapeHtml(meta)})</span>` : '') + `</h3>` +
          (body ? `\n        ${body}` : '') + `
      </div>`;
}


/* -------------------------------------------------------------------- music
   The music/ folder is the playlist list: one text file per playlist, each
   holding a YouTube link (see music/README.txt). No audio is ever hosted --
   playback happens inside YouTube's own player, so nothing here is a copy.
   Spotify links still work; they play in Spotify's embed, which offers no
   controls, so the click wheel can do less with them. YouTube is primary.
   ------------------------------------------------------------------------ */

const MUSIC_EXT = ['.txt', '.md', '.markdown', '.mdown'];
const COVER_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'];
const SPOTIFY_KINDS = ['playlist', 'album', 'track', 'artist', 'episode', 'show'];

// YouTube list ids: PL (made by hand), UU (a channel's uploads), OL, LL, FL,
// RD (a generated radio). Anything else has to arrive as a URL, so a bare
// Spotify id can never be mistaken for a YouTube one.
const YT_LIST = /^(?:PL|UU|OL|LL|FL|RD)[A-Za-z0-9_-]{8,}$/;
const YT_HOST = /(?:^|\/\/|\.)(?:youtube\.com|youtube-nocookie\.com|youtu\.be|music\.youtube\.com)/i;

/** Pulls {src, kind, id} out of a YouTube URL, or a bare playlist id. */
function parseYouTube(raw) {
  const str = String(raw ?? '').trim();
  if (!str) return null;

  if (YT_LIST.test(str)) return { src: 'youtube', kind: 'playlist', id: str };
  if (!YT_HOST.test(str)) return null;

  // A playlist wins over the video it happens to point at: someone sharing
  // "watch?v=...&list=..." is sharing their playlist.
  const list = str.match(/[?&;]list=([A-Za-z0-9_-]{10,})/);
  if (list) return { src: 'youtube', kind: 'playlist', id: list[1] };

  const watch = str.match(/[?&;]v=([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/)
             ?? str.match(/youtu\.be\/([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/)
             ?? str.match(/\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/);
  if (watch) return { src: 'youtube', kind: 'video', id: watch[1] };

  return null;
}

/** Pulls {src, kind, id} out of a Spotify URL, a spotify: URI, or a bare id. */
function parseSpotify(raw) {
  const str = String(raw ?? '').trim();
  if (!str) return null;

  const uri = str.match(/^spotify:([a-z]+):([A-Za-z0-9]+)/i);
  if (uri && SPOTIFY_KINDS.includes(uri[1].toLowerCase())) {
    return { src: 'spotify', kind: uri[1].toLowerCase(), id: uri[2] };
  }
  const url = str.match(/open\.spotify\.com\/(?:embed\/)?(?:intl-[a-z-]+\/)?([a-z]+)\/([A-Za-z0-9]+)/i);
  if (url && SPOTIFY_KINDS.includes(url[1].toLowerCase())) {
    return { src: 'spotify', kind: url[1].toLowerCase(), id: url[2] };
  }
  if (/^[A-Za-z0-9]{16,30}$/.test(str)) return { src: 'spotify', kind: 'playlist', id: str };
  return null;
}

/** YouTube first: it is the house source now. */
const parseSource = (raw) => parseYouTube(raw) ?? parseSpotify(raw);

const embedUrl = (f) => f.src === 'youtube'
  ? (f.kind === 'playlist'
      ? `https://www.youtube.com/embed/videoseries?list=${f.id}`
      : `https://www.youtube.com/embed/${f.id}`)
  : `https://open.spotify.com/embed/${f.kind}/${f.id}?utm_source=generator`;

const openUrl = (f) => f.src === 'youtube'
  ? (f.kind === 'playlist'
      ? `https://www.youtube.com/playlist?list=${f.id}`
      : `https://www.youtube.com/watch?v=${f.id}`)
  : `https://open.spotify.com/${f.kind}/${f.id}`;

const slug = (str) => String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Reads music/ into the list the player expects. Returns [] when the folder
 * isn't there, which is the signal not to draw the player at all. Covers come
 * back relative to the site root, e.g. "music/covers/x.jpg".
 */
function readMusic(root) {
  // The playlists used to have to sit loose at the top of music/. The owner
  // tidied his into music/IPOD/ and the player silently vanished from every
  // page -- readMusic found nothing and the whole device stopped being drawn.
  // So the folder is scanned one level down as well: music/ itself, then each
  // folder inside it. That is deep enough for any tidying he is likely to do
  // and shallow enough that a folder of mp3s does not turn into a playlist.
  const out = [];
  scanMusicDir(root, 'music', out);

  let subs = [];
  try {
    subs = fs.readdirSync(root, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'covers')
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  } catch { /* no music/ at all */ }

  for (const d of subs) {
    scanMusicDir(path.join(root, d.name), `music/${d.name}`, out);
  }
  return out;
}

/**
 * Reads one folder of playlist files. `relDir` is that folder's path relative
 * to the site root, which is what a cover has to be addressed by.
 */
function scanMusicDir(dir, relDir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  // Two ways to give a tile a cover, indexed by name:
  //
  //   1. an image in covers/ named after the playlist -- the original way;
  //   2. an image sitting RIGHT BESIDE the text file and sharing its name,
  //      which is what the owner actually asked for ("display images as an
  //      album cover that i place in with the album link"). Dropping the
  //      picture next to the link is the obvious gesture, so it is the one
  //      that should work.
  //
  // A same-folder image wins over covers/, being the more deliberate act.
  const covers = new Map();
  try {
    for (const c of fs.readdirSync(path.join(dir, 'covers'))) {
      const ext = path.extname(c).toLowerCase();
      if (COVER_EXT.includes(ext)) covers.set(slug(path.basename(c, ext)), `covers/${c}`);
    }
  } catch { /* no covers/, which is fine */ }

  for (const e of entries) {
    if (!e.isFile() || e.name.startsWith('.')) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (!COVER_EXT.includes(ext)) continue;
    covers.set(slug(path.basename(e.name, ext)), e.name);
  }

  const musicFiles = entries
    .filter(e => e.isFile() &&
                 MUSIC_EXT.includes(path.extname(e.name).toLowerCase()) &&
                 !e.name.startsWith('.') &&
                 !/^readme\b/i.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));

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

    const found = [fields.youtube, fields.spotify, fields.url, fields.link,
                   fields.playlist, fields.album, fields.track, fields.video,
                   ...loose]
      .map(v => parseSource(v)).find(Boolean);
    if (!found) continue;

    const stem = path.basename(e.name, path.extname(e.name));
    const name = stem.replace(/^\d{1,3}[\s._)-]+\s*/, '').trim() || stem;

    const rel = (fields.cover || covers.get(slug(stem)) || covers.get(slug(name)) || '')
      .replace(/^\.\//, '');

    out.push({
      name,
      file: relDir === 'music' ? e.name : `${relDir.slice('music/'.length)}/${e.name}`,
      src: found.src,
      kind: found.kind,
      id: found.id,
      embed: embedUrl(found),
      link: openUrl(found),
      cover: rel ? encodeURI(`${relDir}/${rel}`) : null,
      note: fields.note || fields.caption || '',
    });
  }
}

/**
 * The player is NOT part of the page. It is emitted outside <main>, beside
 * the clock, because app.js replaces <main> wholesale when a visitor walks
 * into a folder -- and anything still inside <main> at that moment is
 * destroyed, iframe and all. Out here it simply never stops.
 * ipod.css fixes the shell to the corner of the screen and docks it.
 */
function musicWindow(music) {
  return `  <div id="ipod-shell" class="ipod-shell">
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
                  <span>put a YouTube link in a text file in <code>music/</code> and regrow.</span>
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

function renderPage({ siteName, title, files, positioned, description, folderDescription,
                      socialImage, assetPrefix, isRoot, tagline, marquee, guestbook, music,
                      assetStamps }) {
  const items = files.map((f, i) => renderItem(f, i, assetPrefix)).join('\n');

  // A guestbook needs a server to hold visitor notes, which GitHub Pages
  // cannot do. Off until there is a backend; flip "enabled" in the config.
  const showGuestbook = isRoot && guestbook && guestbook.enabled === true;

  // Covers are stored relative to the site root; a subpage needs the prefix.
  const musicData = (music ?? []).map(t =>
    t.cover ? { ...t, cover: assetPrefix + t.cover } : t);
  // On every page, not just the front one: the player has to already exist
  // wherever a visitor happens to land, and it is no longer laid out as part
  // of the plantbed, so it costs the folder pages no space.
  const showMusic = musicData.length > 0;

  // Freeform positions live in a media query so phones get the plain stack
  // defined in the base stylesheet and wide screens get the Finder layout.
  let freeform = '';

  /* The phone layout rides along in this same block rather than in the
     stylesheet, because this block is the one the page owns: app.js swaps it
     wholesale when a visitor walks into a folder, so whatever is written here
     survives navigation the way the coordinates above it do.

     A phone used to get one item per row. Four folders were four screens of
     scrolling with the right two thirds of the display empty, which is not
     what a folder looks like on anything. Icon items go three across -- close
     to Finder's own grid at this width -- and anything with a body to read
     (writing, a photograph, a text file) still gets the full width. */
  const phone = `
    @media (max-width: 559px) {
      main { padding: 1.5rem 1rem 1.25rem; }
      .plantbed { display: flex; flex-wrap: wrap; align-items: flex-start; }
      .plantbed > .item { flex: 1 1 100%; min-width: 0; }
      .plantbed > .item.as-icon {
        flex: 0 0 33.333%; width: auto; margin: 0 0 1.1rem;
      }
      /* A phone cannot pan sideways to find the rest of a picture. Nothing
         lying on the page may be wider than the page. */
      .plantbed [data-resizable] { max-width: 100%; }
      .plantbed img, .plantbed video { max-width: 100%; height: auto; }
      /* A filename is one unbreakable line, which is right under an icon and
         wrong above a paragraph: "Screenshot 2026-09-14 at 10.09.54 AM.png"
         is wider than a phone all by itself, and it was dragging the whole
         page sideways with it. */
      .plantbed > .item:not(.as-icon) h3 {
        white-space: normal; overflow-wrap: anywhere;
      }
    }`;

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

    freeform = `
    @media (min-width: 560px) {
      .plantbed { min-height: ${maxY}px; max-width: 68rem; margin: 0 auto; }
${rules}
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

    freeform = `
    @media (min-width: 560px) {
      .plantbed { min-height: ${height}px; margin-left: max(0px, calc(50% - ${halfWidth}px - 13rem)); }
${rules}
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
${folderDescription ? `      <p class="folder-description" style="white-space:pre-line">${escapeHtml(folderDescription)}</p>\n` : ''}\
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
  <link rel="stylesheet" href="${assetUrl(assetPrefix, assetStamps, 'style.css')}">
${showMusic ? `  <link rel="stylesheet" href="${assetUrl(assetPrefix, assetStamps, 'ipod.css')}">\n` : ''}\
  <style id="page-style">${freeform}${phone}
  </style>
</head>

<body>
  <div id="clock-shell" title="click to change format">
    <pre id="clock"></pre>
    <p id="clock-date"></p>
  </div>
${showMusic ? musicWindow(musicData) + '\n' : ''}\

  <main>
${head}
    <div class="plantbed${positioned ? ' freeform' : ' scattered'}">
${items}
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
  <script src="${assetUrl(assetPrefix, assetStamps, 'app.js')}"></script>
${showMusic ? `  <script>window.GARDEN_MUSIC = ${JSON.stringify(musicData).replace(/</g, '\\u003c')};</script>
  <script src="${assetUrl(assetPrefix, assetStamps, 'ipod.js')}"></script>\n` : ''}\
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

  // A description.txt (see DESCRIPTION_RE) is read here, off the raw listing,
  // before it's filtered out of the page's items below -- it describes this
  // folder rather than sitting in it. Case- and extension-forgiving on
  // purpose: the whole point is that it takes no care to get right.
  let description;
  const descEntry = entries.find(e => e.isFile() && DESCRIPTION_RE.test(e.name));
  if (descEntry) {
    try { description = fs.readFileSync(path.join(dir, descEntry.name), 'utf8').trim() || undefined; }
    catch { /* unreadable -- fall back to the site default below */ }
  }

  entries = resolveEntries(dir, entries)
    .filter(e => !isIgnored(e.name, e.isDirectory(), rules))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));

  // Finder's in-memory positions beat .DS_Store, which it only flushes when
  // the window closes -- that lag is why a drag used to not show up here.
  const positions = positionsFor(ctx.live, dir) ?? parseDSStore(path.join(dir, '.DS_Store'));
  const rel = path.relative(root, dir);
  const depthFromRoot = rel ? rel.split(path.sep).length : 0;

  const files = entries.map(e => {
    let f;
    try {
      f = describe(dir, e, rules, ctx.root, depthFromRoot === 0);
    } catch (err) {
      // One unreadable or unusual file must not take the whole folder's page
      // down with it -- that would hide everything else in it too, which is
      // worse than showing this one item plainly. It still gets a name and,
      // where possible, a size; a click just downloads whatever it is.
      if (!ctx.quiet) console.warn(`  ! ${path.join(dir, e.name)}: ${err.message}`);
      let size = '';
      try { size = prettyBytes(fs.statSync(path.join(dir, e.name)).size); } catch {}
      f = { name: e.name, href: encodeURI(e.name + (e.isDirectory() ? '/' : '')),
            type: 'other', size };
    }
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

  const firstImage = files.find(f => f.type === 'image');

  const html = renderPage({
    siteName: ctx.siteName,
    title: rel ? rel + '/' : null,
    files,
    positioned,
    description: description ?? ctx.description,
    folderDescription: description,
    // The converted copy when there is one -- a link preview cannot show HEIC.
    socialImage: rel ? null : (firstImage?.previewHref ?? firstImage?.href),
    assetStamps: ctx.assetStamps,
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
      // A bundle (see BUNDLE_EXT) is a directory on disk but a single item on
      // the site -- packed above, never walked into, so it never grows a page
      // per internal folder the way the original epub bug did.
      if (e.isDirectory() && !BUNDLE_EXT.includes(path.extname(e.name).toLowerCase())) {
        grow(path.join(dir, e.name), { ...ctx, depth: depth + 1 });
      }
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

  // A short digest of each file, hung off its URL in the page. Browsers cache
  // a stylesheet or a script hard, and the owner kept being served yesterday's
  // behaviour after a fix landed. A changed file means a changed URL, so
  // there is nothing left to go stale.
  const stamps = {};

  for (const name of fs.readdirSync(from)) {
    const src = fs.readFileSync(path.join(from, name));
    const dst = path.join(to, name);
    let current = null;
    try { current = fs.readFileSync(dst); } catch { /* new file */ }
    if (!current || !current.equals(src)) fs.writeFileSync(dst, src);
    stamps[name] = crypto.createHash('sha1').update(src).digest('hex').slice(0, 8);
  }

  return stamps;
}

/** `garden-assets/app.js?v=1a2b3c4d` — empty if the file is not one of ours. */
function assetUrl(prefix, stamps, name) {
  const v = stamps && stamps[name];
  return `${prefix}garden-assets/${name}` + (v ? `?v=${v}` : '');
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

  const assetStamps = copyAssets(root);
  beginIconRun();
  thumbsClaimed = new Set();
  bundleClaimed = new Set();

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

    assetStamps,

    // One snapshot of Finder's live layout per build, not one call per
    // folder -- each osascript round trip costs about a third of a second.
    live: liveSnapshot(),

    // One text file per playlist in music/; the player is drawn from these.
    music: readMusic(path.join(root, 'music')),
    depth: 0,
    // A folder nested past this never gets its own page -- it still shows up
    // as an item one level up (describe() doesn't know about the cap), so it
    // used to look like a live folder that 404s the moment you open it. Set
    // high enough that a real folder tree never hits it; the actual backstop
    // against a runaway (a symlink loop) lives in folderBytes' own depth check.
    maxDepth: opts.depth ?? config.depth ?? 20,
    dryRun: opts.dryRun ?? false,
    quiet: opts.quiet ?? false,
    written: { count: 0 },
  };

  grow(root, ctx);

  // Renamed and deleted files leave their thumbnails behind, and these are
  // committed -- so clear out whatever this walk didn't ask for. A dry run
  // promises to leave the folder exactly as it found it.
  const swept = ctx.dryRun ? 0 : sweepIcons(root) + sweepThumbs(root) + sweepBundles(root);

  return {
    root,
    pages: ctx.written.count,
    changed: ctx.written.changed ?? 0,
    swept,
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
    const { root, pages, changed, swept, siteName } = growSite(opts);
    console.log(`grew ${siteName} from ${root}`);
    console.log(opts.dryRun
      ? `would write ${pages} page${pages === 1 ? '' : 's'}`
      : `${pages} page${pages === 1 ? '' : 's'} visited, ${changed} written` +
        (swept ? `, ${swept} stale icon file${swept === 1 ? '' : 's'} removed` : ''));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
