# wiring the iPod into grow.js

The player is three files, all of them already written:

- `src/assets/ipod.css` — the device, the shell it sits in, the dock
- `src/assets/ipod.js` — the behaviour, the YouTube player, the dock controls
- `music/` — the content (see `music/README.txt`)

`copyAssets()` already copies **every** file in `src/assets/` into
`garden-assets/`, so those two ship with no change to that function.

What `grow.js` still has to do is small: read `music/`, and emit the chassis
**outside `<main>`** on every page. Section 5 is the exact diff.

---

## 1. what changed, and why

The player used to be a Spotify embed living in a `.item` inside `<main>` on
the front page only. Three things were wrong with that:

1. **Spotify's embed has no controls.** A cross-origin iframe cannot be
   told to play, pause or skip, so the only "pause" available was to delete
   the iframe. YouTube publishes an official IFrame Player API, so the click
   wheel can now drive real playback.
2. **It died on navigation.** Every folder is a real page, so walking into
   `art/` tore the document down and the music with it. `app.js` now swaps
   `<main>` client-side instead — which only helps if the player is not
   inside `<main>`. It now lives in `#ipod-shell`, a sibling of
   `#clock-shell`, and is never rebuilt.
3. **It was front-page only.** A visitor landing on `anmo.garden/art/` got
   no player at all. It is emitted on every page now. It costs the folder
   pages no layout, because it is fixed to the corner rather than laid out
   in the plantbed.

Spotify is still supported and still parsed. It is no longer the default.

---

## 2. the data shape

`ipod.js` reads one global, injected by the generator before the script tag:

```js
window.GARDEN_MUSIC = [
  {
    name:  "music",                      // display name, sort prefix and extension stripped
    file:  "01 music.txt",               // source filename — the localStorage key
    src:   "youtube",                    // "youtube" | "spotify"   <-- NEW
    kind:  "playlist",                   // youtube: playlist|video
                                         // spotify: playlist|album|track|artist|episode|show
    id:    "PLXWFWrURanY0",
    embed: "https://www.youtube.com/embed/videoseries?list=PLXWFWrURanY0",
    link:  "https://www.youtube.com/playlist?list=PLXWFWrURanY0",
    cover: "music/covers/x.jpg",         // href relative to the page, or null
    note:  "a line under the tile"       // string, may be ""
  }
];
```

Order in the array is the order on screen.

`ipod.js` re-validates and repairs every entry on the client. `src` is a
hint, not a contract: if it is missing or disagrees with the URL, the URL
wins. The only hard requirement is `name` plus **one** of `id`+`kind`+`src`,
`embed`, `link`, or `url`. Anything with none of those is dropped silently
rather than drawn broken. An absent or empty `window.GARDEN_MUSIC` shows a
legible "no music yet" panel and leaves the wheel inert.

This means the OLD Spotify-shaped data (no `src` field) still works — the
source is re-derived from `embed`. Nothing that used to play stops playing.

`cover` is used verbatim as an `<img src>`, so it must be correct relative
to the page being written; on a subpage, prefix it with `assetPrefix`. A
404 falls back to the generated gradient, so a wrong path degrades.

**Covers are never fetched from YouTube.** `i.ytimg.com` thumbnails would
be a third-party request on page load, and the one property this player
must keep is that a page makes zero off-origin requests until somebody
presses play.

---

## 3. the two structural rules

These are the whole design. Break either and the music stops.

**The chassis lives outside `<main>`.** `app.js` replaces `<main>` wholesale
on internal navigation. Anything inside it at that moment is destroyed.
`grow.js` emits `#ipod-shell` next to `#clock-shell`; as a belt-and-braces
measure `ipod.js` also lifts a stray `.ipod` out of `<main>` on boot (a move
made before any iframe exists, so it cannot interrupt playback) and removes
the empty `.item` wrapper it came in. That fallback is why the player still
works if the diff below is only half-applied.

**The stage is a layer, not a view.** The screen's views are toggled with
`display: none`, and an iframe in a box that gets `display: none` is an
iframe that has stopped. `.ipod-stage` is therefore positioned absolutely
over the screen and merely *covered* by the tile list, so pressing MENU no
longer stops anything. `ipod.js` moves it there on boot and measures the
bar's height into `--ipod-bar-h` so the layer starts below it.

Same reasoning for the dock: docking and parking are **transforms**, never
`display` changes, so the music keeps playing in both states.

---

## 4. the `music/` folder

