/**
 * Real Finder icons.
 *
 * The page is supposed to be the folder, so a folder on it should be the
 * icon macOS actually draws -- including a custom icon or a tag colour, not
 * a drawing of one. NSWorkspace hands that over; a tiny Swift helper asks it
 * and writes a PNG. Requires a Mac to build the site, which was already true
 * (.DS_Store is where the positions come from). The PNGs are committed, so
 * the published site needs nothing but a browser.
 *
 * Files go through QuickLook instead of NSWorkspace, because Finder shows a
 * picture of the photo rather than a badge saying "PNG". Same idea, same
 * cache, different system call.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SRC = {
  icon:  path.join(__dirname, 'tools', 'icon.swift'),
  thumb: path.join(__dirname, 'tools', 'thumb.swift'),
};

const ICON_PX = 256;          // 128pt at 2x -- sharp on retina, ~9 KB each
// Files are drawn at 96px like folders, so 2x is 192. Flat folder icons stay
// cheap at any size, but a thumbnail is a photograph: every extra pixel is
// real weight in a public repo, so this one is sized to exactly what's drawn.
const THUMB_PX = 192;
// A full-size derivative, not a thumbnail: this one stands in for the photo
// itself on the front page, so it has to survive being looked at.
const PREVIEW_PX = 1600;

const helpers = new Map();    // name -> compiled binary, or null once it failed

/** Compile a helper once per run into the cache dir, and reuse it after. */
function getHelper(name, root) {
  if (helpers.has(name)) return helpers.get(name);
  if (process.platform !== 'darwin') { helpers.set(name, null); return null; }

  const cache = path.join(root, '.garden-cache');
  const bin = path.join(cache, name);

  // A binary older than its source is stale; anything else we can reuse.
  try {
    if (fs.statSync(bin).mtimeMs >= fs.statSync(SRC[name]).mtimeMs) {
      helpers.set(name, bin);
      return bin;
    }
  } catch { /* not built yet */ }

  fs.mkdirSync(cache, { recursive: true });
  const r = spawnSync('swiftc', ['-O', SRC[name], '-o', bin], { encoding: 'utf8' });
  if (r.status !== 0) { helpers.set(name, null); return null; }

  helpers.set(name, bin);
  return bin;
}

/**
 * garden-assets/icons/<this>.png -- readable, and stable across rebuilds so
 * git sees the same filenames every time.
 *
 * Flattening loses information ("a b.txt" and "a-b.txt" land on the same
 * name), which never mattered while only folders had icons but does once
 * every file wants one. The first path to claim a name keeps it; a later
 * collision gets a suffix, so two files can never quietly share a picture.
 */
let claimed = new Map();      // icon filename -> the relative path that owns it

function iconName(relPath, prefix = '') {
  const flat = relPath.replace(/\/+$/, '').replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '').toLowerCase();
  let base = prefix + (flat || 'root');

  const owner = claimed.get(base);
  if (owner !== undefined && owner !== relPath) {
    let h = 2166136261;
    for (let i = 0; i < relPath.length; i++) {
      h ^= relPath.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    base += '-' + (h >>> 0).toString(36);
  }
  claimed.set(base, relPath);
  return base + '.png';
}

/**
 * Run the helper only when the source has changed since last time. Rebuilds
 * happen on every save, so the common case has to cost nothing but a stat.
 *
 * The stamp is build bookkeeping, not part of the site -- it lives in the
 * cache dir so it never gets published alongside the PNG. It also carries the
 * image's pixel size, which saves reading the PNG back to measure it.
 */
