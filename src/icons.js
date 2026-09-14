/**
 * Real Finder icons.
 *
 * The page is supposed to be the folder, so a folder on it should be the
 * icon macOS actually draws -- including a custom icon or a tag colour, not
 * a drawing of one. NSWorkspace hands that over; a tiny Swift helper asks it
 * and writes a PNG. Requires a Mac to build the site, which was already true
 * (.DS_Store is where the positions come from). The PNGs are committed, so
 * the published site needs nothing but a browser.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SRC = path.join(__dirname, 'tools', 'icon.swift');
const ICON_PX = 256;          // 128pt at 2x -- sharp on retina, ~9 KB each

let helper = null;            // path to the compiled binary, once we have one
let helperFailed = false;     // don't retry a broken toolchain on every folder

/** Compile the helper once per run into the cache dir, and reuse it after. */
function getHelper(root) {
  if (helper || helperFailed) return helper;
  if (process.platform !== 'darwin') { helperFailed = true; return null; }

  const cache = path.join(root, '.garden-cache');
  const bin = path.join(cache, 'icon');

  // A binary older than its source is stale; anything else we can reuse.
  try {
    if (fs.statSync(bin).mtimeMs >= fs.statSync(SRC).mtimeMs) return (helper = bin);
  } catch { /* not built yet */ }

  fs.mkdirSync(cache, { recursive: true });
  const r = spawnSync('swiftc', ['-O', SRC, '-o', bin], { encoding: 'utf8' });
  if (r.status !== 0) { helperFailed = true; return null; }
  return (helper = bin);
}

/** garden-assets/icons/<this>.png -- unique per folder, safe on any filesystem. */
function iconName(relPath) {
  const flat = relPath.replace(/\/+$/, '').replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '').toLowerCase();
  return (flat || 'root') + '.png';
}

/**
 * A folder's icon only changes when someone sets a custom one, which leaves
 * an "Icon\r" file inside it. Keying the cache on that -- rather than on the
 * folder's own mtime, which moves every time anything inside it does -- means
 * a rebuild costs nothing in the normal case.
 */
function iconStamp(dir) {
  try { return String(fs.statSync(path.join(dir, 'Icon\r')).mtimeMs); }
  catch { return '0'; }
}

/**
 * Returns the icon's path relative to the site root, or null if this machine
 * can't produce one. Callers render the name alone when it's null, so a
 * non-Mac build degrades to the plain list instead of breaking.
 */
export function folderIcon(fullPath, root) {
  const bin = getHelper(root);
  if (!bin) return null;

  const rel = path.relative(root, fullPath);
  const out = path.join(root, 'garden-assets', 'icons', iconName(rel));
  // The stamp is build bookkeeping, not part of the site -- it lives in the
  // cache dir so it never gets published alongside the PNG.
  const stampFile = path.join(root, '.garden-cache', iconName(rel) + '.stamp');
  const stamp = iconStamp(fullPath);

  let cached = null;
  try { cached = fs.readFileSync(stampFile, 'utf8'); } catch { /* first time */ }

  if (cached !== stamp || !fs.existsSync(out)) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const r = spawnSync(bin, [fullPath, out, String(ICON_PX)], { encoding: 'utf8' });
    if (r.status !== 0) return null;
    fs.mkdirSync(path.dirname(stampFile), { recursive: true });
    fs.writeFileSync(stampFile, stamp);
  }

  return 'garden-assets/icons/' + iconName(rel);
}