One text file per playlist. A bare YouTube URL on a line is enough;
`key: value` lines (`url`, `youtube`, `spotify`, `link`, `playlist`,
`cover`, `note`) are the longer form. `README.txt` is ignored. Ordering is
by filename, so a numeric prefix chooses the order and is stripped for
display. `music/README.txt` is written for the owner and explains all of it.

---

## 5. the diff to `grow.js`

Everything above is already true of `ipod.js` and `ipod.css`. This is the
remaining half. Applied against `src/grow.js`; it touches only the music
section, `musicWindow()`, and `renderPage()`.

In prose, six changes:

1. `parseYouTube()` added; `parseSpotify()` now returns `src: 'spotify'`;
   `parseSource()` tries YouTube first. `embedUrl()`/`openUrl()` build the
   right URL per source.
2. `readMusic()` looks at `fields.youtube`/`fields.video` too, parses with
   `parseSource`, and emits `src`.
3. `musicWindow()` no longer wraps the device in a `.item` with an `<h3>`;
   it returns `#ipod-shell` directly. Empty-state copy says YouTube.
4. `showMusic` drops the `isRoot` condition — the player goes on every page.
5. The `#music { top; left }` rules and the `+ 560` plantbed padding are
   deleted from both layout branches; the player is no longer laid out.
6. The page-specific `<style>` gets `id="page-style"` so `app.js` can find
   it to swap. (`app.js` falls back to the first `<style>` in `<head>` if
   the id is absent, so this one is a nicety, not a requirement.)