function render(bin, src, out, stampFile, stamp, px) {
  let cached = null;
  try { cached = fs.readFileSync(stampFile, 'utf8'); } catch { /* first time */ }

  const [cachedStamp, cachedSize] = cached ? cached.split('\n') : [];
  if (cachedStamp === stamp && cachedSize && fs.existsSync(out)) {
    const [w, h] = cachedSize.split(' ').map(Number);
    if (w > 0 && h > 0) return { w, h };
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = spawnSync(bin, [src, out, String(px)], { encoding: 'utf8' });
  if (r.status !== 0) return null;

  // icon.swift is silent and always square; thumb.swift reports what it wrote.
  const reported = String(r.stdout ?? '').trim().split(/\s+/).map(Number);
  const size = reported.length === 2 && reported.every(n => n > 0)
    ? { w: reported[0], h: reported[1] }
    : { w: px, h: px };

  fs.mkdirSync(path.dirname(stampFile), { recursive: true });
  fs.writeFileSync(stampFile, `${stamp}\n${size.w} ${size.h}`);
  return size;
}

/**
 * A folder's icon only changes when someone sets a custom one, which leaves
 * an "Icon\r" file inside it. Keying the cache on that -- rather than on the
 * folder's own mtime, which moves every time anything inside it does -- means
 * a rebuild costs nothing in the normal case.
 */
function folderStamp(dir) {
  try { return String(fs.statSync(path.join(dir, 'Icon\r')).mtimeMs); }
  catch { return '0'; }
}

/**
 * Returns the icon's path relative to the site root, or null if this machine
 * can't produce one. Callers render the name alone when it's null, so a
 * non-Mac build degrades to the plain list instead of breaking.
 */
export function folderIcon(fullPath, root) {
  const bin = getHelper('icon', root);
  if (!bin) return null;

  const rel = path.relative(root, fullPath);
  const file = iconName(rel);
  const out = path.join(root, 'garden-assets', 'icons', file);
  const stampFile = path.join(root, '.garden-cache', file + '.stamp');

  const size = render(bin, fullPath, out, stampFile, folderStamp(fullPath), ICON_PX);
  return size ? 'garden-assets/icons/' + file : null;
}

/**
 * The thumbnail Finder shows for a file: the photo itself for an image, a
 * page with the first lines on it for a document. Returns the path relative
 * to the site root plus the PNG's pixel size -- thumbnails are not square, so
 * the caller needs both to reserve the right box.
 *
 * Unlike a folder, a file's thumbnail is stale the moment the file is edited,
 * so the cache is keyed on mtime and length together.
 */
export function fileThumb(fullPath, root) {
  const bin = getHelper('thumb', root);
  if (!bin) return null;

  let stamp;
  try {
    const st = fs.statSync(fullPath);
    stamp = `${st.mtimeMs}:${st.size}`;
  } catch { return null; }

  const rel = path.relative(root, fullPath);
  const file = iconName(rel, 'f-');
  const out = path.join(root, 'garden-assets', 'icons', file);
  const stampFile = path.join(root, '.garden-cache', file + '.stamp');

  const size = render(bin, fullPath, out, stampFile, stamp, THUMB_PX);
  return size ? { href: 'garden-assets/icons/' + file, w: size.w, h: size.h } : null;
}

/**
 * A web-safe copy of a picture no browser will draw.
 *
 * macOS writes HEIC by default, so a photo straight off an iPhone dropped in
 * the folder would otherwise show up as a dead "download" link -- which
 * defeats the point of the front page being the desk. sips ships with the
 * system, so this costs no dependency.
 *
 * Returns the derivative's path relative to the site root and its pixel size,
 * or null if the conversion is not possible here.
 */
export function webPreview(fullPath, root) {
  if (process.platform !== 'darwin') return null;

  let stamp;
  try {
    const st = fs.statSync(fullPath);
    stamp = `${st.mtimeMs}:${st.size}`;
  } catch { return null; }

  const rel = path.relative(root, fullPath);
  // iconName hands back a .png name and records the claim, which is what the
  // sweep matches on; the bytes themselves are JPEG, because this is a
  // photograph and a lossless copy of one is pointless weight in a git repo.
  const claim = iconName(rel, 'w-');
  const file = claim.replace(/\.png$/, '.jpg');
  const out = path.join(root, 'garden-assets', 'icons', file);
  const stampFile = path.join(root, '.garden-cache', file + '.stamp');

  let cached = null;
  try { cached = fs.readFileSync(stampFile, 'utf8'); } catch { /* first time */ }
  const [cachedStamp, cachedSize] = cached ? cached.split('\n') : [];
  if (cachedStamp === stamp && cachedSize && fs.existsSync(out)) {
    const [w, h] = cachedSize.split(' ').map(Number);
    if (w > 0 && h > 0) return { href: 'garden-assets/icons/' + file, w, h };
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = spawnSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80',
    '-Z', String(PREVIEW_PX), fullPath, '--out', out],
    { encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0 || !fs.existsSync(out)) return null;

  const m = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', out],
    { encoding: 'utf8', timeout: 10000 });
  const w = Number(/pixelWidth:\s*(\d+)/.exec(m.stdout ?? '')?.[1]);
  const h = Number(/pixelHeight:\s*(\d+)/.exec(m.stdout ?? '')?.[1]);
  if (!(w > 0 && h > 0)) return null;

  fs.mkdirSync(path.dirname(stampFile), { recursive: true });
  fs.writeFileSync(stampFile, `${stamp}\n${w} ${h}`);
  return { href: 'garden-assets/icons/' + file, w, h };
}

/* -------------------------------------------------------------- housekeeping
   Every file on the site now owns a PNG, and files get renamed and thrown
   away constantly. Without a sweep the icon folder only ever grows, and it is
   committed to a public repo -- so a year of tidying would be published as
   dead weight. Bracket a build with these two.
   ------------------------------------------------------------------------ */

export function beginIconRun() {
  claimed = new Map();
}

/** Drops any icon no path claimed during the run that just finished. */
export function sweepIcons(root) {
  // Nothing claimed means the helper never ran -- a non-Mac build, or a
  // broken toolchain. Deleting the committed icons on that basis would throw
  // away work this machine cannot redo, so leave them alone.
  if (claimed.size === 0) return 0;

  const live = new Set(claimed.keys());
  let removed = 0;

  const sweep = (dir, suffix, nameOf) => {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (!name.endsWith(suffix) || live.has(nameOf(name))) continue;
      try { fs.unlinkSync(path.join(dir, name)); removed++; } catch { /* already gone */ }
    }
  };

  // claimed is keyed on the bare name, so every sweep strips the extension.
  const icons = path.join(root, 'garden-assets', 'icons');
  sweep(icons, '.png', n => n.slice(0, -4));
  sweep(icons, '.jpg', n => n.slice(0, -4));
  sweep(path.join(root, '.garden-cache'), '.stamp',
        n => n.slice(0, -'.stamp'.length).replace(/\.(png|jpg)$/, ''));

  return removed;
}
