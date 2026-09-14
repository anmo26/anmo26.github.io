/* ==========================================================================
   garden — the interactive layer
   - a flip clock drawn out of keyboard characters
   - windows you can drag, collapse and shuffle
   - taskbar toggles, remembered per visitor
   - a guestbook of draggable sticky notes
   ========================================================================== */
(function () {
  'use strict';

  var CFG = window.GARDEN_CONFIG || {};
  var STORE = 'garden:' + (CFG.siteName || 'garden') + ':';

  /* ------------------------------------------------------------ storage */

  function get(key, fallback) {
    try {
      var v = localStorage.getItem(STORE + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  }
  function set(key, value) {
    try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch (e) {}
  }

  /* =========================================================== FLIP CLOCK
     A Twemco split-flap clock drawn as a field of characters. The digits are
     not blocks — they are letterforms packed together, ink figures standing
     out of an ochre ground, with a seam across the middle where the flap
     folds. When a digit turns over, its ground churns for a moment.
     ------------------------------------------------------------------- */

  // 5 x 7 letterform digits
  var GLYPH = {
    '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],

    // the alphabet, cut in the same 5 x 7 stroke as the digits, so the date
    // line is the same kind of object as the time
    'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
    'D': ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
    'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    'I': ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
    'J': ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
    'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    'N': ['10001', '11001', '10101', '10101', '10011', '10001', '10001'],
    'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
    'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    'W': ['10001', '10001', '10001', '10101', '10101', '11011', '01010'],
    'X': ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
    'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
    'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111']
  };

  var GROUND = 'vwvvwvwvvwwvvwvw';  // the ochre texture
  var FIGURE = 'Q@QQ0@QOQ@';      // the ink letterforms
  var SEAM   = 'xxxxxxxxxxxxx';

  var PAD_X = 1;                  // ground columns either side of a glyph
  var PAD_Y = 1;                  // ground rows above and below
  var GAP   = 2;                  // ground columns between two cards
  var CARD_W = 5 + PAD_X * 2;
  var CARD_H = 7 + PAD_Y * 2;
  var SEAM_AFTER = 4;             // the flap folds below this glyph row

  function pick(set, seed) { return set.charAt(Math.abs(seed) % set.length); }

  /**
   * Builds the whole clock as a grid of { ch, cls } cells.
   * `churn` is a map of card index -> true for cards mid-flip.
   */
  function field(text, churn, tick) {
    var rows = [];
    var totalRows = CARD_H + 1;            // +1 for the seam line
    var r, c, i;

    for (r = 0; r < totalRows; r++) rows.push([]);

    for (i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      var isColon = ch === ':';
      var glyph = GLYPH[ch] || null;
      var width = isColon ? 3 : CARD_W;
      var churning = churn[i];

      for (r = 0; r < totalRows; r++) {
        var glyphRow = r <= SEAM_AFTER ? r - PAD_Y : r - PAD_Y - 1;
        var isSeam = r === SEAM_AFTER + 1;

        for (c = 0; c < width; c++) {
          var seed = (i * 31 + r * 17 + c * 7 + (churning ? tick * 13 : 0));

          if (isColon) {
            // the colon reads as two punched dots in the ground
            var dot = (r === 3 || r === 7) && c === 1;
            rows[r].push(dot
              ? { ch: 'O', cls: 'f' }
              : { ch: pick(GROUND, seed), cls: 'g' });
            continue;
          }

          if (isSeam) {
            rows[r].push({ ch: SEAM.charAt(c % SEAM.length), cls: 's' });
            continue;
          }

          var on = false;
          if (glyph && glyphRow >= 0 && glyphRow < 7) {
            var gc = c - PAD_X;
            if (gc >= 0 && gc < 5) on = glyph[glyphRow].charAt(gc) === '1';
          }

          // A churning card loses its figure and thrashes its ground.
          if (churning) {
            rows[r].push({ ch: pick(GROUND, seed * 3 + 1), cls: 'g' });
          } else {
            rows[r].push(on
              ? { ch: pick(FIGURE, seed), cls: 'f' }
              : { ch: pick(GROUND, seed), cls: 'g' });
          }
        }

        if (i < text.length - 1) {
          for (c = 0; c < GAP; c++) {
            rows[r].push({ ch: pick(GROUND, i * 5 + r * 3 + c), cls: 'g' });
          }
        }
      }
    }
    return rows;
  }

  /** Collapses the cell grid into spans, one per run of same colour. */
  function paint(rows) {
    var html = '';
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r], run = '', cls = null;
      for (var c = 0; c < row.length; c++) {
        if (row[c].cls !== cls) {
          if (run) html += '<span class="' + cls + '">' + run + '</span>';
          run = ''; cls = row[c].cls;
        }
        run += row[c].ch;
      }
      if (run) html += '<span class="' + cls + '">' + run + '</span>';
      if (r < rows.length - 1) html += '\n';
    }
    return html;
  }

  /* ------------------------------------------------------- the date face
     The date line and the meridiem are character fields too, but cut on a
     smaller cell: a condensed 5-row alphabet (3 columns wide, 4 or 5 for
     the wide letters) instead of the 5 x 7 cards. The individual characters
     stay as large as the ones in the time — that is what keeps it readable —
     while the letterforms themselves are half the height, so the time still
     reads as the biggest thing on the block.
     Each glyph is an array of rows; a row's length is that glyph's width.
     ------------------------------------------------------------------- */
  var MICRO = {
    'A': ['010', '101', '111', '101', '101'],
    'B': ['110', '101', '110', '101', '110'],
    'C': ['011', '100', '100', '100', '011'],
    'D': ['110', '101', '101', '101', '110'],
    'E': ['111', '100', '110', '100', '111'],
    'F': ['111', '100', '110', '100', '100'],
    'G': ['011', '100', '101', '101', '011'],
    'H': ['101', '101', '111', '101', '101'],
    'I': ['111', '010', '010', '010', '111'],
    'J': ['001', '001', '001', '101', '010'],
    'K': ['101', '101', '110', '101', '101'],
    'L': ['100', '100', '100', '100', '111'],
    'M': ['10001', '11011', '10101', '10001', '10001'],
    'N': ['1001', '1101', '1111', '1011', '1001'],
    'O': ['010', '101', '101', '101', '010'],
    'P': ['110', '101', '110', '100', '100'],
    'Q': ['010', '101', '101', '111', '011'],
    'R': ['110', '101', '110', '101', '101'],
    'S': ['011', '100', '010', '001', '110'],
    'T': ['111', '010', '010', '010', '010'],
    'U': ['101', '101', '101', '101', '111'],
    'V': ['101', '101', '101', '101', '010'],
    'W': ['10001', '10001', '10101', '11011', '10001'],
    'X': ['101', '101', '010', '101', '101'],
    'Y': ['101', '101', '010', '010', '010'],
    'Z': ['111', '001', '010', '100', '111'],
    '0': ['111', '101', '101', '101', '111'],
    '1': ['010', '110', '010', '010', '111'],
    '2': ['111', '001', '111', '100', '111'],
    '3': ['111', '001', '111', '001', '111'],
    '4': ['101', '101', '111', '001', '001'],
    '5': ['111', '100', '111', '001', '111'],
    '6': ['111', '100', '111', '101', '111'],
    '7': ['111', '001', '001', '010', '010'],
    '8': ['111', '101', '111', '101', '111'],
    '9': ['111', '101', '111', '001', '111'],
    '·': ['0', '0', '1', '0', '0'],   // the separator, a punched dot
    ' ': ['00', '00', '00', '00', '00']
  };

  // a thinner ground for the date: the same keyboard texture, but sown with
  // blanks so the small letterforms are not crowded by it
  var MICRO_GROUND = 'v  w v   w  v w   ';

  var MICRO_H = 5;
  var MICRO_GAP = 1;              // ground columns between two letters
  var DOT = '·';

  /** Builds the date line as a field of characters, same ink and ground. */
  function smallField(text) {
    var rows = [];
    var r, c, i;

    for (r = 0; r < MICRO_H; r++) rows.push([]);

    for (i = 0; i < text.length; i++) {
      var glyph = MICRO[text.charAt(i)] || MICRO[' '];
      var width = glyph[0].length;

      for (r = 0; r < MICRO_H; r++) {
        for (c = 0; c < width; c++) {
          var seed = i * 29 + r * 13 + c * 5;
          var on = glyph[r].charAt(c) === '1';
          rows[r].push(on
            ? { ch: pick(FIGURE, seed), cls: 'f' }
            : { ch: pick(MICRO_GROUND, seed), cls: 'g' });
        }

        if (i < text.length - 1) {
          for (c = 0; c < MICRO_GAP; c++) {
            rows[r].push({ ch: pick(MICRO_GROUND, i * 11 + r * 7 + c + 3), cls: 'g' });
          }
        }
      }
    }
    return rows;
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  var DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  var MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY',
                'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

  function mountClock() {
    var host = document.getElementById('clock');
    var dateHost = document.getElementById('clock-date');
    if (!host) return;

    var state = {
      seconds: get('clock.seconds', true),
      hour24: get('clock.hour24', false)
    };

    var previous = '';
    var dateLine = '';
    var churn = {};
    var tick = 0;
    var churnTimer = null;

    function timeText() {
      var d = new Date();
      var h = d.getHours();
      if (!state.hour24) { h = h % 12; if (h === 0) h = 12; }
      return pad(h) + ':' + pad(d.getMinutes()) + (state.seconds ? ':' + pad(d.getSeconds()) : '');
    }

    function render(text) { host.innerHTML = paint(field(text, churn, tick)); }

    function draw() {
      var text = timeText();
      var d = new Date();

      if (dateHost) {
        var line = DAYS[d.getDay()].slice(0, 3) + DOT +
          MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate() + DOT + d.getFullYear() +
          (state.hour24 ? '' : DOT + (d.getHours() < 12 ? 'AM' : 'PM'));
        if (line !== dateLine) {
          dateLine = line;
          dateHost.innerHTML = paint(smallField(line));
        }
      }

      // Which cards turned over since last time?
      churn = {};
      if (previous.length === text.length) {
        for (var i = 0; i < text.length; i++) {
          if (previous.charAt(i) !== text.charAt(i)) churn[i] = true;
        }
      }
      previous = text;

      var flipping = Object.keys(churn).length > 0;
      render(text);

      clearTimeout(churnTimer);
      if (flipping && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        // let the flap tumble for a couple of frames, then settle
        tick = 0;
        var churnStep = function () {
          tick++;
          if (tick > 2) { churn = {}; render(text); return; }
          render(text);
          churnTimer = setTimeout(churnStep, 55);
        };
        churnTimer = setTimeout(churnStep, 55);
      }
    }

    // Click to cycle 12h -> 24h -> 12h without seconds -> 24h without seconds.
    var MODES = [
      { hour24: false, seconds: true },
      { hour24: true, seconds: true },
      { hour24: false, seconds: false },
      { hour24: true, seconds: false }
    ];

    var shell = document.getElementById('clock-shell');
    (shell || host).addEventListener('click', function () {
      var at = 0, m;
      for (m = 0; m < MODES.length; m++) {
        if (MODES[m].hour24 === state.hour24 && MODES[m].seconds === state.seconds) at = m;
      }
      var next = MODES[(at + 1) % MODES.length];
      state.hour24 = next.hour24;
      state.seconds = next.seconds;
      dateLine = '';
      set('clock.hour24', state.hour24);
      set('clock.seconds', state.seconds);
      previous = '';
      draw();
    });

    draw();
    setInterval(draw, 1000);
  }

  /* ============================================================= DRAGGING */

  var zTop = 100;

  /* Only one thing is ever being dragged, so the move and up listeners go on
     the window once, here, rather than once per draggable element. They used
     to be attached inside makeDraggable, which was harmless when the page was
     built exactly once -- but the page is now rebuilt on every internal
     navigation, and that version would have left a fresh set of window
     listeners behind after every folder the visitor walked into. */

  var drag = null;

  function dragMove(e) {
    if (!drag) return;
    var x = Math.max(0, drag.originX + (e.clientX - drag.startX));
    var y = Math.max(0, drag.originY + (e.clientY - drag.startY));
    drag.el.style.left = x + 'px';
    drag.el.style.top = y + 'px';
  }

  function dragEnd() {
    if (!drag) return;
    var d = drag;
    drag = null;
    d.el.classList.remove('focused');

    var x = parseInt(d.el.style.left, 10);
    var y = parseInt(d.el.style.top, 10);

    if (d.onDrop) {
      // Guestbook notes carry their own position, so where a visitor drops
      // one is where everybody sees it.
      d.onDrop(x, y);
    } else if (d.key) {
      var moved = get('moved', {});
      moved[d.key] = { x: x, y: y };
      set('moved', moved);
    }
  }

  window.addEventListener('pointermove', dragMove);
  window.addEventListener('pointerup', dragEnd);
  window.addEventListener('pointercancel', dragEnd);

  function makeDraggable(el, handle, key, onDrop) {
    handle = handle || el;

    handle.addEventListener('pointerdown', function (e) {
      if (e.target.closest('a, button, input, textarea, select')) return;
      if (!window.matchMedia('(min-width: 560px)').matches) return;

      var offset = el.offsetParent;
      if (!offset) return;

      var rect = el.getBoundingClientRect();
      var parent = offset.getBoundingClientRect();

      drag = {
        el: el,
        key: key,
        onDrop: onDrop,
        originX: rect.left - parent.left,
        originY: rect.top - parent.top,
        startX: e.clientX,
        startY: e.clientY
      };

      el.style.left = drag.originX + 'px';
      el.style.top = drag.originY + 'px';
      el.style.zIndex = ++zTop;
      el.classList.add('focused');

      handle.setPointerCapture && handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
  }

  function restorePositions() {
    if (!window.matchMedia('(min-width: 560px)').matches) return;
    var moved = get('moved', {});
    Object.keys(moved).forEach(function (key) {
      if (key.indexOf('note:') === 0) return;   // notes carry their own x/y
      var el = document.querySelector('.item[data-key="' + CSS.escape(key) + '"]');
      if (!el) return;
      el.style.left = moved[key].x + 'px';
      el.style.top = moved[key].y + 'px';
      el.style.zIndex = ++zTop;
    });
  }

  /* ============================================================== WINDOWS */

  function mountItems() {
    document.querySelectorAll('.plantbed > .item').forEach(function (item) {
      var handle = item.querySelector('h3');
      if (!handle) return;

      item.addEventListener('pointerdown', function () { item.style.zIndex = ++zTop; });
      makeDraggable(item, handle, item.dataset.key);
    });
  }

  /* ============================================================== TOGGLES */

  var TOGGLES = [
    { id: 'grain', label: 'grain',
      apply: function (on) { document.body.classList.toggle('grain', on); } },
    { id: 'clock', label: 'clock', def: true,
      apply: function (on) { var c = document.getElementById('clock-shell');
                             if (c) c.style.display = on ? '' : 'none'; } },

    // The music player. This parks the whole thing off the side of the
    // screen and brings it back; `‹‹` on the player itself only docks it.
    // Both are transforms in ipod.css, so neither one stops the music --
    // hiding the player is not the same as turning it off.
    //
    // It is a body class rather than a reach for the element, because
    // ipod.js builds #ipod-shell after this file has already run.
    { id: 'music', label: 'music', def: true,
      only: function () { return !!(window.GARDEN_MUSIC && window.GARDEN_MUSIC.length); },
      apply: function (on) { document.body.classList.toggle('music-off', !on); } }
  ];

  var THEMES = ['', 'theme-clean', 'theme-pocari', 'theme-olive', 'theme-ink'];
  var THEME_NAMES = ['bone', 'paper', 'pocari', 'olive', 'ink'];

  function mountToggles() {
    var bar = document.getElementById('taskbar-toggles');
    if (!bar) return;

    TOGGLES.forEach(function (t) {
      if (t.only && !t.only()) return;
      var on = get('toggle.' + t.id, !!t.def);
      var btn = document.createElement('button');
      btn.className = 'toggle';
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(on));
      btn.innerHTML = '<span class="led"></span>' + t.label;
      btn.addEventListener('click', function () {
        on = !on;
        btn.setAttribute('aria-pressed', String(on));
        set('toggle.' + t.id, on);
        t.apply(on);
      });
      bar.appendChild(btn);
      t.apply(on);
    });

    // theme cycler
    var themeIdx = get('theme', 0);
    var themeBtn = document.createElement('button');
    themeBtn.className = 'toggle';
    themeBtn.type = 'button';
    function paintTheme() {
      THEMES.forEach(function (c) { if (c) document.body.classList.remove(c); });
      if (THEMES[themeIdx]) document.body.classList.add(THEMES[themeIdx]);
      themeBtn.innerHTML = '<span class="led"></span>' + THEME_NAMES[themeIdx];
      themeBtn.setAttribute('aria-pressed', 'true');
    }
    themeBtn.addEventListener('click', function () {
      themeIdx = (themeIdx + 1) % THEMES.length;
      set('theme', themeIdx);
      paintTheme();
    });
    bar.appendChild(themeBtn);
    paintTheme();

    // reset everything this visitor has rearranged
    var reset = document.createElement('button');
    reset.className = 'toggle';
    reset.type = 'button';
    reset.innerHTML = '<span class="led"></span>put back';
    reset.title = 'put every item back where Finder has it';
    reset.addEventListener('click', function () {
      set('moved', {});
      location.reload();
    });
    bar.appendChild(reset);
  }

  /* ============================================================ GUESTBOOK
     Storage goes through a small adapter. `local` keeps notes in this
     browser only — good for previewing. A shared backend is swapped in by
     setting GARDEN_CONFIG.guestbook.
     ------------------------------------------------------------------- */

  var Guestbook = {
    mode: (CFG.guestbook && CFG.guestbook.mode) || 'local',

    list: function () {
      if (this.mode === 'local') return Promise.resolve(get('notes', []));
      return fetch(CFG.guestbook.url, { headers: { 'accept': 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (d) { return d.notes || []; });
    },

    add: function (note) {
      if (this.mode === 'local') {
        var notes = get('notes', []);
        notes.push(note);
        set('notes', notes);
        return Promise.resolve(note);
      }
      return fetch(CFG.guestbook.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(note)
      }).then(function (r) { return r.json(); });
    },

    update: function (note) {
      if (this.mode === 'local') {
        var notes = get('notes', []).map(function (n) { return n.id === note.id ? note : n; });
        set('notes', notes);
        return Promise.resolve(note);
      }
      return fetch(CFG.guestbook.url + '/' + encodeURIComponent(note.id), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(note)
      }).then(function (r) { return r.json(); });
    }
  };

  function noteEl(note, bed) {
    var el = document.createElement('div');
    el.className = 'note c' + (note.colour % 5);
    el.dataset.key = 'note:' + note.id;

    var when = new Date(note.at).toLocaleDateString();
    el.innerHTML =
      '<div class="note-head"><strong></strong><span></span></div>' +
      '<div class="note-body"></div>' +
      '<div class="replies"></div>' +
      '<div class="note-foot"><button type="button">reply</button></div>';

    el.querySelector('.note-head strong').textContent = note.name || 'anonymous';
    el.querySelector('.note-head span').textContent = when;
    el.querySelector('.note-body').textContent = note.body;

    var replies = el.querySelector('.replies');
    (note.replies || []).forEach(function (r) {
      var d = document.createElement('div');
      d.className = 'reply';
      d.textContent = '↳ ' + (r.name || 'anonymous') + ': ' + r.body;
      replies.appendChild(d);
    });

    el.querySelector('.note-foot button').addEventListener('click', function () {
      var who = prompt('your name (optional)') || 'anonymous';
      var body = prompt('your reply');
      if (!body) return;
      note.replies = note.replies || [];
      note.replies.push({ name: who, body: body, at: Date.now() });
      Guestbook.update(note);
      var d = document.createElement('div');
      d.className = 'reply';
      d.textContent = '↳ ' + who + ': ' + body;
      replies.appendChild(d);
    });

    if (window.matchMedia('(min-width: 560px)').matches && note.x != null) {
      el.style.left = note.x + 'px';
      el.style.top = note.y + 'px';
    }

    bed.appendChild(el);
    makeDraggable(el, el.querySelector('.note-head'), 'note:' + note.id, function (x, y) {
      note.x = x;
      note.y = y;
      Guestbook.update(note);
    });
    return el;
  }

  function mountGuestbook() {
    var form = document.getElementById('gb-form');
    var bed = document.getElementById('gb-notes');
    if (!form || !bed) return;

    var status = document.getElementById('gb-status');

    if (Guestbook.mode === 'local') {
      status.textContent = 'preview mode — notes are saved in your browser only';
    }

    Guestbook.list().then(function (notes) {
      notes.forEach(function (n) { noteEl(n, bed); });
    }).catch(function (e) {
      status.textContent = 'could not load the guestbook (' + e.message + ')';
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = form.querySelector('[name=name]').value.trim();
      var body = form.querySelector('[name=body]').value.trim();
      if (!body) return;

      var note = {
        id: String(Date.now()) + Math.random().toString(36).slice(2, 7),
        name: name || 'anonymous',
        body: body.slice(0, 800),
        at: Date.now(),
        colour: Math.floor(Math.random() * 5),
        x: Math.round(40 + Math.random() * 420),
        y: Math.round(40 + Math.random() * 260),
        replies: []
      };

      Guestbook.add(note).then(function () {
        noteEl(note, bed);
        form.reset();
        status.textContent = 'posted!';
        setTimeout(function () {
          status.textContent = Guestbook.mode === 'local'
            ? 'preview mode — notes are saved in your browser only' : '';
        }, 2500);
      }).catch(function (err) {
        status.textContent = 'could not post (' + err.message + ')';
      });
    });
  }

  /* =========================================================== NAVIGATION
     Every folder on this site is a real page, which is the whole idea --
     and it meant that walking into one threw the music player away with the
     rest of the document. This turns an internal click into a fetch and a
     swap of <main>, so the furniture outside <main> (the clock, the taskbar,
     the iPod) is never rebuilt and never stops.

     It is a progressive enhancement and nothing more. With JavaScript off,
     or on any fetch that does not come back cleanly, the link does exactly
     what it always did: a full page load. Nobody is ever left on a blank
     page -- the failure path is `location.href = url`.
     ------------------------------------------------------------------- */

  var navToken = 0;                 // so a slow fetch cannot overwrite a fast one

  /** The one <style> the generator writes per page: the Finder coordinates. */
  function pageStyle(doc) {
    return doc.getElementById('page-style') || doc.head.querySelector('style');
  }

  /**
   * Is this a link to another folder page on this site?
   *
   * Deliberately narrow. Only paths that end in "/" or "/index.html" are
   * pages; everything else in a garden is a real file -- an image, a text
   * file, a download -- and must be left to the browser. Modifier clicks,
   * middle clicks, new-tab targets and other origins are left alone too,
   * because every one of them means "not here".
   */
  function pageLink(a) {
    if (!a || !a.getAttribute) return false;
    if (a.hasAttribute('download')) return false;
    if (a.getAttribute('target')) return false;
    if ((a.getAttribute('rel') || '').indexOf('external') !== -1) return false;

    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#') return false;

    var url;
    try { url = new URL(a.href); } catch (e) { return false; }

    if (url.origin !== location.origin) return false;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.href.split('#')[0] === location.href.split('#')[0]) return false;

    return /\/$/.test(url.pathname) || /\/index\.html$/i.test(url.pathname);
  }

  /**
   * Rewrite the incoming page's relative URLs so they still point where they
   * did before it was lifted out of its own folder.
   *
   * This is the part that has to be right. A page two folders down writes
   * `src="../../garden-assets/x.png"` and `href="older/"`, both relative to
   * ITS folder; dropped into a document sitting at the root they would
   * resolve against the wrong base and every link on the page would break.
   * Resolving each one against the URL it was fetched from makes them
   * absolute, which is correct from anywhere.
   */
  var URL_ATTRS = ['href', 'src', 'poster'];

  function absolutise(scope, base) {
    var nodes = scope.querySelectorAll('[href],[src],[poster],[srcset]');
    var i, a, raw, node;

    for (i = 0; i < nodes.length; i++) {
      node = nodes[i];

      for (a = 0; a < URL_ATTRS.length; a++) {
        raw = node.getAttribute(URL_ATTRS[a]);
        if (raw === null || raw === '') continue;
        // already absolute, protocol-relative, a fragment, or a data: URI
        if (raw.charAt(0) === '#' || raw.indexOf('//') === 0) continue;
        if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
        try { node.setAttribute(URL_ATTRS[a], new URL(raw, base).href); } catch (e) {}
      }

      raw = node.getAttribute('srcset');
      if (raw) {
        try {
          node.setAttribute('srcset', raw.split(',').map(function (part) {
            var bits = part.trim().split(/\s+/);
            if (!bits[0]) return part;
            bits[0] = new URL(bits[0], base).href;
            return bits.join(' ');
          }).join(', '));
        } catch (e) {}
      }
    }
  }

  function go(url, push, scrollY) {
    var token = ++navToken;
    document.body.classList.add('is-navigating');

    fetch(url, { credentials: 'same-origin', headers: { 'accept': 'text/html' } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var type = r.headers.get('content-type') || '';
        if (type && type.indexOf('text/html') === -1) throw new Error('not a page');
        return r.text();
      })
      .then(function (html) {
        if (token !== navToken) return;              // a later click already won

        var doc = new DOMParser().parseFromString(html, 'text/html');
        var incoming = doc.querySelector('main');
        var here = document.querySelector('main');
        if (!incoming || !here) throw new Error('no main');

        absolutise(incoming, url);

        // Remember where we were standing before leaving, so Back lands
        // on the same part of the page.
        if (push) {
          history.replaceState({ garden: 1, y: window.pageYOffset }, '', location.href);
          history.pushState({ garden: 1, y: 0 }, '', url);
        }

        here.parentNode.replaceChild(document.importNode(incoming, true), here);

        // The page-specific <style> is the Finder layout for THIS folder.
        var mine = pageStyle(document);
        var theirs = pageStyle(doc);
        if (mine) mine.textContent = theirs ? theirs.textContent : '';

        if (doc.title) document.title = doc.title;

        bootPage();
        window.scrollTo(0, scrollY || 0);
        document.body.classList.remove('is-navigating');

        // Put the reader at the top of the new page rather than leaving
        // focus on a link that no longer exists.
        var h1 = document.querySelector('main h1');
        if (h1) {
          h1.setAttribute('tabindex', '-1');
          try { h1.focus({ preventScroll: true }); } catch (e) { h1.focus(); }
        }
      })
      .catch(function () {
        if (token !== navToken) return;
        document.body.classList.remove('is-navigating');
        location.href = url;          // whatever went wrong, just load the page
      });
  }

  function mountNav() {
    if (!window.fetch || !window.history || !history.pushState || !window.DOMParser) return;

    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    history.replaceState({ garden: 1, y: window.pageYOffset }, '', location.href);

    document.addEventListener('click', function (e) {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      var a = e.target.closest ? e.target.closest('a') : null;
      if (!pageLink(a)) return;

      e.preventDefault();
      go(a.href, true, 0);
    });

    window.addEventListener('popstate', function (e) {
      go(location.href, false, (e.state && e.state.y) || 0);
    });
  }

  /* ================================================================ boot

     Split in two, because the page is no longer built exactly once. Anything
     that belongs to the document as a whole -- the clock, the taskbar, the
     link interception -- is mounted once and left alone. Anything that
     belongs to the contents of <main> is mounted again after every swap,
     because those nodes are new. The iPod is in neither list: ipod.js moves
     it out of <main> on load and nothing here ever touches it again.
     ------------------------------------------------------------------- */

  function bootPage() {
    mountItems();
    mountGuestbook();
    restorePositions();
  }

  /* ============================================================== BROADCAST
     The ticker says what the world is reading on Wikipedia right now. It is
     the closest thing to live news that a page with no server can honestly
     get: one public feed, no key, no tracking, and it allows the request
     from a browser.

     The owner's own words are already in the HTML. This only ever appends,
     so with no JS, no network, or a feed that moved, the ticker still reads
     exactly as it did before.
     ========================================================================= */

  function mountBroadcast() {
    var span = document.querySelector('.marquee span');
    if (!span || !window.fetch) return;

    var d = new Date();
    // Yesterday: the current day's ranking is still being counted, and an
    // empty list would leave the ticker looking broken for no reason.
    d.setDate(d.getDate() - 1);
    var ymd = d.getFullYear() + '/' +
      ('0' + (d.getMonth() + 1)).slice(-2) + '/' + ('0' + d.getDate()).slice(-2);

    fetch('https://api.wikimedia.org/feed/v1/wikipedia/en/featured/' + ymd)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var list = j && j.mostread && j.mostread.articles;
        if (!list || !list.length) return;

        var titles = [];
        for (var i = 0; i < list.length && titles.length < 8; i++) {
          var t = list[i].normalizedtitle;
          // Wikipedia's own furniture is not news.
          if (t && t.indexOf('Main Page') < 0 && t.indexOf('Special:') < 0) titles.push(t);
        }
        if (!titles.length) return;

        // textContent, not innerHTML: this string comes off the network.
        span.textContent = span.textContent +
          '  the world is reading  *  ' + titles.join('  *  ') + '  *';
      })
      .catch(function () { /* offline, or the feed moved. The ticker stands. */ });
  }

  function boot() {
    mountClock();
    mountToggles();
    mountNav();
    mountBroadcast();
    bootPage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
