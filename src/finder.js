/**
 * finder.js — icon positions straight from Finder's memory.
 *
 * .DS_Store is only written when Finder feels like it (reliably on window
 * close, sporadically otherwise), so dragging an icon changes nothing on disk
 * for a long time. Finder itself knows the new position the instant the mouse
 * comes up, and it will tell us over Apple Events. That is what this file is
 * for: the same map parseDSStore() returns, but current.
 *
 * Only folders that are open in an icon-view Finder window are answered for.
 * A folder nobody is looking at has already had its .DS_Store flushed, so the
 * on-disk reader is the authority there -- and Finder's answer for a closed
 * folder can be stale or empty, which would be worse than not asking.
 *
 * No dependencies. Never throws: every failure is a null, so callers can tell
 * "Finder could not answer" from "Finder says this folder has no icons".
 */
import fs from 'fs';
import { spawnSync } from 'child_process';

// Record/unit separators. Filenames may contain commas, quotes, newlines and
// tabs, so AppleScript's default comma join is unparseable -- we build the
// string ourselves and delimit with control characters instead. The name is
// always the LAST field, so even a name containing a separator rejoins intact.
const RS = '\x1e';
const US = '\x1f';

const OSASCRIPT_TIMEOUT_MS = 5000;

/* ------------------------------------------------------------------ scripts */

// Positions for one folder, if it is open in an icon-view window.
const ONE_FOLDER = `on run argv
  set wanted to item 1 of argv
  set RS to character id 30
  set US to character id 31
  tell application "Finder"
    try
      set tgt to folder (POSIX file wanted as alias)
    on error
      return "ERR"
    end try
    set found to false
    repeat with k from 1 to count of Finder windows
      set w to Finder window k
      try
        set wp to POSIX path of (target of w as alias)
        if wp ends with "/" then set wp to text 1 thru -2 of wp
        if wp is wanted and (current view of w) is icon view then
          set found to true
          exit repeat
        end if
      end try
    end repeat
    if not found then return "NOWINDOW"
    set ns to name of every item of tgt
    set ps to position of every item of tgt
    set out to "OK"
    repeat with k from 1 to count of ns
      set pos to item k of ps
      if pos is not missing value then
        set out to out & RS & ((item 1 of pos) as integer as text) & US & ((item 2 of pos) as integer as text) & US & (item k of ns)
      end if
    end repeat
    return out
  end tell
end run`;

// Every open icon-view window in one shot, so the watcher can poll for drags
// anywhere -- including subfolders -- without one osascript call per folder.
const ALL_WINDOWS = `on run
  set RS to character id 30
  set US to character id 31
  tell application "Finder"
    set out to "OK"
    repeat with k from 1 to count of Finder windows
      set w to Finder window k
      try
        if (current view of w) is icon view then
          set tgt to target of w
          set wp to POSIX path of (tgt as alias)
          if wp ends with "/" then set wp to text 1 thru -2 of wp
          set ns to name of every item of tgt
          set ps to position of every item of tgt
          repeat with j from 1 to count of ns
            set pos to item j of ps
            if pos is not missing value then
              set out to out & RS & wp & US & ((item 1 of pos) as integer as text) & US & ((item 2 of pos) as integer as text) & US & (item j of ns)
            end if
          end repeat
        end if
      end try
    end repeat
    return out
  end tell
end run`;

/* ------------------------------------------------------------------ running */

/**
 * Runs an AppleScript and hands back stdout, or null if anything at all went
 * wrong. The hard timeout matters: Finder can wedge behind a modal sheet or a
 * stalled network volume, and a watcher that blocks forever on a poll is worse
 * than one that misses a drag.
 */
function run(script, args) {
  if (process.platform !== 'darwin') return null;

  let r;
  try {
    r = spawnSync('osascript', ['-e', script, ...args], {
      encoding: 'utf8',
      timeout: OSASCRIPT_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    return null;
  }

  // error covers spawn failure and the timeout kill; status covers Finder not
  // running and automation permission being denied (error -1743), which the
  // owner sees as a one-time "allow control" prompt the first time through.
  if (r.error || r.status !== 0) return null;
  return r.stdout ?? null;
}

/**
 * Turns one `x<US>y<US>name` record into an entry. Returns null for anything
 * malformed rather than guessing, so a single odd row cannot poison the map.
 */
function addRecord(out, fields) {
  const x = Number(fields[0]);
  const y = Number(fields[1]);
  const name = fields.slice(2).join(US);
  if (!name || !Number.isFinite(x) || !Number.isFinite(y)) return;

  out[name] = { Iloc: { x, y } };

  // APFS hands back whatever normalization was written; HFS+ decomposes. If
  // Finder and readdir() ever disagree, an alias key keeps lookups working.
  const nfc = name.normalize('NFC');
  if (nfc !== name) out[nfc] = { Iloc: { x, y } };
}

/* -------------------------------------------------------------------- public */

/**
 * Live icon positions for one folder, shaped exactly like parseDSStore():
 * `{ [filename]: { Iloc: { x, y } } }`.
 *
 * Returns null when Finder cannot or should not answer -- not macOS, Finder
 * not running, permission denied, folder missing, folder not open in an
 * icon-view window, osascript failed or timed out. A null means "fall back to
 * .DS_Store"; an empty object means "Finder looked, there are no icons".
 */
export function livePositions(dir) {
  let real;
  try {
    // Finder reports resolved paths (/tmp is really /private/tmp), so compare
    // like with like or the window match silently never fires.
    real = fs.realpathSync(dir);
  } catch {
    return null;
  }

  const stdout = run(ONE_FOLDER, [real]);
  if (stdout === null) return null;

  const records = stdout.replace(/\n$/, '').split(RS);
  if (records[0] !== 'OK') return null;

  const out = {};
  for (let i = 1; i < records.length; i++) {
    if (records[i]) addRecord(out, records[i].split(US));
  }
  return out;
}

/**
 * Live positions for every folder currently open in an icon-view window, as
 * `{ [folderPath]: { [filename]: { Iloc: { x, y } } } }`. One osascript call
 * however many windows are open, which is what makes second-by-second polling
 * affordable. Returns null on the same failures as livePositions().
 */
export function liveSnapshot() {
  const stdout = run(ALL_WINDOWS, []);
  if (stdout === null) return null;

  const records = stdout.replace(/\n$/, '').split(RS);
  if (records[0] !== 'OK') return null;

  const out = {};
  for (let i = 1; i < records.length; i++) {
    if (!records[i]) continue;
    const fields = records[i].split(US);
    if (fields.length < 4) continue;
    const dir = fields[0];
    (out[dir] ??= {});
    addRecord(out[dir], fields.slice(1));
  }
  return out;
}

/**
 * Looks one folder up in a liveSnapshot(), or null if Finder had nothing for
 * it. Separate from plain property access because Finder reports resolved
 * paths while a walker may hold an unresolved one -- through a symlinked
 * source folder the two spellings differ and every lookup would quietly miss.
 *
 * Pass the whole snapshot once per build rather than calling livePositions()
 * per folder: that is one osascript round trip instead of one for every
 * directory in the garden.
 */
export function positionsFor(snapshot, dir) {
  if (!snapshot) return null;
  if (snapshot[dir]) return snapshot[dir];
  try {
    return snapshot[fs.realpathSync(dir)] ?? null;
  } catch {
    return null;
  }
}
