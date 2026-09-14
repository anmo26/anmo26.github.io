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
    '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100']
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

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  var DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  var MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY',
                'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

  function mountClock() {
    var host = document.getElementById('clock');
    var dateHost = document.getElementById('clock-date');
    if (!host) return;

    var state = {
      seconds: get('clock.seconds', false),
      hour24: get('clock.hour24', false)
    };

    var previous = '';
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
        dateHost.textContent = DAYS[d.getDay()] + ' · ' +
          MONTHS[d.getMonth()] + ' ' + d.getDate() + ' · ' + d.getFullYear() +
          (state.hour24 ? '' : ' · ' + (d.getHours() < 12 ? 'AM' : 'PM'));
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

    // Click to cycle 12h -> 24h -> hours and minutes only.
    var shell = document.getElementById('clock-shell');
    (shell || host).addEventListener('click', function () {
      if (!state.hour24) { state.hour24 = true; }
      else if (state.seconds) { state.seconds = false; }
      else { state.hour24 = false; state.seconds = true; }
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

  function makeDraggable(el, handle, key, onDrop) {
    handle = handle || el;
    var startX, startY, originX, originY, dragging = false;

    function down(e) {
      if (e.target.closest('a, button, input, textarea, select')) return;
      if (!window.matchMedia('(min-width: 760px)').matches) return;

      dragging = true;
      var rect = el.getBoundingClientRect();
      var parent = el.offsetParent.getBoundingClientRect();
      originX = rect.left - parent.left;
      originY = rect.top - parent.top;
      startX = e.clientX;
      startY = e.clientY;

      el.style.left = originX + 'px';
      el.style.top = originY + 'px';
      el.style.zIndex = ++zTop;
      el.classList.add('focused');

      handle.setPointerCapture && handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    }

    function move(e) {
      if (!dragging) return;
      var x = Math.max(0, originX + (e.clientX - startX));
      var y = Math.max(0, originY + (e.clientY - startY));
      el.style.left = x + 'px';
      el.style.top = y + 'px';
    }

    function up() {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('focused');

      var x = parseInt(el.style.left, 10);
      var y = parseInt(el.style.top, 10);

      if (onDrop) {
        // Guestbook notes carry their own position, so where a visitor drops
        // one is where everybody sees it.
        onDrop(x, y);
      } else if (key) {
        var moved = get('moved', {});
        moved[key] = { x: x, y: y };
        set('moved', moved);
      }
    }

    handle.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function restorePositions() {
    if (!window.matchMedia('(min-width: 760px)').matches) return;
    var moved = get('moved', {});
    Object.keys(moved).forEach(function (key) {
      if (key.indexOf('note:') === 0) return;   // notes carry their own x/y
      var el = document.querySelector('.win[data-key="' + CSS.escape(key) + '"]');
      if (!el) return;
      el.style.left = moved[key].x + 'px';
      el.style.top = moved[key].y + 'px';
      el.style.zIndex = ++zTop;
    });
  }

  /* ============================================================== WINDOWS */

  function mountWindows() {
    var collapsed = get('collapsed', {});

    document.querySelectorAll('.win').forEach(function (win) {
      var key = win.dataset.key;
      var bar = win.querySelector('.win-bar');

      if (collapsed[key]) win.classList.add('collapsed');

      var roll = win.querySelector('.js-collapse');
      if (roll) {
        roll.addEventListener('click', function () {
          win.classList.toggle('collapsed');
          collapsed[key] = win.classList.contains('collapsed');
          set('collapsed', collapsed);
          roll.textContent = win.classList.contains('collapsed') ? '+' : '_';
        });
        roll.textContent = win.classList.contains('collapsed') ? '+' : '_';
      }

      var close = win.querySelector('.js-close');
      if (close) {
        close.addEventListener('click', function () {
          win.style.display = 'none';
          var hidden = get('hidden', {});
          hidden[key] = true;
          set('hidden', hidden);
        });
      }

      win.addEventListener('pointerdown', function () { win.style.zIndex = ++zTop; });
      if (bar) makeDraggable(win, bar, key);
    });

    var hidden = get('hidden', {});
    Object.keys(hidden).forEach(function (key) {
      var el = document.querySelector('.win[data-key="' + CSS.escape(key) + '"]');
      if (el && hidden[key]) el.style.display = 'none';
    });
  }

  /* ============================================================== TOGGLES */

  var TOGGLES = [
    { id: 'grain', label: 'grain',
      apply: function (on) { document.body.classList.toggle('grain', on); } },
    { id: 'clock', label: 'clock', def: true,
      apply: function (on) { var c = document.getElementById('clock-shell');
                             if (c) c.style.display = on ? '' : 'none'; } }
  ];

  var THEMES = ['', 'theme-clean', 'theme-olive', 'theme-ink'];
  var THEME_NAMES = ['bone', 'paper', 'olive', 'ink'];

  function mountToggles() {
    var bar = document.getElementById('taskbar-toggles');
    if (!bar) return;

    TOGGLES.forEach(function (t) {
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
    reset.innerHTML = '<span class="led"></span>reset';
    reset.addEventListener('click', function () {
      set('moved', {});
      set('collapsed', {});
      set('hidden', {});
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

    if (window.matchMedia('(min-width: 760px)').matches && note.x != null) {
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

  /* ================================================================ boot */

  function boot() {
    mountClock();
    mountWindows();
    mountToggles();
    mountGuestbook();
    restorePositions();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
