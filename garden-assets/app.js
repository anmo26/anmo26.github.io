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
  var pending = null;          // pressed, but not yet moved far enough to count
  var DRAG_SLOP = 4;           // px of travel before a press becomes a drag
  var TOUCH_SLOP = 8;          // a finger resting is never as still as a mouse
  var HOLD_MS = 420;           // press-and-hold, about the length iOS uses
  var holdTimer = null;

  /* The one width the whole page agrees on. Below it the Finder coordinates
     are dropped and the items simply flow; everything that has to know asks
     here rather than spelling the query out again. */
  function wide() { return window.matchMedia('(min-width: 560px)').matches; }

  /**
   * Pin every item in a bed at the spot it is already occupying.
   *
   * Below the breakpoint the items are in normal flow, where `left` and `top`
   * mean nothing to them -- which is why dragging used to be switched off on a
   * phone altogether. This is what turns it back on: nothing moves, the stack
   * just stops being a stack, and from here the phone bed is the same
   * absolutely-positioned bed the desktop has.
   *
   * All of them at once, and never one at a time: lifting a single item out of
   * the flow would reflow everything below it out from under the finger.
   */
  function freezeBed(bed) {
    if (!bed || bed.hasAttribute('data-frozen')) return;

    var items = bed.querySelectorAll(':scope > .item');
    var base = bed.getBoundingClientRect();
    var box = [];
    var i, b;

    for (i = 0; i < items.length; i++) {
      b = items[i].getBoundingClientRect();
      box.push({ x: b.left - base.left, y: b.top - base.top, w: b.width });
    }

    // The bed was only as tall as its flow contents, and it is about to have
    // no flow left in it at all.
    bed.style.minHeight = Math.ceil(base.height) + 'px';

    for (i = 0; i < items.length; i++) {
      // The width has to be carried over explicitly: a paragraph of writing
      // that was filling the page would otherwise shrink to its longest word.
      items[i].style.width = Math.ceil(box[i].w) + 'px';
      items[i].style.position = 'absolute';
      items[i].style.margin = '0';
      items[i].style.left = Math.round(box[i].x) + 'px';
      items[i].style.top = Math.round(box[i].y) + 'px';
    }

    bed.setAttribute('data-frozen', '');
  }

  /** A frozen bed holds no flow, so it has to be told how tall it now is. */
  function growBed(bed) {
    if (!bed || !bed.hasAttribute('data-frozen')) return;
    var items = bed.querySelectorAll(':scope > .item');
    var low = 0;
    for (var i = 0; i < items.length; i++) {
      low = Math.max(low, items[i].offsetTop + items[i].offsetHeight);
    }
    bed.style.minHeight = Math.ceil(low + 24) + 'px';
  }

  /** The bed an element is lying on, or null if it is furniture on top. */
  function bedOf(el) {
    var p = el.parentNode;
    return p && p.classList && p.classList.contains('plantbed') ? p : null;
  }

  /**
   * The moment a held press becomes a grab. A finger gets no cursor and no
   * hover, so unless the item visibly answers the hold nobody can tell whether
   * it took -- and they let go and try again.
   */
  function lift(p) {
    p.held = true;
    // Without this the browser is still free to decide the finger meant to
    // scroll, and would cancel the drag the instant it moved.
    p.el.style.touchAction = 'none';
    p.el.style.transition = 'transform .12s ease-out';
    p.el.style.transform = 'scale(1.06)';
    p.el.classList.add('focused');
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) {} }
  }

  function drop(p) {
    p.el.style.touchAction = '';
    p.el.style.transition = '';
    p.el.style.transform = '';
    p.el.classList.remove('focused');
  }

  function beginDrag() {
    drag = pending;
    pending = null;
    clearTimeout(holdTimer);

    // On a phone the bed is still in flow, and a coordinate would mean
    // nothing until it is pinned.
    if (!wide()) freezeBed(bedOf(drag.el));

    drag.el.style.left = drag.originX + 'px';
    drag.el.style.top = drag.originY + 'px';
    drag.el.style.zIndex = ++zTop;
    drag.el.classList.add('focused');
    if (drag.handle && drag.handle.setPointerCapture) {
      try { drag.handle.setPointerCapture(drag.pointerId); } catch (err) {}
    }
  }

  function dragMove(e) {
    if (pending) {
      var slop = pending.touch ? TOUCH_SLOP : DRAG_SLOP;
      var travelled = Math.abs(e.clientX - pending.startX) >= slop ||
                      Math.abs(e.clientY - pending.startY) >= slop;

      if (pending.touch && !pending.held) {
        // Travelled before the hold was up. This finger is reading the page,
        // and the press was never a grab -- so get out of the way of it
        // completely rather than competing with the scroll.
        if (travelled) { clearTimeout(holdTimer); drop(pending); pending = null; }
        return;
      }
      // A lifted item follows the finger straight away; there is no second
      // threshold to cross once the hold has already said what this is.
      if (!pending.touch && !travelled) return;

      beginDrag();
    }
    if (!drag) return;

    // Held off until now: preventing the default on the press itself would
    // have cancelled the click, and a press that never travels IS a click.
    if (e.cancelable) e.preventDefault();

    // The bed can be scaled to fit the window, and these are screen pixels.
    // Without dividing, the item would lag behind the pointer.
    var k = bedScale || 1;
    var x = Math.max(0, drag.originX + (e.clientX - drag.startX) / k);
    var y = Math.max(0, drag.originY + (e.clientY - drag.startY) / k);

    // A phone cannot pan sideways to go and fetch something back, so nothing
    // may be pushed off the edge of it in the first place.
    if (!wide() && drag.el.parentNode) {
      var room = drag.el.parentNode.clientWidth - drag.el.offsetWidth;
      if (room > 0 && x > room) x = room;
      if (room <= 0) x = 0;
    }

    drag.el.style.left = x + 'px';
    drag.el.style.top = y + 'px';
  }

  /**
   * The browser paints its own grip in the bottom-right corner of anything
   * with `resize`, and handles the drag itself. We must keep our hands off
   * those pixels or the item runs away instead of the picture growing.
   */
  var GRIP = 18;

  // Matches MAX_MEDIA_PX in the generator: how wide a picture is drawn before
  // anybody touches it. Finder's grid is 112px, so wider than this starts
  // landing on whatever was placed beside it.
  var MEDIA_START_PX = 238;

  function inResizeGrip(e) {
    var box = e.target.closest ? e.target.closest('[data-resizable]') : null;
    if (!box) return false;
    var r = box.getBoundingClientRect();
    return e.clientX > r.right - GRIP && e.clientY > r.bottom - GRIP;
  }

  /**
   * A picture is wrapped in a link, so letting go of the resize corner still
   * counts as a click on that link and the file would open. Pulling a corner
   * is not asking to open anything, so the click that follows is dropped.
   *
   * Armed on the press rather than the release: by the time the pointer
   * comes up the browser has already decided a click is on its way.
   */
  document.addEventListener('pointerdown', function (e) {
    if (!inResizeGrip(e)) return;

    var box = e.target.closest('[data-resizable]');
    if (!box || box.hasAttribute('data-gripped')) return;
    box.setAttribute('data-gripped', '');

    var kill = function (ev) { ev.preventDefault(); ev.stopPropagation(); };
    box.addEventListener('click', kill, true);

    window.addEventListener('pointerup', function stop() {
      window.removeEventListener('pointerup', stop, true);
      // One tick of slack: the click lands immediately after pointerup, and
      // the guard has to still be there when it does.
      setTimeout(function () {
        box.removeEventListener('click', kill, true);
        box.removeAttribute('data-gripped');
      }, 0);
    }, true);
  }, true);

  /** A press that turned into a drag must not also open the link under it. */
  function swallowNextClick(el) {
    var kill = function (ev) { ev.preventDefault(); ev.stopPropagation(); };
    el.addEventListener('click', kill, true);
    setTimeout(function () { el.removeEventListener('click', kill, true); }, 0);
  }

  function dragEnd() {
    clearTimeout(holdTimer);
    if (pending) { drop(pending); pending = null; }
    if (!drag) return;
    var d = drag;
    drag = null;
    drop(d);
    swallowNextClick(d.el);

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
    growBed(bedOf(d.el));
    fitSoon();
  }

  window.addEventListener('pointermove', dragMove);
  window.addEventListener('pointerdown', function () {
    clearTimeout(holdTimer);
    if (pending) { drop(pending); pending = null; }
  }, true);
  window.addEventListener('pointerup', dragEnd);
  window.addEventListener('pointercancel', dragEnd);

  /* A long press is the drag gesture now, so the browser's own long-press
     menu -- iOS's link preview, Android's context menu -- would otherwise
     open on top of the item the visitor has just picked up. */
  window.addEventListener('contextmenu', function (e) {
    if (drag || (pending && pending.held)) e.preventDefault();
  });

  /**
   * A press does not become a drag until the pointer has actually travelled.
   * That is what lets the filename and the icon -- both of them links, and
   * both the obvious things to grab -- be draggable and still be clickable.
   * The old handler bailed out on any link, which left nothing draggable but
   * the grey size text beside the name.
   */
  function makeDraggable(el, handle, key, onDrop) {
    handle = handle || el;

    // iOS pops its own preview panel over a link or an image after about half
    // a second, which is precisely the gesture that now lifts the item.
    handle.style.webkitTouchCallout = 'none';

    handle.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // Real controls keep their own behaviour; a press on one is never a drag.
      if (e.target.closest('button, input, textarea, select, video, audio, iframe')) return;
      if (inResizeGrip(e)) return;     // that corner belongs to the browser

      var offset = el.offsetParent;
      if (!offset) return;

      var rect = el.getBoundingClientRect();
      var parent = offset.getBoundingClientRect();
      var k = bedScale || 1;

      pending = {
        el: el,
        key: key,
        onDrop: onDrop,
        handle: handle,
        pointerId: e.pointerId,
        touch: e.pointerType !== 'mouse',
        held: e.pointerType === 'mouse',   // a mouse means it the moment it moves
        originX: (rect.left - parent.left) / k,
        originY: (rect.top - parent.top) / k,
        startX: e.clientX,
        startY: e.clientY
      };

      clearTimeout(holdTimer);
      if (pending.held) return;

      /* Swiping is how a phone reads a page, so a finger that has merely
         landed on something is not yet asking to move it -- and a 4px
         threshold would have turned every scroll that started on an icon into
         a drag. Hold still and the item lifts; move first and the press stays
         what it was, a scroll or a tap. */
      var p = pending;
      holdTimer = setTimeout(function () {
        if (pending === p) lift(p);
      }, HOLD_MS);
    });
  }

  function restorePositions() {
    var moved = get('moved', {});
    var mine = [];

    Object.keys(moved).forEach(function (key) {
      if (key.indexOf('note:') === 0) return;   // notes carry their own x/y
      var el = document.querySelector('.item[data-key="' + CSS.escape(key) + '"]');
      if (el) mine.push({ el: el, at: moved[key] });
    });
    if (!mine.length) return;

    // On a phone the items are still in flow, and a remembered coordinate
    // cannot mean anything to them until the bed has been pinned.
    if (!wide()) freezeBed(document.querySelector('.plantbed'));

    mine.forEach(function (m) {
      m.el.style.left = m.at.x + 'px';
      m.el.style.top = m.at.y + 'px';
      m.el.style.zIndex = ++zTop;
    });

    if (!wide()) growBed(document.querySelector('.plantbed'));
  }

  /* ============================================================== WINDOWS */

  function mountItems() {
    document.querySelectorAll('.plantbed > .item').forEach(function (item) {
      // The browser's own link and image dragging would otherwise take over
      // the moment you grab an icon, which is the obvious thing to grab.
      item.querySelectorAll('a, img').forEach(function (n) { n.draggable = false; });

      item.addEventListener('pointerdown', function () { item.style.zIndex = ++zTop; });

      mountResizable(item);

      // Anything that stands for the file is a handle: the icon, the name,
      // the picture. Prose and code are not, so text stays selectable.
      var handles = item.querySelectorAll('h3, .icon, :scope > a > img, :scope > img, :scope > video');
      if (!handles.length) return;
      handles.forEach(function (h) { makeDraggable(item, h, item.dataset.key); });
    });
  }

  /**
   * Pictures and videos lying open on the front page can be pulled bigger or
   * smaller by their corner, and stay that way. The browser does the actual
   * resizing; all this does is give it something to resize, put back what
   * was chosen last time, and write down the result.
   */
  function mountResizable(item) {
    if (!item.classList.contains('kind-image') && !item.classList.contains('kind-video')) return;

    /* The grip is a pointer affordance. A finger has no corner to catch, and
       the browser draws nothing there to catch -- but mounting it anyway had
       two costs on a phone. The press guard below swallows any click in the
       bottom-right 18px of a resizable box, so that corner of every picture
       went dead; and a resizable box drops its max-width, which let a 1872px
       video push the whole page sideways and leave the site panning. */
    if (!wide()) return;

    var media = item.querySelector('img, video');
    if (!media) return;
    var box = media.parentNode;
    if (!box || box === item) box = media;      // no wrapping link: resize the media
    if (box.hasAttribute('data-resizable')) return;

    box.setAttribute('data-resizable', '');

    var key = item.dataset.key;
    var sizes = get('sized', {});
    if (key && sizes[key]) {
      box.style.width = sizes[key].w + 'px';
    } else {
      // Measuring the rendered width here would read back the "fill the box"
      // rule and lock in whatever the item happened to be. Size from the
      // picture's own dimensions instead, capped the way the page caps them.
      var nat = media.naturalWidth ||
                parseInt(media.getAttribute('width'), 10) || 0;
      box.style.width = (nat ? Math.min(nat, MEDIA_START_PX) : MEDIA_START_PX) + 'px';
    }

    if (!key || !window.ResizeObserver) return;

    // Only record once the pointer is up: an observer firing mid-drag would
    // write to storage on every frame.
    var pendingW = 0;
    var ro = new ResizeObserver(function (entries) {
      pendingW = Math.round(entries[0].contentRect.width);
    });
    ro.observe(box);

    window.addEventListener('pointerup', function () {
      if (!pendingW) return;
      var all = get('sized', {});
      all[key] = { w: pendingW };
      set('sized', all);
      pendingW = 0;
    });
  }


  /* ================================================================== FIT
     The arrangement is whatever Finder says it is, and a folder dragged wide
     on a big display does not fit a laptop window -- which left the site
     needing scrolling in both directions at once. Rather than move anything,
     which would throw away the arrangement, the whole bed is scaled down
     until it fits.

     There is a floor: past a point the filenames stop being readable, and a
     page you cannot read is worse than a page you have to scroll. Below that
     floor it scrolls, just less than it did.
     --------------------------------------------------------------------- */

  var bedScale = 1;
  var MIN_SCALE = 0.62;
  var TASKBAR_H = 44;

  function bedContent(bed) {
    var items = bed.querySelectorAll(':scope > .item');
    var w = 0, h = 0;
    var base = bed.getBoundingClientRect();
    var k = bedScale || 1;

    for (var i = 0; i < items.length; i++) {
      var b = items[i].getBoundingClientRect();
      // Back out of whatever scale is on right now, so this measures the
      // arrangement itself rather than the last answer we gave.
      w = Math.max(w, (b.right - base.left) / k);
      h = Math.max(h, (b.bottom - base.top) / k);
    }
    return { w: w, h: h };
  }

  function fitBed() {
    var bed = document.querySelector('.plantbed');
    if (!bed) return;

    var on = get('toggle.fit', true) && wide() &&
             bed.classList.contains('freeform');

    if (!on) {
      bedScale = 1;
      bed.style.transform = '';
      bed.style.width = '';
      // A frozen bed is holding its own height up -- every item in it is
      // absolute now -- so clearing this would collapse the page to nothing
      // the first time anything was dragged on a phone.
      if (!bed.hasAttribute('data-frozen')) {
        bed.style.height = '';
        bed.style.minHeight = '';
      }
      return;
    }

    var size = bedContent(bed);
    if (!size.w || !size.h) return;

    var availW = bed.parentNode.clientWidth;
    var top = bed.getBoundingClientRect().top + window.pageYOffset - bedOffsetY(bed);
    var availH = window.innerHeight - top - TASKBAR_H;
    if (availW < 80 || availH < 160) return;

    var k = Math.min(1, availW / size.w, availH / size.h);
    if (k < MIN_SCALE) k = MIN_SCALE;

    bedScale = k;
    if (k === 1) {
      bed.style.transform = '';
      bed.style.height = '';
      bed.style.minHeight = '';
      return;
    }

    // transform does not change layout, so the page would keep the unscaled
    // height and scroll into empty paper. Say what the box is really worth.
    bed.style.transformOrigin = 'top left';
    bed.style.transform = 'scale(' + k + ')';
    bed.style.width = (100 / k) + '%';
    bed.style.height = Math.ceil(size.h * k) + 'px';
    // The generator writes a min-height for the unscaled arrangement into the
    // page itself, and that would win -- leaving a screen of empty paper
    // below the folder to scroll through.
    bed.style.minHeight = bed.style.height;
  }

  /** How far the bed has already been shifted by its own transform. */
  function bedOffsetY(bed) {
    return 0;   // transform-origin is the top-left, so the top never moves
  }

  var fitTimer = null;
  function fitSoon() {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(fitBed, 60);
  }

  window.addEventListener('resize', fitSoon);

  /* ============================================================== TOGGLES */

  var TOGGLES = [
    // Nothing to fit on a phone: the arrangement is dropped below the
    // breakpoint, so this scaled nothing and only ate room in a bar that has
    // none to spare.
    { id: 'fit', label: 'fit', def: true,
      only: function () { return wide(); },
      apply: function () { fitSoon(); } },
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
      set('sized', {});
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


  /* ============================================================== VIEWERS
     Opening a file used to hand the whole browser window over to it, which
     is the one thing a folder never does. A file opens in a panel on top of
     the page instead: draggable, closeable, and as many at once as you like,
     so two things can sit side by side while the site carries on behind them.
     ---------------------------------------------------------------------- */

  var VIEWER_KIND = {
    image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp'],
    video: ['mp4', 'mov', 'webm', 'm4v', 'ogv'],
    audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'aiff'],
    frame: ['pdf'],
    text:  ['txt', 'text', 'md', 'markdown', 'log', 'csv', 'json', 'js', 'mjs',
            'css', 'html', 'py', 'sh', 'yml', 'yaml', 'toml', 'ini', 'rb', 'go',
            'rs', 'c', 'h', 'cpp', 'java', 'sql', 'conf']
  };

  var openViewers = 0;

  function viewerKind(pathname) {
    var m = /\.([A-Za-z0-9]+)$/.exec(pathname);
    if (!m) return null;
    var ext = m[1].toLowerCase();
    for (var kind in VIEWER_KIND) {
      if (VIEWER_KIND[kind].indexOf(ext) !== -1) return kind;
    }
    return null;
  }

  /** A link to a file we can show ourselves, rather than a folder to walk into. */
  function fileLink(a) {
    if (!a || !a.getAttribute) return false;
    if (a.hasAttribute('download') || a.getAttribute('target')) return false;

    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#') return false;

    var url;
    try { url = new URL(a.href); } catch (e) { return false; }
    if (url.origin !== location.origin) return false;
    if (/\/$/.test(url.pathname) || /\/index\.html$/i.test(url.pathname)) return false;

    return viewerKind(url.pathname);
  }

  function closeViewer(panel) {
    // Stop the sound before the node goes: a detached <video> can keep
    // playing in some browsers, and a torn-off iframe keeps downloading.
    panel.querySelectorAll('video, audio').forEach(function (m) {
      try { m.pause(); m.removeAttribute('src'); m.load(); } catch (e) {}
    });
    panel.querySelectorAll('iframe').forEach(function (f) { f.src = 'about:blank'; });
    if (panel.parentNode) panel.parentNode.removeChild(panel);
    openViewers = Math.max(0, openViewers - 1);
  }

  function openViewer(href, name, kind) {
    var panel = document.createElement('div');
    panel.className = 'viewer';

    // Cascade, so a second one does not land exactly on the first. Only where
    // there is room to cascade into: on a phone the stylesheet pins the panel
    // to the four edges of the screen, and an inline coordinate written here
    // beats that rule and leaves the panel hanging off the side instead.
    if (wide()) {
      var step = (openViewers % 6) * 26;
      panel.style.left = (70 + step) + 'px';
      panel.style.top = (70 + step) + 'px';
    }
    panel.style.zIndex = ++zTop;
    openViewers++;

    var bar = document.createElement('div');
    bar.className = 'viewer-bar';

    var label = document.createElement('span');
    label.className = 'viewer-name';
    label.textContent = name;
    bar.appendChild(label);

    var out = document.createElement('a');
    out.className = 'viewer-out';
    out.href = href;
    out.target = '_blank';
    out.rel = 'noopener';
    out.title = 'open the real file in a new tab';
    out.textContent = '↗';
    bar.appendChild(out);

    var shut = document.createElement('button');
    shut.className = 'viewer-shut';
    shut.type = 'button';
    shut.title = 'close';
    shut.setAttribute('aria-label', 'close ' + name);
    shut.textContent = '✕';
    shut.addEventListener('click', function () { closeViewer(panel); });
    bar.appendChild(shut);

    panel.appendChild(bar);

    var body = document.createElement('div');
    body.className = 'viewer-body';
    panel.appendChild(body);

    if (kind === 'image') {
      var img = document.createElement('img');
      img.alt = name;
      img.src = href;
      img.draggable = false;
      body.appendChild(img);
    } else if (kind === 'video') {
      var v = document.createElement('video');
      v.controls = true;
      v.src = href;
      body.appendChild(v);
    } else if (kind === 'audio') {
      var au = document.createElement('audio');
      au.controls = true;
      au.src = href;
      body.appendChild(au);
    } else if (kind === 'frame') {
      var f = document.createElement('iframe');
      f.src = href;
      f.title = name;
      body.appendChild(f);
    } else {
      var pre = document.createElement('pre');
      pre.textContent = 'reading…';
      body.appendChild(pre);
      fetch(href).then(function (r) {
        return r.ok ? r.text() : Promise.reject(new Error(r.status));
      }).then(function (t) {
        // textContent, never innerHTML: this is a file off the disk.
        pre.textContent = t;
      }).catch(function () {
        pre.textContent = 'could not read this file. the ↗ opens it directly.';
      });
    }

    document.body.appendChild(panel);
    panel.addEventListener('pointerdown', function () { panel.style.zIndex = ++zTop; });
    // Nowhere to drag it to when it already fills the screen, and a hold on
    // the title bar would only be a way to lose it off an edge.
    if (wide()) makeDraggable(panel, bar, null);
    shut.focus();
    return panel;
  }

  function mountViewers() {
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      // Modifier-clicks still mean "give me a real tab".
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      var a = e.target.closest ? e.target.closest('a') : null;
      var kind = fileLink(a);
      if (!kind) return;

      e.preventDefault();
      openViewer(a.href, a.getAttribute('data-name') || decodeURIComponent(
        a.pathname.split('/').pop()), kind);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var all = document.querySelectorAll('.viewer');
      if (!all.length) return;
      closeViewer(all[all.length - 1]);
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
    fitBed();
    // Pictures settle after they load, and the bed is only as big as what is
    // in it -- so measure again once they have.
    window.addEventListener('load', fitSoon);
    document.querySelectorAll('.plantbed img').forEach(function (img) {
      if (!img.complete) img.addEventListener('load', fitSoon, { once: true });
    });
  }

  /* ============================================================== BROADCAST
     The ticker carries actual news: Wikipedia's "In the news", which is the
     same short, sourced sentences that sit on its front page. One public
     endpoint, no key, no tracking, and it answers cross-origin.

     The owner's own words are already in the HTML. This replaces only the
     part after them, so with no JS, no network, or a feed that moved, the
     ticker still reads exactly as it was written.
     ========================================================================= */

  var NEWS_URL = 'https://en.wikipedia.org/w/api.php?action=parse' +
                 '&page=Template:In_the_news&prop=text&format=json&origin=*';
  var NEWS_EVERY_MS = 60 * 60 * 1000;      // an hour
  var newsBase = '';

  /** Strip tags and entities without ever handing the string to innerHTML. */
  function plainText(html) {
    var doc;
    try {
      doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
    } catch (e) { return ''; }
    return (doc.body.textContent || '').replace(/\[[^\]]*\]/g, '');
  }

  function headlines(html) {
    var items = html.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) || [];
    var out = [];

    for (var i = 0; i < items.length && out.length < 6; i++) {
      var t = plainText(items[i]).replace(/\s+/g, ' ').trim();

      // The list ends with bare "ongoing" and "recent deaths" links, which
      // are navigation rather than news. A real item is a whole sentence.
      if (t.length < 40 || t.charAt(t.length - 1) !== '.') continue;
      if (/^(Ongoing|Recent deaths)\b/i.test(t)) continue;

      out.push(t.replace(/\.$/, ''));
    }
    return out;
  }

  function paintNews(span, lines) {
    if (!lines.length) return;
    // textContent, never innerHTML: every word of this came off the network.
    span.textContent = newsBase + '  in the news  *  ' + lines.join('  *  ') + '  *';
  }

  function fetchNews(span) {
    // Cache-bust, or an hourly refresh would be served the same response by
    // the browser all day.
    fetch(NEWS_URL + '&_=' + Math.floor(Date.now() / NEWS_EVERY_MS))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var html = j && j.parse && j.parse.text && j.parse.text['*'];
        if (html) paintNews(span, headlines(html));
      })
      .catch(function () { /* offline, or the feed moved. The ticker stands. */ });
  }

  function mountBroadcast() {
    var span = document.querySelector('.marquee span');
    if (!span || !window.fetch || !window.DOMParser) return;

    newsBase = span.textContent;
    fetchNews(span);
    setInterval(function () { fetchNews(span); }, NEWS_EVERY_MS);

    // An hour is a long time to leave a laptop shut; catch up on waking.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) fetchNews(span);
    });
  }

  function boot() {
    mountClock();
    mountToggles();
    mountNav();
    mountViewers();
    mountBroadcast();
    bootPage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
