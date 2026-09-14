#!/usr/bin/env node
/**
 * watch.js — keep the site in sync with the folder, live.
 *
 * Watches the source folder. When anything changes it regrows the pages and,
 * if publishing is turned on in garden.config.json, commits and pushes so the
 * public site follows along a minute or so later.
 *
 * Usage:  node src/watch.js [--no-publish] [--serve]
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

import { growSite, loadConfig } from './grow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(__dirname, '..');

const argv = process.argv.slice(2);
const noPublish = argv.includes('--no-publish');

const config = loadConfig(path.join(PROJECT, 'garden.config.json'));
const root = path.resolve((config.source ?? PROJECT).replace(/^~/, process.env.HOME ?? '~'));

const DEBOUNCE_MS = config.debounceMs ?? 2000;

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

/* -------------------------------------------------------------------- rebuild */

let timer = null;
let building = false;
let queued = false;

function rebuild() {
  if (building) { queued = true; return; }
  building = true;

  try {
    const { pages, changed } = growSite({ quiet: true });
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

/* ---------------------------------------------------------------------- main */

if (!fs.existsSync(root)) {
  console.error(`source folder does not exist: ${root}`);
  console.error('set "source" in garden.config.json');
  process.exit(1);
}

log(`watching ${root}`);
log(`publish: ${!noPublish && config.publish ? 'on' : 'off'}`);
rebuild();

try {
  fs.watch(root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const base = path.basename(filename);
    // Our own output, and Finder/editor scratch files, shouldn't retrigger.
    if (base === 'index.html' || base.startsWith('.') && base !== '.DS_Store') return;
    if (base.endsWith('~') || base.startsWith('.#')) return;
    schedule();
  });
} catch (e) {
  console.error(`cannot watch ${root}: ${e.message}`);
  process.exit(1);
}

process.on('SIGINT', () => { log('stopped'); process.exit(0); });
