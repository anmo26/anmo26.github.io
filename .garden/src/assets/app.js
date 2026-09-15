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
      // Seconds cost three more cards, and the field is already as wide as a
      // phone will take. A visitor who wants them back taps the clock.
      seconds: get('clock.seconds', wide()),
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
    play('tick');
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
      // A second finger already down means this press is one half of a
      // pinch, not the start of a drag -- see activeTouches, below.
      if (activeTouches.length > 1) return;
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

    var bed = document.querySelector('.plantbed');

    // On a phone the items are still in flow, and a remembered coordinate
    // cannot mean anything to them until the bed has been pinned.
    if (!wide()) freezeBed(bed);

    mine.forEach(function (m) {
      var x = m.at.x;
      // A window narrowed from a desktop to a phone brings its remembered
      // coordinates with it, and half of them are off the side of the screen
      // now. Better where it still fits than where it cannot be reached.
      if (!wide() && bed) {
        var room = bed.clientWidth - m.el.offsetWidth;
        x = room > 0 ? Math.min(x, room) : 0;
      }
      m.el.style.left = x + 'px';
      m.el.style.top = m.at.y + 'px';
      m.el.style.zIndex = ++zTop;
    });

    if (!wide()) growBed(bed);
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

    /** The picture's own shape, once it is known. */
    function aspect() {
      var w = media.naturalWidth || media.videoWidth ||
              parseInt(media.getAttribute('width'), 10) || 0;
      var h = media.naturalHeight || media.videoHeight ||
              parseInt(media.getAttribute('height'), 10) || 0;
      return w && h ? w / h : 0;
    }

    /**
     * Put the corner back on the corner.
     *
     * `resize: both` hands the visitor a free rectangle, and a picture set
     * to fit inside one letterboxes: pull down and you get a tall grey box
     * with a small photo floating in it, the grip stranded in empty space
     * far below the image. Nobody is asking for a box. They are asking for
     * a bigger picture -- so the height is taken back off the drag and
     * derived from the width, which leaves the grip sitting exactly on the
     * bottom-right corner of what is actually on screen.
     */
    function snap(box) {
      var a = aspect();
      if (!a) return;
      box.style.height = Math.round(box.clientWidth / a) + 'px';
    }
    var box = media.parentNode;
    if (!box || box === item) box = media;      // no wrapping link: resize the media
    if (box.hasAttribute('data-resizable')) return;

    box.setAttribute('data-resizable', '');
    box.title = 'drag the bottom-right corner to resize';

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

    // The shape is only knowable once the picture has arrived, and the very
    // first sizing happens long before that.
    if (media.complete || media.videoWidth) snap(box);
    else media.addEventListener('load', function () { snap(box); }, { once: true });
    media.addEventListener('loadedmetadata', function () { snap(box); }, { once: true });

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
      snap(box);
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

     A phone used to drop the arrangement altogether below the 560px
     breakpoint and stack everything in a plain column instead -- which is
     also why the type in this file reads oversized on a phone: it was
     always chosen for how it looks AFTER the fit transform shrinks it, and
     a phone was the one place that transform never ran. `mobilizeBed` pins
     a phone's items back at the exact coordinates Finder gave them (the
     generator still writes those into a `@media (min-width: 560px)` block
     even though a phone never matches it -- this reads them out of that
     rule rather than off the rendered, stacked page), and then fitBed scales
     that real canvas down exactly the way it already does on a laptop.
     --------------------------------------------------------------------- */

  var bedScale = 1;
  var MIN_SCALE = 0.62;
  // A phone fits by width alone, and an arrangement a laptop finds merely
  // wide can be four or five times a phone's own width -- so fitting ALL of
  // it in means shrinking to about a seventh, at which point the filenames
  // are two pixels tall and the photos are specks. That is not "the same
  // look as the desktop", it is a thumbnail of it.
  //
  // So legibility wins over never panning: the floor is the point where text
  // is still readable, and a wider arrangement than that is panned across,
  // the way you would move a small window over a big desk.
  var MOBILE_MIN_SCALE = 0.5;
  var TASKBAR_H = 44;

  /** clientWidth is <main>'s padding box; the bed lives inside its content
   *  box, inset by that padding on both sides. Shared by fitBed and the
   *  pinch/double-tap code below, so the two can never disagree about how
   *  much room the phone actually has. */
  function mobileAvailW(bed) {
    var cs = window.getComputedStyle(bed.parentNode);
    return bed.parentNode.clientWidth -
      (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  }

  /** The plain width-fit a phone lands on when nobody has pinched or
   *  double-tapped: as close to full size as the screen allows, floored at
   *  the point past which a filename stops being legible. */
  function mobileFitWidthScale(availW, contentW) {
    var k = Math.min(1, availW / contentW);
    return k < MOBILE_MIN_SCALE ? MOBILE_MIN_SCALE : k;
  }

  /** The scale at which the whole arrangement fits the phone's own screen,
   *  width AND height both -- the same sum a laptop's fit already does,
   *  just against a phone's window instead of needing a click to trigger
   *  it. This is the floor a pinch can zoom out to, and what a double-tap
   *  zooms out to when it is not already there: past it there is nothing
   *  left to see, only an arrangement shrunk to specks. */
  function fitEverythingScale(bed, size) {
    if (!size.w || !size.h) return MOBILE_MIN_SCALE;
    var availW = mobileAvailW(bed);
    var availH = window.innerHeight - taskbarHeight() - 24;
    if (availW < 40 || availH < 40) return MOBILE_MIN_SCALE;
    return Math.max(0.16, Math.min(availW / size.w, availH / size.h));
  }

  function taskbarHeight() {
    var bar = document.getElementById('taskbar-toggles');
    var tb = bar ? bar.closest('.taskbar') : document.querySelector('.taskbar');
    return (tb && tb.offsetHeight) || TASKBAR_H;
  }

  /**
   * The Finder coordinates for this page, read straight out of the
   * `@media (min-width: 560px)` rule the generator writes per-page --
   * whether or not that media query currently matches. One `{ top, left }`
   * per item id ("p0", "p1", ...), or null if this page carries none (a
   * plain flowed listing, with nothing to recreate).
   */
  function pageCoords() {
    var style = pageStyle(document);
    if (!style || !style.sheet) return null;
    var rules;
    try { rules = style.sheet.cssRules; } catch (e) { return null; }
    if (!rules) return null;

    var map = null;
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (!r.media || !/min-width/.test(r.media.mediaText)) continue;
      for (var j = 0; j < r.cssRules.length; j++) {
        var rr = r.cssRules[j];
        if (!rr.selectorText || rr.selectorText.charAt(0) !== '#') continue;
        if (!rr.style.left && !rr.style.top) continue;
        map = map || {};
        map[rr.selectorText.slice(1)] = { top: rr.style.top, left: rr.style.left };
      }
    }
    return map;
  }

  /**
   * On a phone, pin a freeform bed's items at their real Finder coordinates
   * instead of leaving them in the flowed column the stylesheet falls back
   * to below 560px. Safe to call as often as fitBed likes: a bed only ever
   * does this once, the same way freezeBed only ever freezes once.
   */
  function mobilizeBed(bed) {
    if (wide() || !bed || bed.hasAttribute('data-frozen')) return;
    if (!bed.classList.contains('freeform')) return;

    var coords = pageCoords();
    if (!coords) return;

    var items = bed.querySelectorAll(':scope > .item');
    var used = 0;
    for (var i = 0; i < items.length; i++) {
      var c = items[i].id && coords[items[i].id];
      if (!c) continue;
      items[i].style.position = 'absolute';
      items[i].style.margin = '0';
      items[i].style.left = c.left;
      items[i].style.top = c.top;
      used++;
    }
    if (!used) return;

    // The class carries the same freeform sizing rules style.css already
    // gives a desktop item (width: max-content, the icon column, the log's
    // margin), just without that rule's own 560px gate. It has to land
    // before deoverlapItems below measures anything, or every item is
    // still whatever width the flowed phone stack left it at.
    bed.classList.add('mobile-freeform');

    deoverlapItems(items);
    resettleWhenImagesLoad(bed, items);

    bed.setAttribute('data-frozen', '');
    growBed(bed);
  }

  /**
   * A photo whose file has not arrived yet has almost no height, so the
   * settling above measures it as a sliver and lets a neighbour sit where
   * the full-size picture is about to appear. Wait for the pictures, then
   * settle once more against their real heights.
   *
   * Only ever done while the arrangement is still the one the page worked
   * out for itself: the moment a visitor picks anything up, where things
   * sit is their decision, and a late-loading photo must not shove it
   * around underneath them.
   */
  function resettleWhenImagesLoad(bed, items) {
    var imgs = bed.querySelectorAll('img');
    var i;

    bed.setAttribute('data-settling', '');
    bed.addEventListener('pointerdown', function () {
      bed.removeAttribute('data-settling');
    }, { once: true, capture: true });

    function settle() {
      if (!bed.hasAttribute('data-settling')) return;
      deoverlapItems(items);
      growBed(bed);
    }

    // The first settle above ran against whatever width the bed happened to
    // have at that instant -- fitBed has not yet chosen the phone's scale,
    // and that choice changes the bed's width, which changes how tall every
    // wrapped caption and scaled photo ends up. Settle again once the
    // browser has finished laying all of that out, and again as the pictures
    // themselves arrive, since a photo that has not loaded reserves the
    // wrong hole until it does.
    requestAnimationFrame(function () { requestAnimationFrame(settle); });

    for (i = 0; i < imgs.length; i++) {
      if (imgs[i].complete) continue;
      imgs[i].addEventListener('load', settle, { once: true });
      imgs[i].addEventListener('error', settle, { once: true });
    }

    // Past this point the arrangement is the one the visitor sees and may
    // already be rearranging; nothing loading late gets to move it again.
    setTimeout(function () {
      settle();
      bed.removeAttribute('data-settling');
    }, 4000);
  }


  // A gap to leave between two items once one has been dropped below the
  // other -- small enough to still read as one arrangement, wide enough
  // that a finger can tell the two apart.
  var MOBILE_ITEM_GAP = 14;

  /**
   * A folder's Finder coordinates are laid out for the small icon Finder
   * itself draws at that spot. On the desktop page that is still roughly
   * what ends up there, but on a phone every item is full width -- a photo
   * or a page of writing dropped at an icon's old (x, y) reaches straight
   * into whatever else Finder happened to put nearby, and the two become
   * unusable stacked on top of each other.
   *
   * Rather than throw the arrangement out, this keeps the Finder ordering
   * and nudges each item straight down past anything already claiming its
   * space -- the same gravity a masonry layout uses. The x Finder chose is
   * never touched, only y, so the result still reads as the owner's own
   * columns settling into a clear run rather than a shuffled stack.
   */
  function deoverlapItems(items) {
    var placed = [];
    var i, j, el, rect, p, hit, guard;

    for (i = 0; i < items.length; i++) {
      el = items[i];
      rect = {
        left: parseFloat(el.style.left) || 0,
        top: parseFloat(el.style.top) || 0,
        width: el.offsetWidth,
        height: el.offsetHeight
      };
      rect.right = rect.left + rect.width;
      rect.bottom = rect.top + rect.height;

      // Settle straight down until clear of everything already placed. A
      // second pass over the list is needed because dropping past one
      // collision can land squarely on top of another one that started
      // out lower -- each pass only ever pushes further down, so this is
      // guaranteed to finish, but the guard is there in case a rounding
      // quirk ever disagrees with that math.
      hit = true;
      guard = 0;
      while (hit && guard < 500) {
        hit = false;
        for (j = 0; j < placed.length; j++) {
          p = placed[j];
          if (rect.left < p.right && rect.right > p.left &&
              rect.top < p.bottom && rect.bottom > p.top) {
            rect.top = p.bottom + MOBILE_ITEM_GAP;
            rect.bottom = rect.top + rect.height;
            hit = true;
          }
        }
        guard++;
      }

      el.style.top = Math.round(rect.top) + 'px';
      placed.push(rect);
    }
  }

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

    mobilizeBed(bed);

    var on = get('toggle.fit', true) && bed.classList.contains('freeform') &&
             (wide() || bed.hasAttribute('data-frozen'));

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

    // clientWidth is <main>'s padding box; the bed lives inside its content
    // box, inset by that padding on both sides. Measuring the padding box
    // itself was a few percent too generous about how much room there
    // really was -- barely visible on a laptop's wide margins, but on a
    // phone's much narrower ones it was enough to leave the bed's own right
    // edge hanging past the screen.
    var availW = mobileAvailW(bed);
    if (availW < 80) return;

    var k;
    if (wide()) {
      var top = bed.getBoundingClientRect().top + window.pageYOffset - bedOffsetY(bed);
      var availH = window.innerHeight - top - taskbarHeight();
      if (availH < 160) return;
      k = Math.min(1, availW / size.w, availH / size.h);
      if (k < MIN_SCALE) k = MIN_SCALE;
    } else {
      // A phone already scrolls vertically the way any page does -- fitting
      // height too would only shrink everything further than the one thing
      // that actually has to fit does. Only the width is real here: past
      // it a folder needs a sideways scroll to read at all, which is the
      // exact complaint this whole thing exists to fix. The floor is just a
      // safety net against a filename shrinking to nothing, not a target.
      //
      // Unless a pinch or a double-tap has already picked a scale on
      // purpose -- that choice has to survive a resize or a rotation
      // rather than being clobbered back to the width-fit the moment the
      // window so much as twitches.
      if (mobileZoom != null) {
        k = Math.max(fitEverythingScale(bed, size), Math.min(ZOOM_MAX, mobileZoom));
      } else {
        k = mobileFitWidthScale(availW, size.w);
      }
    }

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

  /* ============================================================ PINCH ZOOM
     Swiping sideways used to be the only way past what MOBILE_MIN_SCALE
     would fit -- a whole wide arrangement, or a close look at one corner
     of it, were both out of reach. A two-finger pinch changes the scale
     directly; a double-tap jumps between the two ends of that range.
     Panning while zoomed is nothing new -- it is just the ordinary
     sideways scroll <main> already has, and the page's own vertical one.

     This has to be Touch events, not Pointer events. A pinch is only
     legible as two touches arriving on the same gesture, which is what
     TouchEvent hands over directly (`e.touches`); Pointer events would mean
     reassembling that out of two independent pointerdowns by hand. More to
     the point, preventDefault() on a pointer event does not stop Safari's
     own page-zoom gesture -- only preventing the matching touchmove does.
     ------------------------------------------------------------------- */

  var ZOOM_MAX = 2.2;      // close enough to make out a photo's corner
  var mobileZoom = null;   // a scale the visitor chose on purpose; null = automatic
  var pinch = null;        // { dist, scale, bed, size } while two fingers are down

  function touchDistance(t0, t1) {
    var dx = t1.clientX - t0.clientX, dy = t1.clientY - t0.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Sets the bed to an explicit scale, the same way the tail of fitBed
   *  does -- but this is a scale a visitor picked, not one fitBed itself
   *  worked out, so it is recorded in mobileZoom rather than recomputed. */
  function applyZoom(bed, k, size) {
    bedScale = k;
    mobileZoom = k;
    bed.style.transformOrigin = 'top left';
    bed.style.transform = 'scale(' + k + ')';
    bed.style.width = (100 / k) + '%';
    bed.style.height = Math.ceil(size.h * k) + 'px';
    bed.style.minHeight = bed.style.height;
  }

  function onPinchStart(e) {
    if (wide() || e.touches.length !== 2) return;
    var bed = document.querySelector('.plantbed');
    if (!bed || !bed.classList.contains('freeform') || !bed.hasAttribute('data-frozen')) return;

    // A second finger landing means whatever the first one was starting --
    // a tap, a held drag -- was never that; get out of its way entirely.
    clearTimeout(holdTimer);
    if (pending) { drop(pending); pending = null; }
    if (drag) { drop(drag); drag = null; }

    e.preventDefault();
    pinch = {
      dist: touchDistance(e.touches[0], e.touches[1]),
      scale: bedScale || 1,
      bed: bed,
      size: bedContent(bed)
    };
  }

  function onPinchMove(e) {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();

    var bed = pinch.bed, size = pinch.size;
    if (!size.w || !size.h) return;

    var floor = Math.min(fitEverythingScale(bed, size), MOBILE_MIN_SCALE);
    var d = touchDistance(e.touches[0], e.touches[1]);
    var k = pinch.scale * (d / pinch.dist);
    if (k < floor) k = floor;
    if (k > ZOOM_MAX) k = ZOOM_MAX;

    // Keep the point between the two fingers under the two fingers: read
    // where it falls in the bed's own unscaled coordinates before the
    // scale changes, then pull the page's scroll back to put it there
    // again after. A transform never moves anything by itself -- only the
    // scroll containers around it do.
    var midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    var midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    var before = bed.getBoundingClientRect();
    var contentX = (midX - before.left) / (bedScale || 1);
    var contentY = (midY - before.top) / (bedScale || 1);

    applyZoom(bed, k, size);

    var after = bed.getBoundingClientRect();
    var main = bed.parentNode;
    main.scrollLeft += after.left - (midX - contentX * k);
    window.scrollBy(0, after.top - (midY - contentY * k));
  }

  function onPinchEnd(e) {
    if (pinch && e.touches.length < 2) pinch = null;
  }

  document.addEventListener('touchstart', onPinchStart, { passive: false });
  document.addEventListener('touchmove', onPinchMove, { passive: false });
  document.addEventListener('touchend', onPinchEnd, { passive: false });
  document.addEventListener('touchcancel', onPinchEnd, { passive: false });

  /* A press-and-drag already answers to two fingers landing at once (see
     onPinchStart) but not to two independent fingers, one after another,
     each getting its own pointerdown. Count how many touches are actually
     down and refuse to arm a drag once a second one lands, so a finger
     steadying the phone while the other pinches can never be mistaken for
     a second thing to pick up. */
  var activeTouches = [];
  window.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse') return;
    if (activeTouches.indexOf(e.pointerId) === -1) activeTouches.push(e.pointerId);
  }, true);
  function releaseTouch(e) {
    var i = activeTouches.indexOf(e.pointerId);
    if (i !== -1) activeTouches.splice(i, 1);
  }
  window.addEventListener('pointerup', releaseTouch, true);
  window.addEventListener('pointercancel', releaseTouch, true);

  /* Double-tap toggles between the two ends of the same range a pinch
     reaches: the whole folder at once, or the ordinary reading scale. It
     only answers on the bare paper of the bed, never on an item -- a tap
     on a file already opens it the instant it lifts, with no wait to see
     whether a second one is coming, so a "double tap" over an item is
     really just two single taps in a row, and it has to stay that. */
  var lastTapAt = 0, lastTapX = 0, lastTapY = 0;

  function onPossibleDoubleTap(e) {
    if (wide() || pinch) return;
    if (e.changedTouches.length !== 1 || e.touches.length !== 0) return;
    if (e.target.closest && e.target.closest('.item')) return;

    var t = e.changedTouches[0];
    var now = Date.now();
    var close = Math.abs(t.clientX - lastTapX) < 30 && Math.abs(t.clientY - lastTapY) < 30;
    var isDouble = close && (now - lastTapAt) < 350;

    // A third tap landing quickly is not a second double-tap; make it
    // start the count over instead of toggling the zoom straight back.
    lastTapAt = isDouble ? 0 : now;
    lastTapX = t.clientX;
    lastTapY = t.clientY;
    if (!isDouble) return;

    var bed = document.querySelector('.plantbed');
    if (!bed || !bed.classList.contains('freeform') || !bed.hasAttribute('data-frozen')) return;
    var size = bedContent(bed);
    if (!size.w || !size.h) return;

    e.preventDefault();

    var everything = fitEverythingScale(bed, size);
    var comfortable = mobileFitWidthScale(mobileAvailW(bed), size.w);

    var current = mobileZoom == null ? comfortable : mobileZoom;
    var goingOut = current > (everything + comfortable) / 2;
    applyZoom(bed, goingOut ? everything : comfortable, size);
  }

  document.addEventListener('touchend', onPossibleDoubleTap, { passive: false });

  /* The last word in the taskbar is an instruction, and the gesture it names
     is not the same one on both. A phone was being told to drag. */
  function mountHint() {
    var hint = document.getElementById('taskbar-clock');
    if (!hint) return;
    hint.textContent = wide() ? 'drag things around →' : 'hold to move';
  }

  window.addEventListener('resize', fitSoon);
  window.addEventListener('resize', mountHint);

  /* ============================================================== TOGGLES */

  var TOGGLES = [
    // A phone gets the same scaled-down arrangement a laptop does now, so
    // the same switch turns it off there too.
    { id: 'fit', label: 'fit', def: true,
      apply: function () { fitSoon(); } },
    { id: 'sound', label: 'sound', def: true,
      apply: function (on) { soundOn = on; ambSync(); } },
    { id: 'pogo', label: 'pogo', def: true,
      apply: function (on) { var m = document.getElementById('pogo');
                             if (m) m.hidden = !on; } },
    { id: 'plant', label: 'plant', def: true,
      apply: function (on) { var c = document.getElementById('cactus-shell');
                             if (c) c.style.display = on ? '' : 'none'; } },
    { id: 'still', label: 'still', def: true,
      apply: function (on) { var d = document.getElementById('still-shell');
                             if (d) d.style.display = on ? '' : 'none'; } },
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

  // Grain used to be a single on/off, and for a long time it was wired to a
  // class the stylesheet did not define -- the button did nothing at all.
  // There are four textures now, so it cycles like the theme button beside
  // it. Each is drawn in plain black and multiplied into whatever paper is
  // underneath, so none of them can introduce a colour of its own.
  var TEXTURES = ['', 'tex-grain', 'tex-scan', 'tex-weave', 'tex-dots'];
  var TEXTURE_NAMES = ['plain', 'grain', 'scan', 'weave', 'dots'];

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

    // texture cycler -- same shape as the theme one above
    var texIdx = get('texture', 0);
    var texBtn = document.createElement('button');
    texBtn.className = 'toggle';
    texBtn.type = 'button';
    function paintTexture() {
      TEXTURES.forEach(function (c) { if (c) document.body.classList.remove(c); });
      if (TEXTURES[texIdx]) document.body.classList.add(TEXTURES[texIdx]);
      texBtn.innerHTML = '<span class="led"></span>' + TEXTURE_NAMES[texIdx];
      texBtn.setAttribute('aria-pressed', texIdx ? 'true' : 'false');
    }
    texBtn.addEventListener('click', function () {
      texIdx = (texIdx + 1) % TEXTURES.length;
      set('texture', texIdx);
      paintTexture();
    });
    bar.appendChild(texBtn);
    paintTexture();

    // reset everything this visitor has rearranged
    var reset = document.createElement('button');
    reset.className = 'toggle';
    reset.type = 'button';
    reset.innerHTML = '<span class="led"></span>put back';
    reset.title = 'put every item back where Finder has it';
    /* Put back means put back: the arrangement, the sizes, every door that
       has been found, and every living thing's progress. What it does not
       touch is preference -- the theme, the texture, the switches, the
       clock's format and the player are how this visitor likes the place,
       not something they have done to it. */
    var WORLD = ['moved', 'sized', 'cactus', 'still', 'adam', 'sun', 'rocket',
                 'dig', 'tossed', 'ipod.scale',
                 'secret.garden', 'secret.bar', 'secret.sun', 'secret.moon',
                 'secret.family', 'secret.night', 'secret.ocean', 'secret.crypt'];
    /* Not in that list, deliberately: `nursery`, because those plants take
       years and nobody should lose four of them by tidying their desk, and
       `trophies`, which is a record of what this visitor has already done.
       Putting the world back does not mean it never happened. */

    reset.addEventListener('click', function () {
      WORLD.forEach(function (k) {
        try { localStorage.removeItem(STORE + k); } catch (e) {}
        try { sessionStorage.removeItem(STORE + k); } catch (e) {}
      });
      try { sessionStorage.removeItem(STORE + 'secret.library'); } catch (e) {}
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

        // The scene lives on <body>, which a page swap does not replace.
        var scene = doc.body && doc.body.getAttribute('data-scene');
        if (scene) document.body.setAttribute('data-scene', scene);
        else document.body.removeAttribute('data-scene');

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
    if (wide()) {
      makeDraggable(panel, bar, null);
      mountViewerGrip(panel);
    }
    shut.focus();
    return panel;
  }

  /**
   * Drives the panel's corner by hand instead of leaning on the browser's
   * own `resize`. That built-in resize only ever worked for pictures: a
   * text file's own scrollbar and a PDF's iframe both sit flush with the
   * same corner and catch the mousedown before the browser's resize logic
   * gets a look at it, which is exactly why those panels read as stuck.
   * A real element, appended after everything else in the panel, sits on
   * top of all of it by DOM order alone and answers the drag itself --
   * so every kind of file resizes the same way.
   */
  function mountViewerGrip(panel) {
    var grip = document.createElement('div');
    grip.className = 'viewer-grip';
    panel.appendChild(grip);

    grip.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      panel.style.zIndex = ++zTop;

      var rect = panel.getBoundingClientRect();
      var startX = e.clientX, startY = e.clientY;
      var startW = rect.width, startH = rect.height;
      var cs = window.getComputedStyle(panel);
      var minW = parseFloat(cs.minWidth) || 0;
      var minH = parseFloat(cs.minHeight) || 0;
      var capW = parseFloat(cs.maxWidth);
      var maxW = isNaN(capW) ? Infinity : capW;
      if (panel.parentNode) {
        maxW = Math.min(maxW, panel.parentNode.clientWidth - rect.left - 4);
      }

      // Pin the width down before the first move: it has been shrink-to-fit
      // until now, and a stray pointermove must not have it jump back there.
      panel.style.width = startW + 'px';
      panel.style.height = startH + 'px';
      grip.classList.add('gripping');
      try { grip.setPointerCapture(e.pointerId); } catch (err) {}

      function move(ev) {
        var w = Math.max(minW, Math.min(maxW, startW + (ev.clientX - startX)));
        var h = Math.max(minH, startH + (ev.clientY - startY));
        panel.style.width = w + 'px';
        panel.style.height = h + 'px';
      }
      function up() {
        grip.classList.remove('gripping');
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
      }
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
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
    syncScene();            // a folder can be a place; see GARDEN SCENE
    cactusVisit();          // a new page is a new chance to water the plant
    mountItems();
    mountGuestbook();
    // Ahead of restorePositions: a returning visitor who has already moved
    // something would otherwise have their phone bed frozen at the flowed,
    // stacked layout first (restorePositions freezes it too, to have
    // somewhere to write a remembered x/y into), and the real Finder
    // coordinates would arrive one call too late to matter.
    mobilizeBed(document.querySelector('.plantbed'));
    restorePositions();
    fitBed();
    // Pictures settle after they load, and the bed is only as big as what is
    // in it -- so measure again once they have.
    window.addEventListener('load', fitSoon);
    document.querySelectorAll('.plantbed img').forEach(function (img) {
      if (!img.complete) img.addEventListener('load', fitSoon, { once: true });
    });
  }

  /* ================================================================ TICKER
     The line under the masthead. It used to read the same four phrases all
     day and then an hour of world news, neither of which had anything to do
     with this folder. It is the site's own recent history now: the things
     most lately added or changed, newest first, straight off the file
     dates -- so a photograph dragged into a folder in Finder announces
     itself on the next build without anybody writing a word about it.

     Only the timestamps are built in. The wording is worked out here, when
     the page is read, so "an hour ago" means an hour before it is seen
     rather than an hour before it was published.
     ========================================================================= */

  function ago(ms) {
    var s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 90) return 'just now';
    var m = s / 60;
    if (m < 60) return Math.round(m) + ' minutes ago';
    var h = m / 60;
    if (h < 24) return Math.round(h) === 1 ? 'an hour ago' : Math.round(h) + ' hours ago';
    var d = h / 24;
    if (d < 2) return 'yesterday';
    if (d < 14) return Math.round(d) + ' days ago';
    var w = d / 7;
    if (w < 9) return Math.round(w) === 1 ? 'a week ago' : Math.round(w) + ' weeks ago';
    var mo = d / 30.4;
    if (mo < 18) return Math.round(mo) <= 1 ? 'a month ago' : Math.round(mo) + ' months ago';
    return Math.round(d / 365) + ' years ago';
  }

  function mountTicker() {
    var span = document.querySelector('.marquee span');
    if (!span) return;
    var recent = CFG.recent;
    if (!recent || !recent.length) return;

    function paint() {
      var out = ['lately'], i;
      for (i = 0; i < recent.length; i++) {
        out.push(recent[i].name + ' \u2014 ' + ago(recent[i].at));
      }
      // textContent, never innerHTML: a filename can hold anything.
      span.textContent = '  ' + out.join('  *  ') + '  *';
    }

    paint();
    setInterval(paint, 60000);
  }

  /* =============================================================== SOUND
     Two small noises, made on the spot rather than downloaded: a rustle
     when the cactus is watered and a tick when something is set down.
     Nothing is fetched, nothing is stored, and the taskbar can turn it off.
     A browser will not let a page make a sound until the visitor has done
     something, which is exactly when these fire anyway. */

  var soundOn = get('toggle.sound', true);
  var actx = null, noiseBuf = null;

  function audio() {
    if (!soundOn) return null;
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    if (!actx) { try { actx = new C(); } catch (e) { return null; } }
    if (actx.state === 'suspended') { try { actx.resume(); } catch (e) {} }
    if (!noiseBuf) {
      var n = Math.floor(actx.sampleRate * 0.5);
      noiseBuf = actx.createBuffer(1, n, actx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    return actx;
  }

  function play(kind) {
    var ctx = audio();
    if (!ctx) return;
    try {
      var t = ctx.currentTime;
      var src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      var f = ctx.createBiquadFilter();
      var g = ctx.createGain();
      src.connect(f); f.connect(g); g.connect(ctx.destination);

      if (kind === 'rustle') {
        // a handful of dry leaves: wide noise, soft in, soft out
        f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 0.6;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.085, t + 0.06);
        g.gain.exponentialRampToValueAtTime(0.0004, t + 0.44);
        src.start(t); src.stop(t + 0.46);
      } else if (kind === 'pluck') {
        f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 3;
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.0006, t + 0.13);
        src.start(t); src.stop(t + 0.15);
      } else {
        // something set down on a desk
        f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 1.1;
        g.gain.setValueAtTime(0.11, t);
        g.gain.exponentialRampToValueAtTime(0.0006, t + 0.05);
        src.start(t); src.stop(t + 0.06);
      }
    } catch (e) { /* no audio on this device; the site is not about sound */ }
  }

  /* ----------------------------------------------------------- ambience
     A room tone for the places that are places. It is the same trick as
     the noises above -- white noise through a filter -- but held open and
     shaped instead of struck, so it costs nothing to download and nothing
     to keep running. Each room gets a filter, a level, a slow swell, and
     sometimes a small event that happens now and then (a drip in the
     crypt, ice in a glass in the bar, a bubble in the sea).

     A browser will not let a page make a sound before the visitor has
     touched it, so the bed waits for the first click or keypress and then
     comes up over four seconds. Nobody should be startled by a website. */

  var AMBIENCE = {
    garden:    { type: 'bandpass', freq: 780,  q: 0.45, gain: 0.020, swell: 0.055, rate: 0.07,
                 every: [5200, 14000], voice: 'bird' },
    nursery:   { type: 'lowpass',  freq: 520,  q: 0.30, gain: 0.014, swell: 0.030, rate: 0.05 },
    moon:      { type: 'lowpass',  freq: 110,  q: 0.60, gain: 0.020, swell: 0.010, rate: 0.03 },
    crypt:     { type: 'lowpass',  freq: 180,  q: 1.40, gain: 0.026, swell: 0.014, rate: 0.04,
                 every: [4000, 11000], voice: 'drip' },
    bar:       { type: 'lowpass',  freq: 420,  q: 0.50, gain: 0.022, swell: 0.020, rate: 0.05,
                 every: [7000, 17000], voice: 'ice' },
    ocean:     { type: 'lowpass',  freq: 300,  q: 0.90, gain: 0.046, swell: 0.140, rate: 0.10,
                 every: [2600, 7000],  voice: 'bubble' },
    moonlight: { type: 'bandpass', freq: 3400, q: 1.20, gain: 0.010, swell: 0.040, rate: 0.13,
                 every: [3000, 9000],  voice: 'cricket' }
  };

  var amb = null;          // { src, filter, gain, lfo, timer, kind }
  var ambWanted = null;    // what the room asked for, whether or not it is on
  var ambTouched = false;  // has the visitor done anything yet

  function ambStop() {
    if (!amb) return;
    try {
      var t = actx.currentTime;
      amb.gain.gain.cancelScheduledValues(t);
      amb.gain.gain.setValueAtTime(amb.gain.gain.value || 0.0001, t);
      amb.gain.gain.exponentialRampToValueAtTime(0.00001, t + 1.2);
      var dying = amb;
      setTimeout(function () {
        try { dying.src.stop(); } catch (e) {}
        try { dying.lfo.stop(); } catch (e) {}
      }, 1500);
    } catch (e) {}
    clearInterval(amb.timer);
    amb = null;
  }

  /** One small event over the bed: a bird, a drip, ice, a bubble. */
  function ambVoice(kind) {
    var ctx = audio();
    if (!ctx) return;
    try {
      var t = ctx.currentTime;
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);

      if (kind === 'bird') {
        o.type = 'sine';
        o.frequency.setValueAtTime(2200 + Math.random() * 900, t);
        o.frequency.exponentialRampToValueAtTime(3400, t + 0.07);
        o.frequency.exponentialRampToValueAtTime(1900, t + 0.16);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.020, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);
        o.start(t); o.stop(t + 0.22);
      } else if (kind === 'drip') {
        o.type = 'sine';
        o.frequency.setValueAtTime(950, t);
        o.frequency.exponentialRampToValueAtTime(240, t + 0.11);
        g.gain.setValueAtTime(0.035, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.start(t); o.stop(t + 0.24);
      } else if (kind === 'bubble') {
        o.type = 'sine';
        o.frequency.setValueAtTime(320 + Math.random() * 260, t);
        o.frequency.exponentialRampToValueAtTime(880, t + 0.09);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.024, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
        o.start(t); o.stop(t + 0.15);
      } else if (kind === 'cricket') {
        o.type = 'triangle';
        o.frequency.setValueAtTime(4300, t);
        g.gain.setValueAtTime(0.0001, t);
        var k;
        for (k = 0; k < 3; k++) {
          g.gain.exponentialRampToValueAtTime(0.012, t + 0.02 + k * 0.07);
          g.gain.exponentialRampToValueAtTime(0.0002, t + 0.05 + k * 0.07);
        }
        o.start(t); o.stop(t + 0.26);
      } else {
        // ice: two short bright taps against a glass
        o.type = 'triangle';
        o.frequency.setValueAtTime(1800, t);
        g.gain.setValueAtTime(0.030, t);
        g.gain.exponentialRampToValueAtTime(0.0002, t + 0.09);
        g.gain.exponentialRampToValueAtTime(0.022, t + 0.135);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
        o.start(t); o.stop(t + 0.28);
      }
    } catch (e) {}
  }

  function ambStart(kind) {
    var spec = AMBIENCE[kind];
    if (!spec) return;
    var ctx = audio();
    if (!ctx) return;
    try {
      var t = ctx.currentTime;
      var src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;

      var f = ctx.createBiquadFilter();
      f.type = spec.type;
      f.frequency.value = spec.freq;
      f.Q.value = spec.q;

      var g = ctx.createGain();
      g.gain.setValueAtTime(0.00001, t);
      g.gain.exponentialRampToValueAtTime(spec.gain, t + 4);

      // the swell: a very slow wave laid over the level, so it breathes
      var lfo = ctx.createOscillator();
      var lg = ctx.createGain();
      lfo.type = 'sine';
      lfo.frequency.value = spec.rate;
      lg.gain.value = spec.swell * spec.gain * 18;
      lfo.connect(lg); lg.connect(g.gain);

      src.connect(f); f.connect(g); g.connect(ctx.destination);
      src.start(t); lfo.start(t);

      amb = { src: src, filter: f, gain: g, lfo: lfo, kind: kind, timer: 0 };

      if (spec.voice) {
        var lo = spec.every[0], hi = spec.every[1];
        amb.timer = setInterval(function () {
          if (document.hidden || !soundOn || !amb) return;
          if (Math.random() < 0.55) ambVoice(spec.voice);
        }, lo + Math.random() * (hi - lo));
      }
    } catch (e) {}
  }

  /** The room asks for its tone. Nothing happens until sound is on and
      somebody has touched the page. */
  function ambience(kind) {
    ambWanted = kind || null;
    ambSync();
  }

  function ambSync() {
    if (!soundOn || !ambTouched || !ambWanted) { ambStop(); return; }
    if (amb && amb.kind === ambWanted) return;
    ambStop();
    ambStart(ambWanted);
  }

  function ambWake() {
    if (ambTouched) return;
    ambTouched = true;
    ambSync();
  }
  document.addEventListener('pointerdown', ambWake, true);
  document.addEventListener('keydown', ambWake, true);

  /* ============================================================== SECRETS
     Some folders are not drawn on the page that holds them. Each names its
     own key in a secret.txt (see grow.js), and each key is earned a
     different way: twenty clicks on the clock, the last tuna picked off the
     cactus, a still that has finished its run, or simply the hour.

     How long a key lasts is part of the secret. The library is a guest --
     it is gone when the tab closes or when everything is put back. The two
     that are earned are kept. Night is not stored at all; it is asked of
     the clock. */

  var SECRET_KEEP = {
    library: 'session',
    garden:  'forever',
    bar:     'forever',
    sun:     'forever',
    moon:    'forever',
    family:  'forever',
    ocean:   'forever',
    crypt:   'forever',
    night:   'hour'
  };

  function sessionGet(key, fallback) {
    try {
      var v = sessionStorage.getItem(STORE + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  }
  function sessionSet(key, value) {
    try { sessionStorage.setItem(STORE + key, JSON.stringify(value)); } catch (e) {}
  }

  function isNight() {
    if (sessionGet('secret.night', false)) return true;   // the typed code
    var h = new Date().getHours();
    return h >= 21 || h < 5;
  }

  function secretOpen(key) {
    if (SECRET_KEEP[key] === 'hour') return isNight();
    if (SECRET_KEEP[key] === 'session') return sessionGet('secret.' + key, false);
    return get('secret.' + key, false);
  }

  function applySecrets() {
    var key;
    for (key in SECRET_KEEP) {
      if (!SECRET_KEEP.hasOwnProperty(key)) continue;
      document.body.classList.toggle('secret-' + key, secretOpen(key));
    }
  }

  function toast(text) {
    var el = document.createElement('div');
    el.className = 'secret-toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(function () { el.classList.add('going'); }, 3600);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4600);
  }

  function openSecret(key, announce) {
    if (SECRET_KEEP[key] === 'session') sessionSet('secret.' + key, true);
    else if (SECRET_KEEP[key] !== 'hour') set('secret.' + key, true);
    applySecrets();
    if (!announce) return;

    var item = document.querySelector('.item[data-secret="' + key + '"]');
    var name = item ? (item.dataset.key || '').replace(/\/$/, '') : key;
    toast(name + ' is open');
    play('pluck');
    if (item && item.scrollIntoView) item.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  var SECRET_CLICKS = 20;
  var SECRET_WINDOW_MS = 9000;
  // Typed on the keyboard, anywhere on the site. One opens a folder that
  // cannot be stumbled on by any amount of clicking; the other brings the
  // night round early, for showing somebody MOONLIGHT in the afternoon.
  var CODES = { anmoli: 'family', moonrise: 'night' };
  var CODE_LEN = 8;

  function mountSecrets() {
    applySecrets();
    // Night comes round on its own while somebody is still reading.
    setInterval(applySecrets, 60000);

    /* --- the clock: twenty clicks in a hurry opens the library --- */
    var shell = document.getElementById('clock-shell');
    var hits = [];
    if (shell) shell.addEventListener('click', function () {
      if (secretOpen('library')) return;
      var now = Date.now();
      hits.push(now);
      // Only a spam counts. A click a minute all afternoon is somebody
      // changing the time format, which is what this control is for.
      while (hits.length && now - hits[0] > SECRET_WINDOW_MS) hits.shift();

      if (hits.length >= SECRET_CLICKS) { hits = []; openSecret('library', true); return; }
      if (hits.length >= SECRET_CLICKS / 2) {
        shell.classList.add('rattling');
        setTimeout(function () { shell.classList.remove('rattling'); }, 220);
      }
    });

    /* --- the keyboard: a word typed anywhere on the page --- */
    var typed = '';
    document.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
      if (!/^[a-z]$/i.test(e.key)) return;

      typed = (typed + e.key.toLowerCase()).slice(-CODE_LEN);

      var word, key;
      for (word in CODES) {
        if (!CODES.hasOwnProperty(word)) continue;
        if (typed.slice(-word.length) !== word) continue;
        key = CODES[word];
        typed = '';

        if (key === 'night') {
          // It answers even when it is already dark. A code that types back
          // nothing is indistinguishable from a code that does not work.
          var already = isNight();
          sessionSet('secret.night', true);
          applySecrets();
          toast(already ? 'it is already night' : 'the moon is out');
          play('rustle');
          return;
        }

        if (secretOpen(key)) { toast('already open'); return; }
        openSecret(key, true);
        return;
      }
    });
  }

  /* ============================================================== CACTUS
     A prickly pear that belongs to the visitor, not to the site: it lives
     in their own browser, and everybody's is at a different height. It
     cannot die. Water is the only input, days are the only clock, and the
     end of it is fruit -- which can then be picked into the bucket beside
     the pot. The fruit of an opuntia is a tuna; five of them in the bucket
     opens the garden log.
     ------------------------------------------------------------------- */

  // Nine rows, eleven columns, every stage -- so the drawing grows without
  // the page around it shifting. The last four rows are the pot.
  var POT = [
    '  ,,,,,,,  ',
    ' \\mmmmmmm/ ',
    '  |ooooo|  ',
    '  \\_____/  '
  ];

  var CROWN = [
    ['', '', '', '', ''],
    ['', '', '', '', '     i     '],
    ['', '', '', '    ooo    ', '    oio    '],
    ['', '', '    ooo    ', '   onaoo   ', '   olioo   '],
    ['', '    ooo    ', '   onaoo   ', ' ooooooooo ', '   olioo   '],
    ['    !@!    ', '    ooo    ', '   onaoo   ', ' ooooooooo ', '   olioo   '],
    ['   6 6 6   ', '    ooo    ', '  6onaoo6  ', ' ooooooooo ', '   olioo   ']
  ];

  var TUNAS = 5;          // how many 6s stand in the fruiting drawing
  var RIPE = CROWN.length - 1;

  // The bucket: seven columns, bottom-aligned with the pot. Empty until
  // something is picked into it. Slots fill along the floor first, then
  // stack -- which is how fruit sits in a bucket.
  var BUCKET = ['       ', ' \\   / ', ' |   | ', ' \\___/ '];
  var BUCKET_SLOTS = [[2, 2], [2, 3], [2, 4], [1, 2], [1, 4]];

  var STAGE_NAME = ['a pot', 'a sprout', 'a pad', 'growing', 'arms out', 'in flower', 'fruiting'];
  var STAGE_NEED = [0, 1, 2, 4, 6, 9, 12];

  /* It used to take a fortnight of coming back: one watering per page
     visited, six a day at the outside. That was the right shape for a plant
     and the wrong shape for a site somebody is still building -- you could
     not see the thing you had just made until tomorrow. Water it as much as
     you like. The days are still counted, so the daily version is a
     constant away if it is ever wanted back. */

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function stageOf(drops) {
    var s = 0, i;
    for (i = 0; i < STAGE_NEED.length; i++) if (drops >= STAGE_NEED[i]) s = i;
    return s;
  }

  var cactusVisit = function () {};

  function mountCactus() {
    var host = document.getElementById('cactus');
    var shell = document.getElementById('cactus-shell');
    var pail = document.getElementById('bucket');
    var fill = document.getElementById('cactus-fill');
    var say = document.getElementById('cactus-say');
    if (!host || !shell) return;

    var plant = get('cactus', null);
    if (!plant || typeof plant.drops !== 'number') plant = { drops: 0, day: '', today: 0, last: 0 };
    if (!plant.picked || plant.picked.length !== TUNAS) plant.picked = [0, 0, 0, 0, 0];
    // Fruit comes back. Whatever was taken yesterday is on the plant again
    // this morning -- the garden it opened stays open regardless.
    if (plant.day !== today()) { plant.day = today(); plant.today = 0; plant.picked = [0, 0, 0, 0, 0]; }

    var sayTimer = null;

    function grown() { return stageOf(plant.drops) === RIPE; }
    function canWater() { return !grown(); }
    function inBucket() {
      var n = 0, i;
      for (i = 0; i < TUNAS; i++) if (plant.picked[i]) n++;
      return n;
    }

    /** Colour comes from where a character sits, not from what it is: the
        pot is the pot whatever letter draws it. Fruit and flowers are the
        exception -- those are themselves wherever they appear. */
    function paint() {
      var stage = stageOf(plant.drops);
      var ripe = stage === RIPE;
      var rows = CROWN[stage].concat(POT);
      var dry = plant.today === 0;
      var html = '';
      var r, c, ch, cls, fruit = 0;

      for (r = 0; r < rows.length; r++) {
        var row = rows[r] || '           ';
        for (c = 0; c < row.length; c++) {
          ch = row.charAt(c);
          if (ch === ' ') { html += ' '; continue; }

          if (ch === '6') {
            // A tuna. Picked ones leave a gap on the plant and turn up in
            // the bucket instead.
            var idx = fruit++;
            if (ripe && plant.picked[idx]) { html += ' '; continue; }
            html += '<span class="fr' + (ripe ? ' pick' : '') +
                    '" data-tuna="' + idx + '" title="pick it">6</span>';
            continue;
          }
          if (ch === '@' || ch === '!') cls = 'fl';
          else if (r >= CROWN[stage].length) cls = 'po';
          else cls = dry ? 'pa dry' : 'pa';
          html += '<span class="' + cls + '">' + ch + '</span>';
        }
        html += r === rows.length - 1 ? '' : '\n';
      }
      host.innerHTML = html;
      host.setAttribute('aria-label',
        'a prickly pear cactus, ' + STAGE_NAME[stage] + (dry ? ', thirsty' : ', watered'));

      paintBucket(ripe || inBucket() > 0);

      if (fill) {
        var at = STAGE_NEED[stage];
        var next = stage + 1 < STAGE_NEED.length ? STAGE_NEED[stage + 1] : at;
        var pc = next > at ? (plant.drops - at) / (next - at) : 1;
        var left = next - plant.drops;
        fill.style.width = Math.round(Math.max(0, Math.min(1, pc)) * 100) + '%';
        fill.parentNode.setAttribute('title',
          stage + 1 < STAGE_NEED.length
            ? STAGE_NAME[stage] + ' — ' + left + (left === 1 ? ' more watering to go' : ' more waterings to go')
            : 'fruiting. it does not get better than this.');
      }

      shell.classList.toggle('thirsty', canWater());
      shell.classList.toggle('dry', dry);
      shell.classList.toggle('ripe', ripe && inBucket() < TUNAS);
    }

    function paintBucket(show) {
      if (!pail) return;
      pail.hidden = !show;
      if (!show) return;

      var grid = BUCKET.map(function (s) { return s.split(''); });
      var i, slot, n = 0;
      for (i = 0; i < TUNAS; i++) {
        if (!plant.picked[i]) continue;
        slot = BUCKET_SLOTS[n++];
        grid[slot[0]][slot[1]] = '6';
      }
      var html = '', r, c, ch;
      for (r = 0; r < grid.length; r++) {
        for (c = 0; c < grid[r].length; c++) {
          ch = grid[r][c];
          if (ch === ' ') { html += ' '; continue; }
          html += '<span class="' + (ch === '6' ? 'fr' : 'po') + '">' + ch + '</span>';
        }
        html += r === grid.length - 1 ? '' : '\n';
      }
      pail.innerHTML = html;
      pail.setAttribute('title', inBucket() + ' of ' + TUNAS + ' tunas picked');
    }

    function speak(text, revert) {
      if (!say) return;
      clearTimeout(sayTimer);
      say.textContent = text;
      if (revert) sayTimer = setTimeout(function () { say.textContent = revert; }, 3200);
    }

    function rest() {
      if (grown() && inBucket() < TUNAS) { speak('pick the tuna'); return; }
      if (grown()) { speak('all grown'); return; }
      speak('water me');
    }

    function pick(idx) {
      if (plant.picked[idx]) return;
      plant.picked[idx] = 1;
      set('cactus', plant);
      paint();
      play('pluck');

      if (inBucket() >= TUNAS) {
        speak('bucket full', null);
        openSecret('garden', true);
        setTimeout(rest, 3600);
      } else {
        speak('in the bucket', null);
        setTimeout(rest, 2200);
      }
    }

    function water() {
      if (!canWater()) {
        speak('it is as big as it gets', null);
        setTimeout(rest, 2400);
        shell.classList.add('nope');
        setTimeout(function () { shell.classList.remove('nope'); }, 320);
        return;
      }

      var before = stageOf(plant.drops);
      plant.drops++;
      plant.today++;
      plant.last = Date.now();
      set('cactus', plant);
      paint();
      play('rustle');

      shell.classList.add('drinking');
      setTimeout(function () { shell.classList.remove('drinking'); }, 700);

      var after = stageOf(plant.drops);
      if (after > before) speak(after === RIPE ? 'it fruited!' : 'it grew!', null);
      else speak('thank you', null);
      setTimeout(rest, 3200);
    }

    shell.addEventListener('click', function (e) {
      // A ripe fruit is a thing in its own right: clicking one picks it
      // rather than watering the plant it is hanging on.
      var t = e.target.closest ? e.target.closest('[data-tuna]') : null;
      if (t && stageOf(plant.drops) === RIPE) { pick(+t.getAttribute('data-tuna')); return; }
      water();
    });
    shell.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); water(); }
    });
    shell.setAttribute('tabindex', '0');
    shell.setAttribute('role', 'button');

    // Every page walked into is a fresh chance to water -- the site swaps
    // <main> rather than reloading, so nothing else would ever reset this.
    cactusVisit = function () {
      if (plant.day !== today()) {
        plant.day = today(); plant.today = 0; plant.picked = [0, 0, 0, 0, 0];
        set('cactus', plant);
      }
      paint();
      rest();
    };

    paint();
    rest();
  }

  /* =============================================================== STILL
     A pot still that is always running, whether anybody is watching or
     not. It measures its run against the wall clock rather than against
     time spent on the page, so it carries on while the tab is shut and is
     waiting, finished, when the visitor comes back. What it fills is the
     jar in the corner of the drawing; when the jar is full, the bar opens.
     ------------------------------------------------------------------- */

  var STILL_RUN_MS = 10 * 60 * 1000;
  var PUMP_MS = 45 * 1000;    // what one squeeze of the bellows is worth

  // Open, and squeezed. Bottom-aligned with the still, so the base stays
  // put and only the top of it collapses.
  var BELLOWS = [
    ['  __   ', ' /  \\  ', '|    |-', ' \\__/  '],
    ['       ', '  __   ', ' |__|=~', ' \\__/  ']
  ];

  var STILL = [
    '   _____     ',
    '  /     \\___ ',
    ' | a n m |  \\',
    ' |  ~~~  |  |',
    '  \\_____/   |',
    '   |||    _|_',
    '  =====   |_|'
  ];

  // What the still pours, and the empty glass it leaves once it is drunk.
  var DRINK      = ['\\~~~/', ' \\~/ ', '  |  ', ' _|_ '];
  var DRINK_GONE = ['\\   /', ' \\ / ', '  |  ', ' _|_ '];

  var BOIL  = ['~~~', '-~-', '~-~', '-~~'];
  var FLAME = ['|||', ')|(', '(|)', '|)|'];
  var JAR   = [' ', '.', ':', '='];

  function mountStill() {
    var host = document.getElementById('still');
    var shell = document.getElementById('still-shell');
    var fill = document.getElementById('still-fill');
    var say = document.getElementById('still-say');
    if (!host || !shell) return;

    var run = get('still', null);
    if (!run || typeof run.start !== 'number') run = { start: Date.now() };
    set('still', run);

    var bellows = document.getElementById('bellows');
    var drink = document.getElementById('drink');
    var frame = 0;
    var squeezed = 0;

    function progress() {
      return Math.max(0, Math.min(1, (Date.now() - run.start) / STILL_RUN_MS));
    }

    function paint() {
      var p = progress();
      var done = p >= 1;
      var rows = STILL.slice();

      if (!done) {
        rows[3] = rows[3].replace('~~~', BOIL[frame % BOIL.length]);
        rows[5] = rows[5].replace('|||', FLAME[frame % FLAME.length]);
        // a drop making its way down the condenser, on the right-hand pipe
        var at = frame % 3;
        rows[2 + at] = rows[2 + at].substring(0, 12) + 'o';
      }

      // the jar fills as the run goes on -- this IS the progress bar, the
      // one below it is only there to be readable
      var level = done ? 3 : Math.floor(p * 3);
      rows[6] = rows[6].substring(0, 10) + '|' + JAR[level] + '|';

      var html = '', r, c, ch, cls;
      for (r = 0; r < rows.length; r++) {
        for (c = 0; c < rows[r].length; c++) {
          ch = rows[r].charAt(c);
          if (ch === ' ') { html += ' '; continue; }
          if (ch === '~' || ch === '-') cls = 'li';
          else if (ch === ')' || ch === '(' || (r === 5 && c < 7 && ch === '|')) cls = 'fi';
          else if (ch === 'o') cls = 'dr';
          else if (r === 6 && c > 9) cls = done ? 'fr' : 'li';
          else cls = 'me';
          html += '<span class="' + cls + '">' + ch + '</span>';
        }
        html += r === rows.length - 1 ? '' : '\n';
      }
      host.innerHTML = html;

      paintBellows(done);
      paintDrink(done);
      if (fill) fill.style.width = Math.round(p * 100) + '%';
      shell.classList.toggle('done', done);
      if (say) say.textContent = done ? 'ready' : 'distilling';
      host.setAttribute('aria-label', done ? 'a pot still, finished' : 'a pot still, running');
      shell.setAttribute('title', done
        ? 'the run is finished'
        : 'running — ' + Math.round(p * 100) + '% through');

      return done;
    }

    /* A finished run pours a drink. The drink is the door -- it is not
       poured and drunk in the same motion, because the whole point of
       having waited is getting to pick the glass up yourself. */
    function paintDrink(done) {
      if (!drink) return;
      drink.hidden = !done;
      if (!done) return;
      if (drink.innerHTML) return;               // already poured

      var rows = secretOpen('bar') ? DRINK_GONE : DRINK;
      var html = '', r, c, ch;
      for (r = 0; r < rows.length; r++) {
        for (c = 0; c < rows[r].length; c++) {
          ch = rows[r].charAt(c);
          if (ch === ' ') { html += ' '; continue; }
          html += '<span class="' + (ch === '~' ? 'fr' : 'me') + '">' + ch + '</span>';
        }
        html += r === rows.length - 1 ? '' : '\n';
      }
      drink.innerHTML = html;
      drink.setAttribute('title', secretOpen('bar')
        ? 'the bar is open'
        : 'a finished drink. pick it up.');
      drink.classList.toggle('ready', !secretOpen('bar'));
    }

    function takeDrink() {
      if (progress() < 1 || secretOpen('bar')) return;
      openSecret('bar', true);
      drink.innerHTML = '';
      paintDrink(true);
      if (say) say.textContent = 'cheers';
    }

    function paintBellows(done) {
      if (!bellows) return;
      bellows.hidden = done;
      if (done) return;
      var rows = BELLOWS[squeezed ? 1 : 0];
      var html = '', r, c, ch;
      for (r = 0; r < rows.length; r++) {
        for (c = 0; c < rows[r].length; c++) {
          ch = rows[r].charAt(c);
          if (ch === ' ') { html += ' '; continue; }
          html += '<span class="' + (ch === '~' || ch === '=' ? 'fi' : 'me') + '">' + ch + '</span>';
        }
        html += r === rows.length - 1 ? '' : '\n';
      }
      bellows.innerHTML = html;
    }

    /* The bellows. A run takes ten minutes on its own; squeezing this takes
       three quarters of a minute off it each time, which turns the waiting
       into something you can do something about. It cannot push a run past
       finished, and it cannot start one that has not begun. */
    function pump() {
      if (progress() >= 1) return;
      run.start -= PUMP_MS;
      if (Date.now() - run.start > STILL_RUN_MS) run.start = Date.now() - STILL_RUN_MS;
      set('still', run);

      squeezed = 1;
      frame += 2;                       // the flame jumps
      paint();
      play('rustle');
      if (say) say.textContent = 'whoosh';
      setTimeout(function () {
        squeezed = 0;
        paintBellows(progress() >= 1);
        if (say && progress() < 1) say.textContent = 'distilling';
      }, 220);
    }

    if (drink) {
      drink.setAttribute('role', 'button');
      drink.setAttribute('tabindex', '0');
      drink.addEventListener('click', function (e) { e.stopPropagation(); takeDrink(); });
      drink.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); takeDrink(); }
      });
    }

    if (bellows) {
      bellows.setAttribute('title', 'squeeze the bellows — it speeds the run up');
      bellows.setAttribute('role', 'button');
      bellows.setAttribute('tabindex', '0');
      bellows.addEventListener('click', function (e) { e.stopPropagation(); pump(); });
      bellows.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pump(); }
      });
    }

    paint();
    // Only while it is worth animating: a finished still has nothing left
    // to show, and a hidden tab should not be burning a timer.
    var timer = setInterval(function () {
      if (document.hidden) return;
      frame++;
      if (paint()) clearInterval(timer);
    }, 520);
  }

  /* ========================================================== MOONLIGHT
     The other scene. Silver on near-black, a field of stars, and the moon
     itself -- drawn at whatever phase it is actually at tonight, worked
     out from the date rather than picked. Standing on the ground under it
     is a model rocket, and the rocket is the way up: it is fuelled a click
     at a time and then it goes, through the top of the page, and what is
     above is the moon.
     ------------------------------------------------------------------- */

  var MOON_CH = 'anmoli.oO0@';

  /**
   * How far through the cycle the moon is tonight: 0 is new, 0.5 is full.
   *
   * Counted in synodic months from a new moon nobody disputes -- the one on
   * the 6th of January 2000. Good to a couple of hours, which is a great
   * deal better than a drawing that is simply always full.
   */
  function moonPhase(when) {
    var SYNODIC = 29.530588853;
    var KNOWN = Date.UTC(2000, 0, 6, 18, 14);
    var days = ((when || new Date()).getTime() - KNOWN) / 86400000;
    var age = days % SYNODIC;
    if (age < 0) age += SYNODIC;
    return age / SYNODIC;
  }

  function phaseName(p) {
    if (p < 0.03 || p > 0.97) return 'new moon';
    if (p < 0.22) return 'waxing crescent';
    if (p < 0.28) return 'first quarter';
    if (p < 0.47) return 'waxing gibbous';
    if (p < 0.53) return 'full moon';
    if (p < 0.72) return 'waning gibbous';
    if (p < 0.78) return 'last quarter';
    return 'waning crescent';
  }

  /**
   * The disc, lit according to the phase.
   *
   * The terminator is an ellipse across the face: at a quarter it is a
   * straight edge down the middle, and it bows out to the rim as the moon
   * fills. cos(2*pi*phase) IS that ellipse's width, signed -- which is the
   * whole trick, and why this is four lines rather than forty.
   */
  function moonDisc(phase, R) {
    var k = Math.cos(2 * Math.PI * phase);
    var waxing = phase < 0.5;
    var rows = [], r, c, dy, span, nx, lit, ch, row;

    for (r = -R; r <= R; r++) {
      row = [];
      dy = r / R;
      span = Math.sqrt(Math.max(0, 1 - dy * dy));
      for (c = -Math.round(R * 2); c <= Math.round(R * 2); c++) {
        // twice as wide as tall: a character cell is about half as wide
        nx = (c / 2) / R;
        if (Math.abs(nx) > span || span < 0.02) { row.push(null); continue; }
        lit = waxing ? (nx > k * span) : (nx < -k * span);
        ch = MOON_CH.charAt(Math.floor(noise(r + R, c + R * 2, 41) * MOON_CH.length));
        row.push({ ch: ch, lit: lit });
      }
      rows.push(row);
    }
    return rows;
  }

  function mountMoonlight() {
    sceneOn = 'moonlight';

    var scene = document.createElement('div');
    scene.id = 'scene';
    scene.className = 'night';
    scene.setAttribute('aria-hidden', 'true');
    scene.innerHTML =
      '<pre id="nightsky"></pre>' +
      '<pre id="moondisc"></pre>' +
      '<p id="moonsays"></p>' +
      '<div id="regolith"></div>';
    document.body.appendChild(scene);

    var sky = document.getElementById('nightsky');
    var disc = document.getElementById('moondisc');
    var says = document.getElementById('moonsays');

    function paintSky() {
      sky.textContent = starField(Math.ceil(window.innerWidth / 6.7),
                                  Math.ceil(window.innerHeight / 11), 17);
    }

    function paintMoon() {
      var p = moonPhase();
      var R = window.innerWidth < 560 ? 7 : 11;
      var rows = moonDisc(p, R);
      var html = '', r, c, cell, run = '', runCls = null;

      function flush() {
        if (!run) return;
        html += runCls ? '<span class="' + runCls + '">' + run + '</span>' : run;
        run = '';
      }
      for (r = 0; r < rows.length; r++) {
        for (c = 0; c < rows[r].length; c++) {
          cell = rows[r][c];
          var cls = !cell ? null : cell.lit ? 'lt' : 'dk';
          if (cls !== runCls) { flush(); runCls = cls; }
          run += cell ? cell.ch : ' ';
        }
        flush(); runCls = null;
        if (r !== rows.length - 1) html += '\n';
      }
      disc.innerHTML = html;
      disc.setAttribute('aria-label', phaseName(p));
      says.textContent = phaseName(p) + '  ·  ' + Math.round(
        (1 - Math.cos(2 * Math.PI * p)) / 2 * 100) + '% lit';
    }

    // the rocket, standing on the ground under all that
    mountRocket();

    paintSky();
    paintMoon();
    window.addEventListener('resize', paintSky);
    window.addEventListener('resize', paintMoon);
    sceneTimers.push(setInterval(function () {
      if (!document.hidden) paintMoon();          // the phase does move
    }, 600000));
  }

  /* ================================================================ POGO
     A man on a pogo stick who goes where you point. He is drawn in the
     same characters as everything else, he is never clickable (the page
     underneath has to keep working), and he lands on things: the top edge
     of every folder, photograph and note on the page is a ledge he can
     bounce up onto. Stop moving and he runs down and falls asleep.

     Everything here is in PAGE coordinates -- the arrangement is drawn
     inside a scaled box, and taking the ledges from what is actually on
     screen means none of that scaling has to be thought about twice.
     ------------------------------------------------------------------- */

  var POGO_UP = [' \\o/ ', '  |  ', ' [T] ', '  |  ', '  v  '];
  var POGO_DOWN = ['     ', '  o  ', ' /|\\ ', ' [T] ', '  v  '];
  var POGO_SLEEP = ['  z  ', ' z   ', '  o  ', ' /|\\ ', ' [=] '];
  // Stood still, pouring something out of a can.
  var POGO_WATER = ['     ', '  o  ', ' /|\\_', ' [T]:', '  v  '];
  /* In water there is nothing to push off, so the stick stops being a
     spring and becomes something to paddle with. Two frames, alternated
     slowly, which is all a breaststroke needs to read as one. */
  var POGO_SWIM = [
    ['     ', ' \\o/ ', '  |  ', ' /T\\ ', '  ~  '],
    ['     ', ' -o- ', '  |  ', ' <T> ', ' ~~  ']
  ];

  // Set by mountPogo. The garden scene asks him to go and water the tree,
  // and tells him where he is standing -- the moon pulls a sixth as hard.
  var pogoErrand = function () {};
  var pogoGravity = function () {};
  var pogoSwim = function () {};

  var GRAVITY = 2100;        // px per second per second
  var POGO_H = 56;           // how tall he is, near enough

  /* He is five characters tall, and the ceiling on his hop is six of those.
     Before this he could stack one bounce on the next off a ledge and leave
     the top of the page altogether, which reads less as a companion and
     more as something going wrong.

     Between a tick-over and that ceiling he is governed by ENERGY, which is
     the whole character of him: it winds up while there is somewhere to be
     and winds down when nothing has moved. So he builds to full height over
     a few seconds rather than springing to it, and settles lower and lower
     into sleep rather than stopping mid-air. */
  var HOP_MIN = Math.sqrt(2 * GRAVITY * 12);           // a tick over on the spot
  var HOP_MAX = Math.sqrt(2 * GRAVITY * POGO_H * 3);   // the ceiling: three of him
  var ENERGY_UP = 0.28;      // per second, winding up
  var ENERGY_DOWN = 0.24;    // per second, winding down
  var RUN = 300;             // top speed along the ground
  var IDLE_AFTER = 1600;     // pointer still this long and he starts to settle

  function mountPogo() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // A phone has no cursor to follow, a screen he would fill a quarter of,
    // and a battery. He is a desk companion.
    if (!wide()) return;

    var man = document.createElement('div');
    man.id = 'pogo';
    man.setAttribute('aria-hidden', 'true');
    var art = document.createElement('pre');
    man.appendChild(art);
    document.body.appendChild(man);

    var W = 34, H = 56;                       // roughly what the sprite fills
    var x = 80, y = 0, vx = 0, vy = 0;        // y is his feet
    var targetX = 200, targetY = 0;
    var lastPointed = 0;
    var asleep = false;
    var energy = 0.25;
    var lastLand = null;       // how high the last landing was
    var errand = null;         // somewhere he has been asked to go
    var grav = 1;              // 1 on earth, a sixth of that on the moon
    var ledges = [];
    var last = 0;
    var drawn = '';

    function floor() {
      var bar = document.querySelector('.taskbar');
      var barTop = bar ? bar.getBoundingClientRect().top + window.pageYOffset : 0;
      return barTop || (window.pageYOffset + window.innerHeight);
    }

    /* Every visible item is a one-way ledge: he passes up through it and
       lands on its top. Read fresh rather than cached, because the whole
       point of this site is that the visitor moves things around. */
    function readLedges() {
      var out = [];
      var nodes = document.querySelectorAll('.plantbed > .item, .win, .viewer');
      var i, r, n;
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        if (!n.offsetParent) continue;
        r = n.getBoundingClientRect();
        if (r.width < 24 || r.height < 12) continue;
        out.push({ x1: r.left + window.pageXOffset, x2: r.right + window.pageXOffset,
                   top: r.top + window.pageYOffset });
      }
      ledges = out;
    }

    function standingOn(px, py, prevY) {
      // The floor is the taskbar, which is pinned to the window -- so where
      // the ground is depends on where the page is scrolled to. Only the
      // ledges between the top of the screen and that line are his: a
      // folder further down the page than the visitor has scrolled would
      // otherwise catch him below the taskbar and he would be gone.
      var f = floor();
      var ceiling = window.pageYOffset;
      var best = null, i, l;

      for (i = 0; i < ledges.length; i++) {
        l = ledges[i];
        if (l.top >= f - 6 || l.top < ceiling + 6) continue;
        if (px < l.x1 - 10 || px > l.x2 + 10) continue;
        if (prevY > l.top + 2) continue;         // came from below: pass through
        if (py < l.top) continue;                // not down to it yet
        if (!best || l.top < best.top) best = l; // the first one he meets
      }
      // And the ground itself always catches him, however fast he arrives.
      if (py >= f && (!best || f < best.top)) best = { top: f, ground: true };
      return best;
    }

    function sprite(name) {
      if (drawn === name) return;
      drawn = name;
      var rows = name === 'sleep' ? POGO_SLEEP : name === 'water' ? POGO_WATER
               : name === 'down' ? POGO_DOWN : POGO_UP;
      art.textContent = rows.join('\n');
      man.classList.toggle('asleep', name === 'sleep');
    }

    function step(dt) {
      /* An errand overrides the cursor: somebody has asked him to go and
         stand somewhere and do something. He walks over, stops bouncing,
         does it, and then goes back to following the pointer. */
      if (errand && errand.until && performance.now() > errand.until) {
        errand = null;
        lastPointed = performance.now();
        energy = 0.2;
      }

      var wantX = errand ? errand.x : targetX;
      var reach = wantX - x;

      if (errand) {
        // no wind-down while he is working
        lastPointed = performance.now();
        asleep = false;
      }

      if (asleep) {
        vx = 0;
        sprite('sleep');
      } else {
        // He leans towards where you are pointing, and can only lean so
        // far. Slowing down as he arrives is what lets him actually land on
        // a folder: a folder is seventy pixels wide, and a man who is still
        // doing three hundred pixels a second when he gets there sails
        // straight over the top of it.
        var near = Math.min(1, Math.abs(reach) / 140 + 0.2);
        var want = Math.abs(reach) < 5 ? 0 :
                   Math.max(-RUN * near, Math.min(RUN * near, reach * 3.2));
        vx += (want - vx) * Math.min(1, dt * 14);
      }

      /* Somewhere to be means wind up; nothing moving means wind down. */
      var idle = performance.now() - lastPointed > IDLE_AFTER;
      /* Measured from the ground he took off from, not from wherever he
         happens to be in the arc. Read off his live height, this said "yes,
         climb" near the floor and "no, settle" at the top of every single
         hop, and the two cancelled each other out at about a third of his
         full height -- which is why he could never quite get up onto a
         ledge he was plainly aiming at. */
      var base = lastLand === null ? y : lastLand;
      var wantsHeight = (base - targetY) > POGO_H * 0.5 || Math.abs(reach) > 160;
      var goal = idle ? 0 : (wantsHeight ? 1 : 0.2);
      var rate = goal > energy ? ENERGY_UP : ENERGY_DOWN;
      energy += Math.max(-rate * dt, Math.min(rate * dt, goal - energy));
      energy = Math.max(0, Math.min(1, energy));

      var prevY = y;
      vy += GRAVITY * grav * dt;
      x += vx * dt;
      y += vy * dt;

      // Never off the top of the screen either: a companion who has gone
      // somewhere you cannot see him is not company.
      var ceil = window.pageYOffset + 46;
      if (y < ceil) { y = ceil; if (vy < 0) vy = 0; }

      // Never off the side of the paper.
      var minX = window.pageXOffset + W / 2;
      var maxX = window.pageXOffset + window.innerWidth - W / 2;
      if (x < minX) { x = minX; vx = Math.abs(vx) * 0.4; }
      if (x > maxX) { x = maxX; vx = -Math.abs(vx) * 0.4; }

      if (vy > 0) {
        var l = standingOn(x, y, prevY);
        if (l) {
          y = l.top;
          /* A pogo stick does not get something for nothing. Landing higher
             than he took off from means the spring gave up its height to
             the climb, so the next few bounces are short and he has to work
             back up -- which is why he now steps up a stack of folders
             instead of arriving at the top in one impossible leap. Coming
             down off something is the opposite: he arrives with all that
             height as speed, and the stick gives it straight back. */
          if (lastLand !== null) {
            var rise = lastLand - y;                       // + went up, - came down
            if (rise > 6) energy = Math.max(0.04, energy - Math.min(0.75, rise / (POGO_H * 2.2)));
            else if (rise < -POGO_H * 0.75) energy = Math.min(1, energy + Math.min(0.6, -rise / (POGO_H * 3)));
          }
          lastLand = y;

          if (errand && Math.abs(x - errand.x) < 26) {
            // Arrived at the thing he was asked to go and do. He stands.
            if (!errand.until) errand.until = performance.now() + errand.ms;
            vy = 0;
            vx = 0;
          }
          else if (asleep) { vy = 0; }
          else if (energy < 0.05 && Math.abs(reach) < 48) {
            // Nothing left in him and nowhere to be: this is where he stops,
            // on the ground, mid-stride -- not frozen in the air.
            vy = 0;
            asleep = true;
          } else {
            vy = -(HOP_MIN + energy * (HOP_MAX - HOP_MIN));
          }
        }
      }

      // Fallen off the bottom of everything: put him back on the floor.
      if (y > floor() + 400) { y = floor(); vy = 0; x = targetX; }

      if (errand && errand.until) sprite('water');
      else if (asleep) sprite('sleep');
      else sprite(vy < -40 ? 'up' : 'down');

      man.style.transform = 'translate3d(' + Math.round(x - W / 2) + 'px,' +
                            Math.round(y - H) + 'px,0)';
    }

    function frame(now) {
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      if (!document.hidden && !man.hidden) step(dt);
      requestAnimationFrame(frame);
    }

    function pointAt(clientX, clientY) {
      targetX = clientX + window.pageXOffset;
      targetY = clientY + window.pageYOffset;
      lastPointed = performance.now();
      // Waking is a small hop. Getting back up to full height is the same
      // wind-up as any other and takes a few seconds.
      if (asleep) { asleep = false; energy = 0; vy = -HOP_MIN * 1.5; }
    }

    document.addEventListener('mousemove', function (e) { pointAt(e.clientX, e.clientY); });
    document.addEventListener('pointerdown', function (e) { pointAt(e.clientX, e.clientY); });

    // The ledges move: items get dragged, the page scrolls, the window
    // changes shape, a folder is walked into.
    readLedges();
    setInterval(readLedges, 400);
    window.addEventListener('resize', readLedges);

    pogoErrand = function (pageX, ms) {
      errand = { x: pageX, until: 0, ms: ms || 1200 };
    };

    /* Same push off the stick, a sixth of the pull back down: he goes about
       six times as high and hangs there on the way. Nothing else changes --
       the ceiling clamp still keeps him on the screen, so the moon reads as
       a slow enormous bound rather than a man vanishing upwards. */
    pogoGravity = function (mult) {
      grav = mult || 1;
    };

    y = floor();
    targetY = y;
    lastLand = y;
    requestAnimationFrame(frame);
  }


  /* ========================================================= GARDEN SCENE
     A folder can be a place instead of a listing. Put the word "garden" in
     a scene.txt and the page it sits in gets ground under it, weather over
     it, a cow, and a seedling.

     The seedling is the Adam Jewel Tree. Two hundred and fifty waterings
     and it goes through the roof -- literally: the ceiling of the page
     cracks and there is another floor above this one, the SUN LEVEL, which
     you can scroll up into and which holds you there until you ask to come
     back down.

     None of this is the folder's contents. The folder's contents are still
     the folder's contents, sitting on the grass.
     ------------------------------------------------------------------- */

  var TREE_CLICKS = 250;
  var TUFTS = 56;
  var TUFT_CHARS = ['.', ',', 'v', 'w', 'W'];
  var GROUND_H = 62;

  /* A model rocket, the kind you build on a kitchen table. It is fuelled a
     click at a time, it counts itself down, and then it goes -- and what it
     does on the way is punch a hole in the sky the same way the tree went
     through the ceiling. There is a floor above the sun. */
  var ROCKET_FUEL = 30;

  var ROCKET = [
    '    /\\     ',
    '   /  \\    ',
    '   | an |  ',
    '   | mo |  ',
    '   | li |  ',
    '   |____|  ',
    '  /|    |\\ ',
    ' / |____| \\'
  ];
  var EXHAUST = [
    ['    \\/     ', '    ||     '],
    ['    ||     ', '   \\||/    '],
    ['   \\||/    ', '   //\\\\    ']
  ];

  // The earth, seen from up there.
  var EARTH = [
    '  .o0O0o.  ',
    ' oO@anmo@O ',
    'O@li26@0o@O',
    ' O@0o@anmo ',
    '  `o0O0o\'  '
  ];

  var SUN_ART = [
    '   \\    |    /   ',
    '    \\ .----. /   ',
    ' -- ( anmo ) --  ',
    '    / \'----\' \\   ',
    '   /    |    \\   '
  ];

  /* THE TREE IS A MASS, NOT A LINE.
     An adam tree is the wood they build ships out of -- it wants to read as
     something enormous and slightly threatening standing in the garden, not
     as a stick with a bobble on top. So it is not drawn: it is grown, cell
     by cell, out of a field of letters. Bark is a dense block of dark
     browns and near-blacks; leaves are a ragged green mass that crawls up
     and out over it. Every cell picks its own letter and its own shade from
     a hash of where it sits, so the texture is random but it is the SAME
     random every time it is redrawn -- otherwise the whole tree would
     shimmer on every watering. */

  var FIELD_W = 49;
  var BARK_CH = 'anmoli268@#%&$';
  var LEAF_CH = 'anmoli&%o0@6';

  function noise(r, c, k) {
    var x = Math.sin((r + 1) * 127.1 + (c + 1) * 311.7 + (k || 0) * 74.7) * 43758.5453;
    return x - Math.floor(x);
  }

  /** Where the site's root is, whatever path it is served from. */
  function siteRoot() {
    var back = document.querySelector('.masthead a[href]');
    try { return new URL(back ? back.getAttribute('href') : '/', location.href); }
    catch (e) { return new URL('/', location.href); }
  }

  /**
   * The storey above is a ROOM, not a poster of a room.
   *
   * It was a panel with a link on it, which is a strange thing to climb a
   * tree for. It holds the SUN LEVEL folder's own contents now -- the
   * same files, the same icons, opening the same way -- fetched once and
   * laid out in a row up here. The ids are dropped on the way in: they
   * are this OTHER page's Finder coordinates, and the stylesheet in force
   * is the garden's, which would scatter them by somebody else's map.
   */
  function fillRoom(bed, folder) {
    if (!bed) return;
    var url;
    try { url = new URL(folder, siteRoot()).href; } catch (e) { return; }

    fetch(url, { credentials: 'same-origin', headers: { accept: 'text/html' } })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (html) {
        if (!html) throw new Error('no room');
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var incoming = doc.querySelector('main');
        if (!incoming) throw new Error('no main');
        absolutise(incoming, url);

        var items = incoming.querySelectorAll('.plantbed > .item');
        bed.innerHTML = '';
        if (!items.length) {
          bed.innerHTML = '<p class="sun-wait">nothing up here yet. ' +
            'put something in the ' + folder.replace(/\/$/, '') + ' folder.</p>';
          return;
        }
        var i, node;
        for (i = 0; i < items.length; i++) {
          node = document.importNode(items[i], true);
          node.removeAttribute('id');
          node.style.position = 'static';
          bed.appendChild(node);
        }
      })
      .catch(function () {
        bed.innerHTML = '<p class="sun-wait">the room is up here, but the ' +
          'site could not read it just now.</p>';
      });
  }

  function starField(cols, rows, seed) {
    var out = '', r, c, n;
    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols; c++) {
        n = noise(r, c, seed);
        out += n > 0.988 ? '*' : n > 0.962 ? '.' : n > 0.955 ? '+' : ' ';
      }
      if (r !== rows - 1) out += '\n';
    }
    return out;
  }

  function openMoon(scrollUp) {
    if (!document.getElementById('moon-level')) {
      var moon = document.createElement('section');
      moon.id = 'moon-level';
      moon.innerHTML =
        '<pre class="moon-stars" aria-hidden="true"></pre>' +
        '<pre class="moon-earth" aria-hidden="true">' + EARTH.join('\n') + '</pre>' +
        '<div class="moon-inner">' +
          '<h2>THE MOON</h2>' +
          '<div class="moon-bed"><p class="sun-wait">unpacking…</p></div>' +
          '<p class="sun-down">&darr; moonlight is below</p>' +
        '</div>' +
        '<pre class="moon-ground" aria-hidden="true"></pre>';
      document.body.insertBefore(moon, document.body.firstChild);

      var added = moon.getBoundingClientRect().height;
      window.scrollBy(0, added);

      moon.querySelector('.moon-stars').textContent =
        starField(Math.ceil(window.innerWidth / 6.7), 26, 21);

      var g = moon.querySelector('.moon-ground');
      var w = Math.ceil(window.innerWidth / 6.7), line = '', c;
      for (c = 0; c < w; c++) {
        line += noise(0, c, 31) > 0.9 ? 'o' : noise(0, c, 32) > 0.82 ? '.' : '_';
      }
      g.textContent = line + '\n' + '    \\  ' + new Array(w - 8).join(' ');
      fillRoom(moon.querySelector('.moon-bed'), 'MOON/');
    }

    document.documentElement.classList.add('moon-open');
    document.body.classList.add('moon-open');
    openSecret('moon', false);
    watchFloor();

    if (!scrollUp) return;
    setTimeout(function () { window.scrollTo({ top: 0, behavior: 'smooth' }); }, 300);
  }

  function mountRocket() {
    /* NOT inside the scene. The scene is scenery: it is painted behind the
       page and it takes no pointer events at all, so a button parked in it
       is a button nobody can press. The pad goes on the body, above the
       files, like the tree's watering button does. */
    var pad = document.createElement('div');
    pad.id = 'pad';
    pad.innerHTML = '<pre id="rocket" role="img" aria-label="a model rocket"></pre>' +
      '<button id="rocket-hit" type="button"><span id="rocket-fuel"></span></button>';
    document.body.appendChild(pad);
    sceneNodes.push(pad);

    var art = pad.querySelector('#rocket');
    var hit = pad.querySelector('#rocket-hit');
    var gauge = pad.querySelector('#rocket-fuel');

    var ship = get('rocket', null);
    if (!ship || typeof ship.fuel !== 'number') ship = { fuel: 0, flown: false };

    var frame = 0, flying = false, burning = false;

    function draw(showFlame) {
      var rows = ROCKET.slice();
      if (showFlame) rows = rows.concat(EXHAUST[frame % EXHAUST.length]);
      var html = '', r, c, ch, cls, run = '', runCls = null;

      function flush() {
        if (!run) return;
        html += runCls ? '<span class="' + runCls + '">' + run + '</span>' : run;
        run = '';
      }
      for (r = 0; r < rows.length; r++) {
        for (c = 0; c < rows[r].length; c++) {
          ch = rows[r].charAt(c);
          cls = ch === ' ' ? null : (r >= ROCKET.length ? 'fl' : 'me');
          if (cls !== runCls) { flush(); runCls = cls; }
          run += ch;
        }
        flush(); runCls = null;
        if (r !== rows.length - 1) html += '\n';
      }
      art.innerHTML = html;
    }

    function paint() {
      draw(burning);
      var left = ROCKET_FUEL - ship.fuel;
      if (ship.flown) {
        gauge.textContent = 'flown';
        hit.setAttribute('title', 'it has been. the moon is above you.');
      } else if (left > 0) {
        var bars = Math.round(ship.fuel / ROCKET_FUEL * 10);
        gauge.textContent = '[' + new Array(bars + 1).join('=') +
                            new Array(10 - bars + 1).join('.') + ']';
        hit.setAttribute('title', 'fuel the rocket — ' + left + ' to go');
      } else {
        gauge.textContent = 'LAUNCH';
        hit.setAttribute('title', 'press to launch');
      }
      hit.setAttribute('aria-label', ship.flown ? 'the rocket has flown'
        : left > 0 ? 'fuel the rocket, ' + ship.fuel + ' of ' + ROCKET_FUEL
        : 'launch the rocket');
      pad.classList.toggle('fuelled', left <= 0 && !ship.flown);
    }

    function press() {
      if (flying) return;
      if (ship.flown) { openMoon(true); return; }

      if (ship.fuel < ROCKET_FUEL) {
        ship.fuel++;
        set('rocket', ship);
        play('tick');
        pad.classList.add('pumping');
        setTimeout(function () { pad.classList.remove('pumping'); }, 180);
        paint();
        return;
      }
      launch();
    }

    function launch() {
      flying = true;
      burning = true;
      var n = 5;

      var count = setInterval(function () {
        gauge.textContent = n > 0 ? String(n) : 'GO';
        play('tick');
        frame++;
        draw(true);
        if (n-- > 0) return;
        clearInterval(count);
        go();
      }, 620);

      function go() {
        play('rustle');
        pad.classList.add('flying');
        var rise = 0;
        var fly = setInterval(function () {
          frame++;
          rise += 26;
          pad.style.transform = 'translateY(' + (-rise) + 'px)';
          draw(true);
          if (rise < window.innerHeight + 220) return;
          clearInterval(fly);

          ship.flown = true;
          set('rocket', ship);
          burning = false;
          pad.classList.remove('flying');
          pad.style.transform = '';
          paint();
          toast('the moon');
          openMoon(true);
        }, 40);
      }
    }

    hit.addEventListener('click', press);
    paint();
    if (ship.flown) openMoon(false);
  }

  /* Which storey the visitor is standing on. A scene's ground, weather and
     scenery are fixed to the window, so without this they ride upstairs
     with you -- and the whole point of having broken through is that up
     here is somewhere else. */
  var floorWatch = null;

  /** The room tone of the storey the scene itself is on. */
  var sceneTone = null;

  function watchFloor() {
    if (floorWatch) return;
    floorWatch = sceneScroll = function () {
      var up = document.getElementById('moon-level') || document.getElementById('sun-level');
      var down = document.getElementById('crypt-level');
      var upstairs = false, downstairs = false, r;

      if (up) {
        var h = up.getBoundingClientRect().height || window.innerHeight;
        upstairs = window.pageYOffset < h * 0.5;
      }
      if (down && !upstairs) {
        r = down.getBoundingClientRect();
        downstairs = r.top < window.innerHeight * 0.5;
      }
      if (!up && !down) return;

      document.body.classList.toggle('upstairs', upstairs);
      document.body.classList.toggle('downstairs', downstairs);
      document.body.classList.toggle('on-sun', upstairs && up.id === 'sun-level');
      document.body.classList.toggle('on-moon', upstairs && up.id === 'moon-level');
      document.body.classList.toggle('on-crypt', downstairs);
      // A sixth of a gee. He goes about six times as high and hangs there.
      pogoGravity(upstairs && up.id === 'moon-level' ? 0.17 : 1);

      ambience(upstairs ? (up.id === 'moon-level' ? 'moon' : 'nursery')
             : downstairs ? 'crypt' : sceneTone);
    };
    window.addEventListener('scroll', floorWatch, { passive: true });
    window.addEventListener('resize', floorWatch);
    floorWatch();
  }


  var sceneOn = '';
  var sceneTimers = [];
  var sceneNodes = [];
  var sceneScroll = null;

  function unmountScene() {
    if (!sceneOn) return;
    sceneOn = '';
    sceneTimers.forEach(clearInterval);
    sceneTimers = [];
    sceneNodes.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    sceneNodes = [];
    if (sceneScroll) {
      window.removeEventListener('scroll', sceneScroll);
      window.removeEventListener('resize', sceneScroll);
      sceneScroll = null;
    }
    document.body.classList.remove('on-sun');
    document.body.classList.remove('on-moon');
    document.body.classList.remove('on-crypt');
    document.body.classList.remove('upstairs');
    document.body.classList.remove('downstairs');
    document.documentElement.classList.remove('moon-open');
    document.body.classList.remove('moon-open');
    document.documentElement.classList.remove('crypt-open');
    document.body.classList.remove('crypt-open', 'floor-broken');
    floorWatch = null;
    sceneTone = null;
    ambience(null);
    pogoSwim(false);
    pogoGravity(1);
    ['scene', 'adam', 'adam-hit', 'pad', 'spade', 'sun-level', 'moon-level',
     'crypt-level'].forEach(function (id) {
      var n = document.getElementById(id);
      if (n && n.parentNode) n.parentNode.removeChild(n);
    });
    document.documentElement.classList.remove('sun-open');
    document.body.classList.remove('sun-open', 'roof-broken');
  }

  function syncScene() {
    var want = document.body.getAttribute('data-scene') || '';
    if (want === sceneOn) return;
    if (sceneOn) unmountScene();
    if (want === 'garden') mountGarden();
    else if (want === 'moonlight') mountMoonlight();
    else if (want === 'ocean') mountOcean();
    else if (want === 'crypt') mountCrypt();
    else if (want === 'nursery') mountNurseryScene();
    else if (want === 'bar') mountBar();
  }

  function mountGarden() {
    sceneOn = 'garden';

    var tree = get('adam', null);
    if (!tree || typeof tree.clicks !== 'number') tree = { clicks: 0 };

    /* ------------------------------------------------------------ build */

    var scene = document.createElement('div');
    scene.id = 'scene';
    scene.setAttribute('aria-hidden', 'true');
    scene.innerHTML =
      '<pre id="roof"></pre>' +
      '<div id="ground"><div id="grass"></div><pre id="cow"></pre></div>';
    document.body.appendChild(scene);

    /* The tree and the thing you press are two elements, not one.
       A grown beanstalk is a column the whole height of the window, and a
       column that swallows clicks would put a dead stripe down the middle
       of the folder. So the drawing takes no pointer events at all and the
       watering is a button at the foot of it, which is where anybody would
       reach for a watering can anyway. */
    var adam = document.createElement('div');
    adam.id = 'adam';
    adam.setAttribute('aria-hidden', 'true');
    adam.innerHTML = '<pre id="adam-art"></pre>';
    document.body.appendChild(adam);

    var hit = document.createElement('button');
    hit.id = 'adam-hit';
    hit.type = 'button';
    hit.innerHTML = '<span id="adam-count"></span>';
    document.body.appendChild(hit);
    sceneNodes.push(hit);

    var art = document.getElementById('adam-art');
    var count = document.getElementById('adam-count');
    var grass = document.getElementById('grass');
    var cow = document.getElementById('cow');
    var roof = document.getElementById('roof');

    /* ------------------------------------------------------------ grass
       Tufts on a line, each one growing on its own. The cow eats them and
       they come back, which is the whole of the arrangement. */

    var tufts = [];
    var i;
    for (i = 0; i < TUFTS; i++) {
      var t = document.createElement('i');
      t.style.left = (i / (TUFTS - 1) * 100) + '%';
      t.textContent = TUFT_CHARS[0];
      grass.appendChild(t);
      tufts.push({ el: t, h: Math.floor(Math.random() * 3) });
    }

    function paintTuft(t) { t.el.textContent = TUFT_CHARS[t.h]; }
    tufts.forEach(paintTuft);

    sceneTimers.push(setInterval(function () {
      if (document.hidden) return;
      // A few blades at a time, so it is never obviously a timer.
      for (var n = 0; n < 3; n++) {
        var t = tufts[Math.floor(Math.random() * tufts.length)];
        if (t.h < TUFT_CHARS.length - 1) { t.h++; paintTuft(t); }
      }
    }, 2600));

    /* -------------------------------------------------------------- cow
       Walks, stops, puts her head down, eats whatever is in front of her,
       and wanders off again. She is never in a hurry and she never leaves. */

    /* She is drawn once, facing right, and mirrored for the other way --
       hand-drawing both directions is how you end up with a cow whose legs
       do not line up. Her legs alternate as she walks, her tail swishes,
       and when she stops her whole head goes down into the grass. */

    var COW_WALK = [
      [
        '                ^__^  ',
        ' |\\____________/(oo)  ',
        ' |/  @@   @   @ \\__/  ',
        ' |     @  @@@  @   |  ',
        '  \\__||______||___/   ',
        '     ||      ||       '
      ],
      [
        '                ^__^  ',
        ' /|____________/(oo)  ',
        '|/   @@   @   @ \\__/  ',
        ' |     @  @@@  @   |  ',
        '  \\__||______||___/   ',
        '     |\\      /|       '
      ]
    ];

    var COW_EAT = [
      '                      ',
      ' |\\____________       ',
      ' |/  @@   @   @\\      ',
      ' |     @  @@@  @\\^__^ ',
      '  \\__||______||_(oo)  ',
      '     ||      || (__)  '
    ];

    var COW_FLIP = { '/': '\\', '\\': '/', '(': ')', ')': '(' };

    function mirror(rows) {
      var out = [], r, i, line, ch;
      for (r = 0; r < rows.length; r++) {
        line = '';
        for (i = rows[r].length - 1; i >= 0; i--) {
          ch = rows[r].charAt(i);
          line += COW_FLIP[ch] || ch;
        }
        out.push(line);
      }
      return out;
    }

    var COW = {
      right: COW_WALK,
      rightEat: [COW_EAT],
      left: [mirror(COW_WALK[0]), mirror(COW_WALK[1])],
      leftEat: [mirror(COW_EAT)]
    };

    // Starting clear of the corner the music player docks into.
    var cowX = 470, cowDir = 1, cowEating = 0, cowRest = 0, cowStep = 0;

    function paintCow() {
      var key = (cowDir > 0 ? 'right' : 'left') + (cowEating > 0 ? 'Eat' : '');
      var frames = COW[key];
      cow.textContent = frames[cowStep % frames.length].join('\n');
      cow.style.transform = 'translateX(' + Math.round(cowX) + 'px)';
    }

    sceneTimers.push(setInterval(function () {
      if (document.hidden) return;
      var w = scene.clientWidth - 90;

      if (cowEating > 0) {
        cowEating--;
        if (cowEating === 6) {
          // Whatever is under her nose is gone.
          var near = null, best = 1e9, r;
          for (var k = 0; k < tufts.length; k++) {
            r = Math.abs(tufts[k].el.offsetLeft - (cowX + 40));
            if (r < best) { best = r; near = tufts[k]; }
          }
          if (near && near.h > 0) { near.h = 0; paintTuft(near); }
        }
        paintCow();
        return;
      }

      if (cowRest > 0) { cowRest--; if (!cowRest) cowEating = 24; paintCow(); return; }

      cowX += cowDir * 2.2;
      cowStep++;
      if (cowX < 0) { cowX = 0; cowDir = 1; }
      if (cowX > w) { cowX = w; cowDir = -1; }
      if (Math.random() < 0.012) cowRest = 4;
      if (Math.random() < 0.006) cowDir = -cowDir;
      paintCow();
    }, 120));

    paintCow();

    /* ------------------------------------------------------------- tree */

    function maxRows() {
      var room = window.innerHeight - GROUND_H - taskbarHeight() - 40;
      return Math.max(8, Math.floor(room / 11));
    }

    function trunkRows(clicks) {
      var t = Math.min(1, clicks / TREE_CLICKS);
      // Bent so the first few waterings visibly do something. A straight
      // line would be a third of a character per click, which reads as
      // nothing happening at all.
      return Math.round(Math.pow(t, 0.7) * maxRows());
    }

    /** Paint an ellipse of leaves into the grid, edges roughened. */
    function blob(grid, cy, cx, rx, ry, seed) {
      var r, c, dy, dx, edge;
      for (r = Math.max(0, Math.round(cy - ry)); r <= cy + ry && r < grid.length; r++) {
        dy = (r - cy) / ry;
        if (dy * dy > 1) continue;
        edge = Math.sqrt(1 - dy * dy);
        for (c = 0; c < FIELD_W; c++) {
          dx = Math.abs(c - cx);
          // the ragged margin: a leaf mass has no clean outline
          if (dx > rx * edge + (noise(r, c, seed) - 0.45) * 2.6) continue;
          grid[r][c] = 'L';
        }
      }
    }

    function buildGrid() {
      var t = Math.min(1, tree.clicks / TREE_CLICKS);
      var h = Math.max(1, trunkRows(tree.clicks));
      var halfW = 1 + Math.round(Math.pow(t, 0.7) * 8);       // trunk 3..19 wide
      var canH = 2 + Math.round(Math.pow(t, 0.55) * 9);
      var canR = 2 + Math.round(Math.pow(t, 0.55) * 21);
      var rootH = h > 4 ? 3 : 1;
      var rows = canH + h + rootH;
      var mid = Math.floor(FIELD_W / 2);
      var grid = [], r, c, k;

      for (r = 0; r < rows; r++) {
        grid.push([]);
        for (c = 0; c < FIELD_W; c++) grid[r].push(' ');
      }

      // the crown
      blob(grid, canH - 1, mid, canR, canH * 0.9, 1);

      // the trunk: narrow at the shoulders, heavy at the foot, and never
      // straight -- the edge wanders a character either way
      for (k = 0; k < h; k++) {
        r = canH + k;
        var frac = h === 1 ? 1 : k / (h - 1);
        var hw = 1 + (halfW - 1) * Math.pow(frac, 0.8);
        var lean = Math.round((noise(r, 0, 3) - 0.5) * 2.2);
        for (c = 0; c < FIELD_W; c++) {
          if (Math.abs(c - mid - lean) <= hw + (noise(r, c, 2) - 0.5) * 1.6) grid[r][c] = 'B';
        }
      }

      // limbs, once there is a tree to hang them off
      if (h > 14) {
        [0.30, 0.52, 0.74].forEach(function (at, i) {
          var rr = canH + Math.round(h * at);
          var side = i % 2 ? 1 : -1;
          var reach = Math.round(canR * (0.55 - at * 0.25));
          if (reach < 3) return;
          blob(grid, rr, mid + side * (halfW + reach * 0.7), reach, reach * 0.55, 10 + i);
          // the branch that holds it up
          for (c = 0; c < FIELD_W; c++) {
            if (side > 0 ? (c > mid && c < mid + halfW + reach * 0.7)
                         : (c < mid && c > mid - halfW - reach * 0.7)) {
              if (grid[rr][c] === ' ') grid[rr][c] = 'B';
            }
          }
        });
      }

      // roots, splaying out into the grass
      for (k = 0; k < rootH; k++) {
        r = canH + h + k;
        var rw = halfW + (k + 1) * 2.2;
        for (c = 0; c < FIELD_W; c++) {
          if (Math.abs(c - mid) <= rw && noise(r, c, 5) > k * 0.22) grid[r][c] = 'B';
        }
      }

      return grid;
    }

    function paintTree() {
      var grid = buildGrid();
      var html = '', r, c, cell, cls, ch, run = '', runCls = null;

      function flush() {
        if (!run) return;
        html += runCls ? '<span class="' + runCls + '">' + run + '</span>' : run;
        run = '';
      }

      for (r = 0; r < grid.length; r++) {
        for (c = 0; c < FIELD_W; c++) {
          cell = grid[r][c];
          if (cell === ' ') { cls = null; ch = ' '; }
          else if (cell === 'L') {
            cls = noise(r, c, 7) < 0.42 ? 'lg' : 'lf';
            ch = LEAF_CH.charAt(Math.floor(noise(r, c, 8) * LEAF_CH.length));
          } else {
            cls = noise(r, c, 9) < 0.38 ? 'bd' : 'bk';
            ch = BARK_CH.charAt(Math.floor(noise(r, c, 6) * BARK_CH.length));
          }
          if (cls !== runCls) { flush(); runCls = cls; }
          run += ch;
        }
        flush(); runCls = null;
        if (r !== grid.length - 1) html += '\n';
      }
      art.innerHTML = html;

      var left = TREE_CLICKS - tree.clicks;
      count.textContent = left > 0
        ? tree.clicks + ' / ' + TREE_CLICKS
        : 'the adam jewel tree';
      hit.setAttribute('title', left > 0
        ? 'the adam jewel tree — ' + left + ' more waterings'
        : 'the adam jewel tree, grown');
      hit.setAttribute('aria-label', 'water the adam jewel tree, ' +
        tree.clicks + ' of ' + TREE_CLICKS);
    }

    function water() {
      if (tree.clicks >= TREE_CLICKS) { openSun(true); return; }

      tree.clicks++;
      set('adam', tree);
      paintTree();
      play('rustle');

      adam.classList.add('drinking');
      setTimeout(function () { adam.classList.remove('drinking'); }, 320);

      // He comes over and does the actual watering. It is his garden too.
      var box = hit.getBoundingClientRect();
      pogoErrand(box.left + box.width / 2 + window.pageXOffset, 1100);

      if (tree.clicks >= TREE_CLICKS) setTimeout(function () { breakRoof(); }, 500);
    }

    hit.addEventListener('click', water);

    /* -------------------------------------------------------- the roof */

    function paintRoof() {
      var w = Math.ceil(scene.clientWidth / 6.7);
      var mid = Math.floor(w / 2);
      var line = '', k, d;
      for (k = 0; k < w; k++) {
        d = Math.abs(k - mid);
        if (d > 16) line += '_';
        else if (d > 12) line += '/';
        else if (d > 8) line += '\\';
        else if (d > 4) line += '/';
        else if (d === 0) line += ' ';
        else line += d % 2 ? '\\' : '/';
      }
      roof.textContent = line;
    }

    function breakRoof() {
      document.body.classList.add('roof-broken');
      paintRoof();
      play('rustle');
      toast('the roof gave way');
      setTimeout(function () { openSun(true); }, 1400);
    }

    /* ---------------------------------------------------- the sun level */

    function openSun(scrollUp) {
      if (!document.getElementById('sun-level')) {
        var sun = document.createElement('section');
        sun.id = 'sun-level';
        sun.innerHTML =
          '<div class="sun-inner">' +
            '<pre class="sun-art" aria-hidden="true">' +
              SUN_ART.join('\n') + '</pre>' +
            '<h2>SUN LEVEL</h2>' +
            '<div class="sun-bed"><p class="sun-wait">opening the room…</p></div>' +
            '<p class="sun-down">&darr; the garden is below</p>' +
          '</div>' +
          '<pre class="sun-floor" aria-hidden="true"></pre>';
        document.body.insertBefore(sun, document.body.firstChild);
        fillRoom(sun.querySelector('.sun-bed'), 'SUN LEVEL/');

        // Inserting a whole storey above the page would otherwise yank
        // whatever is being read upwards by exactly that much.
        var added = sun.getBoundingClientRect().height;
        window.scrollBy(0, added);

        var floorPre = sun.querySelector('.sun-floor');
        var w = Math.ceil(window.innerWidth / 6.7), line = '', k, d;
        var mid = Math.floor(w / 2);
        for (k = 0; k < w; k++) {
          d = Math.abs(k - mid);
          line += d < 2 ? ' ' : d < 6 ? '/' : d < 10 ? '\\' : '=';
        }
        floorPre.textContent = line;
      }

      document.documentElement.classList.add('sun-open');
      document.body.classList.add('sun-open');
      openSecret('sun', false);
      watchFloor();

      if (!scrollUp) return;
      setTimeout(function () {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 300);
    }

    /* ============================================================ ROCKET
       A model rocket on a pad in the corner of the sun level. Fuel it a
       click at a time, it counts itself down out loud, and then it goes --
       up through the top of the storey the same way the tree came up
       through the garden's ceiling. What is above the sun is the moon.
       --------------------------------------------------------------- */

    /* ============================================================== MOON
       A third floor. Black sky, a field of stars that is the same field
       every time, the earth hanging in it, grey ground, a flag, and the
       MOON folder's own files standing on it. The man on the pogo stick
       finds the gravity up here very agreeable. */

    /* ------------------------------------------------------------ start */

    paintTree();
    paintRoof();
    window.addEventListener('resize', paintTree);
    window.addEventListener('resize', paintRoof);

    if (tree.clicks >= TREE_CLICKS) {
      document.body.classList.add('roof-broken');
      openSun(false);
    }
  }

  function boot() {
    mountClock();
    mountSecrets();
    mountCactus();
    mountStill();
    mountPogo();
    mountToggles();
    mountHint();
    mountNav();
    mountViewers();
    mountTicker();
    bootPage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