```diff
@@ -278,31 +278,75 @@
 
 /* -------------------------------------------------------------------- music
    The music/ folder is the playlist list: one text file per playlist, each
-   holding a Spotify link (see music/README.txt). No audio is ever hosted --
-   playback happens inside Spotify's own embed, so nothing here is a copy.
+   holding a YouTube link (see music/README.txt). No audio is ever hosted --
+   playback happens inside YouTube's own player, so nothing here is a copy.
+   Spotify links still work; they play in Spotify's embed, which offers no
+   controls, so the click wheel can do less with them. YouTube is primary.
    ------------------------------------------------------------------------ */
 
 const MUSIC_EXT = ['.txt', '.md', '.markdown', '.mdown'];
 const COVER_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'];
 const SPOTIFY_KINDS = ['playlist', 'album', 'track', 'artist', 'episode', 'show'];
 
-/** Pulls {kind, id} out of a Spotify URL, a spotify: URI, or a bare id. */
+// YouTube list ids: PL (made by hand), UU (a channel's uploads), OL, LL, FL,
+// RD (a generated radio). Anything else has to arrive as a URL, so a bare
+// Spotify id can never be mistaken for a YouTube one.
+const YT_LIST = /^(?:PL|UU|OL|LL|FL|RD)[A-Za-z0-9_-]{8,}$/;
+const YT_HOST = /(?:^|\/\/|\.)(?:youtube\.com|youtube-nocookie\.com|youtu\.be|music\.youtube\.com)/i;
+
+/** Pulls {src, kind, id} out of a YouTube URL, or a bare playlist id. */
+function parseYouTube(raw) {
+  const str = String(raw ?? '').trim();
+  if (!str) return null;
+
+  if (YT_LIST.test(str)) return { src: 'youtube', kind: 'playlist', id: str };
+  if (!YT_HOST.test(str)) return null;
+
+  // A playlist wins over the video it happens to point at: someone sharing
+  // "watch?v=...&list=..." is sharing their playlist.
+  const list = str.match(/[?&;]list=([A-Za-z0-9_-]{10,})/);
+  if (list) return { src: 'youtube', kind: 'playlist', id: list[1] };
+
+  const watch = str.match(/[?&;]v=([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/)
+             ?? str.match(/youtu\.be\/([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/)
+             ?? str.match(/\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/);
+  if (watch) return { src: 'youtube', kind: 'video', id: watch[1] };
+
+  return null;
+}
+
+/** Pulls {src, kind, id} out of a Spotify URL, a spotify: URI, or a bare id. */
 function parseSpotify(raw) {
   const str = String(raw ?? '').trim();
   if (!str) return null;
 
   const uri = str.match(/^spotify:([a-z]+):([A-Za-z0-9]+)/i);
   if (uri && SPOTIFY_KINDS.includes(uri[1].toLowerCase())) {
-    return { kind: uri[1].toLowerCase(), id: uri[2] };
+    return { src: 'spotify', kind: uri[1].toLowerCase(), id: uri[2] };
   }
   const url = str.match(/open\.spotify\.com\/(?:embed\/)?(?:intl-[a-z-]+\/)?([a-z]+)\/([A-Za-z0-9]+)/i);
   if (url && SPOTIFY_KINDS.includes(url[1].toLowerCase())) {
-    return { kind: url[1].toLowerCase(), id: url[2] };
+    return { src: 'spotify', kind: url[1].toLowerCase(), id: url[2] };
   }
-  if (/^[A-Za-z0-9]{16,30}$/.test(str)) return { kind: 'playlist', id: str };
+  if (/^[A-Za-z0-9]{16,30}$/.test(str)) return { src: 'spotify', kind: 'playlist', id: str };
   return null;
 }
 
+/** YouTube first: it is the house source now. */
+const parseSource = (raw) => parseYouTube(raw) ?? parseSpotify(raw);
+
+const embedUrl = (f) => f.src === 'youtube'
+  ? (f.kind === 'playlist'
+      ? `https://www.youtube.com/embed/videoseries?list=${f.id}`
+      : `https://www.youtube.com/embed/${f.id}`)
+  : `https://open.spotify.com/embed/${f.kind}/${f.id}?utm_source=generator`;
+
+const openUrl = (f) => f.src === 'youtube'
+  ? (f.kind === 'playlist'
+      ? `https://www.youtube.com/playlist?list=${f.id}`
+      : `https://www.youtube.com/watch?v=${f.id}`)
+  : `https://open.spotify.com/${f.kind}/${f.id}`;
+
 const slug = (str) => String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
 
 /**
@@ -353,9 +397,10 @@
       loose.push(line);
     }
 
-    const found = [fields.spotify, fields.url, fields.link, fields.playlist,
-                   fields.album, fields.track, ...loose]
-      .map(v => parseSpotify(v)).find(Boolean);
+    const found = [fields.youtube, fields.spotify, fields.url, fields.link,
+                   fields.playlist, fields.album, fields.track, fields.video,
+                   ...loose]
+      .map(v => parseSource(v)).find(Boolean);
     if (!found) continue;
 
     const stem = path.basename(e.name, path.extname(e.name));
@@ -367,10 +412,11 @@
     out.push({
       name,
       file: e.name,
+      src: found.src,
       kind: found.kind,
       id: found.id,
-      embed: `https://open.spotify.com/embed/${found.kind}/${found.id}?utm_source=generator`,
-      link: `https://open.spotify.com/${found.kind}/${found.id}`,
+      embed: embedUrl(found),
+      link: openUrl(found),
       cover: rel ? encodeURI(`${base}/${rel}`) : null,
       note: fields.note || fields.caption || '',
     });
@@ -378,10 +424,15 @@
   return out;
 }
 
+/**
+ * The player is NOT part of the page. It is emitted outside <main>, beside
+ * the clock, because app.js replaces <main> wholesale when a visitor walks
+ * into a folder -- and anything still inside <main> at that moment is
+ * destroyed, iframe and all. Out here it simply never stops.
+ * ipod.css fixes the shell to the corner of the screen and docks it.
+ */
 function musicWindow(music) {
-  const n = music.length;
-  return `      <div class="item kind-ipod" id="music" data-key="__music">
-        <h3>music <span class="meta">(${n} playlist${n === 1 ? '' : 's'})</span></h3>
+  return `  <div id="ipod-shell" class="ipod-shell">
           <div class="ipod" id="ipod" role="group" aria-label="iPod music player"
                data-view="list" data-player="off">
 
@@ -408,7 +459,7 @@
               <div class="ipod-view ipod-view-empty">
                 <div class="ipod-empty">
                   <strong>no music yet</strong>
-                  <span>put a Spotify link in a text file in <code>music/</code> and regrow.</span>
+                  <span>put a YouTube link in a text file in <code>music/</code> and regrow.</span>
                 </div>
               </div>
             </div>
@@ -430,7 +481,7 @@
 
             <p class="ipod-noscript">this player needs JavaScript.</p>
           </div>
-      </div>`;
+  </div>`;
 }
 
 function guestbookWindow() {
@@ -462,7 +513,10 @@
   // Covers are stored relative to the site root; a subpage needs the prefix.
   const musicData = (music ?? []).map(t =>
     t.cover ? { ...t, cover: assetPrefix + t.cover } : t);
-  const showMusic = isRoot && musicData.length > 0;
+  // On every page, not just the front one: the player has to already exist
+  // wherever a visitor happens to land, and it is no longer laid out as part
+  // of the plantbed, so it costs the folder pages no space.
+  const showMusic = musicData.length > 0;
 
   // Freeform positions live in a media query so phones get the plain stack
   // defined in the base stylesheet and wide screens get the Finder layout.
@@ -487,16 +541,10 @@
     const rules = laid.map(l =>
       `      #p${l.i} { top: ${l.y}px; left: ${l.x}px; }`).join('\n');
 
-    // The player has no icon in .DS_Store to inherit a spot from, so it sits
-    // below the scatter -- pushing it off to the right would put it past the
-    // window edge, and the body clips horizontally.
-    const musicRule = showMusic ? `\n      #music { top: ${maxY}px; left: 0px; }` : '';
-    const bedHeight = showMusic ? maxY + 560 : maxY;
-
     freeform = `
     @media (min-width: 560px) {
-      .plantbed { min-height: ${bedHeight}px; max-width: 68rem; margin: 0 auto; }
-${rules}${musicRule}
+      .plantbed { min-height: ${maxY}px; max-width: 68rem; margin: 0 auto; }
+${rules}
     }`;
   }
 
