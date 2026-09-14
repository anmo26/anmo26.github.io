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
     A Twemco-style split-flap clock, rendered entirely in ASCII. Each digit
     is a 5x5 grid of '#', sliced across the middle by the flap seam.
     ------------------------------------------------------------------- */

  var GLYPH = {
    '0': ['#####', '#   #', '#   #', '#   #', '#####'],
    '1': ['  ## ', '   # ', '   # ', '   # ', '  ###'],
    '2': ['#####', '    #', '#####', '#    ', '#####'],
    '3': ['#####', '    #', '#####', '    #', '#####'],
    '4': ['#   #', '#   #', '#####', '    #', '    #'],
    '5': ['#####', '#    ', '#####', '    #', '#####'],
    '6': ['#####', '#    ', '#####', '#   #', '#####'],
    '7': ['#####', '    #', '   # ', '  #  ', '  #  '],
    '8': ['#####', '#   #', '#####', '#   #', '#####'],
    '9': ['#####', '#   #', '#####', '    #', '    #']
  };

  var CARD_W = 5;
  var TOP_ROWS = 3;   // rows above the flap seam

  /**
   * Renders a run of digits as a row of flip cards.
   * Returns an array of text lines.
   */
  function cards(text) {
    var lines = [];
    var top = '+' + rep('-', CARD_W) + '+';

    function rowFor(i) {
      var out = [];
      for (var c = 0; c < text.length; c++) {
        var ch = text[c];
        if (ch === ':') { out.push(i === 1 || i === 3 ? ' o ' : '   '); continue; }
        var g = GLYPH[ch] || ['     ', '     ', '     ', '     ', '     '];
        out.push('|' + g[i] + '|');
      }
      return out.join('');
    }

    function edge() {
      var out = [];
      for (var c = 0; c < text.length; c++) {
        out.push(text[c] === ':' ? '   ' : top);
      }
      return out.join('');
    }

    lines.push(edge());
    for (var i = 0; i < TOP_ROWS; i++) lines.push(rowFor(i));
    lines.push(edge());                       // the flap seam
    for (var j = TOP_ROWS; j < 5; j++) lines.push(rowFor(j));
    lines.push(edge());
    return lines;
  }

  function rep(s, n) { return new Array(n + 1).join(s); }
  function pad(n) { return n < 10 ? '0' + n : String(n); }

  var DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  function centre(text, width) {
    if (text.length >= width) return text;
    var left = Math.floor((width - text.length) / 2);
    return rep(' ', left) + text + rep(' ', width - text.length - left);
  }

  function clockFrame(showSeconds, hour24) {
    var d = new Date();
    var h = d.getHours();
    var suffix = '';
    if (!hour24) {
      suffix = h < 12 ? 'AM' : 'PM';
      h = h % 12;
      if (h === 0) h = 12;
    }

    var time = pad(h) + ':' + pad(d.getMinutes()) + (showSeconds ? ':' + pad(d.getSeconds()) : '');
    var lines = cards(time);
    var width = lines[0].length;

    var date = DAYS[d.getDay()] + '  ' + MONTHS[d.getMonth()] + ' ' + pad(d.getDate()) +
               '  ' + d.getFullYear();

    var out = lines.slice();
    if (suffix) out.push(centre('[ ' + suffix + ' ]', width));
    out.push(rep('=', width));
    out.push(centre(date, width));
    return out.join('\n');
  }

  function mountClock() {
    var host = document.getElementById('clock');
    if (!host) return;

    var state = {
      seconds: get('clock.seconds', true),
      hour24: get('clock.hour24', false)
    };

    function draw() { host.textContent = clockFrame(state.seconds, state.hour24); }

    // Click the clock to cycle 12h -> 24h -> no seconds.
    host.addEventListener('click', function () {
      if (!state.hour24) { state.hour24 = true; }
      else if (state.seconds) { state.seconds = false; }
      else { state.hour24 = false; state.seconds = true; }
      set('clock.hour24', state.hour24);
      set('clock.seconds', state.seconds);
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
    { id: 'crt',     label: 'CRT',      apply: function (on) { document.body.classList.toggle('crt', on); } },
    { id: 'sparkle', label: 'sparkles', apply: function (on) { sparkleOn = on; } },
    { id: 'clock',   label: 'clock',    def: true,
      apply: function (on) { var c = document.getElementById('clock-shell');
                             if (c) c.style.display = on ? '' : 'none'; } }
  ];

  var THEMES = ['', 'theme-bubblegum', 'theme-matrix', 'theme-noon'];
  var THEME_NAMES = ['midnight', 'bubblegum', 'matrix', 'noon'];

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
    reset.innerHTML = '<span class="led"></span>reset layout';
    reset.addEventListener('click', function () {
      set('moved', {});
      set('collapsed', {});
      set('hidden', {});
      location.reload();
    });
    bar.appendChild(reset);
  }

  /* ============================================================ SPARKLES */

  var sparkleOn = false;
  var lastSparkle = 0;

  document.addEventListener('pointermove', function (e) {
    if (!sparkleOn) return;
    var now = Date.now();
    if (now - lastSparkle < 40) return;
    lastSparkle = now;

    var s = document.createElement('div');
    s.className = 'sparkle';
    s.style.left = (e.clientX - 3) + 'px';
    s.style.top = (e.clientY - 3) + 'px';
    s.style.background = ['#00ffff', '#ff00cc', '#00ff66', '#ffe600'][Math.floor(Math.random() * 4)];
    document.body.appendChild(s);
    setTimeout(function () { s.remove(); }, 700);
  });

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
