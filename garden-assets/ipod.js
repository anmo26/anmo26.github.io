/* ==========================================================================
   garden — ipod.js
   The music window: a click-wheel iPod whose screen holds playlist tiles
   and, on select, a YouTube player.

   No audio is ever hosted by this site. Playback goes through YouTube's
   official IFrame Player API, so the click wheel really does drive play,
   pause, next and previous — the media stays on YouTube, nothing is copied
   here. Spotify links still work; they play in Spotify's own embed, which
   has no control API, so there the wheel can only mount and unmount it.

   TWO PROPERTIES THIS FILE MUST KEEP

   1. LAZY, UNLESS ASKED OTHERWISE. Nothing third-party is requested until
      the visitor picks something: no iframe, and the YouTube API script
      itself is injected on first play, not on page load.

      The one exception is the `autoplay` preference, which the owner asked
      for and which ships on: with it on, the player asks YouTube for the
      last-played list as soon as the page settles, so there is music in the
      garden the moment it opens. Switch it off in the player's own bar and
      this file is exactly as lazy as it was -- zero off-origin requests
      until somebody presses a button.

   2. ALIVE ACROSS PAGES. app.js swaps <main> on internal navigation. The
      player must therefore live OUTSIDE <main> and never be rebuilt. On
      boot this file lifts the device into #ipod-shell on <body> (a move
      done before any iframe exists, so nothing is torn down), and from
      then on nothing detaches it. The stage keeps its iframe even when the
      screen is showing the list, so walking back to the menu — or into
      another folder — does not stop the music.

   DATA CONTRACT — the generator injects, before this script:

     window.GARDEN_MUSIC = [
       {
         name:  "music",                             // display name (required)
         file:  "01 music.txt",                      // source file, for keys
         src:   "youtube",                           // youtube | spotify
         kind:  "playlist",                          // playlist | video | album ...
         id:    "PLXWFWrURanY0",
         embed: "https://www.youtube.com/embed/videoseries?list=PLXWFWrURanY0",
         link:  "https://www.youtube.com/playlist?list=PLXWFWrURanY0",
         cover: "music/covers/whatever.jpg",         // href or null
         note:  "a line under the tile"              // string, may be ""
       }
     ];

   Only `name` plus one of `id` / `embed` / `link` is strictly required;
   everything else is repaired or defaulted here, and a `src` that is
   missing or wrong is re-derived from the URL. See src/ipod-integration.md.
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

  function el(tag, cls) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
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
      .replace(/['’]/g, '')          // don't let "today's" split into two words
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/).filter(Boolean);
    if (!words.length) return '♪';                // eighth note
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  /* ------------------------------------------------------------ parsing */

  var SPOTIFY_KINDS = { playlist: 1, album: 1, track: 1, artist: 1, episode: 1, show: 1 };

  // YouTube list ids: PL (made by hand), UU (a channel's uploads), OL, LL,
  // FL, RD (a generated radio). Anything else we insist on seeing a URL for,
  // so a bare Spotify id can never be mistaken for one.
  var YT_LIST = /^(?:PL|UU|OL|LL|FL|RD)[A-Za-z0-9_-]{8,}$/;
  var YT_HOST = /(?:^|\/\/|\.)(?:youtube\.com|youtube-nocookie\.com|youtu\.be|music\.youtube\.com)/i;

  /** Pull {src, kind, id} out of any YouTube URL, or a bare list id. */
  function parseYouTube(raw) {
    if (!raw) return null;
    var s = String(raw).trim();
    if (!s) return null;

    if (YT_LIST.test(s)) return { src: 'youtube', kind: 'playlist', id: s };
    if (!YT_HOST.test(s)) return null;

    // A playlist wins over the video it happens to be pointing at: a
    // "watch?v=...&list=..." link is somebody sharing their playlist.
    var list = s.match(/[?&;]list=([A-Za-z0-9_-]{10,})/);
    if (list) return { src: 'youtube', kind: 'playlist', id: list[1] };

    var watch = s.match(/[?&;]v=([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/) ||
                s.match(/youtu\.be\/([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/) ||
                s.match(/\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/);
    if (watch) return { src: 'youtube', kind: 'video', id: watch[1] };

    return null;
  }

  /** Pull {src, kind, id} out of any Spotify URL, URI or bare id. */
  function parseSpotify(raw) {
    if (!raw) return null;
    var s = String(raw).trim();
    if (!s) return null;

    // spotify:playlist:37i9dQZF1DX0hvSv6cNiG3
    var uri = s.match(/^spotify:([a-z]+):([A-Za-z0-9]+)/i);
    if (uri && SPOTIFY_KINDS[uri[1].toLowerCase()]) {
      return { src: 'spotify', kind: uri[1].toLowerCase(), id: uri[2] };
    }

    // https://open.spotify.com/[embed/][intl-de/]playlist/ID?si=...
    var url = s.match(/open\.spotify\.com\/(?:embed\/)?(?:intl-[a-z-]+\/)?([a-z]+)\/([A-Za-z0-9]+)/i);
    if (url && SPOTIFY_KINDS[url[1].toLowerCase()]) {
      return { src: 'spotify', kind: url[1].toLowerCase(), id: url[2] };
    }

    // a bare base62 id — assume a playlist, which is what this folder is for
    if (/^[A-Za-z0-9]{16,30}$/.test(s)) return { src: 'spotify', kind: 'playlist', id: s };

    return null;
  }

  /** YouTube first: it is the house source now. */
  function parseSource(raw) {
    return parseYouTube(raw) || parseSpotify(raw);
  }

  function embedUrl(found) {
    if (found.src === 'youtube') {
      return found.kind === 'playlist'
        ? 'https://www.youtube.com/embed/videoseries?list=' + found.id
        : 'https://www.youtube.com/embed/' + found.id;
    }
    return 'https://open.spotify.com/embed/' + found.kind + '/' + found.id +
           '?utm_source=generator';
  }

  function openUrl(found) {
    if (found.src === 'youtube') {
      return found.kind === 'playlist'
        ? 'https://www.youtube.com/playlist?list=' + found.id
        : 'https://www.youtube.com/watch?v=' + found.id;
    }
    return 'https://open.spotify.com/' + found.kind + '/' + found.id;
  }

  function sourceName(src) { return src === 'youtube' ? 'YouTube' : 'Spotify'; }

  /* ---------------------------------------------------------- the data */

  /** Repair whatever the generator handed us; drop anything unplayable. */
  function normalize(raw) {
    if (!raw || !raw.length) return [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var t = raw[i];
      if (!t || typeof t !== 'object') continue;

      // Trust an explicit {src, kind, id} triple, but only when it is whole;
      // otherwise re-derive everything from whatever URL we can find.
      var found = null;
      if (t.src === 'youtube' && t.id && (t.kind === 'playlist' || t.kind === 'video')) {
        found = { src: 'youtube', kind: t.kind, id: t.id };
      } else if (t.src === 'spotify' && t.id && SPOTIFY_KINDS[t.kind]) {
        found = { src: 'spotify', kind: t.kind, id: t.id };
      }
      if (!found) found = parseSource(t.embed);
      if (!found) found = parseSource(t.link);
      if (!found) found = parseSource(t.url);
      if (!found) found = parseSource(t.youtube);
      if (!found) found = parseSource(t.spotify);   // tolerate the raw key names
      if (!found && t.id) found = parseSource(t.id);
      if (!found) continue;                         // nothing playable — skip

      var name = String(t.name || t.title || t.file || found.id).trim();
      out.push({
        name: name,
        file: t.file || name,
        src: found.src,
        kind: found.kind,
        id: found.id,
        embed: embedUrl(found),
        link: t.link && /^https?:/i.test(t.link) ? t.link : openUrl(found),
        cover: t.cover || null,
        note: t.note ? String(t.note) : ''
      });
    }
    return out;
  }

  /* -------------------------------------------------- the YouTube API
     Injected on first play, never on load. Everything that wants the API
     waits on this one promise, so the script tag is added at most once. */

  var ytLoad = null;

  function loadYouTubeAPI() {
    if (ytLoad) return ytLoad;
    ytLoad = new Promise(function (resolve, reject) {
      if (window.YT && window.YT.Player) { resolve(window.YT); return; }

      // Another script may already own this hook; chain rather than clobber.
      var previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof previous === 'function') { try { previous(); } catch (e) {} }
        resolve(window.YT);
      };

      var s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = function () { reject(new Error('could not reach YouTube')); };
      document.head.appendChild(s);

      // A rejection after a resolution is a no-op, so this is just a floor
      // under "the wheel does nothing and never says why".
      setTimeout(function () {
        if (!(window.YT && window.YT.Player)) reject(new Error('YouTube did not answer'));
      }, 15000);
    });
    return ytLoad;
  }

  /* ------------------------------------------------------------ chassis
     Two structural moves, both made once, both made while the device is
     still empty — so neither can interrupt playback. */

  /**
   * Lift the device out of <main> into a fixed shell on <body>. app.js
   * replaces <main> wholesale when you walk into a folder; anything still
   * inside it at that moment is destroyed, iframe and all.
   */
  function shellFor(pod) {
    var parent = pod.parentNode;
    if (parent && parent.id === 'ipod-shell') return parent;   // generator did it

    var shell = el('div', 'ipod-shell');
    shell.id = 'ipod-shell';
    document.body.appendChild(shell);

    // The window the generator wrapped it in goes with it — an empty
    // "music (1 playlist)" heading left lying in the plantbed is litter.
    var item = pod.closest ? pod.closest('.item.kind-ipod') : null;
    shell.appendChild(pod);
    if (item && item.parentNode && !item.querySelector('.ipod')) {
      item.parentNode.removeChild(item);
    }
    return shell;
  }

  /**
   * Move the stage out of the player view and make it a layer of the screen.
   * Inside the view it would be inside a `display: none` box every time the
   * visitor pressed MENU, and a detached box is a stopped iframe. As a layer
   * it is merely covered by the list, and keeps playing underneath it.
   */
  function stageFor(root) {
    var screen = root.querySelector('.ipod-screen');
    var stage = root.querySelector('.ipod-stage');
    if (!stage) { stage = el('div', 'ipod-stage'); }
    if (screen && stage.parentNode !== screen) screen.appendChild(stage);
    stage.setAttribute('data-mode', 'none');
    return stage;
  }

  /**
   * How tall is the taskbar right now?
   *
   * The player and its grab tab both sit just above it, and "just above it"
   * used to be a guessed 2.6rem. On a phone the taskbar wraps to two rows —
   * and it gains a row again every time a control is added to it — so the
   * guess put the tab UNDERNEATH the taskbar, invisible. Measured instead,
   * and re-measured on resize, so it cannot drift out of date.
   */
  function sizeChrome() {
    var bar = document.querySelector('.taskbar');
    var h = bar ? bar.offsetHeight : 0;
    document.documentElement.style.setProperty('--ipod-taskbar-h',
      (h > 0 ? h : 42) + 'px');
  }

  /* ------------------------------------------------------- the dock
     The player is furniture: it can be pushed to the edge of the screen and
     pulled back, and it keeps playing either way, because docking is a
     transform and nothing else. The taskbar's `music` toggle in app.js
     parks it entirely; these two controls only slide it aside. */

  function buildDock(shell, root) {
    var tab = el('button', 'ipod-tab');
    tab.type = 'button';
    tab.setAttribute('aria-label', 'bring the music player back');
    tab.title = 'bring the music player back';
    tab.appendChild(el('span', 'ipod-tab-label')).textContent = 'music';
    // On <body>, not in the shell: docking transforms the shell, and a
    // transformed ancestor is the containing block for a position:fixed
    // child -- a tab inside would ride off the screen with it.
    document.body.appendChild(tab);

    var dock = el('button', 'ipod-dock');
    dock.type = 'button';
    dock.setAttribute('aria-label', 'push the music player to the side');
    dock.title = 'push it to the side';
    // A word, not just chevrons: two faint arrows read as decoration and
    // the owner could not find the control.
    dock.innerHTML = '&#8249;&#8249;&nbsp;hide';

    // It used to sit in the bar across the top of the screen. That bar is
    // 220-odd pixels wide and already holds the back button, the name of
    // whatever is playing, and `tracks` — five things fighting over one
    // line, all of them set tiny to fit. `hide` belongs to the device, not
    // to the screen, so it moves down to the line under it, beside the
    // ticker, and the bar gets its room back.
    var ticker = root.querySelector('.ipod-ticker');
    if (ticker && ticker.parentNode) {
      var strip = el('div', 'ipod-strip');
      ticker.parentNode.insertBefore(strip, ticker);
      strip.appendChild(ticker);
      strip.appendChild(dock);
    } else {
      var bar = root.querySelector('.ipod-bar');
      if (bar) bar.appendChild(dock);
    }

    function apply(on, save) {
      shell.setAttribute('data-docked', on ? 'on' : 'off');
      document.body.classList.toggle('music-docked', on);
      tab.hidden = !on;
      dock.setAttribute('aria-expanded', on ? 'false' : 'true');
      if (save) set('ipod.docked', on);
    }

    dock.addEventListener('click', function () { apply(true, true); tab.focus(); });
    tab.addEventListener('click', function () {
      apply(false, true);
      var select = root.querySelector('.ipod-btn-select');
      if (select) select.focus();
    });

    // A narrow window has no room for a 292px device sitting over the page,
    // so it starts pushed aside. A wide one starts open.
    apply(get('ipod.docked', !window.matchMedia('(min-width: 900px)').matches), false);
  }

  /* ------------------------------------------------------------ device */

  function mount(root) {
    var tracks = normalize(window.GARDEN_MUSIC);

    var shell = shellFor(root);
    var stage = stageFor(root);

    sizeChrome();
    window.addEventListener('resize', sizeChrome);
    // The web fonts land after this runs and can add a row to the taskbar.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(sizeChrome).catch(function () {});
    }
    setTimeout(sizeChrome, 600);

    var bar     = root.querySelector('.ipod-bar');
    var title   = root.querySelector('.ipod-bar-title');
    var back    = root.querySelector('.ipod-back');
    var list    = root.querySelector('.ipod-list');
    var ticker  = root.querySelector('.ipod-ticker');
    var paused  = root.querySelector('.ipod-paused-name');
    var noscript = root.querySelector('.ipod-noscript');
    if (noscript) noscript.parentNode.removeChild(noscript);

    buildDock(shell, root);

    /* ------------------------------------------------- the rest of the list
       A playlist is more than the one video playing. YouTube's player will
       hand over the video ids it queued, but not their titles, so each is
       asked for by name from YouTube's public oEmbed endpoint -- no key, and
       it answers cross-origin. Titles are cached for the life of the page.

       Spotify's own embed already shows its tracks, so the panel stays out
       of the way there. */

    var infoCache = {};

    /**
     * A video's name, and — where oEmbed happens to know it — its shape.
     * The shape here is a second opinion only; `videoShape` below is the
     * one that decides. Measured: oEmbed called this playlist's first track
     * 4:3 when the video is actually square, so it is not trustworthy on
     * its own. It is right often enough to be worth keeping as a backstop.
     */
    function videoInfo(id) {
      if (infoCache[id]) return Promise.resolve(infoCache[id]);
      if (!window.fetch) return Promise.resolve({ title: '', ratio: 0 });

      function ask(url) {
        return fetch('https://www.youtube.com/oembed?format=json&url=' +
                     encodeURIComponent(url))
          .then(function (r) { return r.ok ? r.json() : null; });
      }

      return ask('https://www.youtube.com/shorts/' + id)
        .then(function (j) { return j || ask('https://www.youtube.com/watch?v=' + id); })
        .then(function (j) {
          var info = {
            title: (j && j.title) ? String(j.title) : '',
            ratio: (j && j.width > 0 && j.height > 0) ? (j.width / j.height) : 0
          };
          if (info.title || info.ratio) infoCache[id] = info;
          return info;
        })
        .catch(function () { return { title: '', ratio: 0 }; });
    }

    function videoTitle(id) {
      return videoInfo(id).then(function (i) { return i.title; });
    }

    /* ------------------------------------------------ how tall is it, really

       YouTube keeps a thumbnail cut to a video's ORIGINAL proportions at
       i.ytimg.com/vi/<id>/oar1.jpg — "oar" for original aspect ratio. It is
       the only public thing that is reliably right: measured across a
       square upload, two videos shot upright on a phone, a Short and an
       ordinary widescreen video, it matched every one, where oEmbed got the
       square one wrong and reports 16:9 for Shorts.

       It is read as an image, so there is no CORS to satisfy — the browser
       hands us naturalWidth and naturalHeight and that is all we need. When
       there is no such file the video is the ordinary widescreen shape, and
       oEmbed's answer (then 16:9) is used instead.

       Nothing here is requested until something is playing, so the player is
       as quiet on arrival as it ever was.                                  */

    var shapeCache = {};

    function videoShape(id) {
      if (shapeCache[id]) return Promise.resolve(shapeCache[id]);

      return new Promise(function (resolve) {
        var img = new Image();
        var done = false;

        function finish(r) {
          if (done) return;
          done = true;
          if (r) shapeCache[id] = r;
          resolve(r);
        }

        img.onload = function () {
          finish(img.naturalWidth > 0 && img.naturalHeight > 0
            ? img.naturalWidth / img.naturalHeight : 0);
        };
        img.onerror = function () { finish(0); };
        setTimeout(function () { finish(0); }, 6000);   // never hang the screen
        img.src = 'https://i.ytimg.com/vi/' + id + '/oar1.jpg';
      }).then(function (r) {
        if (r) return r;
        return videoInfo(id).then(function (i) { return i.ratio || (16 / 9); });
      });
    }

    var queue = el('div', 'ipod-queue');
    queue.hidden = true;
    var queueList = el('ol', 'ipod-queue-list');
    queue.appendChild(queueList);
    var screenEl = root.querySelector('.ipod-screen');
    if (screenEl) screenEl.appendChild(queue);

    var queueBtn = el('button', 'ipod-queuebtn');
    queueBtn.type = 'button';
    queueBtn.hidden = true;
    queueBtn.title = 'show every track in this playlist';
    queueBtn.setAttribute('aria-expanded', 'false');
    queueBtn.textContent = 'tracks';
    if (bar) bar.appendChild(queueBtn);

    var queueIds = [];

    /** Repaint which row is lit, without rebuilding the list. */
    function markQueue() {
      var at = -1;
      try { at = yt && yt.getPlaylistIndex ? yt.getPlaylistIndex() : -1; } catch (e) {}
      var rows = queueList.children;
      for (var i = 0; i < rows.length; i++) {
        if (i === at) rows[i].setAttribute('aria-current', 'true');
        else rows[i].removeAttribute('aria-current');
      }
    }

    function buildQueue() {
      var ids = [];
      try { ids = (yt && yt.getPlaylist && yt.getPlaylist()) || []; } catch (e) { ids = []; }

      // A single video is not a playlist, and neither is Spotify.
      if (!ids.length || stage.getAttribute('data-mode') !== 'yt') {
        queueBtn.hidden = true;
        closeQueue();
        return;
      }
      queueBtn.hidden = false;

      // Same queue as last time: only the lit row can have moved.
      if (ids.join(',') === queueIds.join(',')) { markQueue(); return; }
      queueIds = ids;

      queueList.innerHTML = '';
      ids.forEach(function (id, i) {
        var row = el('li', 'ipod-queue-row');
        var btn = el('button', 'ipod-queue-name');
        btn.type = 'button';
        btn.textContent = String(i + 1) + '.';
        btn.addEventListener('click', function () {
          try { yt.playVideoAt(i); } catch (e) {}
          closeQueue();                 // you picked a track: show it playing
        });
        row.appendChild(btn);
        queueList.appendChild(row);

        videoTitle(id).then(function (t) {
          // textContent: this string came off the network.
          btn.textContent = String(i + 1) + '.  ' + (t || id);
        });
      });
      markQueue();
    }

    /**
     * The queue is not there the instant the player is ready, and if autoplay
     * is refused no state change ever arrives to ask again -- which left the
     * track list permanently empty on any browser that blocks autoplay.
     * Ask a few times over the first few seconds instead.
     */
    function queueSoon() {
      [0, 400, 1200, 3000].forEach(function (ms) { setTimeout(buildQueue, ms); });
    }

    /**
     * THE `tracks` PANEL IS A GUEST, NOT A VIEW.
     *
     * It used to be sticky: one press of `tracks` opened it and nothing
     * ever closed it again. Because it is a layer above BOTH the stage and
     * the menu, that one press meant every playlist opened afterwards came
     * up showing the track list instead of the video -- and so did MENU.
     * That is the whole of the "it defaults to tracks rather than the
     * video" complaint. Every move that changes what the screen is meant to
     * be showing now closes it, and it is hidden outright on the menu.
     */
    function showQueue(on) {
      queue.hidden = !on;
      queueBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
      if (on) markQueue();
    }
    function closeQueue() { showQueue(false); }

    queueBtn.addEventListener('click', function () { showQueue(queue.hidden); });

    /* --------------------------------------------------- the stage's shape

       The screen used to be a fixed 4:3 box that whatever was playing got
       poured into, and YouTube padded the difference: a widescreen video
       sat in a letterbox, and a video shot upright on a phone came out as a
       thin strip down the middle with black either side of it.

       The stage is now cut to the shape of the thing playing -- the box IS
       the video -- and the screen grows or shrinks to match, within limits
       so a tall video cannot push the device off the top of the window.
       Resizing a box does not unmount it, so the music never stops.

       The stage is also an absolute layer and has to be told where the bar
       ends. That is measured rather than guessed: the bar grows with the
       font.                                                               */

    var WIDEST  = 16 / 9;      // wider than this and YouTube letterboxes anyway
    var TALLEST = 9 / 16;      // a phone held upright
    var ratioNow = 0;          // 0 = nothing loaded: the plain 4:3 screen

    /** How tall the picture may get before it starts eating the window. */
    function stageCap() {
      var room = (window.innerHeight || 700) * 0.32;
      return Math.max(120, Math.min(280, Math.round(room)));
    }

    function sizeStage() {
      if (bar) root.style.setProperty('--ipod-bar-h', bar.offsetHeight + 'px');
      if (!screenEl) return;

      // The video's shape belongs to the player. On the menu the screen goes
      // back to its plain 4:3, because a widescreen video would otherwise
      // squash the tile grid down to a single row of covers, and the menu is
      // for browsing. `state` is not assigned yet on the very first call,
      // which is exactly the "nothing loaded" case anyway.
      if (!ratioNow || !state || state.view !== 'player') {
        screenEl.style.height = '';
        stage.style.width = '';
        stage.style.height = '';
        return;
      }

      var r = ratioNow;
      if (r > WIDEST) r = WIDEST;
      if (r < TALLEST) r = TALLEST;

      var wide = screenEl.clientWidth;
      if (!wide) return;

      var h = Math.round(wide / r);
      var cap = stageCap();
      if (h > cap) h = cap;
      if (h < 96) h = 96;
      var w = Math.min(wide, Math.round(h * r));

      stage.style.width = w + 'px';
      stage.style.height = h + 'px';
      screenEl.style.height = (h + (bar ? bar.offsetHeight : 0)) + 'px';
    }

    /** Cut the stage to this video's shape as soon as its size is known. */
    function fitTo(id) {
      if (!id) return;
      videoShape(id).then(function (ratio) {
        if (!ratio) return;
        if (Math.abs(ratio - ratioNow) < 0.01) return;
        ratioNow = ratio;
        sizeStage();
      });
    }

    sizeStage();
    window.addEventListener('resize', sizeStage);

    // --- nothing to play: say so, plainly, and stop.
    if (!tracks.length) {
      root.setAttribute('data-view', 'empty');
      if (title) title.textContent = 'no music';
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
      playing: -1,         // which tile is loaded, -1 for none
      live: false,         // is a Spotify embed currently mounted
      now: ''              // the track title YouTube is reporting
    };

    // The autostart attempt, and what it is allowed to do next. See the
    // "starting on its own" section at the bottom of mount().
    var AUTO_KEY = 'toggle.autoplay';
    var autoPending = false;     // we asked for playback and have no answer yet
    var hasPlayed = false;       // sound has come out at least once this visit
    var gestureArmed = false;    // waiting on the visitor's first click/key/touch
    var hint = '';               // a line the ticker shows instead of the link

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
      // Deliberately NOT YouTube's thumbnail service — that would be a
      // third-party request on page load, which is the one thing this
      // player is not allowed to make.
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
        img.alt = '';
        img.decoding = 'async';
        // Deliberately NOT loading="lazy": these live inside a scrolling
        // box, and a lazy image in a scroll container can sit unloaded
        // forever because the heuristic watches the document viewport.
        // Covers are a handful of small same-origin files; the thing that
        // must stay lazy is the player iframe, and it is.
        // The listener goes on before `src`: a cached 404 fires `error`
        // synchronously, and attaching afterwards would miss it.
        img.addEventListener('error', generated);     // missing file -> gradient
        img.src = t.cover;
        art.appendChild(img);
        // And once more for the case where it already failed and finished.
        if (img.complete && img.naturalWidth === 0) generated();
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
        // Even on the menu, say what is still playing — the whole point of
        // this rewrite is that it usually still is.
        var live = tracks[state.playing];
        title.textContent = 'playlists';
        if (live && state.now) ticker.textContent = '♪ ' + state.now;
        else if (live) ticker.textContent = '♪ ' + live.name;
        else ticker.textContent = cur.note ? cur.name + ' — ' + cur.note : cur.name;
      } else {
        var now = tracks[state.playing] || cur;
        title.textContent = state.now || now.name;
        ticker.innerHTML = '';
        // A waiting autostart owns this line until sound actually starts —
        // it is the only place the player can tell you what it is waiting
        // for, and it must not be buried behind a link.
        if (hint) { ticker.textContent = hint; return; }
        // The link goes first so it survives the ellipsis on a narrow
        // screen; the note is the part that can afford to be cut.
        var a = document.createElement('a');
        a.href = now.link;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = 'open in ' + sourceName(now.src) + ' ↗';
        ticker.appendChild(a);
        if (now.note) ticker.appendChild(document.createTextNode(' · ' + now.note));
      }

      var t = tiles[state.index];
      if (t && t.scrollIntoView) t.scrollIntoView({ block: 'nearest' });
    }

    function say(text) { if (ticker) ticker.textContent = text; }

    /** One place to record "something is coming out of the speakers", so a
        docked player can still show a lit dot on its tab. */
    function playingNow(on) {
      root.setAttribute('data-playing', on ? 'yes' : 'no');
      document.body.classList.toggle('music-playing', !!on);
    }

    /* -------------------------------------------------- the YouTube half */

    var yt = null;         // the YT.Player, built once and kept for good
    var ytBox = null;

    function ytHost() {
      if (ytBox) return ytBox;
      ytBox = el('div', 'ipod-stage-box is-yt');
      ytBox.appendChild(el('div', 'ipod-yt-host'));
      stage.appendChild(ytBox);
      return ytBox;
    }

    function playerVars(t) {
      var vars = {
        autoplay: 1,
        playsinline: 1,
        rel: 0,
        modestbranding: 1
      };
      if (location.protocol === 'http:' || location.protocol === 'https:') {
        vars.origin = location.origin;
      }
      if (t.kind === 'playlist') {
        vars.listType = 'playlist';
        vars.list = t.id;
      }
      return vars;
    }

    function ytLoadTrack(t) {
      if (t.kind === 'playlist') yt.loadPlaylist({ list: t.id, listType: 'playlist', index: 0 });
      else yt.loadVideoById(t.id);
    }

    function nowPlayingTitle() {
      try {
        var d = yt && yt.getVideoData && yt.getVideoData();
        return (d && d.title) ? d.title : '';
      } catch (e) { return ''; }
    }

    function nowPlayingId() {
      try {
        var d = yt && yt.getVideoData && yt.getVideoData();
        return (d && d.video_id) ? d.video_id : '';
      } catch (e) { return ''; }
    }

    function playerState() {
      try { return (yt && yt.getPlayerState) ? yt.getPlayerState() : -1; }
      catch (e) { return -1; }
    }

    function playYouTube(i) {
      var t = tracks[i];
      stageMode('yt');
      state.now = '';
      say('reaching YouTube…');

      loadYouTubeAPI().then(function (YT) {
        if (state.playing !== i) return;          // they moved on while it loaded

        if (yt && yt.loadPlaylist) {
          ytLoadTrack(t); queueSoon(); paint(); checkAutoplay(); return;
        }

        var opts = {
          width: '100%',
          height: '100%',
          playerVars: playerVars(t),
          events: {
            onReady: function (e) {
              // The constructor has not returned yet, so the outer `yt` is
              // still undefined at this point. Everything below needs it.
              yt = e.target;
              try { e.target.playVideo(); } catch (err) {}
              if (stage.getAttribute('data-mode') !== 'yt') return;
              state.now = nowPlayingTitle();
              fitTo(nowPlayingId());
              queueSoon();
              paint();
              checkAutoplay();
            },
            onStateChange: function (e) {
              // Switching to a Spotify playlist pauses this player rather
              // than destroying it, and the pause arrives here a moment
              // later -- after the screen has already been repainted for
              // Spotify. Without this guard that late event would put the
              // YouTube track's name back in the bar and blank the
              // "playing" light while Spotify was audibly playing.
              if (stage.getAttribute('data-mode') !== 'yt') return;

              // 1 playing, 2 paused, 0 ended, 3 buffering, 5 cued
              playingNow(e.data === 1);

              // Sound is out: the autostart is over, and anything it was
              // holding against the visitor's first gesture is let go.
              if (e.data === 1) {
                hasPlayed = true; autoPending = false; hint = ''; disarmGesture();
              } else if (e.data === 2 && hasPlayed) {
                // They pressed pause. Do not argue with them.
                autoPending = false; hint = ''; disarmGesture();
              }

              state.now = nowPlayingTitle();
              fitTo(nowPlayingId());
              buildQueue();
              paint();
            },
            onError: function () {
              say('YouTube would not play that one');
            }
          }
        };
        if (t.kind !== 'playlist') opts.videoId = t.id;

        yt = new YT.Player(ytHost().firstChild, opts);
      }).catch(function (err) {
        if (state.playing !== i) return;
        // If YouTube never answered an autostart, do not leave a visitor who
        // asked for nothing staring at an empty black screen: put the menu
        // back and say what happened on the one line there is.
        if (autoPending) {
          autoPending = false;
          state.view = 'list';
          root.setAttribute('data-view', 'list');
          root.setAttribute('data-player', 'off');
          stage.setAttribute('data-mode', 'none');
          state.playing = -1;
          paint();
        }
        say(err && err.message ? err.message : 'could not reach YouTube');
      });
    }

    /* -------------------------------------------------- the Spotify half */

    var spBox = null;

    function playSpotify(i) {
      var t = tracks[i];
      stageMode('sp');
      if (!spBox) {
        spBox = el('div', 'ipod-stage-box is-sp');
        stage.appendChild(spBox);
      }
      spBox.innerHTML = '';
      var frame = document.createElement('iframe');
      frame.src = t.embed;
      frame.title = 'Spotify player: ' + t.name;
      frame.loading = 'lazy';
      frame.setAttribute('frameborder', '0');
      // `allow` already grants fullscreen; the legacy attribute only warns.
      frame.setAttribute('allow',
        'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture');
      spBox.appendChild(frame);
      // Spotify's widget has no shape of its own worth matching — it is a
      // list, and it scrolls. Give it the plain screen back.
      ratioNow = 0;
      sizeStage();
      state.live = true;
      state.now = '';
      root.setAttribute('data-player', 'on');
      playingNow(true);
    }

    function unloadSpotify() {
      if (spBox) spBox.innerHTML = '';     // the only way to stop a cross-origin embed
      state.live = false;
      root.setAttribute('data-player', 'off');
      playingNow(false);
      if (paused) paused.textContent = (tracks[state.playing] || {}).name || '';
    }

    /**
     * Which half of the stage is on top. Nothing is ever removed: switching
     * from YouTube to Spotify pauses YouTube rather than destroying it, so
     * switching back costs no reload.
     */
    function stageMode(mode) {
      stage.setAttribute('data-mode', mode);
      if (mode === 'yt') {
        if (state.live) unloadSpotify();
        root.setAttribute('data-player', 'on');
      } else if (mode === 'sp' && yt) {
        try { yt.pauseVideo(); } catch (e) {}
      }
      if (mode !== 'yt') { queueBtn.hidden = true; closeQueue(); }
    }

    /* ------------------------------------------------------ the controls */

    function select(quiet) {
      state.playing = state.index;
      state.view = 'player';
      root.setAttribute('data-view', 'player');
      closeQueue();          // picking a playlist lands on the video, always
      sizeStage();           // and in the shape of whatever is about to play

      var t = tracks[state.playing];
      if (t.src === 'youtube') playYouTube(state.playing);
      else playSpotify(state.playing);

      set('ipod.last', t.file);
      paint();
      // `quiet` is the autostart: taking focus out from under someone who
      // has just arrived and may already be reading is not on.
      if (back && !quiet) back.focus();
    }

    /**
     * MENU no longer stops anything. It used to tear the iframe down, which
     * is exactly the behaviour this rewrite exists to get rid of — the list
     * simply covers the stage while the music carries on behind it.
     */
    function toMenu() {
      closeQueue();          // MENU means the playlists, not the track list
      if (state.view === 'list') {
        list.scrollTop = 0;
        state.index = 0;
      } else {
        state.view = 'list';
        root.setAttribute('data-view', 'list');
        state.index = state.playing >= 0 ? state.playing : state.index;
      }
      sizeStage();           // the menu takes its own shape back
      paint();
      list.focus();
    }

    function step(delta) {
      if (state.view === 'player') {
        var t = tracks[state.playing];
        // On YouTube the wheel means what it means on a real iPod: the next
        // track. Spotify's embed exposes no controls, so there it still
        // steps to the next playlist.
        if (t && t.src === 'youtube' && yt) {
          try {
            if (delta > 0) yt.nextVideo();
            else yt.previousVideo();
          } catch (e) {}
          return;
        }
        state.index = (state.playing + delta + tracks.length) % tracks.length;
        select();
        return;
      }
      state.index = (state.index + delta + tracks.length) % tracks.length;
      paint();
    }

    function playPause() {
      if (state.view === 'list') { select(); return; }

      var t = tracks[state.playing];
      if (!t) { select(); return; }

      if (t.src === 'youtube') {
        if (!yt) { playYouTube(state.playing); return; }
        try {
          if (yt.getPlayerState && yt.getPlayerState() === 1) yt.pauseVideo();
          else yt.playVideo();
        } catch (e) {}
        return;
      }

      if (state.live) unloadSpotify();
      else playSpotify(state.playing);
      paint();
    }

    /* ----------------------------------------------------- the wheel */

    var ACTIONS = {
      menu: toMenu,
      prev: function () { step(-1); },
      next: function () { step(1); },
      select: function () { if (state.view === 'list') select(); else playPause(); },
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
                     (e.target.classList.contains('ipod-btn') ||
                      e.target.classList.contains('ipod-dock') ||
                      e.target.classList.contains('ipod-back'));

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

    /* ------------------------------------------------- starting on its own

       The owner wants music in the garden the moment it opens. No browser
       will simply allow that. Audible playback nobody asked for is blocked
       everywhere -- YouTube's embed is not an exception, it is the usual
       case -- and shipping a player that quietly fails would be worse than
       shipping nothing.

       So it is two moves. Ask immediately. If the ask is refused, hold the
       request against the visitor's very first gesture anywhere on the page
       -- a click, a key, a touch -- and start then. Either way the music
       begins at the first moment the browser permits, and the refusal
       looks like a player waiting on its poster frame, which is a normal
       player and not a broken one.

       Three things it must not do:
         - fight a visitor who pauses it (once sound has come out, pause is
           final: the gesture listener is dropped and never re-armed)
         - start again on internal navigation (app.js swaps <main> only, so
           this file is never re-run; the whole of it happens once per real
           page load)
         - be unavoidable (`auto` in the player's bar, remembered)         */

    function autoWanted() { return get(AUTO_KEY, true) !== false; }

    function firstGesture() {
      disarmGesture();
      hint = '';
      try { if (yt && yt.playVideo) yt.playVideo(); } catch (e) {}
      paint();

      // Measured: on Chrome's ordinary setting this works, and the player is
      // playing about ten milliseconds later. On the strictest setting there
      // is, a click on the page is not enough — only a click inside the
      // video's own frame counts. Say so, once, and then stop asking. The
      // listener is never re-armed: one unheeded request is enough, and
      // YouTube's own play button is right there in the picture.
      setTimeout(function () {
        if (hasPlayed || !autoPending) return;
        var s = playerState();
        if (s === 1 || s === 3) return;
        autoPending = false;
        hint = 'press \u25B6 on the video itself to start it';
        paint();
      }, 2500);
    }

    function disarmGesture() {
      if (!gestureArmed) return;
      gestureArmed = false;
      document.removeEventListener('pointerdown', firstGesture, true);
      document.removeEventListener('keydown', firstGesture, true);
      document.removeEventListener('touchstart', firstGesture, true);
    }

    function armGesture() {
      if (gestureArmed || hasPlayed || !autoWanted()) return;
      gestureArmed = true;
      // Capture, so it runs before anything on the page swallows the event,
      // and one-shot, so it can never become a thing that keeps happening.
      document.addEventListener('pointerdown', firstGesture, true);
      document.addEventListener('keydown', firstGesture, true);
      document.addEventListener('touchstart', firstGesture, true);
      hint = 'your browser held the music — click anywhere to start it';
      paint();
    }

    /**
     * Did the autostart actually take? Asked a beat after the player says it
     * is ready, because "playing" does not arrive in the same tick. 1 is
     * playing and 3 is buffering its way there; anything else at this point
     * means the browser said no.
     */
    function checkAutoplay() {
      if (!autoPending) return;
      setTimeout(function () {
        if (!autoPending) return;
        var s = playerState();
        if (s === 1 || s === 3) return;
        armGesture();
      }, 1500);
    }

    function autoStart() {
      if (!autoWanted()) return;

      // YouTube only. Its player says whether it really started; Spotify's
      // embed says nothing at all, so "autostart" there would be a silent
      // iframe and a lit dot that might be a lie.
      var want = -1, i;
      if (tracks[state.index] && tracks[state.index].src === 'youtube') {
        want = state.index;
      } else {
        for (i = 0; i < tracks.length; i++) {
          if (tracks[i].src === 'youtube') { want = i; break; }
        }
      }
      if (want < 0) return;

      autoPending = true;
      state.index = want;
      select(true);
    }

    /* ------------------------------------------------------ the switch

       A site that makes noise unbidden is hostile to some visitors, so the
       switch is one press away, on the menu where the player is not busy
       showing anything else, and it is remembered. Off is genuinely off:
       nothing is asked of YouTube until somebody presses play.

       It writes `toggle.autoplay`, which is the key a taskbar toggle in
       app.js would use — the two would be the same setting, not two.     */

    var autoBtn = el('button', 'ipod-auto');
    autoBtn.type = 'button';
    autoBtn.textContent = 'auto';

    function paintAuto() {
      var on = autoWanted();
      autoBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      autoBtn.title = on
        ? 'music starts when the site opens — click to stop that'
        : 'music waits for you — click to have it start when the site opens';
      autoBtn.setAttribute('aria-label', autoBtn.title);
    }

    autoBtn.addEventListener('click', function () {
      set(AUTO_KEY, !autoWanted());
      paintAuto();
      if (!autoWanted()) { autoPending = false; hint = ''; disarmGesture(); paint(); }
    });
    if (bar) bar.appendChild(autoBtn);
    paintAuto();

    /* ------------------------------------------------------- first run */

    // Restore where the visitor left off — highlight only. Loading the embed
    // here would defeat the whole point of lazy-loading it, and starting
    // audio on arrival is rude besides.
    var last = get('ipod.last', null);
    if (last) {
      for (var i = 0; i < tracks.length; i++) {
        if (tracks[i].file === last) { state.index = i; break; }
      }
    }

    root.setAttribute('data-view', 'list');
    root.setAttribute('data-player', 'off');
    playingNow(false);
    paint();
    if (last && tracks[state.index].file === last) {
      say('last played: ' + tracks[state.index].name);
    }

    // Last, so a throw in here cannot take the rest of the player with it.
    try { autoStart(); } catch (e) { if (window.console) console.warn('[ipod]', e); }
  }

  /* ================================================================ boot */

  function boot() {
    var pods = document.querySelectorAll('.ipod');
    for (var i = 0; i < pods.length; i++) {
      if (pods[i].getAttribute('data-mounted') === 'yes') continue;
      pods[i].setAttribute('data-mounted', 'yes');
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
