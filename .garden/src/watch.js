#!/usr/bin/env node
/**
 * watch.js — keep the site in sync with the folder, live.
 *
 * Watches the source folder. When anything changes it regrows the pages and,
 * if publishing is turned on in garden.config.json, commits and pushes so the
 * public site follows along a minute or so later.
 *
 * Dragging an icon is not a file change -- Finder keeps the new position in
 * memory and only writes .DS_Store much later -- so fs.watch never hears about
 * a rearranged folder. Alongside the watch we poll Finder for its live
 * positions, which is the only way the layout follows the drag straight away.
 *
 * Usage:  node src/watch.js [--no-publish] [--serve] [--no-poll]
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

import { loadConfig } from './grow.js';
import { liveSnapshot } from './finder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(__dirname, '..');

const argv = process.argv.slice(2);
const noPublish = argv.includes('--no-publish');
const noPoll = argv.includes('--no-poll') || argv.includes('--no-polling');

const config = loadConfig(path.join(PROJECT, 'garden.config.json'));
const root = path.resolve((config.source ?? PROJECT).replace(/^~/, process.env.HOME ?? '~'));

const DEBOUNCE_MS = config.debounceMs ?? 2000;

// Each poll is a blocking osascript round trip of roughly a third of a second,
// so this is a tradeoff between how fast a drag shows up and how much of the
// event loop we hand to Finder. 1.5s reads as immediate without being greedy.
const POLL_MS = Math.max(250, config.finderPollMs ?? 1500);
// When Finder cannot answer at all we back off rather than spawning osascript
// once a second forever -- on a machine with Finder quit that would be pure
// waste until the watcher is killed.
const POLL_BACKOFF_MAX_MS = 60_000;

/* ------------------------------------------------------------------ helpers */

const stamp = () => new Date().toLocaleTimeString('en-US', { hour12: false });
const log = (...a) => console.log(`[${stamp()}]`, ...a);

function git(args, opts = {}) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8', ...opts });
}

function hasGitRemote() {
  if (!fs.existsSync(path.join(root, '.git'))) return false;
  const r = git(['remote']);
  return r.status === 0 && r.stdout.trim().length > 0;
}

function publish() {
  const add = git(['add', '-A']);
  if (add.status !== 0) { log('git add failed:', add.stderr.trim()); return; }

  const status = git(['status', '--porcelain']);
  if (!status.stdout.trim()) { log('nothing to publish'); return; }

  const files = status.stdout.trim().split('\n').length;
  const commit = git(['commit', '-m', `grow: ${files} change${files === 1 ? '' : 's'}`]);
  if (commit.status !== 0) { log('git commit failed:', commit.stderr.trim()); return; }

  log('pushing...');
  const push = git(['push']);
  if (push.status !== 0) {
    log('git push failed:', (push.stderr || push.stdout).trim());
    log('(fix the remote, then the next change will push both commits)');
    return;
  }
  log(`published — live in ~1 min at ${config.url ?? 'your Pages URL'}`);
}

/**
 * The log is on the page, and launchd keeps this process alive for as long as
 * the machine is up, so left alone it would grow forever. Only the tail is
 * ever shown; keep a little more than that and drop the rest.
 */
const LOG_KEEP = 200;

function trimLog() {
  const p = path.join(root, '.garden.log');
  try {
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    if (lines.length <= LOG_KEEP * 4) return;
    // Rewritten in place. launchd holds this file open in append mode, so its
    // next write lands after whatever is here now rather than at a stale offset.
    fs.writeFileSync(p, lines.slice(-LOG_KEEP).join('\n'));
  } catch { /* no log yet, or it is being written to right now */ }
}

/* ---------------------------------------------------------------------- heic
   An iPhone writes HEIC by default and no browser will draw one, so a photo
   dropped straight in would be a dead link. Every .heic gets a .jpg sibling
   made for it before the site is built, and the original is kept rather than
   thrown away -- it moves into .originals/, which the build skips.
   ------------------------------------------------------------------------ */

const ORIGINALS = '.originals';
const SKIP_DIRS = new Set(['node_modules', 'garden-assets', 'src']);

function* findHeic(dir, rel = '') {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

  for (const e of entries) {
    // Leading dots cover .git, .garden-cache, .thumbs and .originals itself,
    // so a converted original can never be found and converted again.
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* findHeic(path.join(dir, e.name), path.join(rel, e.name));
    } else if (/\.heic$/i.test(e.name)) {
      yield { dir, rel, name: e.name };
    }
  }
}

/** Returns how many were converted. Never throws; a failure leaves the file. */
function convertHeic() {
  let done = 0;

  for (const f of findHeic(root)) {
    const src = path.join(f.dir, f.name);
    const jpg = path.join(f.dir, f.name.replace(/\.heic$/i, '.jpg'));

    // sips refuses to overwrite nothing, but a second .heic named like an
    // existing .jpg would clobber a real photo. Leave that alone and say so.
    if (fs.existsSync(jpg)) {
      log(`skipped ${f.name}: ${path.basename(jpg)} already exists`);
      continue;
    }

    const r = spawnSync('sips', ['-s', 'format', 'jpeg', src, '--out', jpg],
      { encoding: 'utf8', timeout: 60000 });
    if (r.status !== 0 || !fs.existsSync(jpg)) {
      log(`could not convert ${f.name}: ${(r.stderr || '').trim() || 'sips failed'}`);
      continue;
    }

    // Keep the original. It is the owner's photo at full quality, and the
    // conversion is lossy -- deleting it would be deleting the only copy.
    const keepDir = path.join(root, ORIGINALS, f.rel);
    try {
      fs.mkdirSync(keepDir, { recursive: true });
      fs.renameSync(src, path.join(keepDir, f.name));
    } catch (e) {
      log(`converted ${f.name} but could not file the original: ${e.message}`);
      continue;
    }

    log(`converted ${f.name} -> ${path.basename(jpg)} (original kept in ${ORIGINALS}/)`);
    done++;
  }

  return done;
}

