/* ==========================================================================
   garden — ipod.js
   The music window: a click-wheel iPod whose screen holds album tiles and,
   on select, a Spotify embed.

   No audio is ever hosted by this site. Playback goes through Spotify's
   official embed iframe (open.spotify.com/embed/...), which is free, needs
   no API key, gives anonymous visitors 30-second previews and full tracks
   to anyone signed in to Spotify. The iframe is created only when a
   playlist is selected — never on page load.

   DATA CONTRACT — the generator injects, before this script:

     window.GARDEN_MUSIC = [
       {
         name:  "dream pop",                         // display name (required)
         file:  "01 dream pop.txt",                  // source file, for keys
         kind:  "playlist",                          // playlist | album | track
         id:    "37i9dQZF1DX0hvSv6cNiG3",            // Spotify id (required)
         embed: "https://open.spotify.com/embed/playlist/37i9dQZF1DX0hvSv6cNiG3",
         link:  "https://open.spotify.com/playlist/37i9dQZF1DX0hvSv6cNiG3",
         cover: "music/covers/dream-pop.jpg",        // href or null
         note:  "for the train ride home"            // string, may be ""
       }
     ];

   Only `name` plus one of `id` / `embed` / `link` is strictly required;
   everything else is repaired or defaulted here. See src/ipod-integration.md.
   ========================================================================== */
