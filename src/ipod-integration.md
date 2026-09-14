# wiring the iPod into grow.js

Everything the music window needs already exists in `src/assets/`:

- `src/assets/ipod.css` — the device
- `src/assets/ipod.js` — the behaviour
- `music/` — the content (see `music/README.txt`)

`copyAssets()` already copies **every** file in `src/assets/` into
`garden-assets/`, so `ipod.css` and `ipod.js` ship with no change to that
function. What follows is the rest: a parser, a markup block, and two tags.

Nothing here touches the folder-is-the-site idea — the player is driven
entirely by what is in `music/`.

---

## 1. the data shape

`ipod.js` reads one global, injected by the generator before the script tag:

```js
window.GARDEN_MUSIC = [
  {
    name:  "late night drives",                 // display name, sort prefix and extension stripped
    file:  "01 late night drives.txt",          // source filename — the localStorage key and dedupe key
    kind:  "playlist",                          // playlist | album | track | artist | episode | show
    id:    "37i9dQZF1DX4WYpdgoIcn6",            // Spotify base62 id
    embed: "https://open.spotify.com/embed/playlist/37i9dQZF1DX4WYpdgoIcn6?utm_source=generator",
    link:  "https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6",
    cover: "music/covers/deep-focus.jpg",       // href relative to the page, or null
    note:  "windows down, nothing to prove"     // string, may be ""
  }
];
```

Order in the array is the order on screen.

`ipod.js` re-validates and repairs every entry on the client, so the only
hard requirement is `name` plus **one** of `id`+`kind`, `embed`, or `link`.
Anything with none of those is dropped silently rather than drawn broken.
An absent or empty `window.GARDEN_MUSIC` is not an error — the screen shows
a legible "no music yet" panel and the wheel goes inert.

`cover` is used verbatim as an `<img src>`, so it must be correct **relative
to the page being written**. On a subpage, prefix it with `assetPrefix` (see
step 4). If the image 404s the tile falls back to a generated gradient, so a
wrong path degrades rather than breaks.

---

## 2. `readMusic(dir)` — paste into grow.js

Drop this in after the `describing a file` section, next to `describe()`.
Uses only `fs` and `path`, both already imported.

```js
/* -------------------------------------------------------------------- music
   The music/ folder is the playlist list. One text file per playlist, each
   holding a Spotify link — see music/README.txt. No audio is ever hosted;
   playback happens in Spotify's own embed iframe.
   ------------------------------------------------------------------------ */

const MUSIC_EXT = ['.txt', '.md', '.markdown', '.mdown'];
const COVER_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'];
const SPOTIFY_KINDS = ['playlist', 'album', 'track', 'artist', 'episode', 'show'];

/** Pulls {kind, id} out of a Spotify URL, a spotify: URI, or a bare id. */
function parseSpotify(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  const uri = s.match(/^spotify:([a-z]+):([A-Za-z0-9]+)/i);
  if (uri && SPOTIFY_KINDS.includes(uri[1].toLowerCase())) {
    return { kind: uri[1].toLowerCase(), id: uri[2] };
  }
  const url = s.match(/open\.spotify\.com\/(?:embed\/)?(?:intl-[a-z-]+\/)?([a-z]+)\/([A-Za-z0-9]+)/i);
  if (url && SPOTIFY_KINDS.includes(url[1].toLowerCase())) {
    return { kind: url[1].toLowerCase(), id: url[2] };
  }
  if (/^[A-Za-z0-9]{16,30}$/.test(s)) return { kind: 'playlist', id: s };   // a bare id
  return null;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Reads music/ into the array ipod.js expects. Returns [] when the folder
 * isn't there, which is the signal not to emit the window at all.
 * Covers come back relative to the site root (e.g. "music/covers/x.jpg").
 */
export function readMusic(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];                                   // no music/ folder — nothing to do
  }

  const base = path.basename(dir);

  // Index covers/ once, so a cover can also be found by name alone.
  const covers = new Map();
  try {
    for (const c of fs.readdirSync(path.join(dir, 'covers'))) {
      const ext = path.extname(c).toLowerCase();
      if (COVER_EXT.includes(ext)) covers.set(slug(path.basename(c, ext)), `covers/${c}`);
    }
  } catch { /* no covers/, that's fine */ }

  const files = entries
    .filter(e => e.isFile() &&
                 MUSIC_EXT.includes(path.extname(e.name).toLowerCase()) &&
                 !e.name.startsWith('.') &&
                 !/^readme\b/i.test(e.name))     // the instructions aren't a playlist
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));

  const out = [];
  for (const e of files) {
    let body;
    try { body = fs.readFileSync(path.join(dir, e.name), 'utf8'); } catch { continue; }

    // Liberal parse: `key: value` lines, plus any bare URL / URI / id line.
    const fields = {};
    const loose = [];
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      if (/^spotify:[a-z]+:/i.test(line)) { loose.push(line); continue; }   // it's a URI, not a key
      const kv = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(\S.*)$/);
      if (kv && !/^https?$/i.test(kv[1])) { fields[kv[1].toLowerCase()] = kv[2].trim(); continue; }
      loose.push(line);
    }

    const found = [fields.spotify, fields.url, fields.link, fields.playlist,
                   fields.album, fields.track, ...loose]
      .map(v => parseSpotify(v)).find(Boolean);
    if (!found) continue;                        // not a playlist file; skip it quietly

    const stem = path.basename(e.name, path.extname(e.name));
    const name = stem.replace(/^\d{1,3}[\s._)-]+\s*/, '').trim() || stem;   // drop the "01 " prefix

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
```

Verified against the shipped `music/` folder — all three accepted link
forms parse, `README.txt` is skipped, a missing folder returns `[]`.

---

## 3. the window markup