@@ -511,16 +559,10 @@
     const rules = files.map((f, i) =>
       `      #p${i} { top: ${f.y - minY + TOP_PADDING}px; left: ${f.x - minX}px; }`).join('\n');
 
-    // The player has no icon in .DS_Store to inherit a spot from, so it sits
-    // below the arrangement -- pushing it off to the right would put it past
-    // the window edge, and the body clips horizontally.
-    const musicRule = showMusic ? `\n      #music { top: ${height}px; left: 0px; }` : '';
-    const bedHeight = showMusic ? height + 560 : height;
-
     freeform = `
     @media (min-width: 560px) {
-      .plantbed { min-height: ${bedHeight}px; margin-left: max(0px, calc(50% - ${halfWidth}px - 13rem)); }
-${rules}${musicRule}
+      .plantbed { min-height: ${height}px; margin-left: max(0px, calc(50% - ${halfWidth}px - 13rem)); }
+${rules}
     }`;
   }
 
@@ -560,7 +602,7 @@
   <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ctext y='13' font-size='13'%3E%F0%9F%8C%B1%3C/text%3E%3C/svg%3E">
   <link rel="stylesheet" href="${assetPrefix}garden-assets/style.css">
 ${showMusic ? `  <link rel="stylesheet" href="${assetPrefix}garden-assets/ipod.css">\n` : ''}\
-  <style>${freeform}
+  <style id="page-style">${freeform}
   </style>
 </head>
 
@@ -569,11 +611,12 @@
     <pre id="clock"></pre>
     <p id="clock-date"></p>
   </div>
+${showMusic ? musicWindow(musicData) + '\n' : ''}\
 
   <main>
 ${head}
     <div class="plantbed${positioned ? ' freeform' : ' scattered'}">
-${items}${showMusic ? '\n' + musicWindow(musicData) : ''}
+${items}
     </div>
 ${showGuestbook ? `
     <section class="guestbed" id="gb-notes">
```

---

## 6. what the player does, so you can describe it

- Nothing third-party is requested until the visitor presses play — not the
  iframe, not the YouTube API script itself.
- Selecting a tile starts it. MENU goes back to the tiles **without**
  stopping it.
- On YouTube the wheel is a real wheel: `▶❙❙` plays and pauses, `‹‹` and
  `››` are previous and next **track**. On Spotify, which exposes no
  controls, `▶❙❙` mounts and unmounts the embed and `‹‹`/`››` step to the
  previous/next **playlist**.
- Walking into a folder does not stop the music. Neither does Back.
- `‹‹` in the player's top bar pushes it off the left edge, leaving a small
  labelled tab. The tab brings it back. It keeps playing while docked.
- `music` in the taskbar parks it entirely. It keeps playing while parked.
- Both states are remembered in `localStorage` (`ipod.docked`,
  `toggle.music`), wrapped in try/catch because storage throws in private
  windows. A first visit starts docked below 900px and open above it.
- Playback itself is deliberately **not** resumed after a full reload. The
  last-played tile is highlighted, nothing more; starting audio on arrival
  is rude and browsers block it anyway.

---

## 7. the stylesheet it was drawn to

`ipod.css` is scoped entirely under `.ipod`, `.ipod-shell` and `.ipod-tab`,
uses only the tokens at the top of `style.css` — bone paper, ink, one ochre,
one olive — and gives every `var()` a literal fallback, so it cannot break
if a token is renamed. It handles the alternate papers, including
`theme-ink`. It introduces no colours of its own.

**No change to `style.css` is needed.** The one page-level rule the
navigation wants (`body.is-navigating { cursor: progress }`) is carried in
`ipod.css`, which now ships on every page. If `music/` is ever emptied, that
rule stops shipping and internal navigation simply loses its busy cursor —
a cosmetic loss and nothing more. Move it into `style.css` if that ever
matters; do not put it in both.