(function () {
  'use strict';

  var CFG = window.GARDEN_CONFIG || {};
  var STORE = 'garden:' + (CFG.siteName || 'garden') + ':';

  /* ------------------------------------------------------------ storage
     Same shape as the helpers in app.js, repeated so this file can be
     dropped in on its own. Keys used here all start with "ipod.". */

  function get(key, fallback) {
    try {
      var v = localStorage.getItem(STORE + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  }
  function set(key, value) {
    try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch (e) {}
  }

  /* -------------------------------------------------------------- utils */

  var KINDS = { playlist: 1, album: 1, track: 1, artist: 1, episode: 1, show: 1 };

  /** Pull {kind, id} out of any Spotify URL, URI or bare id we are handed. */
  function parseSpotify(raw) {
    if (!raw) return null;
    var s = String(raw).trim();

    // spotify:playlist:37i9dQZF1DX0hvSv6cNiG3
    var uri = s.match(/^spotify:([a-z]+):([A-Za-z0-9]+)/);
    if (uri && KINDS[uri[1]]) return { kind: uri[1], id: uri[2] };

    // https://open.spotify.com/[embed/][intl-de/]playlist/ID?si=...
    var url = s.match(/open\.spotify\.com\/(?:embed\/)?(?:intl-[a-z-]+\/)?([a-z]+)\/([A-Za-z0-9]+)/);
    if (url && KINDS[url[1]]) return { kind: url[1], id: url[2] };

    // a bare base62 id — assume a playlist, which is what this folder is for
    if (/^[A-Za-z0-9]{16,30}$/.test(s)) return { kind: 'playlist', id: s };

    return null;
  }

  function embedUrl(kind, id) {
    return 'https://open.spotify.com/embed/' + kind + '/' + id + '?utm_source=generator';
  }
  function openUrl(kind, id) {
    return 'https://open.spotify.com/' + kind + '/' + id;
  }

  /** Stable small hash, so a playlist always gets the same fallback colours. */
  function hash(str) {
    var h = 2166136261, i;
    for (i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function initials(name) {
    var words = String(name)
      .replace(/['\u2019]/g, '')          // don't let "today's" split into two words
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/).filter(Boolean);
    if (!words.length) return '♪';                    // eighth note
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  function el(tag, cls) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  }

  /* ---------------------------------------------------------- the data */

  /** Repair whatever the generator handed us; drop anything unplayable. */
  function normalize(raw) {
    if (!raw || !raw.length) return [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var t = raw[i];
      if (!t || typeof t !== 'object') continue;

      var found = null;
      if (t.kind && t.id && KINDS[t.kind]) found = { kind: t.kind, id: t.id };
      if (!found) found = parseSpotify(t.embed);
      if (!found) found = parseSpotify(t.link);
      if (!found) found = parseSpotify(t.spotify);   // tolerate the raw key name
      if (!found) continue;                          // nothing playable — skip

      var name = String(t.name || t.title || t.file || found.id).trim();
      out.push({
        name: name,
        file: t.file || name,
        kind: found.kind,
        id: found.id,
        embed: t.embed && /open\.spotify\.com\/embed\//.test(t.embed)
          ? t.embed : embedUrl(found.kind, found.id),
        link: t.link || openUrl(found.kind, found.id),
        cover: t.cover || null,
        note: t.note ? String(t.note) : ''
      });
    }
    return out;
  }

  /* ------------------------------------------------------------ device */

  function mount(root) {
    var tracks = normalize(window.GARDEN_MUSIC);

    var bar     = root.querySelector('.ipod-bar-title');
    var back    = root.querySelector('.ipod-back');
    var list    = root.querySelector('.ipod-list');
    var stage   = root.querySelector('.ipod-stage');
    var ticker  = root.querySelector('.ipod-ticker');
    var paused  = root.querySelector('.ipod-paused-name');
    var noscript = root.querySelector('.ipod-noscript');
    if (noscript) noscript.remove();

    // --- nothing to play: say so, plainly, and stop.
    if (!tracks.length) {
      root.setAttribute('data-view', 'empty');
      if (bar) bar.textContent = 'no music';
      if (ticker) {
        ticker.textContent = window.GARDEN_MUSIC
          ? 'the music folder has no playable playlists yet'
          : 'no playlist data was injected into this page';
      }
      // Leave the wheel inert rather than throwing on every press.
      root.querySelectorAll('.ipod-btn').forEach(function (b) { b.disabled = true; });
      return;
    }

    var state = {
      view: 'list',        // list | player
      index: 0,            // which tile the wheel is pointing at
      playing: -1,         // which tile is loaded in the embed, -1 for none
      live: false          // is the iframe currently mounted
    };

    /* ---------------------------------------------------------- tiles */

    var tiles = [];
    var uid = 'ipod-' + (root.id || 'x') + '-';

    tracks.forEach(function (t, i) {
      var tile = el('div', 'ipod-tile');
      tile.id = uid + i;
      tile.setAttribute('role', 'option');
      tile.setAttribute('aria-selected', 'false');
      tile.setAttribute('aria-label', t.name + (t.note ? ' — ' + t.note : ''));
      tile.title = t.note ? t.name + ' — ' + t.note : t.name;

      // Fallback art is deterministic: the same name always draws the same
      // tile. Hues stay inside the site's ochre-to-olive band (see ipod.css).
      var art = el('div', 'ipod-tile-art');
      var h = hash(t.name);
      art.style.setProperty('--h1', String(26 + (h % 70)));
      art.style.setProperty('--h2', String(26 + ((h >> 8) % 70)));
      art.style.setProperty('--l',  String(62 + ((h >> 16) % 22)));

      function generated() {
        art.className = 'ipod-tile-art is-generated';
        art.innerHTML = '';
        var ini = el('span', 'ipod-tile-initials');
        ini.textContent = initials(t.name);
        art.appendChild(ini);
      }

      if (t.cover) {
        var img = document.createElement('img');
        img.src = t.cover;
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.addEventListener('error', generated);     // missing file -> gradient
        art.appendChild(img);
      } else {
        generated();
      }

      var label = el('div', 'ipod-tile-name');
      label.textContent = t.name;

      tile.appendChild(art);
      tile.appendChild(label);
      tile.addEventListener('click', function () {
        state.index = i;
        paint();
        select();
      });

      list.appendChild(tile);
      tiles.push(tile);
    });

    /* --------------------------------------------------------- drawing */

    function columns() {
      if (!tiles.length) return 1;
      var w = tiles[0].offsetWidth;
      if (!w) return 1;
      return Math.max(1, Math.round(list.clientWidth / w));
    }

    function paint() {
      for (var i = 0; i < tiles.length; i++) {
        var on = i === state.index;
        tiles[i].setAttribute('aria-selected', on ? 'true' : 'false');
        if (i === state.playing) tiles[i].classList.add('is-playing');
        else tiles[i].classList.remove('is-playing');
      }
      list.setAttribute('aria-activedescendant', uid + state.index);

      var cur = tracks[state.index];
      if (state.view === 'list') {
        bar.textContent = 'playlists';
        ticker.textContent = cur.note ? cur.name + ' — ' + cur.note : cur.name;
      } else {
        var now = tracks[state.playing] || cur;
        bar.textContent = now.name;
        ticker.innerHTML = '';
        var a = document.createElement('a');
        a.href = now.link;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = 'open in Spotify ↗';
        ticker.appendChild(document.createTextNode(
          (now.note ? now.note + ' · ' : '')));
        ticker.appendChild(a);
      }

      var t = tiles[state.index];
      if (t && t.scrollIntoView) t.scrollIntoView({ block: 'nearest' });
    }

    /* ---------------------------------------------------- the embed */

    function loadEmbed(i) {
      var t = tracks[i];
      stage.innerHTML = '';
      var frame = document.createElement('iframe');
      frame.src = t.embed;
      frame.title = 'Spotify player: ' + t.name;
      frame.loading = 'lazy';
      frame.setAttribute('frameborder', '0');
      // `allow` already grants fullscreen; the legacy attribute only warns.
      frame.setAttribute('allow',
        'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture');
      stage.appendChild(frame);
      state.live = true;
      root.setAttribute('data-player', 'on');
    }

    function unloadEmbed() {
      stage.innerHTML = '';                 // the only way to stop a cross-origin embed
      state.live = false;
      root.setAttribute('data-player', 'off');
      if (paused) paused.textContent = (tracks[state.playing] || {}).name || '';
    }

    function select() {
      state.playing = state.index;
      state.view = 'player';
      root.setAttribute('data-view', 'player');
      loadEmbed(state.playing);
      set('ipod.last', tracks[state.playing].file);
      paint();
      back.focus();
    }

    function toMenu() {
      if (state.view === 'list') {
        list.scrollTop = 0;
        state.index = 0;
      } else {
        unloadEmbed();
        state.view = 'list';
        root.setAttribute('data-view', 'list');
        state.index = state.playing >= 0 ? state.playing : state.index;
        state.playing = -1;
      }
      paint();
      list.focus();
    }

    function step(delta) {
      if (state.view === 'player') {
        state.index = (state.playing + delta + tracks.length) % tracks.length;
        select();
        return;
      }
      state.index = (state.index + delta + tracks.length) % tracks.length;
      paint();
    }

    function playPause() {
      if (state.view === 'list') { select(); return; }
      if (state.live) unloadEmbed();
      else loadEmbed(state.playing);
      paint();
    }

    /* ----------------------------------------------------- the wheel */

    var ACTIONS = {
      menu: toMenu,
      prev: function () { step(-1); },
      next: function () { step(1); },
      select: function () { if (state.view === 'list') select(); else back.focus(); },
      play: playPause
    };

    root.querySelectorAll('.ipod-btn').forEach(function (btn) {
      var act = ACTIONS[btn.getAttribute('data-act')];
      if (act) btn.addEventListener('click', act);
    });
    if (back) back.addEventListener('click', toMenu);

    /* -------------------------------------------------- the keyboard */

    root.addEventListener('keydown', function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      // Let the wheel buttons handle their own Enter/Space.
      var onButton = e.target && e.target.classList &&
                     e.target.classList.contains('ipod-btn');

      switch (e.key) {
        case 'ArrowLeft':  step(-1); break;
        case 'ArrowRight': step(1); break;
        case 'ArrowUp':    if (state.view === 'list') { step(-columns()); } break;
        case 'ArrowDown':  if (state.view === 'list') { step(columns()); } break;
        case 'Home':       if (state.view === 'list') { state.index = 0; paint(); } break;
        case 'End':        if (state.view === 'list') { state.index = tracks.length - 1; paint(); } break;
        case 'Enter':
        case ' ':
          if (onButton) return;
          if (state.view === 'list') select();
          else playPause();
          break;
        case 'Escape':
        case 'Backspace':
          toMenu();
          break;
        default:
          return;
      }
      e.preventDefault();
    });

    /* ------------------------------------------------------- first run */

    // Restore where the visitor left off — highlight only. Loading the embed
    // here would defeat the whole point of lazy-loading it.
    var last = get('ipod.last', null);
    if (last) {
      for (var i = 0; i < tracks.length; i++) {
        if (tracks[i].file === last) { state.index = i; break; }
      }
    }

    root.setAttribute('data-view', 'list');
    root.setAttribute('data-player', 'off');
    paint();
    if (last && tracks[state.index].file === last) {
      ticker.textContent = 'last played: ' + tracks[state.index].name;
    }
  }

  /* ================================================================ boot */

  function boot() {
    var pods = document.querySelectorAll('.ipod');
    for (var i = 0; i < pods.length; i++) {
      try {
        mount(pods[i]);
      } catch (err) {
        // Never let the music window take the rest of the page down with it.
        pods[i].setAttribute('data-view', 'empty');
        var t = pods[i].querySelector('.ipod-ticker');
        if (t) t.textContent = 'the player could not start (' + err.message + ')';
        if (window.console) console.error('[ipod]', err);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