A `.win` in the same shape `renderWindow()` produces: `kind-ipod`, a
`.win-bar` with a title, meta and a roll-up button, and a `.win-body`.
No close button — closing the music window would strand the player behind a
`hidden` flag in localStorage with nothing to reopen it.

Add alongside `guestbookWindow()`:

```js
function musicWindow(music) {
  const n = music.length;
  return `      <div class="win kind-ipod" id="music" data-key="__music">
        <div class="win-bar">
          <span class="win-title">music</span>
          <span class="win-meta">${n} playlist${n === 1 ? '' : 's'}</span>
          <button class="win-btn js-collapse" type="button" title="roll up">_</button>
        </div>
        <div class="win-body">
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
        </div>
      </div>`;
}
```

The only interpolated value is the count, so nothing here needs
`escapeHtml`. `ipod.js` removes the `.ipod-noscript` line on boot, so it is
only ever seen by someone with scripting off.

The device is a fixed `292px` wide with `max-width: 100%`, which means
`.plantbed.freeform > .win { width: max-content }` measures it correctly —
the window hugs the iPod at 323px rather than stretching. Confirmed.

---

## 4. the four edits to `grow.js`

**a. read the folder once, in `growSite()`**, next to the other ctx fields:

```js
const ctx = {
  root,
  // ...
  music: readMusic(path.join(root, 'music')),
  written: { count: 0 },
};
```

**b. pass it through `grow()` into `renderPage()`:**

```js
const html = renderPage({
  siteName: ctx.siteName,
  // ...
  music: ctx.music,
});
```

**c. in `renderPage({ ..., music, assetPrefix, isRoot })`** — emit the window
on the root page only, the way the guestbook is, and re-base the covers:

```js
// Covers are stored relative to the site root; a subpage needs the prefix.
const musicData = (music ?? []).map(t =>
  t.cover ? { ...t, cover: assetPrefix + t.cover } : t);

const musicHtml = isRoot && musicData.length ? '\n' + musicWindow(musicData) : '';
```

then add `${musicHtml}` into the `.plantbed`, right after `${windows}`:

```js
    <div class="plantbed${positioned ? ' freeform' : ''}">
${windows}${musicHtml}
${isRoot ? guestbookWindow() + '\n      <div id="gb-notes"></div>' : ''}
    </div>
```

**d. the tags.** One `<link>` in `<head>`, after the existing stylesheet:

```html
  <link rel="stylesheet" href="${assetPrefix}garden-assets/style.css">
  <link rel="stylesheet" href="${assetPrefix}garden-assets/ipod.css">
```

and two `<script>`s at the end of `<body>`, after `app.js`:

```html
  <script src="${assetPrefix}garden-assets/app.js"></script>
  <script>window.GARDEN_MUSIC = ${JSON.stringify(musicData).replace(/</g, '\\u003c')};</script>
  <script src="${assetPrefix}garden-assets/ipod.js"></script>
```

The `replace` matters: playlist names and notes come from the owner's own
text files, and an unescaped `</script>` in one would end the tag early.

If you would rather not ship `ipod.css`/`ipod.js` on pages that have no
player, gate `musicHtml` and both tags on the same `isRoot && musicData.length`.

---

## 5. the `music/` folder on the site

`grow.js` will walk `music/` like any other folder and give it its own page
and a directory window. That is usually what you want — the folder is the
site, and a visitor can look at the text files. Two things to know:

- `music/covers/` gets its own `index.html` too. Harmless; add
  `music/covers/` to `.gardenignore` if you would rather it stayed quiet.
- `music/README.txt` is under the 2kB inline limit, so the folder page shows
  the instructions in full. That is a feature.

To hide the folder entirely and leave only the player, add `music/` to
`.gardenignore`. The cover images still deploy — `.gardenignore` only decides
what gets an `index.html` entry, not what exists in the repo.

---

## 6. what the player does, so you can describe it

- **tiles** — album grid in the screen; click one to play it.
- **click wheel** — `menu` backs out of the player (and scrolls the list to
  the top when already in the list); `‹‹`/`››` move the highlight, or switch
  playlist while playing; the centre button selects; `▶❙❙` plays the
  highlighted playlist, and while playing tears the iframe down and back up,
  which is the only way to stop a cross-origin embed from outside it.
- **keyboard** — the tile grid is a `role="listbox"` with `tabindex="0"` and
  `aria-activedescendant`. Arrow keys move (up/down by a computed column
  count), `Home`/`End` jump, `Enter`/`Space` select, `Escape`/`Backspace`
  go back. Every wheel button is a real focusable `<button>` with an
  `aria-label`. The whole thing works with no mouse.
- **lazy** — no iframe and zero requests to Spotify until someone selects
  something. Verified with `performance.getEntriesByType('resource')`.
- **memory** — the last-played playlist's `file` is stored under
  `garden:<siteName>:ipod.last`, using the same `get`/`set` helpers as
  `app.js`. On the next visit it is highlighted but **not** loaded, so the
  page stays fast.
- **covers** — a missing `cover:` or a 404 falls back to a gradient derived
  from a hash of the name, with the initials on it; hues are held inside the
  site's ochre-to-olive band so it never fights the palette.

## 7. a note on the stylesheet it was drawn to

`ipod.css` was written against the current `style.css` — the paper/ink
palette (`--paper`, `--surface`, `--ink`, `--ochre`, `--olive`, `--rule`,
`--serif`/`--sans`/`--mono`) and its rules: hairlines, no bevels, nothing
glows. Every token is used with a literal fallback (`var(--ochre, #A9752F)`),
so a renamed variable degrades to a sane colour instead of an invisible one.
`body.theme-ink` gets an explicit override block; `theme-olive` and
`theme-clean` need none, since they only move `--paper`.
