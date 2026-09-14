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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DEFAULT = path.join(__dirname, '..');

/* ------------------------------------------------------------------ config */

const ALWAYS_IGNORE = ['.git', '.DS_Store', 'index.html', '.gardenignore', 'node_modules'];

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
const INLINE_TEXT_LIMIT = 2048;    // bigger text files become a plain link
const ROOT_FONT_PX = 14;
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

function describe(dir, entry, rules) {
  const name = entry.name;
  const full = path.join(dir, name);
  const href = encodeURI(name + (entry.isDirectory() ? '/' : ''));

  if (entry.isDirectory()) {
    const n = countItems(full, rules);
    return { name: name + '/', href, type: 'directory',
             contents: `${n} item${n === 1 ? '' : 's'}` };
  }

  const stat = fs.statSync(full);
  const type = classify(name);
  const file = { name, href, type, size: prettyBytes(stat.size), bytes: stat.size };

  if (type === 'image' || type === 'video') {
    const d = (type === 'image' ? imageSize(full) : videoSize(full)) ??
              (type === 'video' ? { width: 480, height: 270 } : null);
    if (!d) return { ...file, type: 'other' };
    const scale = Math.min(1, MAX_MEDIA_PX / d.width, MAX_MEDIA_PX / d.height);
    return { ...file, width: d.width, height: d.height,
             drawnHeight: Math.round(d.height * scale) };
  }

  if (type === 'markdown' || type === 'text' || type === 'raw') {
    if (stat.size > INLINE_TEXT_LIMIT) return { ...file, type: 'other' };
    let body = '';
    try { body = fs.readFileSync(full, 'utf8'); } catch { return { ...file, type: 'other' }; }
    if (body.includes('\u0000')) return { ...file, type: 'other' };  // binary
    return { ...file, contents: body.replace(/\s+$/, ''), lines: body.split('\n').length };
  }

  return file;
}

/** Rough rendered height, used only to give the page something to scroll to. */
function estimateHeight(file) {
  const head = 20;
  switch (file.type) {
    case 'directory': return head;
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

function renderItem(f) {
  const link = (label) => `<a href="${f.href}">${escapeHtml(label)}</a>`;

  switch (f.type) {
    case 'directory':
      return `<h3>${link(f.name)} (${f.contents})</h3>`;
    case 'image':
      return `<h3>${link(f.name)} (${f.size})</h3>\n` +
             `        <a href="${f.href}"><img src="${f.href}" alt="${escapeHtml(f.name)}" ` +
             `width="${f.width}" height="${f.height}" loading="lazy"></a>`;
    case 'video':
      return `<h3>${link(f.name)} (${f.size})</h3>\n` +
             `        <video width="${f.width}" height="${f.height}" controls preload="metadata">` +
             `<source src="${f.href}"></video>`;
    case 'audio':
      return `<h3>${link(f.name)} (${f.size})</h3>\n` +
             `        <audio controls preload="none"><source src="${f.href}"></audio>`;
    case 'markdown':
      return `<h3>${link(f.name)} (${f.size})</h3>\n` +
             `        <div class="md">${markdown(f.contents)}</div>`;
    case 'text':
      return `<h3>${link(f.name)} (${f.size})</h3>\n` +
             `        <pre>${escapeHtml(f.contents)}</pre>`;
    case 'raw':
      return `<h3>${link(f.name)}</h3>\n` +
             `        <pre>${escapeHtml(f.contents)}</pre>`;
    default:
      return `<h3>${link(f.name)} (${f.size})</h3>`;
  }
}

const STYLE = `
    html, body { height: 100%; margin: 0; -webkit-text-size-adjust: 100%; text-size-adjust: none; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: ${ROOT_FONT_PX}px;
      color: #111;
      background-color: rgb(250, 251, 247);
      overflow-x: scroll;
    }
    main { max-width: 100%; box-sizing: border-box; padding: 1.5em; }
    .plantbed { position: relative; }
    /* Narrow screens (phones) get a plain stack; the freeform positions are
       reapplied in the media query at the bottom of this stylesheet. */
    .item {
      display: inline-block; vertical-align: top;
      margin: 0 .75em 1.5em 0; padding: 0 1em;
      max-width: 100%; box-sizing: border-box;
      outline: 1px solid rgba(0,0,0,.1);
    }
    .item img, .item video, .item audio { width: auto; height: auto; max-width: 100%; max-height: 24em; }
    .item audio { height: 3em; width: 100%; }
    .item pre, .item .md { white-space: pre-wrap; overflow-wrap: anywhere; }
    h1, h2, h3, h4, h5, h6 { font-size: 1em; font-weight: normal; color: #a33230; }
    h1, h2, h3, h4, h5, h6, p, ul, ol, li, pre, code { margin: 0; }
    pre { font-family: inherit; white-space: pre-wrap; }
    a { color: #008900; }
    .md h1, .md h2, .md h3, .md h4, .md h5, .md h6, .md p, .md pre, .md ul, .md ol { margin-top: 1em; }
    .md img { max-width: 100%; }
    .crumbs { margin-bottom: 1.5em; }`;

function renderPage({ siteName, title, files, positioned, description, socialImage }) {
  const items = files.map((f, i) =>
    `      <div class="item" id="p${i}">\n        ${renderItem(f)}\n      </div>`).join('\n');

  // Freeform positions live in a media query so phones get the plain stack
  // defined in the base stylesheet and wide screens get the Finder layout.
  let freeform = '';
  if (positioned) {
    const xs = files.map(f => f.x);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...files.map(f => f.y));
    const halfWidth = Math.round((maxX - minX) / 2);
    const height = Math.round(
      Math.max(...files.map(f => f.y - minY + TOP_PADDING + estimateHeight(f))));

    const rules = files.map((f, i) =>
      `      #p${i} { top: ${f.y - minY + TOP_PADDING}px; left: ${f.x - minX}px; }`).join('\n');

    freeform = `
    @media (min-width: ${FREEFORM_MIN_WIDTH}px) {
      body { overflow-x: scroll; }
      .plantbed { width: 0; height: ${height}px; left: max(0px, calc(50% - ${halfWidth}px - 1em)); }
      .item { position: absolute; margin: 0; max-width: none; }
      .item * { width: max-content; }
      .item img, .item video, .item audio { max-width: 24em; }
      .item audio { width: auto; }
${rules}
    }`;
  }

  const body = `    <div class="plantbed">\n${items}\n    </div>`;

  const heading = title
    ? `    <div class="crumbs"><h3><a href="..">back</a></h3><p>${escapeHtml(title)}</p></div>\n`
    : '';

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
  <style>${STYLE}${freeform}
  </style>
</head>

<body>
  <main>
${heading}${body}
  </main>
</body>
<!--
layout and templates after kevin.garden / file.gallery by Kevin N. Chen
https://kevin.garden — CC BY-NC 4.0
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
    const f = describe(dir, e, rules);
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
  const html = renderPage({
    siteName: ctx.siteName,
    title: rel ? rel + '/' : null,
    files,
    positioned,
    description: ctx.description,
    socialImage: rel ? null : firstImage?.href,
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

  const ctx = {
    root,
    rules: loadRules(root, config),
    siteName: opts.title ?? config.title ?? path.basename(root),
    description: config.description,
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