/* -------------------------------------------------------------------- rebuild */

let timer = null;
let building = false;
let queued = false;

function rebuild() {
  if (building) { queued = true; return; }
  building = true;

  try {
    // Before the build, not after: the generator has to see the .jpg.
    convertHeic();
    trimLog();

    // Run the generator as a child process rather than calling growSite() in
    // here. ES modules are cached for the life of the process, so an imported
    // grow.js would keep rebuilding from whatever the code looked like when
    // the watcher started -- editing the generator would silently do nothing.
    const out = spawnSync(process.execPath, [path.join(__dirname, 'grow.js')], {
      cwd: root, encoding: 'utf8',
    });
    if (out.status !== 0) throw new Error((out.stderr || '').trim() || 'generator failed');

    const tally = /(\d+) pages? visited, (\d+) written/.exec(out.stdout || '');
    const pages = tally ? Number(tally[1]) : 0;
    const changed = tally ? Number(tally[2]) : 0;

    if (changed > 0) {
      log(`regrew ${changed} of ${pages} page${pages === 1 ? '' : 's'}`);
      if (!noPublish && config.publish && hasGitRemote()) publish();
      else if (!noPublish && config.publish) log('publishing on, but no git remote yet');
    }
  } catch (e) {
    log('build error:', e.message);
  } finally {
    building = false;
    if (queued) { queued = false; schedule(); }
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(rebuild, DEBOUNCE_MS);
}

/* --------------------------------------------------------------- finder poll */

let pollTimer = null;
let lastLayout = null;
let backoff = POLL_MS;
let finderQuiet = false; // so we complain about Finder at most once per outage

/**
 * Flattens the snapshot down to one comparable string per folder, keeping only
 * folders inside the garden. Finder happily reports every open window, and a
 * window onto some unrelated folder must not trigger a rebuild.
 */
function layoutOf(snapshot) {
  const lines = [];
  for (const dir of Object.keys(snapshot).sort()) {
    if (dir !== root && !dir.startsWith(root + path.sep)) continue;
    const items = snapshot[dir];
    for (const name of Object.keys(items).sort()) {
      const { x, y } = items[name].Iloc;
      lines.push(`${dir} ${name} ${x},${y}`);
    }
  }
  return lines.join('\n');
}

function poll() {
  // The folder can go away under us (unmounted volume, renamed Desktop). Stop
  // asking Finder about it until it comes back.
  if (!fs.existsSync(root)) {
    backoff = Math.min(backoff * 2, POLL_BACKOFF_MAX_MS);
    pollTimer = setTimeout(poll, backoff);
    return;
  }

  const snapshot = liveSnapshot();

  if (snapshot === null) {
    if (!finderQuiet) {
      finderQuiet = true;
      log('finder not answering — falling back to .DS_Store, will keep trying');
    }
    backoff = Math.min(backoff * 2, POLL_BACKOFF_MAX_MS);
    pollTimer = setTimeout(poll, backoff);
    return;
  }

  if (finderQuiet) { finderQuiet = false; log('finder answering again'); }
  backoff = POLL_MS;

  const layout = layoutOf(snapshot);
  // The first poll is only a baseline -- rebuild() already ran at startup.
  if (lastLayout !== null && layout !== lastLayout) {
    // schedule() rather than rebuild(): mid-drag every poll differs, and the
    // debounce collapses that into one build once the icons come to rest.
    schedule();
  }
  lastLayout = layout;

  pollTimer = setTimeout(poll, POLL_MS);
}

/* ---------------------------------------------------------------------- main */

if (!fs.existsSync(root)) {
  console.error(`source folder does not exist: ${root}`);
  console.error('set "source" in garden.config.json');
  process.exit(1);
}

log(`watching ${root}`);
log(`publish: ${!noPublish && config.publish ? 'on' : 'off'}`);
log(`finder poll: ${noPoll ? 'off' : `every ${POLL_MS}ms`}`);
rebuild();

if (!noPoll) poll();

try {
  fs.watch(root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const base = path.basename(filename);
    // Any dot segment, not just the last one: .thumbs/a.jpg has a basename of
    // "a.jpg", so checking only the basename let our own output retrigger the
    // build that had just written it.
    const parts = filename.split(path.sep);
    if (parts.some((p, i) => p.startsWith('.') && !(i === parts.length - 1 && p === '.DS_Store'))) return;
    if (base === 'index.html') return;
    if (base.endsWith('~') || base.startsWith('.#')) return;
    schedule();
  });
} catch (e) {
  console.error(`cannot watch ${root}: ${e.message}`);
  process.exit(1);
}

process.on('SIGINT', () => { clearTimeout(pollTimer); log('stopped'); process.exit(0); });
