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
            rows[r].push({ ch: SEAM.charAt(c % SEAM.length), cls: churning ? 's2' : 's' });
            continue;
          }

          var on = false;
          if (glyph && glyphRow >= 0 && glyphRow < 7) {
            var gc = c - PAD_X;
            if (gc >= 0 && gc < 5) on = glyph[glyphRow].charAt(gc) === '1';
          }

          /* A card in the middle of a flip keeps a face -- a WRONG face,
             handed to it by the flip plan -- and thrashes the ground it is
             standing in. It used to lose the figure altogether, which read
             as the card going blank rather than as the flap turning over. */
          if (churning) {
            rows[r].push(on
              ? { ch: pick(FIGURE, seed), cls: 'f' }
              : { ch: pick(GROUND, seed * 3 + 1), cls: 'g' });
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
    var flipTimer = null;
    var lastPainted = '';

    function timeText() {
      var d = new Date();
      var h = d.getHours();
      if (!state.hour24) { h = h % 12; if (h === 0) h = 12; }
      return pad(h) + ':' + pad(d.getMinutes()) + (state.seconds ? ':' + pad(d.getSeconds()) : '');
    }

    function render(text) {
      // Nothing has changed since the last frame: do not rebuild five
      // hundred cells to put back exactly what is already on the screen.
      var sig = text + '|' + Object.keys(churn).join(',') + '|' + tick;
      if (sig === lastPainted) return;
      lastPainted = sig;
      host.innerHTML = paint(field(text, churn, tick));
    }

    /* ------------------------------------------------------- the flip
       A split flap never jumps to the answer. It runs forward through the
       faces on the drum and stops when the right one comes up, and on a
       real clock the cards do not all go at once either: the seconds turn
       first, and the minute, and then the hour, so the change travels
       across the face from the right.

       So each card that has to change is given a little plan -- when it
       starts, and the four wrong faces it shows on the way -- and a card
       that has not started yet goes on showing the OLD number. That is
       what makes the wave: for a fifth of a second the minutes are still
       reading 59 while the seconds have already gone over to 00. */

    var FLIP_FACES = 4;      // wrong faces before the right one
    var FLIP_MS = 48;        // how long each face is up
    var WAVE_MS = 56;        // how much later each card to the LEFT starts
    var STEP_MS = 24;        // how often the whole face is looked at

    var DIGITS = '0123456789';
    var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    function flipFaces(to) {
      var seq = DIGITS.indexOf(to) >= 0 ? DIGITS
              : LETTERS.indexOf(to) >= 0 ? LETTERS : null;
      if (!seq) return [to];
      var end = seq.indexOf(to);
      var out = [], k;
      // Forward only, and landing on the right one: the last few faces of
      // the drum before the answer.
      for (k = FLIP_FACES; k >= 1; k--) {
        out.push(seq.charAt((end - k + seq.length * 2) % seq.length));
      }
      out.push(to);
      return out;
    }

    function runFlip(from, to, changed) {
      clearInterval(flipTimer);

      var last = to.length - 1;
      var plan = [];
      changed.forEach(function (i) {
        plan.push({ at: i, start: (last - i) * WAVE_MS, faces: flipFaces(to.charAt(i)) });
      });

      var t0 = performance.now();
      var chars = to.split('');

      flipTimer = setInterval(function () {
        var e = performance.now() - t0;
        var busy = false, n, p, dt, k;

        churn = {};
        for (n = 0; n < to.length; n++) chars[n] = to.charAt(n);

        for (n = 0; n < plan.length; n++) {
          p = plan[n];
          dt = e - p.start;
          if (dt < 0) {
            // Its turn has not come round yet. It is still yesterday here.
            chars[p.at] = from.charAt(p.at);
            busy = true;
            continue;
          }
          k = Math.floor(dt / FLIP_MS);
          if (k < p.faces.length) {
            chars[p.at] = p.faces[k];
            churn[p.at] = true;
            busy = true;
          }
        }

        tick++;
        render(chars.join(''));

        if (busy) return;
        clearInterval(flipTimer);
        flipTimer = null;
        churn = {};
        render(to);
      }, STEP_MS);
    }

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
      var changed = [];
      if (previous.length === text.length) {
        for (var i = 0; i < text.length; i++) {
          if (previous.charAt(i) !== text.charAt(i)) changed.push(i);
        }
      }
      var was = previous;
      previous = text;

      var still = window.matchMedia &&
                  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (!changed.length || still) {
        clearInterval(flipTimer);
        flipTimer = null;
        churn = {};
        render(text);
        return;
      }

      runFlip(was, text, changed);
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

  /* Two stacking bands, not one.

     Everything lying on the bed shares the lower one: whatever was picked
     up last is on top of the rest, which is what a desk does. But the
     clock and the plants in the corner are FURNITURE, and have to sit over
     all of that -- so the bed is capped well below them.

     A picture you have opened is neither. It is the thing you are looking
     at, and it belongs over the furniture as well, so panels get a band of
     their own above the corner and below the taskbar. */
  var zTop = 100;
  var Z_BED_MAX = 7900;
  var zPanel = 8100;

  function bumpZ() {
    if (zTop < Z_BED_MAX) zTop++;
    return zTop;
  }
  function bumpPanel() {
    if (zPanel < 9990) zPanel++;
    return zPanel;
  }

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

    /* A drag that starts on a picture is still, as far as the browser is
       concerned, a mouse being swept across a document -- so it paints
       everything it crosses blue and leaves the selection behind when you
       let go. Nothing is selectable for as long as something is in the
       air, and whatever was already highlighted is dropped. */
    document.body.classList.add('dragging');
    try {
      var sel = window.getSelection();
      if (sel && sel.removeAllRanges) sel.removeAllRanges();
    } catch (err) {}

    // On a phone the bed is still in flow, and a coordinate would mean
    // nothing until it is pinned.
    if (!wide()) freezeBed(bedOf(drag.el));

    drag.el.style.left = drag.originX + 'px';
    drag.el.style.top = drag.originY + 'px';
    /* Picking something up brings it to the front OF ITS OWN BAND. An open
       picture belongs over the clock and the plants, and writing a bed
       number onto it the moment it was dragged put it straight back under
       them -- which is why opening one looked right and moving it did not. */
    drag.el.style.zIndex = drag.el.classList.contains('viewer') ? bumpPanel() : bumpZ();
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
    // Without dividing, the item would lag behind the pointer -- but only
    // things actually lying on the bed are scaled. See makeDraggable.
    var k = drag.scale || 1;
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

    // Where the pointer was last seen, for the bin to answer on release.
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;

    var bin = binEl();
    if (bin && !bin.hidden) {
      var over = !!drag.key && overBin(e.clientX, e.clientY);
      if (over !== bin.classList.contains('open')) {
        bin.classList.toggle('open', over);
        paintBin();
      }
    }
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
    if (!drag) { document.body.classList.remove('dragging'); return; }
    var d = drag;
    drag = null;
    document.body.classList.remove('dragging');
    drop(d);
    swallowNextClick(d.el);

    // Dropped in the bin, or left hanging over the side of the garden.
    var bin = binEl();
    if (bin) { bin.classList.remove('open'); paintBin(); }

    if (d.key && (overBin(d.lastX, d.lastY) || overTheEdge(d.el))) {
      tossItem(d.el);
      growBed(bedOf(d.el));
      fitSoon();
      return;
    }

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

      /* The bed is drawn scaled to fit the window, so a thing lying ON it
         moves in scaled pixels and its travel has to be divided down. A
         panel does NOT lie on the bed -- it is on the body at full size --
         and dividing its travel by the bed's scale sent it running off
         down and to the right, away from the pointer, which is precisely
         what dragging an opened picture used to feel like. The scale is
         per-item now, and it is remembered so the press and every move
         afterwards agree about it. */
      var k = bedOf(el) ? (bedScale || 1) : 1;

      pending = {
        el: el,
        key: key,
        onDrop: onDrop,
        handle: handle,
        scale: k,
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
      m.el.style.zIndex = bumpZ();
    });

    if (!wide()) growBed(bed);
  }

  /* ============================================================== WINDOWS */

  function mountItems() {
    document.querySelectorAll('.plantbed > .item').forEach(function (item) {
      // The browser's own link and image dragging would otherwise take over
      // the moment you grab an icon, which is the obvious thing to grab.
      item.querySelectorAll('a, img').forEach(function (n) { n.draggable = false; });

      item.addEventListener('pointerdown', function () { item.style.zIndex = bumpZ(); });

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

    // Fitting the arrangement to the window used to be a switch nobody ever
    // wanted off: with it off, half of any wide folder is simply not on the
    // screen. It is just how the page works now.
    var on = bed.classList.contains('freeform') &&
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
  /* --------------------------------------------------------- the texture
     Its own layer, starting at the rule under the masthead, so the pattern
     is under the FILES and not under the clock, the still, the prickly
     pear or the name of the site. The top is measured rather than guessed:
     the masthead is a different height on every page and every window. */

  function placeTexture() {
    var tex = document.getElementById('tex');
    if (!tex) return;

    var rule = document.querySelector('.masthead .rule');
    var top = rule ? rule.getBoundingClientRect().bottom + window.pageYOffset : 0;

    /* Height, not `bottom: 0`. The bed is pinned and absolute, so the body's
       own box stops well short of the bottom of the document -- anchoring to
       it gave the layer a height of exactly nothing. */
    var tall = Math.max(document.documentElement.scrollHeight,
                        document.body.scrollHeight,
                        window.innerHeight);
    tex.style.top = Math.round(top) + 'px';
    tex.style.height = Math.max(0, Math.round(tall - top)) + 'px';
  }

  function mountTexture() {
    if (document.getElementById('tex')) return;
    var tex = document.createElement('div');
    tex.id = 'tex';
    tex.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tex);
    placeTexture();
    window.addEventListener('resize', placeTexture);
    // Pictures settle after they load and the page gets taller.
    window.addEventListener('load', function () {
      placeTexture();
      setTimeout(placeTexture, 400);
    });
  }

  function mountHint() {
    var hint = document.getElementById('taskbar-clock');
    if (!hint) return;
    hint.textContent = wide() ? 'drag things around →' : 'hold to move';
  }

  window.addEventListener('resize', fitSoon);
  window.addEventListener('resize', mountHint);

  /* ============================================================== TOGGLES */

  var TOGGLES = [
    { id: 'sound', label: 'sound', def: true,
      apply: function (on) { soundOn = on; ambSync(); } },
    { id: 'pogo', label: 'pogo', def: true,
      apply: function (on) { var m = document.getElementById('pogo');
                             if (m) m.hidden = !on; } },
    // The cactus and the still are one thing to anybody looking at them:
    // the living corner of the page. One switch, not two.
    { id: 'plants', label: 'plants', def: true,
      apply: function (on) { var c = document.getElementById('plants');
                             if (c) c.style.display = on ? '' : 'none'; } },
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

  /* Four rooms, and each one is somewhere else. There used to be five, but
     bone, "paper" and olive were three off-whites within a few points of
     each other, which is not a choice, it is a rounding error. Paper is
     gone and olive is an actual olive now. */
  var THEMES = ['', 'theme-pocari', 'theme-olive', 'theme-ink'];
  var THEME_NAMES = ['bone', 'pocari', 'olive', 'ink'];

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
    // Clamped, because somebody who was sitting on the fifth theme before
    // there were only four would otherwise land on an index that is not
    // there and get no theme and no label at all.
    var themeIdx = get('theme', 0);
    if (!(themeIdx >= 0 && themeIdx < THEMES.length)) themeIdx = 0;
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

    /* Tidy up is the gentle one, and the one people will actually reach
       for, so it comes first. It slides the things on THIS page back to
       where Finder has them and lets go of any sizes, in front of you
       rather than by reloading -- half the pleasure of tidying a desk is
       watching it happen. Nothing else is touched: every door stays open,
       every plant keeps growing, and anything thrown away stays thrown
       away. */
    /* A pad of stickies. Anybody can leave one, anywhere, on any page. */
    var pad = document.createElement('button');
    pad.className = 'toggle';
    pad.type = 'button';
    pad.innerHTML = '<span class="led"></span>note';
    pad.title = 'stick a note to this page';
    pad.addEventListener('click', newSticky);
    bar.appendChild(pad);

    var tidy = document.createElement('button');
    tidy.className = 'toggle';
    tidy.type = 'button';
    tidy.innerHTML = '<span class="led"></span>tidy up';
    tidy.title = 'slide everything on this page back into place';

    tidy.addEventListener('click', function () {
      var bed = document.querySelector('.plantbed');
      if (!bed) return;

      var moved = get('moved', {});
      var sized = get('sized', {});
      var items = bed.querySelectorAll(':scope > .item');
      var i, el, k;

      for (i = 0; i < items.length; i++) {
        k = items[i].dataset.key;
        if (k) { delete moved[k]; delete sized[k]; }
      }
      set('moved', moved);
      set('sized', sized);

      /* On a narrow screen the whole bed is pinned by hand -- every item
         has a left and a top written onto it by mobilizeBed, and clearing
         those would drop the lot into a heap. There is nothing to animate
         back to, so that layout is simply built again. */
      if (!wide()) { location.reload(); return; }

      bed.classList.add('tidying');

      /* Each page carries its own arrangement in its own stylesheet -- the
         Finder coordinates are rules, not inline styles. So putting an item
         back is a matter of taking OFF what the visitor wrote on it and
         letting the page's own rule surface again, which the transition
         above then slides it to. */
      for (i = 0; i < items.length; i++) {
        el = items[i];
        el.style.left = '';
        el.style.top = '';
        el.style.zIndex = '';
        var box = el.querySelector('[data-resizable]');
        if (box) { box.style.width = ''; box.style.height = ''; }
      }

      play('tick');

      setTimeout(function () {
        bed.classList.remove('tidying');
        growBed(bed);
        fitSoon();
      }, 600);
    });
    bar.appendChild(tidy);
    /* ------------------------------------------------------------ reset
       Everything. Not "put things back where Finder has them" -- that is
       what tidy up is for -- but every single thing this browser has ever
       remembered about this site: the arrangement, the sizes, every door
       that has been found, every living thing's progress, the notes stuck
       to the page, the glasshouse, the theme, the switches, the player.

       It asks twice, because there is no undo and because thirty-five
       years of a saguaro should not go on one slip of a finger. */
    var reset = document.createElement('button');
    reset.className = 'toggle';
    reset.type = 'button';
    reset.innerHTML = '<span class="led"></span>full reset';
    reset.title = 'forget everything this browser knows about the site';

    var armed = 0;

    function wipe(store) {
      var doomed = [], i, k;
      try {
        for (i = 0; i < store.length; i++) {
          k = store.key(i);
          if (k && k.indexOf(STORE) === 0) doomed.push(k);
        }
        doomed.forEach(function (key) { store.removeItem(key); });
      } catch (e) {}
    }

    reset.addEventListener('click', function () {
      if (!armed || Date.now() > armed) {
        armed = Date.now() + 6000;
        reset.classList.add('arming');
        reset.innerHTML = '<span class="led"></span>sure?';
        setTimeout(function () {
          if (!armed || Date.now() < armed) return;
          armed = 0;
          reset.classList.remove('arming');
          reset.innerHTML = '<span class="led"></span>full reset';
        }, 6200);
        return;
      }
      armed = 0;
      wipe(localStorage);
      wipe(sessionStorage);
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
    panel.style.zIndex = bumpPanel();
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
    panel.addEventListener('pointerdown', function () { panel.style.zIndex = bumpPanel(); });
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

      panel.style.zIndex = bumpPanel();

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
    applyTossed();          // anything thrown down the shaft is not drawn
    placeTexture();         // the masthead is a different height on every page
    setTimeout(placeTexture, 500);   // ...and so is the page, once it settles
    paintStickies();        // whatever anybody stuck to this page
    var theBin = binEl();
    if (theBin) {
      theBin.hidden = document.body.getAttribute('data-scene') === 'crypt';
      paintBin();
    }
    mountSeaDoor();         // three clicks on the photograph of the sea
    mountVisitors();        // the scratches on the wall of this room
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
    bar:       { type: 'lowpass',  freq: 420,  q: 0.50, gain: 0.018, swell: 0.020, rate: 0.05,
                 every: [7000, 17000], voice: 'ice', music: true },
    ocean:     { type: 'lowpass',  freq: 300,  q: 0.90, gain: 0.046, swell: 0.140, rate: 0.10,
                 every: [2600, 7000],  voice: 'bubble' },
    moonlight: { type: 'bandpass', freq: 3400, q: 1.20, gain: 0.010, swell: 0.040, rate: 0.13,
                 every: [3000, 9000],  voice: 'cricket' }
  };

  /* ---------------------------------------------------------- the trio
     There is a record on in the bar, and it is not a file. Nothing here is
     downloaded: a bass, a piano and a pair of brushes are built out of the
     same oscillators and the same half-second of noise as everything else
     on this site, and they play a turnaround round and round at ninety-two
     beats a minute with the eighths swung.

     It is generated rather than looped, so the piano leaves different holes
     every time and the bass walks a different way up to the same note. It
     is also very quiet. A bar at one in the morning is not a concert.

     Scheduled the way audio has to be scheduled: a timer wakes up four
     times a second, looks a fifth of a second ahead, and books whatever
     falls inside that window against the audio clock rather than against
     setInterval, which is nowhere near steady enough to swing. */

  var JAZZ_BPM = 92;
  var JAZZ_SWING = 0.64;          // where the off-beat lands inside the beat

  /* ii-V-I and round again, in C. Each bar is [root, chord tones above it].
     The piano voicings are rootless -- third, seventh, ninth, thirteenth --
     which is what a piano actually plays when there is a bass in the room. */
  var JAZZ_BARS = [
    { root: 50, walk: [50, 53, 57, 55], voice: [60, 65, 69, 72] },   // Dm7
    { root: 55, walk: [55, 59, 62, 61], voice: [59, 65, 69, 74] },   // G7
    { root: 48, walk: [48, 52, 55, 57], voice: [59, 64, 67, 71] },   // Cmaj7
    { root: 57, walk: [57, 60, 64, 62], voice: [60, 64, 67, 71] },   // Am7
    { root: 50, walk: [50, 53, 57, 59], voice: [60, 65, 69, 72] },   // Dm7
    { root: 55, walk: [55, 62, 59, 53], voice: [59, 65, 69, 74] },   // G7
    { root: 48, walk: [48, 55, 52, 50], voice: [59, 64, 67, 71] },   // Cmaj7
    { root: 55, walk: [55, 57, 59, 61], voice: [59, 65, 69, 74] }    // G7
  ];

  function hz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  var jazz = null;   // { timer, bar, beat, at, gain }

  function jazzNote(ctx, out, midi, t, dur, kind) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    var f = ctx.createBiquadFilter();
    o.connect(f); f.connect(g); g.connect(out);

    if (kind === 'bass') {
      // An upright is nearly a sine with a thumb on it: a little edge at the
      // attack, nothing at all by the end of the note.
      o.type = 'triangle';
      f.type = 'lowpass'; f.frequency.value = 520; f.Q.value = 0.8;
      o.frequency.setValueAtTime(hz(midi) * 1.02, t);
      o.frequency.exponentialRampToValueAtTime(hz(midi), t + 0.03);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.42, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.10, t + dur * 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.95);
    } else {
      o.type = 'triangle';
      f.type = 'lowpass'; f.frequency.value = 2400; f.Q.value = 0.5;
      o.frequency.value = hz(midi);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.13, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Brushes. The ride is a short bright tick; two and four get a swish. */
  function jazzBrush(ctx, out, t, kind) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    var f = ctx.createBiquadFilter();
    var g = ctx.createGain();
    src.connect(f); f.connect(g); g.connect(out);

    if (kind === 'ride') {
      f.type = 'bandpass'; f.frequency.value = 7200; f.Q.value = 1.4;
      g.gain.setValueAtTime(0.09, t);
      g.gain.exponentialRampToValueAtTime(0.0002, t + 0.13);
      src.start(t); src.stop(t + 0.15);
    } else {
      f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.5;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.055, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0002, t + 0.30);
      src.start(t); src.stop(t + 0.32);
    }
  }

  function jazzStop() {
    if (!jazz) return;
    clearInterval(jazz.timer);
    try {
      var t = actx.currentTime;
      jazz.gain.gain.cancelScheduledValues(t);
      jazz.gain.gain.setValueAtTime(jazz.gain.gain.value || 0.0001, t);
      jazz.gain.gain.exponentialRampToValueAtTime(0.00001, t + 1.4);
      var dying = jazz.gain;
      setTimeout(function () { try { dying.disconnect(); } catch (e) {} }, 1800);
    } catch (e) {}
    jazz = null;
  }

  function jazzStart() {
    var ctx = audio();
    if (!ctx || jazz) return;
    try {
      var out = ctx.createGain();
      out.gain.setValueAtTime(0.00001, ctx.currentTime);
      out.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 5);
      out.connect(ctx.destination);

      var beat = 60 / JAZZ_BPM;
      jazz = { timer: 0, bar: 0, beat: 0, at: ctx.currentTime + 0.2, gain: out };

      jazz.timer = setInterval(function () {
        if (!jazz) return;
        var now = ctx.currentTime;
        // Woken late -- a hidden tab, a sleeping laptop. Do not try to catch
        // up by playing forty beats at once; just pick the music back up.
        if (jazz.at < now - 1) jazz.at = now + 0.1;

        while (jazz.at < now + 0.25) {
          var bar = JAZZ_BARS[jazz.bar % JAZZ_BARS.length];
          var b = jazz.beat;
          var t = jazz.at;

          // bass: one note a beat, all the way round
          jazzNote(ctx, out, bar.walk[b], t, beat * 0.92, 'bass');

          // ride: on every beat, and swung on two and four
          jazzBrush(ctx, out, t, 'ride');
          if (b === 1 || b === 3) {
            jazzBrush(ctx, out, t + beat * JAZZ_SWING, 'ride');
            jazzBrush(ctx, out, t, 'swish');
          }

          /* piano: late, and only sometimes. A comping piano that hit every
             bar on the beat would be a drum machine with chords on it. */
          if (Math.random() < (b === 1 || b === 3 ? 0.55 : 0.18)) {
            var when = t + beat * (Math.random() < 0.6 ? JAZZ_SWING : 0);
            var voice = bar.voice;
            var k;
            for (k = 0; k < voice.length; k++) {
              if (Math.random() < 0.22) continue;         // leave a hole
              jazzNote(ctx, out, voice[k], when + k * 0.006, beat * 1.3, 'piano');
            }
          }

          jazz.at += beat;
          jazz.beat++;
          if (jazz.beat > 3) { jazz.beat = 0; jazz.bar++; }
        }
      }, 60);
    } catch (e) { jazz = null; }
  }

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
    jazzStop();
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

      if (spec.music) jazzStart();

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
    sceneTone = 'moonlight';

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
    ambience('moonlight');
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
    var swimming = false;      // in the sea nothing below applies at all
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
      var rows = name === 'swim0' ? POGO_SWIM[0] : name === 'swim1' ? POGO_SWIM[1]
               : name === 'sleep' ? POGO_SLEEP : name === 'water' ? POGO_WATER
               : name === 'down' ? POGO_DOWN : POGO_UP;
      art.textContent = rows.join('\n');
      man.classList.toggle('asleep', name === 'sleep');
    }

    /* ------------------------------------------------------------ water
       Underwater there is nothing to push off, so none of the machinery
       above applies: no springs, no ledges, no floor. He paddles towards
       the cursor in both directions at once, the water drags at him the
       whole time, and when nobody is pointing anywhere he sinks very
       slowly, which is what a person made of letters would do. */

    var SWIM_SPEED = 230;      // px/sec, flat out
    var SWIM_DRAG = 1.35;      // halvings per second with nothing driving him
    var SINK = 30;             // px/sec/sec: heavier than water, but barely
    var swimClock = 0;

    function swimStep(dt) {
      swimClock += dt;

      var dx = targetX - x;
      var dy = (targetY - y) + H * 0.45;   // aim his middle at the cursor
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      // He eases off as he arrives rather than stopping dead on the spot.
      var pull = Math.min(1, d / 110);
      var blend = Math.min(1, dt * 2.4);

      vx += ((dx / d) * SWIM_SPEED * pull - vx) * blend;
      vy += ((dy / d) * SWIM_SPEED * pull - vy) * blend;
      vy += SINK * dt;

      var drag = Math.pow(0.5, dt * SWIM_DRAG);
      vx *= drag;
      vy *= drag;

      x += vx * dt;
      // a slow bob, so he is never quite still even when he has arrived
      y += vy * dt + Math.sin(swimClock * 1.7) * 14 * dt;

      var minX = window.pageXOffset + W / 2;
      var maxX = window.pageXOffset + window.innerWidth - W / 2;
      if (x < minX) { x = minX; vx = Math.abs(vx) * 0.3; }
      if (x > maxX) { x = maxX; vx = -Math.abs(vx) * 0.3; }

      var top = window.pageYOffset + 56;
      var bed = floor();
      if (y < top) { y = top; if (vy < 0) vy = -vy * 0.3; }
      if (y > bed) { y = bed; if (vy > 0) vy = -vy * 0.25; }

      sprite(Math.floor(swimClock * 2.4) % 2 ? 'swim1' : 'swim0');
      man.style.transform = 'translate3d(' + Math.round(x - W / 2) + 'px,' +
                            Math.round(y - H) + 'px,0)';
    }

    function step(dt) {
      if (swimming) { swimStep(dt); return; }
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

    /* The sea. He stops bouncing entirely and starts swimming: see
       swimStep. Coming back out, he is dropped wherever he was floating
       and the ordinary rules catch him. */
    pogoSwim = function (on) {
      if (swimming === !!on) return;
      swimming = !!on;
      drawn = '';
      vx = 0; vy = 0;
      errand = null;
      asleep = false;
      energy = 0.3;
      lastLand = null;
      if (!swimming) lastPointed = performance.now();
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
    sceneTone = 'garden';

    var tree = get('adam', null);
    if (!tree || typeof tree.clicks !== 'number') tree = { clicks: 0 };

    var dug = get('dig', null);
    if (!dug || typeof dug.turns !== 'number') dug = { turns: 0 };

    /* ------------------------------------------------------------ build */

    var scene = document.createElement('div');
    scene.id = 'scene';
    scene.setAttribute('aria-hidden', 'true');
    scene.innerHTML =
      '<pre id="roof"></pre>' +
      '<pre id="sky"></pre>' +
      '<div id="ground"><div id="grass"></div><pre id="cow"></pre></div>';
    document.body.appendChild(scene);

    var says = document.createElement('p');
    says.id = 'wx-say';
    says.hidden = true;
    document.body.appendChild(says);
    sceneNodes.push(says);

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
      // A few blades at a time, so it is never obviously a timer -- and
      // more of them when it is actually raining where the visitor is.
      var many = document.body.classList.contains('wx-wet') ? 8 : 3;
      for (var n = 0; n < many; n++) {
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

      if (tree.clicks >= TREE_CLICKS) {
        setTimeout(function () { breakRoof(); }, 500);
      }
    }

    hit.addEventListener('click', water);

    /* ----------------------------------------------------- the weather
       Whatever is going on outside the window of whoever is looking. The
       sky changes colour, rain and snow fall through the garden, and in
       wet weather the grass comes on without anybody watering it -- which
       is the only part of this that does anything. */

    var sky = document.getElementById('sky');
    var wet = false;

    function paintSky() {
      var kind = document.body.getAttribute('data-wx');
      if (!kind || (kind !== 'rain' && kind !== 'drizzle' &&
                    kind !== 'snow' && kind !== 'storm')) {
        sky.textContent = '';
        return;
      }
      var flake = kind === 'snow';
      var w = Math.ceil(window.innerWidth / 6.7);
      var rows = Math.ceil(window.innerHeight / 12);
      var thick = kind === 'storm' ? 0.90 : kind === 'drizzle' ? 0.972 : 0.945;
      var out = '', r, c, n;
      for (r = 0; r < rows; r++) {
        for (c = 0; c < w; c++) {
          n = noise(r + skyPhase, c, 71);
          out += n > thick ? (flake ? '*' : '/') : (n > thick - 0.02 ? (flake ? '.' : '\'') : ' ');
        }
        if (r !== rows - 1) out += '\n';
      }
      sky.textContent = out;
    }

    var skyPhase = 0;
    sceneTimers.push(setInterval(function () {
      if (document.hidden || !wet) return;
      skyPhase = (skyPhase + 1) % 997;
      paintSky();
    }, 220));

    weather(function (w) {
      document.body.setAttribute('data-wx', w.kind);
      document.body.classList.toggle('wx-night', !w.day);
      wet = w.kind === 'rain' || w.kind === 'drizzle' ||
            w.kind === 'snow' || w.kind === 'storm';
      document.body.classList.toggle('wx-wet', wet);
      says.hidden = false;
      says.textContent = w.place.toLowerCase() + '  ·  ' + w.temp + '°  ·  ' +
                         (WX_WORD[w.kind] || w.kind) +
                         (w.wind >= 25 ? '  ·  windy' : '');
      paintSky();
    });
    window.addEventListener('resize', paintSky);

    /* -------------------------------------------------------- the spade
       There is a floor under the garden the same way there was a ceiling
       over it. Sixty turns and it gives. */

    var spade = document.createElement('button');
    spade.id = 'spade';
    spade.type = 'button';
    spade.innerHTML = '<pre aria-hidden="true">' + SPADE.join('\n') + '</pre>' +
                      '<span id="spade-count"></span>';
    document.body.appendChild(spade);
    sceneNodes.push(spade);
    var spadeCount = spade.querySelector('#spade-count');

    function paintSpade() {
      var left = DIG_CLICKS - dug.turns;
      spadeCount.textContent = left > 0 ? dug.turns + ' / ' + DIG_CLICKS : 'the shaft';
      spade.setAttribute('title', left > 0
        ? 'dig — ' + left + ' more turns'
        : 'the shaft is open. throw something over the side.');
      spade.setAttribute('aria-label', 'dig at the bottom of the garden, ' +
        dug.turns + ' of ' + DIG_CLICKS);
      spade.classList.toggle('through', left <= 0);
    }

    function dig() {
      if (dug.turns >= DIG_CLICKS) { openCrypt(true); return; }
      dug.turns++;
      set('dig', dug);
      paintSpade();
      play('tick');
      spade.classList.add('turning');
      setTimeout(function () { spade.classList.remove('turning'); }, 200);
      if (dug.turns >= DIG_CLICKS) setTimeout(breakFloor, 420);
    }
    spade.addEventListener('click', dig);

    function breakFloor() {
      document.body.classList.add('floor-broken');
      play('rustle');
      toast('the floor gave way');
      setTimeout(function () { openCrypt(true); }, 1200);
    }

    function openCrypt(scrollDown) {
      if (!document.getElementById('crypt-level')) {
        var c = document.createElement('section');
        c.id = 'crypt-level';
        document.body.appendChild(c);
        cryptRoom(c, 'BOTTOM CRYPT');
        var up = document.createElement('p');
        up.className = 'crypt-up';
        up.innerHTML = '&uarr; the garden is above';
        c.querySelector('.crypt-inner').appendChild(up);
      }
      document.documentElement.classList.add('crypt-open');
      document.body.classList.add('crypt-open');
      openSecret('crypt', false);
      watchFloor();
      if (!scrollDown) return;
      setTimeout(function () {
        var c = document.getElementById('crypt-level');
        if (c) window.scrollTo({ top: c.offsetTop, behavior: 'smooth' });
      }, 300);
    }

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
            '<div class="sun-house"></div>' +
            '<div class="sun-bed"><p class="sun-wait">opening the room…</p></div>' +
            '<p class="sun-down">&darr; the garden is below</p>' +
          '</div>' +
          '<pre class="sun-floor" aria-hidden="true"></pre>';
        document.body.insertBefore(sun, document.body.firstChild);
        mountNursery(sun.querySelector('.sun-house'));
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

    paintSpade();
    ambience('garden');

    if (tree.clicks >= TREE_CLICKS) {
      document.body.classList.add('roof-broken');
      openSun(false);
    }
    if (dug.turns >= DIG_CLICKS) {
      document.body.classList.add('floor-broken');
      openCrypt(false);
    }
  }

  /* ============================================================ VISITORS
     Not a number in a box. A wall with a scratch on it for everybody who
     has stood in this room -- five to a gate, the way you count days in a
     cell -- and the plain figure underneath for when the wall gets full.

     The count itself lives on a small free service that stores one integer
     against one name and nothing else: no visitor, no address, no session.
     If it is ever gone the wall simply does not appear, which is the right
     way for a decoration to fail.
     ------------------------------------------------------------------- */

  var COUNTER = 'https://abacus.jasoncameron.dev';
  var COUNTER_NS = 'anmo-garden';

  // Which rooms keep a count, by the name at the top of the page.
  var VISIT_ROOMS = {
    'THE GARDEN': 'garden',
    'MOON': 'moon',
    'LIBRARY!!!!!': 'library'
  };

  var ROOM_WORD = {
    garden:  'have walked through the garden',
    moon:    'have stood on the moon',
    library: 'have found the library'
  };

  function mountVisitors() {
    var h1 = document.querySelector('.masthead h1');
    var room = h1 && VISIT_ROOMS[h1.textContent.trim()];
    if (!room) return;

    var wall = document.createElement('p');
    wall.id = 'visitors';
    wall.innerHTML = '<b></b><span></span>';
    var rule = document.querySelector('.masthead .rule');
    if (rule && rule.parentNode) rule.parentNode.insertBefore(wall, rule);
    else document.querySelector('.masthead').appendChild(wall);

    var figure = wall.querySelector('b');
    var say = wall.querySelector('span');

    // One count per visit, not per visitor -- honest, and it means the
    // number answers you the moment you walk in.
    fetch(COUNTER + '/hit/' + COUNTER_NS + '/' + room, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || typeof d.value !== 'number') throw new Error('no count');
        if (d.value === 1) {
          figure.textContent = '';
          say.textContent = 'you are the first person in this room';
        } else {
          figure.textContent = d.value.toLocaleString();
          say.textContent = ' ' + (ROOM_WORD[room] || 'have stood here');
        }
        wall.classList.add('counted');
      })
      .catch(function () { if (wall.parentNode) wall.parentNode.removeChild(wall); });
  }

  /* ============================================================= WEATHER
     The garden gets the weather you are actually standing in.

     Nobody is asked for their location and nothing is sent anywhere that
     could identify them: the browser already knows its own time zone, and
     "America/Toronto" contains the name of a city. That name is looked up
     for a latitude and a longitude, and those go to a free forecast with
     no account and no key. The answer is kept for half an hour.
     ------------------------------------------------------------------- */

  var WX_CACHE_MS = 30 * 60 * 1000;

  /* World Meteorological Organization present-weather codes, grouped into
     the handful of things a garden can visibly do. */
  function wxKind(code) {
    if (code === 0) return 'clear';
    if (code === 1 || code === 2) return 'part';
    if (code === 3) return 'cloud';
    if (code === 45 || code === 48) return 'fog';
    if (code >= 51 && code <= 57) return 'drizzle';
    if (code >= 61 && code <= 67) return 'rain';
    if (code >= 71 && code <= 77) return 'snow';
    if (code >= 80 && code <= 82) return 'rain';
    if (code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'storm';
    return 'cloud';
  }

  var WX_WORD = {
    clear: 'clear', part: 'a few clouds', cloud: 'overcast', fog: 'fog',
    drizzle: 'drizzle', rain: 'rain', snow: 'snow', storm: 'thunder'
  };

  function myCity() {
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    if (!tz || tz.indexOf('/') < 0) return '';
    return tz.split('/').pop().replace(/_/g, ' ');
  }

  function weather(done) {
    var city = myCity();
    if (!city) return;

    var cached = get('wx', null);
    if (cached && cached.city === city && Date.now() - cached.at < WX_CACHE_MS) {
      done(cached);
      return;
    }

    fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&name=' +
          encodeURIComponent(city))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var hit = d && d.results && d.results[0];
        if (!hit) throw new Error('nowhere');
        return fetch('https://api.open-meteo.com/v1/forecast?latitude=' +
          hit.latitude + '&longitude=' + hit.longitude +
          '&current=temperature_2m,weather_code,wind_speed_10m,is_day')
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (w) {
            if (!w || !w.current) throw new Error('no sky');
            var out = {
              at: Date.now(),
              city: city,
              place: hit.name,
              temp: Math.round(w.current.temperature_2m),
              wind: Math.round(w.current.wind_speed_10m),
              day: !!w.current.is_day,
              kind: wxKind(w.current.weather_code)
            };
            set('wx', out);
            done(out);
          });
      })
      .catch(function () { /* the garden keeps its own weather */ });
  }

  /* =============================================================== NOTES
     A pad of stickies. Press "note" in the taskbar and one lands on the
     page: type in it, drag it anywhere, throw it away with the cross in
     its corner. They belong to the page they were stuck to, they survive
     a reload, and a full reset takes the lot.

     They are not in the plantbed. The bed is drawn scaled to fit the
     window and its coordinates are Finder's, neither of which has anything
     to do with where somebody wanted to stick a note -- so a note lives on
     the body at page coordinates, like the bin and the spade.
     ------------------------------------------------------------------- */

  var NOTE_COLOURS = 4;
  var NOTE_MAX = 900;

  /** Which page we are on, as the key the notes are filed under. */
  function noteRoom() {
    try { return decodeURIComponent(location.pathname); } catch (e) { return location.pathname; }
  }

  function allNotes() {
    var n = get('stickies', null);
    return (n && typeof n === 'object') ? n : {};
  }

  function roomNotes() { return allNotes()[noteRoom()] || []; }

  function saveRoomNotes(list) {
    var all = allNotes();
    if (list.length) all[noteRoom()] = list;
    else delete all[noteRoom()];
    set('stickies', all);
  }

  function noteSave(note) {
    var list = roomNotes();
    var i, found = false;
    for (i = 0; i < list.length; i++) {
      if (list[i].id === note.id) { list[i] = note; found = true; break; }
    }
    if (!found) list.push(note);
    saveRoomNotes(list);
  }

  function noteForget(id) {
    saveRoomNotes(roomNotes().filter(function (n) { return n.id !== id; }));
  }

  function stickyEl(note, focus) {
    var el = document.createElement('div');
    el.className = 'sticky c' + (note.colour % NOTE_COLOURS);
    el.style.left = note.x + 'px';
    el.style.top = note.y + 'px';
    el.style.zIndex = bumpPanel();
    el.innerHTML =
      '<div class="sticky-head">' +
        '<span class="sticky-grip" title="drag me">' +
          '<i></i><i></i><i></i>' +
        '</span>' +
        '<button class="sticky-bin" type="button" title="throw this note away" ' +
          'aria-label="throw this note away">&times;</button>' +
      '</div>' +
      '<div class="sticky-body" contenteditable="plaintext-only" ' +
        'role="textbox" aria-multiline="true" spellcheck="true"></div>';
    document.body.appendChild(el);

    var body = el.querySelector('.sticky-body');
    body.textContent = note.text || '';
    if (!note.text) el.classList.add('empty');

    var typing = null;
    body.addEventListener('input', function () {
      el.classList.toggle('empty', !body.textContent.trim());
      clearTimeout(typing);
      typing = setTimeout(function () {
        note.text = body.textContent.slice(0, NOTE_MAX);
        noteSave(note);
      }, 400);
    });
    body.addEventListener('blur', function () {
      note.text = body.textContent.slice(0, NOTE_MAX);
      noteSave(note);
    });

    el.addEventListener('pointerdown', function () { el.style.zIndex = bumpPanel(); });

    el.querySelector('.sticky-bin').addEventListener('click', function () {
      el.classList.add('binned');
      noteForget(note.id);
      play('tick');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    });

    /* Dragged by its head, with no key -- a key would put it in the list of
       things that can be thrown down the shaft, and a note is not a file. */
    makeDraggable(el, el.querySelector('.sticky-head'), null, function (x, y) {
      note.x = x; note.y = y;
      noteSave(note);
    });

    if (focus) {
      body.focus();
      if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    return el;
  }

  function clearStickies() {
    document.querySelectorAll('.sticky').forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
  }

  function paintStickies() {
    clearStickies();
    roomNotes().forEach(function (n) { stickyEl(n, false); });
  }

  function newSticky() {
    /* Somewhere in the middle of what is actually on the screen, nudged a
       little each time so a second note does not land exactly on the first. */
    var many = roomNotes().length;
    var note = {
      id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
      text: '',
      colour: Math.floor(Math.random() * NOTE_COLOURS),
      x: Math.round(window.pageXOffset + window.innerWidth * 0.5 - 100 + (many % 5) * 22),
      y: Math.round(window.pageYOffset + window.innerHeight * 0.34 + (many % 5) * 20)
    };
    noteSave(note);
    stickyEl(note, true);
    play('tick');
  }

  /* ============================================================= TOSSING
     Once the shaft is dug, the edge of the page is an edge. Drag anything
     over the side and it falls -- and it is not gone, it is in the crypt,
     by name, with everything else that was thrown down there. Put back
     fetches the lot.

     Nothing on the actual disk moves. This is a site deciding not to draw
     something; the file is exactly where its owner left it.
     ------------------------------------------------------------------- */

  function tossedList() { return get('tossed', {}); }

  function applyTossed() {
    var t = tossedList();
    document.querySelectorAll('.plantbed > .item').forEach(function (el) {
      var k = el.dataset.key;
      el.classList.toggle('tossed-away', !!(k && t[k]));
    });
    paintPile();
  }

  function pileName(key) { return String(key).replace(/\/$/, ''); }

  /**
   * The heap, as things rather than as a list of names.
   *
   * Every thrown item remembers the page it came off. The crypt fetches
   * those pages, lifts the real item out of each one -- icon, thumbnail,
   * link and all -- and stands it on the floor down here, where it opens
   * exactly the way it would have upstairs. Nothing has moved on the disk;
   * this is the same file, borrowed back.
   */
  function paintPile() {
    var piles = document.querySelectorAll('.crypt-pile');
    if (!piles.length) return;

    var t = tossedList();
    var keys = Object.keys(t).sort(function (a, b) { return t[b].at - t[a].at; });

    if (!keys.length) {
      piles.forEach(function (p) {
        p.innerHTML = '<p class="crypt-empty">nothing has been thrown down here ' +
          'yet. there is a bin in the corner of every page, and in the garden ' +
          'you can shove things off the side.</p>';
      });
      return;
    }

    piles.forEach(function (p) {
      if (!p.querySelector('.pile-bed')) {
        p.innerHTML = '<p class="crypt-empty">bringing it back up…</p>';
      }
    });

    // Grouped by where each thing was thrown from, so each page is asked
    // for once however much came off it.
    var root = siteRoot();
    var byPage = {};
    keys.forEach(function (k) {
      var from = (t[k] && t[k].from) || root.pathname;
      if (!byPage[from]) byPage[from] = [];
      byPage[from].push(k);
    });

    var found = {};
    var pages = Object.keys(byPage);
    var waiting = pages.length;

    pages.forEach(function (path) {
      var url;
      try { url = new URL(path, location.href).href; } catch (e) { done(); return; }

      fetch(url, { credentials: 'same-origin', headers: { accept: 'text/html' } })
        .then(function (r) { return r.ok ? r.text() : null; })
        .then(function (html) {
          if (!html) return;
          var doc = new DOMParser().parseFromString(html, 'text/html');
          var main = doc.querySelector('main');
          if (!main) return;
          absolutise(main, url);
          byPage[path].forEach(function (k) {
            var el = main.querySelector('.item[data-key="' + CSS.escape(k) + '"]');
            if (el) found[k] = document.importNode(el, true);
          });
        })
        .catch(function () {})
        .then(done);
    });

    function done() {
      if (--waiting > 0) return;
      piles.forEach(function (p) { render(p); });
    }

    function render(p) {
      var bed = document.createElement('div');
      bed.className = 'pile-bed';
      keys.forEach(function (k) {
        var node = found[k];
        if (node) {
          node = node.cloneNode(true);
          node.removeAttribute('id');
          // The coordinates on it are Finder's, for a page this is not.
          node.style.position = 'static';
          node.style.left = '';
          node.style.top = '';
          node.style.zIndex = '';
          node.classList.add('pile-item');
          node.classList.remove('tossed-away');
          bed.appendChild(node);
        } else {
          var miss = document.createElement('p');
          miss.className = 'pile-missing';
          miss.textContent = pileName(k);
          bed.appendChild(miss);
        }
      });
      p.innerHTML = '';
      p.appendChild(bed);
    }
  }

  function escapeText(s) {
    var d = document.createElement('span');
    d.textContent = s;
    return d.innerHTML;
  }

  /**
   * True if the item was left hanging over the side of the page.
   *
   * Only in the garden. That is where the shaft is, and it is the one page
   * where the edge of the screen means something -- everywhere else people
   * shove things to the margins all day long and would lose them. The bin
   * below works everywhere instead. Neither one waits for the crypt to be
   * found: you can throw something away long before you know where it goes.
   */
  function overTheEdge(el) {
    if (document.body.getAttribute('data-scene') !== 'garden') return false;
    var r = el.getBoundingClientRect();
    var mid = r.left + r.width / 2;
    return mid < 6 || mid > window.innerWidth - 6;
  }

  /* ------------------------------------------------------------- the bin
     A bin in the corner of every page. Drag something onto it and it goes
     down the shaft with everything else, whether or not the shaft has been
     dug yet -- throwing a thing away does not require knowing where it
     lands. Press it and, if you have found the bottom, it takes you there.
     ------------------------------------------------------------------- */

  var BIN_SHUT = [' ,---, ', ' |___| ', ' |:::| ', ' |:::| ', " '---' "];
  var BIN_OPEN = ['  /--, ', ' |___| ', ' |:::| ', ' |:::| ', " '---' "];

  function binEl() { return document.getElementById('bin'); }

  /**
   * Is the POINTER over the bin's mouth?
   *
   * The pointer, not the middle of what is being carried: things get
   * picked up by their name, which is at the bottom of them, so asking
   * where the item's centre is would mean aiming a folder's waist at the
   * bin while looking at its feet.
   */
  function overBin(x, y) {
    var bin = binEl();
    if (!bin || bin.hidden) return false;
    var b = bin.getBoundingClientRect();
    return x > b.left - 22 && x < b.right + 22 &&
           y > b.top - 22 && y < b.bottom + 22;
  }

  function paintBin() {
    var bin = binEl();
    if (!bin) return;
    var n = Object.keys(tossedList()).length;
    bin.querySelector('pre').textContent =
      (bin.classList.contains('open') ? BIN_OPEN : BIN_SHUT).join('\n');
    bin.querySelector('.bin-count').textContent = n ? String(n) : '';
    bin.setAttribute('title', n
      ? n + (n === 1 ? ' thing' : ' things') + ' at the bottom of the garden'
      : 'drag anything in here and it goes to the bottom of the garden');
  }

  function mountBin() {
    if (!wide()) return;
    var bin = document.createElement('button');
    bin.id = 'bin';
    bin.type = 'button';
    bin.innerHTML = '<pre aria-hidden="true"></pre><span class="bin-count"></span>';
    bin.setAttribute('aria-label', 'the bin');
    document.body.appendChild(bin);

    bin.addEventListener('click', function () {
      if (secretOpen('crypt')) {
        go(new URL('BOTTOM CRYPT/', siteRoot()).href, true, 0);
        return;
      }
      var n = Object.keys(tossedList()).length;
      toast(n ? 'it all goes somewhere. you have not found where yet.'
              : 'drag something in here');
      play('tick');
    });

    paintBin();
  }

  function tossItem(el) {
    var key = el.dataset.key;
    if (!key) return;
    var t = tossedList();
    // Which page it came off, so the crypt can go and fetch the real thing
    // rather than showing a list of names.
    t[key] = { at: Date.now(), from: noteRoom() };
    set('tossed', t);

    el.classList.add('falling');
    play('rustle');
    setTimeout(function () {
      el.classList.remove('falling');
      el.classList.add('tossed-away');
      paintPile();
      paintBin();
      fitSoon();
    }, 640);
    toast(pileName(key) + ' went down the shaft');
  }
  /* ============================================================= NURSERY
     The sun level is a glasshouse. Thirteen plants, in the ground, growing
     at the speed those plants actually grow at -- a pepper fruits in four
     months and a saguaro does not flower until it is thirty-five, and that
     is how long they take here. There is nothing to click except the plant
     itself, which tells you about itself, including what it smells like.

     Three of them are on a yearly round rather than a one-way journey: a
     pepper is an annual and dies back every autumn, garlic goes in before
     the frost and comes out in July, and a shiitake log flushes every few
     months for years. Those loop. The rest only ever get older.

     Everything is drawn from one date: the first time somebody opened the
     glasshouse. That date survives "put back" -- thirty-five years of a
     saguaro is not the kind of thing anybody should lose by tidying.
     ------------------------------------------------------------------- */

  var DAY_MS = 86400000;
  var YEAR = 365;

  /* days: seed (or planting, or inoculation) to the thing it is famous for.
     cycle: an annual's round, in days -- grow up, hold, die back, begin.  */
  var NURSERY = [
    {
      key: 'pepper', name: 'pepper', latin: 'Capsicum annuum',
      form: 'bush', days: 120, cycle: { round: YEAR, grow: 120, hold: 170 },
      about: 'An annual, and it behaves like one: up from seed in a week, ' +
        'flowering by midsummer, loaded by August, black and finished by the ' +
        'first frost. Everything from a padrón to a habanero is this one ' +
        'species doing different things. The heat is in the pale ribs inside, ' +
        'not in the seeds, which only taste hot because they are touching them.',
      smell: 'A broken pepper leaf is the green in tomato-leaf and blackcurrant ' +
        'bud -- sappy, cold, almost metallic. The fruit itself barely smells ' +
        'until you cut it, and then it is grass and cut stem. Roast one and the ' +
        'whole thing turns to smoke and sweet paper.'
    },
    {
      key: 'garlic', name: 'garlic', latin: 'Allium sativum',
      form: 'bulb', days: 240, cycle: { round: YEAR, grow: 240, hold: 30 },
      about: 'Goes in as a single clove before the ground freezes, sits out the ' +
        'winter, and comes up as one plant with a bulb underneath that is the ' +
        'same clove divided. It has not made viable seed in thousands of years; ' +
        'every head of garlic is a cutting of a cutting. Hardnecks throw a ' +
        'curling scape in June, which you snap off so the bulb keeps the sugar.',
      smell: 'Nothing at all, until it is cut. A whole clove is inert; the ' +
        'moment the cell walls break, an enzyme meets a sulphur compound and ' +
        'makes allicin, and allicin is the smell. It is a wound, chemically ' +
        'speaking. Cooked, that collapses into something sweet and nutty ' +
        'instead -- which is why a whole roasted head is mild and a raw ' +
        'crushed one is not.'
    },
    {
      key: 'shiitake', name: 'shiitake', latin: 'Lentinula edodes',
      form: 'fungus', days: 330, cycle: { round: 120, grow: 22, hold: 16 },
      about: 'Not a plant. A log of oak or shii, drilled, plugged with spawn, ' +
        'and then a year of nothing while the mycelium eats its way through ' +
        'the inside. After that it flushes -- a crop of caps in a week, then ' +
        'months of rest, then another. A good log will keep doing that for ' +
        'five or six years and then be too soft to bother with. Soaking it in ' +
        'cold water shocks it into fruiting.',
      smell: 'Fresh: damp wood, a cellar, the underside of a fallen branch. ' +
        'Dried is a completely different animal -- drying makes lenthionine, ' +
        'which is sulphurous and garlicky and faintly of rubber, and is the ' +
        'reason dried shiitake tastes of so much more than fresh.'
    },
    {
      key: 'pear', name: 'prickly pear', latin: 'Opuntia ficus-indica',
      form: 'opuntia', days: 730,
      about: 'Each flat pad is a stem, not a leaf. It roots wherever a pad ' +
        'falls over, which is why one plant becomes a thicket and why it went ' +
        'feral across half the world. The real defence is not the long spines ' +
        'but the glochids around them -- hair-fine, barbed, and almost ' +
        'impossible to get out of a thumb. The fruit is the tuna.',
      smell: 'The flower is faint and sweet, closer to melon rind than to ' +
        'anything floral. A cut pad smells like a green bean snapped in half. ' +
        'Ripe tuna smells of watermelon and cucumber with something slightly ' +
        'soapy behind it.'
    },
    {
      key: 'jasmine', name: 'jasmine', latin: 'Jasminum grandiflorum',
      form: 'vine', days: 730,
      about: 'A scrambler, not a climber -- it has no tendrils and no suckers, ' +
        'it simply grows long and leans on whatever is there. The flowers open ' +
        'after dark and are picked before dawn, by hand, while they are still ' +
        'shut. It takes something like eight thousand of them to make a gram ' +
        'of absolute, which is why the real thing costs what it costs.',
      smell: 'The most animal of the white flowers. Sweet and narcotic on top, ' +
        'and underneath it there is indole -- the same molecule that makes ' +
        'decay smell the way it does. In small amounts it reads as warm skin. ' +
        'That contradiction is the whole reason jasmine is interesting rather ' +
        'than merely pretty.'
    },
    {
      key: 'gardenia', name: 'gardenia', latin: 'Gardenia jasminoides',
      form: 'shrub', days: 900,
      about: 'Notoriously difficult and worth it. Wants acid soil, humidity, ' +
        'and to be left alone; sulks yellow at the first sign of lime in the ' +
        'water. The flowers open pure white, last about three days, and go ' +
        'apricot-brown at the edges as they die, which somehow makes them ' +
        'better rather than worse.',
      smell: 'Creamy and thick enough to feel like a texture. Underneath the ' +
        'white-flower sweetness there is coconut, a little green banana, and ' +
        'something faintly mushroomy that stops it from being sugary. In a ' +
        'closed room one flower is plenty.'
    },
    {
      key: 'osmanthus', name: 'osmanthus', latin: 'Osmanthus fragrans',
      form: 'shrub', days: 1460,
      about: 'Sweet olive. A dull evergreen for fifty weeks of the year and ' +
        'then, in autumn, it covers itself in flowers so small you have to ' +
        'look for them after you have already smelled them. Picked for tea, ' +
        'for wine, for a syrup that goes on everything. The city of Guilin is ' +
        'named after it.',
      smell: 'Apricot. Unmistakably apricot, from a plant with no relation to ' +
        'one -- ripe, slightly jammy, with leather and black tea behind it. ' +
        'It carries a long way on cool air and arrives in patches, so you keep ' +
        'losing it and finding it again as you walk.'
    },
    {
      key: 'sassafras', name: 'sassafras', latin: 'Sassafras albidum',
      form: 'broadleaf', days: 1825,
      about: 'One tree, three leaf shapes on the same branch: a plain oval, a ' +
        'mitten, and a three-lobed one. Root beer was made from the root bark ' +
        'until safrole was banned; filé powder, which thickens gumbo, is still ' +
        'the dried leaf. Goes a spectacular orange in autumn and suckers into ' +
        'thickets if you let it.',
      smell: 'Scratch the root and it is root beer, exactly and almost ' +
        'comically -- sweet, medicinal, a bit of aniseed and a bit of ' +
        'wintergreen. The crushed leaf is different: citrus-soapy, lemony, ' +
        'closer to a cleaning cupboard than to a drink.'
    },
    {
      key: 'cherry', name: 'cherry blossom', latin: 'Prunus serrulata',
      form: 'broadleaf', days: 2190,
      about: 'Somei Yoshino, the one everybody means, is a single clone ' +
        'propagated by grafting since the nineteenth century -- every tree in ' +
        'every avenue is genetically the same tree, which is why they all open ' +
        'within days of each other. They flower before the leaves come, hold ' +
        'for about a week, and then drop the lot at once.',
      smell: 'Almost nothing. Stand under a tree in full flower and you get ' +
        'the faintest green almond, and most of what people remember is the ' +
        'cold air it happens in. The salted leaf wrapped around sakuramochi is ' +
        'where the famous smell actually lives -- that is coumarin, released ' +
        'by the curing, and it is hay and vanilla and new-mown grass.'
    },
    {
      key: 'bergamot', name: 'bergamot', latin: 'Citrus bergamia',
      form: 'broadleaf', days: 2555,
      about: 'A sour hybrid, probably lemon crossed with bitter orange, grown ' +
        'almost entirely on one strip of the Calabrian coast because it sulks ' +
        'anywhere else. Nobody eats it. The entire point is the peel, which is ' +
        'cold-pressed for oil -- for Earl Grey, for eau de cologne, and as the ' +
        'top note of about half of twentieth-century perfumery.',
      smell: 'The brightest thing in the citrus family and the least sweet. ' +
        'Sharp lemon-lime to start, then a cool floral middle from linalyl ' +
        'acetate that is almost lavender, and a bitter green rind underneath. ' +
        'It is what makes Earl Grey taste like a perfume rather than a fruit.'
    },
    {
      key: 'magnolia', name: 'magnolia', latin: 'Magnolia grandiflora',
      form: 'broadleaf', days: 3650,
      about: 'Older than bees. Magnolias evolved before bees existed, so the ' +
        'flowers are built to be pollinated by beetles -- tough, thick-petalled, ' +
        'no nectar, and the carpels are hard enough to survive being chewed on. ' +
        'The leaves are lacquer-green on top and rust-felted underneath. From ' +
        'seed it will not flower for a decade.',
      smell: 'Lemon and vanilla and cold cream. Big, clean, and a little ' +
        'anaesthetic -- there is a camphor edge that keeps it from being ' +
        'sweet. One flower on a warm evening will scent a whole garden, and up ' +
        'close it is almost too much.'
    },
    {
      key: 'hinoki', name: 'hinoki', latin: 'Chamaecyparis obtusa',
      form: 'conifer', days: 7300,
      about: 'Japanese cypress. The wood is straight-grained, pale, and so rot ' +
        'resistant that the oldest surviving wooden buildings in the world are ' +
        'made of it -- Horyu-ji has been standing on hinoki for thirteen ' +
        'hundred years. Reserved for temples and for baths. The foliage is in ' +
        'flat sprays with white Y-marks on the underside.',
      smell: 'Lemon over cold resin, with something almost soapy-clean. The ' +
        'compound is hinokitiol, which is also why it does not rot. A hinoki ' +
        'bath fills with it as soon as hot water goes in, and a freshly cut ' +
        'board smells of it for years.'
    },
    {
      key: 'saguaro', name: 'saguaro', latin: 'Carnegiea gigantea',
      form: 'columnar', days: 12775,
      about: 'Thirty-five years before the first flower. Fifty to seventy ' +
        'before the first arm, and some never grow one at all. It lives two ' +
        'hundred years, weighs several tonnes when full of water, and pleats ' +
        'like an accordion so it can swell after rain. It grows in exactly one ' +
        'desert and nowhere else on earth. It starts under a nurse tree, in ' +
        'the shade, and usually outlives it.',
      smell: 'The flowers open for one night only and shut by the following ' +
        'afternoon. They smell of overripe melon with a rancid-butter edge -- ' +
        'unpleasant to us and exactly right for the long-nosed bats they are ' +
        'waiting for. The plant itself smells of nothing at all.'
    }
  ];

  var PLANT_W = 19, PLANT_H = 15;

  function blank(w, h) {
    var g = [], r, c;
    for (r = 0; r < h; r++) { g.push([]); for (c = 0; c < w; c++) g[r].push(null); }
    return g;
  }

  function put(g, r, c, ch, cls) {
    if (r < 0 || r >= g.length || c < 0 || c >= g[0].length) return;
    g[r][c] = { ch: ch, cls: cls };
  }

  function pickCh(set, n) { return set.charAt(Math.floor(n * set.length) % set.length); }

  /**
   * A mass of foliage. `shape` bends the ellipse into something that reads
   * as a particular tree rather than as a lollipop: wide and layered for a
   * cherry, tall and tight for a bergamot, low and domed for a shrub.
   */
  function foliage(g, cr, cc, rx, ry, seed, opt) {
    var r, c, dx, dy, d, n, edge;
    var leaf = opt.leaf || 'o&%e';
    var dense = opt.dense === undefined ? 0.46 : opt.dense;
    // At its peak it does not merely flower, it is smothered.
    var at = (opt.flowerAt || 0.80) - (opt.peak ? 0.22 : 0);

    for (r = Math.floor(cr - ry); r <= Math.ceil(cr + ry); r++) {
      for (c = Math.floor(cc - rx); c <= Math.ceil(cc + rx); c++) {
        dx = (c - cc) / (rx || 1);
        dy = (r - cr) / (ry || 1);
        // Weighted so the top of a crown is rounder than the bottom, which
        // is what a canopy hanging over a trunk actually looks like.
        if (dy < 0) dy *= 0.88;
        d = dx * dx + dy * dy;
        if (d > 1) continue;
        n = noise(r + 40, c + 40, seed);
        if (d > dense && n < 0.42) continue;                    // a ragged edge
        edge = d > 0.66;
        if (opt.flower && n > at) {
          put(g, r, c, opt.flowerCh || '*', 'fl');
          continue;
        }
        put(g, r, c, pickCh(leaf, n), n < 0.34 ? 'lg' : edge ? 'ld' : 'lf');
      }
    }
  }

  function trunk(g, fromRow, toRow, mid, wide, seed) {
    var r, lean = 0;
    for (r = fromRow; r >= toRow; r--) {
      if (noise(r, 3, seed) > 0.86) lean += noise(r, 5, seed) > 0.5 ? 1 : -1;
      lean = Math.max(-1, Math.min(1, lean));
      put(g, r, mid + lean, '|', 'bk');
      if (wide) {
        put(g, r, mid + lean - 1, noise(r, 1, seed) > 0.55 ? '#' : '|', 'bd');
        put(g, r, mid + lean + 1, noise(r, 2, seed) > 0.55 ? '#' : '|', 'bd');
      }
    }
    return mid + lean;
  }

  /** Roots flaring where the trunk meets the soil. */
  function flare(g, row, mid, wide) {
    put(g, row, mid - 1, '/', 'bd');
    put(g, row, mid + 1, '\\', 'bd');
    if (wide) {
      put(g, row, mid - 2, '_', 'bd');
      put(g, row, mid + 2, '_', 'bd');
    }
  }

  function plantGrid(spec, t, real, peak) {
    var g = blank(PLANT_W, PLANT_H);
    var mid = Math.floor(PLANT_W / 2);
    var soil = PLANT_H - 1;
    var seed = spec.key.charCodeAt(0) * 7 + spec.key.length;
    var c, r, k, h, top, x, y;

    for (c = 0; c < PLANT_W; c++) {
      put(g, soil, c, noise(9, c, seed) > 0.62 ? '~' : '_', 'so');
    }

    if (t < 0.015) {
      put(g, soil - 1, mid, spec.form === 'fungus' ? '=' : '.', 'bk');
      return g;
    }

    /* ---------------------------------------------------- prickly pear
       Pads, each one a stem, each one leaning off the last. Spines along
       the rim, and the tuna sitting on the top edge when it fruits. */
    if (spec.form === 'opuntia') {
      var pads = 1 + Math.floor(t * 3.4);
      var base = soil - 1, off = 0;
      for (k = 0; k < pads; k++) {
        off = k === 0 ? 0 : off + (k % 2 ? -3 : 3);
        off = Math.max(-5, Math.min(5, off));
        for (r = base - 3; r <= base; r++) {
          for (c = mid + off - 3; c <= mid + off + 3; c++) {
            x = (c - (mid + off)) / 3.2;
            y = (r - (base - 1.5)) / 2.2;
            if (x * x + y * y > 1) continue;
            var nn = noise(r, c, seed + k * 9);
            put(g, r, c, nn > 0.88 ? '*' : nn > 0.5 ? '6' : '%',
                nn > 0.88 ? 'sp' : nn < 0.3 ? 'lg' : 'lf');
          }
        }
        if (real >= 0.85) {
          put(g, base - 4, mid + off - 1, '@', 'fl');
          put(g, base - 4, mid + off + 1, '@', 'fl');
          if (peak) {
            put(g, base - 4, mid + off, '@', 'fl');
            put(g, base - 4, mid + off - 3, '@', 'fl');
            put(g, base - 4, mid + off + 3, '@', 'fl');
            put(g, base - 2, mid + off - 4, '@', 'fl');
            put(g, base - 2, mid + off + 4, '@', 'fl');
          }
        }
        base -= 3;
      }
      return g;
    }

    /* --------------------------------------------------------- saguaro
       A fluted column that swells with water. Arms only after fifty
       years, and they come out sideways before they turn and go up. */
    if (spec.form === 'columnar') {
      h = 1 + Math.round(t * (PLANT_H - 3));
      top = soil - h;
      var wideCol = t > 0.35 ? 2 : t > 0.12 ? 1 : 0;
      for (r = soil - 1; r >= top; r--) {
        for (c = mid - wideCol; c <= mid + wideCol; c++) {
          put(g, r, c, (c - mid) % 2 === 0 ? '|' : ':', 'ca');
        }
      }
      // the crown, rounded over
      for (c = mid - wideCol; c <= mid + wideCol; c++) put(g, top, c, '_', 'ca');
      // arms
      if (t > 0.58) {
        var armRow = soil - Math.round(h * 0.52);
        for (k = 1; k <= 3; k++) put(g, armRow, mid - wideCol - k, '_', 'ca');
        for (k = 0; k < Math.round(h * 0.3); k++) {
          put(g, armRow - k, mid - wideCol - 3, '|', 'ca');
          put(g, armRow - k, mid - wideCol - 4, ':', 'ca');
        }
        if (t > 0.74) {
          var armRow2 = soil - Math.round(h * 0.68);
          for (k = 1; k <= 2; k++) put(g, armRow2, mid + wideCol + k, '_', 'ca');
          for (k = 0; k < Math.round(h * 0.22); k++) {
            put(g, armRow2 - k, mid + wideCol + 2, '|', 'ca');
            put(g, armRow2 - k, mid + wideCol + 3, ':', 'ca');
          }
        }
      }
      if (real >= 0.999) {
        for (c = mid - wideCol; c <= mid + wideCol; c++) put(g, top - 1, c, '*', 'fl');
        /* A saguaro in flower wears a ring of them right round the rim,
           and every arm gets its own. It waited thirty-five years. */
        if (peak) {
          put(g, top - 1, mid - wideCol - 1, '*', 'fl');
          put(g, top - 1, mid + wideCol + 1, '*', 'fl');
          put(g, top - 2, mid, '*', 'fl');
          put(g, top, mid - wideCol - 1, '*', 'fl');
          put(g, top, mid + wideCol + 1, '*', 'fl');
          if (t > 0.58) {
            var aTop = soil - Math.round(h * 0.52) - Math.round(h * 0.3);
            put(g, aTop - 1, mid - wideCol - 4, '*', 'fl');
            put(g, aTop - 1, mid - wideCol - 3, '*', 'fl');
          }
          if (t > 0.74) {
            var aTop2 = soil - Math.round(h * 0.68) - Math.round(h * 0.22);
            put(g, aTop2 - 1, mid + wideCol + 2, '*', 'fl');
            put(g, aTop2 - 1, mid + wideCol + 3, '*', 'fl');
          }
        }
      }
      return g;
    }

    /* ---------------------------------------------------------- hinoki
       A cone of flat sprays, densest low down, with a straight leader
       going out of the top of it. */
    if (spec.form === 'conifer') {
      h = 2 + Math.round(t * (PLANT_H - 4));
      top = soil - h;
      for (r = top; r < soil; r++) {
        var down = r - top;
        var half = Math.min(6, Math.round(down * 0.55));
        for (c = mid - half; c <= mid + half; c++) {
          var m = noise(r, c, seed);
          if (Math.abs(c - mid) === half && m < 0.4) continue;
          put(g, r, c, c === mid ? '|' : (c < mid ? '/' : '\\'),
              m < 0.4 ? 'lg' : 'lf');
          if (m > 0.86 && Math.abs(c - mid) < half) put(g, r, c, '&', 'ld');
        }
      }
      put(g, top - 1, mid, '^', 'lg');
      if (peak) {
        // Cones. A cypress does not flower; this is what it has instead.
        for (r = top + 2; r < soil - 1; r++) {
          var dn = r - top;
          var hf = Math.min(6, Math.round(dn * 0.55));
          if (noise(r, 21, seed) > 0.52) put(g, r, mid - hf, 'o', 'fl');
          if (noise(r, 23, seed) > 0.52) put(g, r, mid + hf, 'o', 'fl');
        }
      }
      flare(g, soil - 1, mid, h > 7);
      return g;
    }

    /* ---------------------------------------------------------- garlic
       A bulb sitting in the soil line with straps fanning out of it, and
       a scape curling over the top once it is nearly ready. */
    if (spec.form === 'bulb') {
      put(g, soil - 1, mid - 1, '(', 'bu');
      put(g, soil - 1, mid, t > 0.5 ? '@' : 'o', 'bu');
      put(g, soil - 1, mid + 1, ')', 'bu');
      if (t > 0.6) {
        put(g, soil, mid - 2, '(', 'bu');
        put(g, soil, mid - 1, '|', 'bu');
        put(g, soil, mid, '|', 'bu');
        put(g, soil, mid + 1, '|', 'bu');
        put(g, soil, mid + 2, ')', 'bu');
      }
      /* Straps. Garlic leaves come off the neck alternately and arch over
         as they lengthen, so each one leans a little further out than the
         last and the tip of a long one is nearly horizontal. */
      var straps = 3 + Math.round(t * 4);
      for (k = 0; k < straps; k++) {
        var dir = k % 2 ? 1 : -1;
        var lean = 0.10 + Math.ceil((k + 1) / 2) * 0.30;
        var len = Math.max(2, Math.round((2 + t * 9) * (1 - k * 0.07)));
        var drift = 0;
        for (y = 0; y < len; y++) {
          // arching: barely leaning at the base, falling away at the tip
          drift += lean * (y / len) * 1.7;
          x = mid + dir * Math.round(drift);
          put(g, soil - 2 - y, x,
              y > len - 3 ? (dir > 0 ? '\\' : '/') : (drift > 1.2 ? (dir > 0 ? '\\' : '/') : '|'),
              y > len - 3 ? 'ld' : 'lf');
        }
      }
      if (t >= 0.82) {                       // the scape, curling
        var sc = soil - 2 - Math.round(2 + t * 8);
        put(g, sc, mid, '|', 'lg');
        put(g, sc - 1, mid, ')', 'lg');
        put(g, sc - 1, mid + 1, '\\', 'lg');
        put(g, sc, mid + 2, 'o', 'fl');
        if (peak) {
          put(g, sc - 1, mid + 2, '*', 'fl');
          put(g, sc, mid + 3, '*', 'fl');
          put(g, sc + 1, mid + 2, '*', 'fl');
        }
      }
      return g;
    }

    /* ---------------------------------------------------------- pepper
       A short woody stem and a mound of leaves, with the fruit hanging
       DOWN out of the bottom of it, which is how you know it is a
       pepper and not a tomato. */
    if (spec.form === 'bush') {
      var stem = Math.max(1, Math.round(t * 3));
      for (r = soil - 1; r > soil - 1 - stem; r--) put(g, r, mid, '|', 'bk');
      var cy = soil - 1 - stem - Math.round(1 + t * 2.5);
      foliage(g, cy, mid, 2.2 + t * 4.2, 1.4 + t * 2.6, seed,
              { leaf: 'oe&c', dense: 0.5, flower: real > 0.55 && real < 0.8,
                flowerCh: '*', flowerAt: 0.88, peak: peak });
      if (real >= 0.78) {
        var hang = peak ? [[-3, 1], [2, 2], [0, 3], [-1, 2], [4, 1], [-5, 2], [3, 3], [1, 1]]
                        : [[-3, 1], [2, 2], [0, 3], [-1, 2], [4, 1]];
        for (k = 0; k < hang.length; k++) {
          if (!peak && k / hang.length > (real - 0.78) / 0.22 + 0.2) break;
          x = mid + hang[k][0];
          y = cy + Math.round(1.4 + t * 2.6) - 1 + hang[k][1];
          put(g, y, x, 'v', 'fr');
          put(g, y + 1, x, 'V', 'fr');
        }
      }
      return g;
    }

    /* -------------------------------------------------------- shiitake
       A log, always. The caps come and go; the log stays for years. */
    if (spec.form === 'fungus') {
      // The log: bark on top, a cut end each side, and it is always there.
      for (c = 2; c < PLANT_W - 2; c++) {
        put(g, soil - 1, c, noise(0, c, seed) > 0.62 ? '=' : '-', 'bk');
        put(g, soil - 2, c, noise(1, c, seed) > 0.7 ? '"' : '_', 'bd');
      }
      put(g, soil - 1, 1, '(', 'bd');
      put(g, soil - 2, 1, '/', 'bd');
      put(g, soil - 1, PLANT_W - 2, ')', 'bd');
      put(g, soil - 2, PLANT_W - 2, '\\', 'bd');

      /* A flush, on top of the log. Each cap is a dome on a short stipe,
         and they are spaced far enough apart not to run into one another
         -- a row of merged brackets reads as a fence, not as mushrooms. */
      var spots = [4, 9, 14, 6, 12, 16];
      var caps = peak ? spots.length : Math.min(spots.length, Math.round(t * 6));
      var big = peak || t > 0.6;
      for (k = 0; k < caps; k++) {
        x = spots[k];
        put(g, soil - 4, x, '_', 'cp');
        if (big) {
          put(g, soil - 4, x - 1, '_', 'cp');
          put(g, soil - 4, x + 1, '_', 'cp');
          put(g, soil - 3, x - 2, '(', 'cp');
          put(g, soil - 3, x - 1, '_', 'cp');
          put(g, soil - 3, x, '_', 'cp');
          put(g, soil - 3, x + 1, '_', 'cp');
          put(g, soil - 3, x + 2, ')', 'cp');
        } else {
          put(g, soil - 3, x - 1, '(', 'cp');
          put(g, soil - 3, x, '_', 'cp');
          put(g, soil - 3, x + 1, ')', 'cp');
        }
        put(g, soil - 2, x, '|', 'st');
      }
      return g;
    }

    /* ---------------------------------------------------------- jasmine
       No tendrils and no suckers -- it simply grows long and leans on
       whatever is standing there, so it gets something to lean on. */
    if (spec.form === 'vine') {
      for (r = soil - 1; r >= soil - 1 - Math.round(t * 11); r--) {
        put(g, r, mid - 4, ':', 'bd');
        put(g, r, mid + 4, ':', 'bd');
        if ((soil - r) % 4 === 0) {
          for (c = mid - 4; c <= mid + 4; c++) put(g, r, c, '-', 'bd');
        }
      }
      var col = mid;
      var reach = Math.round(t * 11);
      for (y = 0; y <= reach; y++) {
        r = soil - 1 - y;
        put(g, r, col, y % 3 === 0 ? '/' : '|', 'bk');
        if (noise(r, 3, seed) > 0.5) put(g, r, col - 1, 'e', 'lf');
        if (noise(r, 7, seed) > 0.5) put(g, r, col + 1, 'e', 'lf');
        if (noise(r, 9, seed) > 0.72) put(g, r, col - 2, '&', 'lg');
        if (noise(r, 11, seed) > 0.72) put(g, r, col + 2, '&', 'lg');
        if (real >= 0.8 && noise(r, 13, seed) > (peak ? 0.48 : 0.78)) {
          put(g, r, col + (noise(r, 15, seed) > 0.5 ? 3 : -3), '*', 'fl');
        }
        if (noise(r, 17, seed) > 0.68) col += noise(r, 19, seed) > 0.5 ? 1 : -1;
        col = Math.max(mid - 3, Math.min(mid + 3, col));
      }
      return g;
    }

    /* -------------------------------------------------- shrub and tree */
    var shrub = spec.form === 'shrub';
    var reachRows = 1 + Math.round(t * (PLANT_H - 4));
    var stemTop = Math.round(soil - 1 - reachRows * (shrub ? 0.34 : 0.55));
    var thick = t > 0.55;
    var tip = trunk(g, soil - 1, stemTop, mid, thick, seed);
    if (thick) flare(g, soil - 1, mid, reachRows > 8);

    // Branches, once there is a trunk long enough to hang them off.
    if (!shrub && reachRows > 7) {
      for (k = 0; k < 2; k++) {
        r = stemTop + 1 + k * 2;
        var dir2 = k % 2 ? 1 : -1;
        for (c = 1; c <= 2 + k; c++) put(g, r - c, tip + dir2 * c, dir2 > 0 ? '/' : '\\', 'bd');
      }
    }

    var shape = {
      magnolia:  { rx: 1.9 + t * 4.6, ry: 1.2 + t * 3.4, leaf: 'OQ0o', dense: 0.60, fch: '@', fat: 0.86 },
      cherry:    { rx: 2.4 + t * 6.2, ry: 1.0 + t * 2.0, leaf: 'oe%c', dense: 0.40, fch: 'o', fat: 0.52 },
      bergamot:  { rx: 1.8 + t * 3.6, ry: 1.4 + t * 3.2, leaf: 'oe&o', dense: 0.58, fch: '@', fat: 0.84 },
      sassafras: { rx: 2.2 + t * 4.8, ry: 1.2 + t * 2.8, leaf: 'YoeV', dense: 0.34, fch: '&', fat: 0.80 },
      osmanthus: { rx: 2.6 + t * 4.4, ry: 1.4 + t * 2.4, leaf: 'e&oe', dense: 0.66, fch: '.', fat: 0.55 },
      gardenia:  { rx: 2.6 + t * 4.0, ry: 1.4 + t * 2.2, leaf: 'OoQe', dense: 0.62, fch: '@', fat: 0.86 }
    }[spec.key] || { rx: 2 + t * 4, ry: 1.2 + t * 2.6, leaf: 'oe&%', dense: 0.5, fch: '*', fat: 0.8 };

    foliage(g, stemTop - Math.round(shape.ry * 0.55), tip, shape.rx, shape.ry, seed, {
      leaf: shape.leaf,
      dense: shape.dense,
      flower: real >= (spec.key === 'sassafras' ? 0.55 : 0.8),
      flowerCh: shape.fch,
      flowerAt: shape.fat,
      peak: peak
    });
    return g;
  }

  function gridHtml(g) {
    var html = '', r, c, cell, run = '', runCls = null;
    function flush() {
      if (!run) return;
      html += runCls ? '<span class="' + runCls + '">' + run + '</span>' : run;
      run = '';
    }
    for (r = 0; r < g.length; r++) {
      for (c = 0; c < g[r].length; c++) {
        cell = g[r][c];
        var cls = cell ? cell.cls : null;
        if (cls !== runCls) { flush(); runCls = cls; }
        run += cell ? cell.ch : ' ';
      }
      flush(); runCls = null;
      if (r !== g.length - 1) html += '\n';
    }
    return html;
  }

  /** "4 years 2 months", "11 days", "today" -- never a number of seconds. */
  function spanWords(ms) {
    if (ms <= 0) return 'now';
    var d = ms / DAY_MS;
    if (d < 1) return 'today';
    if (d < 45) return Math.round(d) + (Math.round(d) === 1 ? ' day' : ' days');
    var years = Math.floor(d / 365);
    var months = Math.round((d - years * 365) / 30.44);
    if (months === 12) { years++; months = 0; }
    var out = [];
    if (years) out.push(years + (years === 1 ? ' year' : ' years'));
    if (months) out.push(months + (months === 1 ? ' month' : ' months'));
    return out.join(' ') || 'a month';
  }

  /* When it was planted, plus how far each plant has been pushed forward by
     hand. Kept together, and kept out of "put back" -- thirty-five years of
     a saguaro is not something anybody should lose by tidying a desk. */
  function nurseryBook() {
    var n = get('nursery', null);
    if (!n || typeof n.started !== 'number') n = { started: Date.now() };
    if (!n.push || typeof n.push !== 'object') n.push = {};
    set('nursery', n);
    return n;
  }

  var PUSH_MS = 12 * 3600 * 1000;      // half a day, per press

  /**
   * Where a plant is today: how grown it looks, and what to say about it.
   *
   * A perennial only ever gets older. An annual goes round: up over `grow`
   * days, held for `hold`, then back down to bare ground and round again
   * -- so the pepper really is empty every winter and the garlic really is
   * out of the ground from July until the frost.
   */
  /* What a plant does when it arrives.

     Nothing here stands at its peak forever. Once it is fully grown it
     holds -- in full flower, in fruit, at its very best and drawn that way
     -- for a twentieth of however long it took to get there, and then it
     goes back to being a seed and does the whole thing again. A pepper
     stands for six days, a magnolia for six months, a saguaro for nearly
     two years. The ratio is the same for all of them, which is why it
     reads as one rule and not as thirteen exceptions.

     Annuals keep their own seasons, which are already a round: the pepper
     dies back for the winter, the garlic comes out of the ground in July,
     the log rests between flushes. */
  var PEAK_SHARE = 20;              // it holds for a twentieth of its growing

  /* What each one is actually doing when it gets there. A cypress does not
     flower, and what anybody goes to look at a sassafras for is October. */
  var PEAK_WORD = {
    pear: 'in fruit', bergamot: 'in fruit',
    hinoki: 'in cone', sassafras: 'in autumn colour'
  };

  function ordinal(n) {
    var tens = n % 100, ones = n % 10;
    var suffix = (tens >= 11 && tens <= 13) ? 'th'
               : ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th';
    return n + suffix;
  }

  function plantState(spec, started, now, push) {
    var age = Math.max(0, now - started + (push || 0));

    if (!spec.cycle) {
      var span = spec.days * DAY_MS;
      var hold = span / PEAK_SHARE;
      var round = span + hold;
      var into = age % round;
      var lap = Math.floor(age / round) + 1;
      if (into < span) {
        return {
          t: into / span, ripe: false, glory: false, round: lap,
          say: spanWords(span - into) + ' to go'
        };
      }
      return {
        t: 1, ripe: true, glory: true, round: lap,
        say: (PEAK_WORD[spec.key] || 'in full flower') +
             ' — ' + spanWords(round - into) + ' left'
      };
    }

    var cy = spec.cycle;
    var cround = cy.round * DAY_MS;
    var cinto = ((age % cround) + cround) % cround;
    var day = cinto / DAY_MS;
    var year = Math.floor(age / cround) + 1;

    if (day < cy.grow) {
      return { t: day / cy.grow, ripe: false, glory: false, round: year,
               say: spanWords((cy.grow - day) * DAY_MS) + ' to crop' };
    }
    if (day < cy.grow + cy.hold) {
      return { t: 1, ripe: true, glory: true, round: year,
               say: (spec.form === 'fungus' ? 'flushing' : 'cropping') +
                    ' — ' + spanWords((cy.grow + cy.hold - day) * DAY_MS) + ' left' };
    }
    var fade = (cy.round - cy.grow - cy.hold);
    var gone = (day - cy.grow - cy.hold) / fade;
    return { t: Math.max(0, 1 - gone), ripe: false, glory: false, round: year,
             say: spanWords((cy.round - day) * DAY_MS) + ' until it starts again' };
  }

  /**
   * The glasshouse itself, built into whatever is handed to it -- the room
   * above the garden, or the SUN LEVEL folder's own page. Both are the
   * same plants on the same clock.
   */
  function mountNursery(host) {
    if (!host) return;
    var book = nurseryBook();
    var started = book.started;

    function pushOf(key) { return book.push[key] || 0; }

    var wrap = document.createElement('div');
    wrap.className = 'nursery';
    host.appendChild(wrap);

    var card = document.createElement('div');
    card.className = 'plant-card';
    card.hidden = true;
    host.appendChild(card);

    var open = null;

    function shut() {
      open = null;
      card.hidden = true;
      beds.forEach(function (b) { b.el.classList.remove('open'); });
    }

    function show(b, again) {
      // Pressing the same plant twice closes it -- unless this is a redraw,
      // which is what `again` means.
      if (open === b.spec.key && !again) { shut(); return; }
      open = b.spec.key;
      beds.forEach(function (x) { x.el.classList.toggle('open', x === b); });

      var st = plantState(b.spec, started, Date.now(), pushOf(b.spec.key));
      var age = spanWords(Date.now() - started + pushOf(b.spec.key));
      var pushed = pushOf(b.spec.key);
      card.className = 'plant-card p-' + b.spec.key + (st.glory ? ' at-peak' : '');
      card.innerHTML =
        '<button class="plant-shut" type="button" aria-label="close">&times;</button>' +
        '<h3>' + b.spec.name + '</h3>' +
        '<p class="card-latin">' + b.spec.latin + '</p>' +
        (st.glory ? '<p class="card-peak">at its peak — ' + st.say + '</p>' : '') +
        '<p class="card-about">' + b.spec.about + '</p>' +
        '<p class="card-smell"><b>what it smells like</b> ' + b.spec.smell + '</p>' +
        '<p class="card-age">' +
          (b.spec.cycle ? 'season ' + st.round + ' in this glasshouse'
                        : 'in the ground ' + age +
                          (st.round > 1 ? '  ·  its ' + ordinal(st.round) + ' time round' : '')) +
          '  ·  ' + st.say +
          (pushed ? '  ·  hurried along by ' + spanWords(pushed) : '') + '</p>';
      card.hidden = false;
      card.querySelector('.plant-shut').addEventListener('click', shut);
      if (again) return;
      if (card.scrollIntoView) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      play('tick');
    }

    /* A plant is not a button. It holds two: the plant itself, which tells
       you about itself, and a small one underneath that hurries it along
       -- and a button inside a button is not a thing a browser will build. */
    var beds = NURSERY.map(function (spec) {
      var bed = document.createElement('div');
      bed.className = 'plant p-' + spec.key;
      bed.innerHTML =
        '<button class="plant-face" type="button">' +
          '<span class="plant-pot">' +
            '<pre class="plant-art" role="img" aria-label="' + spec.name + '"></pre>' +
          '</span>' +
          '<span class="plant-name">' + spec.name + '</span>' +
          '<span class="plant-latin">' + spec.latin + '</span>' +
        '</button>' +
        '<span class="plant-bar"><i></i></span>' +
        '<span class="plant-when"></span>' +
        '<button class="plant-push" type="button">+12 hours</button>';
      wrap.appendChild(bed);

      var b = { spec: spec, el: bed,
                art: bed.querySelector('.plant-art'),
                fill: bed.querySelector('.plant-bar i'),
                when: bed.querySelector('.plant-when') };

      bed.querySelector('.plant-face').addEventListener('click', function () { show(b); });

      /* Half a day at a time, for this plant only. It is the real clock
         that is being wound on, so a pepper feels it immediately and a
         saguaro barely notices -- which is exactly right. */
      bed.querySelector('.plant-push').addEventListener('click', function () {
        book.push[spec.key] = pushOf(spec.key) + PUSH_MS;
        set('nursery', book);
        bed.classList.add('hurried');
        setTimeout(function () { bed.classList.remove('hurried'); }, 420);
        play('rustle');
        paint();
        if (open === spec.key) show(b, true);      // redraw the open card
      });

      return b;
    });

    function paint() {
      var now = Date.now();
      beds.forEach(function (b) {
        var st = plantState(b.spec, started, now, pushOf(b.spec.key));
        // The bar and the words stay honest; only the drawing is bent, so
        // that a seed is a visible seedling inside a month instead of being
        // a full stop for its first seventy days.
        b.art.innerHTML = gridHtml(plantGrid(b.spec, Math.pow(st.t, 0.42), st.t, st.glory));
        b.fill.style.width = (st.t * 100).toFixed(2) + '%';
        b.el.classList.toggle('grown', st.ripe);
        b.el.classList.toggle('glory', !!st.glory);
        b.when.textContent = st.say;
      });
    }

    paint();
    // A magnolia does not need watching closely. Twice a minute is already
    // far more often than anything here can visibly change.
    sceneTimers.push(setInterval(function () { if (!document.hidden) paint(); }, 30000));
    window.addEventListener('resize', paint);
  }

  /** The SUN LEVEL folder opened directly, rather than climbed up into. */
  function mountNurseryScene() {
    sceneOn = 'nursery';
    sceneTone = 'nursery';

    var scene = document.createElement('div');
    scene.id = 'scene';
    scene.className = 'glass';
    scene.setAttribute('aria-hidden', 'true');
    scene.innerHTML = '<pre id="sunbeam"></pre><div id="glassfloor"></div>';
    document.body.appendChild(scene);

    var beam = document.getElementById('sunbeam');
    function paintBeam() {
      var w = Math.ceil(window.innerWidth / 6.7), rows = 5, out = '', r, c, n;
      for (r = 0; r < rows; r++) {
        for (c = 0; c < w; c++) {
          n = noise(r, c, 55);
          out += n > 0.93 ? '\\' : n > 0.88 ? '|' : n > 0.85 ? '/' : ' ';
        }
        if (r !== rows - 1) out += '\n';
      }
      beam.textContent = out;
    }
    paintBeam();
    window.addEventListener('resize', paintBeam);

    var house = document.createElement('section');
    house.className = 'glasshouse';
    house.innerHTML = '<h2>the glasshouse</h2>' +
      '<p class="glass-say">thirteen plants, in the ground, growing at the speed ' +
      'they really grow at. every one of them holds at its peak for a twentieth ' +
      'of the time it took to get there, and then starts again. press one and ' +
      'it will tell you about itself.</p>';
    var main = document.querySelector('main');
    if (main) main.appendChild(house);
    sceneNodes.push(house);
    mountNursery(house);

    ambience('nursery');
  }

  /* =============================================================== OCEAN
     Found by clicking the photograph of the sea five times, which is what
     anybody does with a photograph of the sea.

     Down here the man on the pogo stick stops bouncing. There is nothing
     to push off, so he swims: he paddles towards the cursor in both
     directions at once, the water drags at him, and when nobody is
     pointing anywhere he sinks, very slowly. See pogoSwim.
     ------------------------------------------------------------------- */

  var FISH = [
    { art: '><>',        depth: 0.30, speed: 34 },
    { art: '<><',        depth: 0.52, speed: -26 },
    { art: '>=<',        depth: 0.68, speed: 19 },
    { art: '><>',        depth: 0.44, speed: -41 },
    { art: '}-{><',      depth: 0.78, speed: 14 },
    { art: '><>',        depth: 0.86, speed: -22 }
  ];

  function mountOcean() {
    sceneOn = 'ocean';
    sceneTone = 'ocean';

    var scene = document.createElement('div');
    scene.id = 'scene';
    scene.className = 'sea';
    scene.setAttribute('aria-hidden', 'true');
    scene.innerHTML =
      '<pre id="surface"></pre>' +
      '<pre id="shafts"></pre>' +
      '<div id="shoal"></div>' +
      '<div id="bubbles"></div>' +
      '<pre id="seabed"></pre>';
    document.body.appendChild(scene);

    var surface = document.getElementById('surface');
    var shafts = document.getElementById('shafts');
    var shoal = document.getElementById('shoal');
    var bubbles = document.getElementById('bubbles');
    var seabed = document.getElementById('seabed');

    /* ----------------------------------------------------- the surface
       Two lines of swell, moving at different speeds so the water never
       repeats on itself as obviously as one line would. */

    var phase = 0;
    function paintSurface() {
      var w = Math.ceil(window.innerWidth / 6.7) + 2;
      var a = '', b = '', c, h;
      for (c = 0; c < w; c++) {
        h = Math.sin(c * 0.22 + phase) + Math.sin(c * 0.09 - phase * 0.6);
        a += h > 1.1 ? '~' : h > 0.2 ? '^' : h > -0.7 ? '~' : '-';
        h = Math.sin(c * 0.31 - phase * 1.4) + Math.sin(c * 0.13 + phase * 0.3);
        b += h > 0.9 ? '~' : h > -0.4 ? '-' : ' ';
      }
      surface.textContent = a + '\n' + b;
    }

    function paintShafts() {
      var w = Math.ceil(window.innerWidth / 6.7);
      var rows = 14, out = '', r, c, n;
      for (r = 0; r < rows; r++) {
        for (c = 0; c < w; c++) {
          n = noise(0, c, 61);
          out += (n > 0.955 && r < rows - 2) ? '\\' : n > 0.93 ? '|' : ' ';
        }
        if (r !== rows - 1) out += '\n';
      }
      shafts.textContent = out;
    }

    function paintBed() {
      var w = Math.ceil(window.innerWidth / 6.7);
      var a = '', b = '', c, n;
      for (c = 0; c < w; c++) {
        n = noise(0, c, 63);
        a += n > 0.94 ? 'Y' : n > 0.88 ? 'o' : n > 0.8 ? ',' : '.';
        b += n > 0.7 ? '_' : '.';
      }
      seabed.textContent = a + '\n' + b;
    }

    /* ---------------------------------------------------------- fish
       Each one crosses the whole window at its own pace and comes back
       round the other side. They do not react to anything; they are
       weather, not company. */

    var swimmers = FISH.map(function (f) {
      var el = document.createElement('pre');
      el.className = 'fish' + (f.speed < 0 ? ' back' : '');
      el.textContent = f.art;
      el.style.top = (f.depth * 100) + '%';
      shoal.appendChild(el);
      return { el: el, x: Math.random() * window.innerWidth, spec: f };
    });

    var bubbleSeed = 0;
    function blow() {
      var b = document.createElement('i');
      b.className = 'bubble';
      b.textContent = ['o', '°', '.', 'O'][bubbleSeed++ % 4];
      b.style.left = (4 + Math.random() * 92) + '%';
      b.style.animationDuration = (5 + Math.random() * 5).toFixed(1) + 's';
      bubbles.appendChild(b);
      setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 11000);
    }

    paintSurface(); paintShafts(); paintBed();
    window.addEventListener('resize', paintShafts);
    window.addEventListener('resize', paintBed);

    sceneTimers.push(setInterval(function () {
      if (document.hidden) return;
      phase += 0.22;
      paintSurface();
      var w = window.innerWidth;
      swimmers.forEach(function (s) {
        s.x += s.spec.speed * 0.12;
        if (s.x > w + 60) s.x = -60;
        if (s.x < -60) s.x = w + 60;
        s.el.style.transform = 'translateX(' + Math.round(s.x) + 'px)';
      });
    }, 120));

    sceneTimers.push(setInterval(function () { if (!document.hidden) blow(); }, 1400));

    pogoSwim(true);
    ambience('ocean');
  }

  /* ------------------------------------------------ the sea, three clicks
     One photograph on the front page is of the sea. Click it five times
     and it lets you in -- and it is the one picture on the site that will
     not open, because a photograph that showed you a big version of itself
     on the first click would never be tried a second time. */

  var SEA_PHOTO = 'IMG_3427.JPG';
  var SEA_CLICKS = 5;

  function mountSeaDoor() {
    var item = document.querySelector('.item[data-key="' + CSS.escape(SEA_PHOTO) + '"]');
    if (!item) return;
    item.classList.add('sea-photo');

    var hits = 0, timer = 0;

    /* Capture, and preventDefault on every click. The viewer listens on the
       document in the bubble phase and bails on a prevented event, so this
       is the one photograph on the site that never opens -- which is the
       whole point. A picture that showed you a big version of itself on the
       first click would never be tried a second time, let alone a third. */
    item.addEventListener('click', function (e) {
      e.preventDefault();

      hits++;
      clearTimeout(timer);
      timer = setTimeout(function () { hits = 0; item.classList.remove('rippling'); }, 1800);
      if (hits < SEA_CLICKS) {
        item.classList.add('rippling');
        play('tick');
        return;
      }
      hits = 0;
      item.classList.remove('rippling');
      if (!secretOpen('ocean')) {
        openSecret('ocean', false);
        toast('the sea');
      }
      play('rustle');
      setTimeout(function () { go(new URL('THE OCEAN/', siteRoot()).href, true, 0); }, 420);
    }, true);
  }

  /* =============================================================== CRYPT
     The bottom of the garden. It is dug, not found: sixty turns of a spade
     at the foot of the page, and then the floor gives way the same way the
     roof did. What is down here is whatever has been thrown down here.
     ------------------------------------------------------------------- */

  var DIG_CLICKS = 60;
  var SPADE = ['  __  ', ' |  | ', ' |__| ', '  ||  ', '  ||  '];

  function cryptRoom(host, heading) {
    host.innerHTML =
      '<pre class="crypt-bricks" aria-hidden="true"></pre>' +
      '<div class="crypt-inner">' +
        '<pre class="crypt-lamp" aria-hidden="true">' +
          '  .-.  \n (   ) \n  `|\'  \n   |   ' + '</pre>' +
        '<h2>' + heading + '</h2>' +
        '<p class="crypt-say">nothing down here is deleted. it is only down here.</p>' +
        '<div class="crypt-pile"></div>' +
      '</div>';

    var bricks = host.querySelector('.crypt-bricks');
    function paintBricks() {
      var w = Math.ceil(window.innerWidth / 6.7);
      var rows = 22, out = '', r, c, n;
      for (r = 0; r < rows; r++) {
        for (c = 0; c < w; c++) {
          n = noise(r, c, 77);
          if ((c + (r % 2) * 5) % 10 === 0) out += '|';
          else if (r % 3 === 0) out += '_';
          else out += n > 0.94 ? '.' : n > 0.9 ? ',' : ' ';
        }
        if (r !== rows - 1) out += '\n';
      }
      bricks.textContent = out;
    }
    paintBricks();
    window.addEventListener('resize', paintBricks);
    paintPile();
  }

  /** The BOTTOM CRYPT folder opened directly. */
  function mountCrypt() {
    sceneOn = 'crypt';
    sceneTone = 'crypt';

    var scene = document.createElement('div');
    scene.id = 'scene';
    scene.className = 'tomb';
    scene.setAttribute('aria-hidden', 'true');
    document.body.appendChild(scene);

    var room = document.createElement('section');
    room.className = 'crypt-room';
    var main = document.querySelector('main');
    if (main) main.appendChild(room);
    sceneNodes.push(room);
    cryptRoom(room, 'the heap');

    ambience('crypt');
  }

  /* ================================================================= BAR
     A basement somewhere, six seats, a record on, rain outside that has
     been going on for hours. Nobody comes in. The bartender does not talk
     unless you do. There is a cat, some of the time.
     ------------------------------------------------------------------- */

  var BOTTLES = [
    ' /^\\ ', ' |=| ', ' /"\\ ', ' |_| ', ' /~\\ ', ' |o| ', ' /-\\ '
  ];

  /* The cat does not do one thing. It sits, it loafs, it lies flat out, it
     turns its back on the room, it washes, and every so often it is simply
     not there -- and when it comes back it is somewhere else, doing
     something else, and nobody saw it move. That is the whole of it. */
  var CAT_POSES = [
    // sitting up, tail curled round
    ['   /\\_/\\    ',
     '  ( o.o )   ',
     '   > ^ <    ',
     '  (")_(")   '],
    // loafed: paws folded under, eyes shut
    ['            ',
     '   /\\_/\\    ',
     '  ( -.- )   ',
     ' (________) '],
    // flat out on its side, tail out behind
    ['            ',
     '            ',
     '   /\\_/\\    ',
     ' _( o.o )__~'],
    // back turned, tail up
    ['     |      ',
     '    /\\ /\\   ',
     '   (     )  ',
     '    ^   ^   '],
    // washing a back leg
    ['      |     ',
     '   /\\_/\\|   ',
     '  ( o.o )   ',
     '   >(_)<    '],
    // asleep, curled, dreaming of something
    ['        z   ',
     '     z      ',
     '   ,-.-.    ',
     '  ( -.- )   ']
  ];

  /* Two things get said in this bar.

     The first is a line from somebody who wrote in Japanese. Everything
     here is old enough to be out of copyright -- Bashō, Buson, Issa,
     Ryōkan, Sei Shōnagon, Kenkō, Kamo no Chōmei, Sōseki, Akutagawa,
     Santōka, Dazai -- and kept to the length of something a person would
     actually say out loud at a bar. The living ones are in the second
     list instead, as facts about them, which is the honest way to have
     Murakami in a bar without borrowing his sentences.

     The second is a fact about something you might be drinking. Not
     "wine is made from grapes" -- the kind of thing the person behind
     the counter tells you at one in the morning because you asked. */

  var BAR_QUOTES = [
    { t: 'An old pond. A frog jumps in. The sound of water.', by: 'Bashō' },
    { t: 'The moon and the sun are travellers of a hundred generations.', by: 'Bashō' },
    { t: 'In this world we walk on the roof of hell, gazing at flowers.', by: 'Issa' },
    { t: 'Snail, climb Mount Fuji — but slowly, slowly.', by: 'Issa' },
    { t: 'Lighting one candle with another candle. Spring evening.', by: 'Buson' },
    { t: 'The thief left it behind: the moon at the window.', by: 'Ryōkan' },
    { t: 'Are we to look at cherry blossoms only in full bloom?', by: 'Kenkō' },
    { t: 'The most precious thing in life is its uncertainty.', by: 'Kenkō' },
    { t: 'In spring, the dawn.', by: 'Sei Shōnagon' },
    { t: 'Things that make one’s heart beat faster: sparrows feeding their young.', by: 'Sei Shōnagon' },
    { t: 'The flow of the river is ceaseless, and its water is never the same.', by: 'Kamo no Chōmei' },
    { t: 'I am a cat. As yet I have no name.', by: 'Sōseki' },
    { t: 'Approach everything rationally and you become harsh.', by: 'Sōseki' },
    { t: 'Human life is more hell than hell itself.', by: 'Akutagawa' },
    { t: 'Mine has been a life of much shame.', by: 'Dazai' },
    { t: 'No road but this one. I walk alone.', by: 'Santōka' },
    { t: 'Even in Kyoto, hearing the cuckoo, I long for Kyoto.', by: 'Bashō' },
    { t: 'The autumn wind: for me there is no god, there is no Buddha.', by: 'Santōka' }
  ];

  /* The other half of the shelf: writers from everywhere else, on the three
     things people actually talk about at a bar after midnight -- whether
     anyone is really in there, whether any of this makes us happy, and what
     part we thought we were playing. Kept short, kept attributed, and
     weighted towards the ones long out of copyright. */
  var BAR_WORLD = [
    // consciousness, and whether anyone is home
    { t: 'The mind is its own place, and in itself can make a heaven of hell.', by: 'Milton' },
    { t: 'We are such stuff as dreams are made on.', by: 'Shakespeare' },
    { t: 'The eye sees only what the mind is prepared to comprehend.', by: 'Robertson Davies' },
    { t: 'If the doors of perception were cleansed, everything would appear as it is: infinite.', by: 'Blake' },
    { t: 'Consciousness does not appear to itself chopped up in bits.', by: 'William James' },
    { t: 'Man is the only creature who refuses to be what he is.', by: 'Camus' },
    { t: 'It is not enough to have a good mind; the main thing is to use it well.', by: 'Descartes' },
    { t: 'Was I the man dreaming I was a butterfly, or the butterfly dreaming I was a man?', by: 'Zhuangzi' },
    { t: 'The unexamined life is not worth living.', by: 'Socrates' },
    { t: 'He who has a why to live can bear almost any how.', by: 'Nietzsche' },

    // happiness, and the trouble with going after it
    { t: 'Very little is needed to make a happy life; it is all within yourself.', by: 'Marcus Aurelius' },
    { t: 'Wealth consists not in having great possessions, but in having few wants.', by: 'Epictetus' },
    { t: 'The greater part of our happiness depends on our dispositions, not our circumstances.', by: 'Martha Washington' },
    { t: 'To be without some of the things you want is an indispensable part of happiness.', by: 'Bertrand Russell' },
    { t: 'Happiness is not an ideal of reason but of imagination.', by: 'Kant' },
    { t: 'Most men lead lives of quiet desperation.', by: 'Thoreau' },
    { t: 'The secret of being a bore is to tell everything.', by: 'Voltaire' },
    { t: 'To be stupid, selfish, and have good health are three requirements for happiness.', by: 'Flaubert' },

    // the parts we play
    { t: 'All the world’s a stage, and all the men and women merely players.', by: 'Shakespeare' },
    { t: 'We are what we pretend to be, so we must be careful what we pretend to be.', by: 'Vonnegut' },
    { t: 'Be yourself; everyone else is already taken.', by: 'Wilde' },
    { t: 'Man is condemned to be free.', by: 'Sartre' },
    { t: 'Man will become better when you show him what he is like.', by: 'Chekhov' },
    { t: 'A man is a god in ruins.', by: 'Emerson' },
    { t: 'Do I contradict myself? Very well then, I contradict myself.', by: 'Whitman' },

    // the ones Anmo asked for by name
    { t: 'The test of a first-rate intelligence is holding two opposed ideas at once.', by: 'F. Scott Fitzgerald' },
    { t: 'So we beat on, boats against the current, borne back ceaselessly into the past.', by: 'F. Scott Fitzgerald' },
    { t: 'The world breaks everyone, and afterward many are strong at the broken places.', by: 'Hemingway' },
    { t: 'The best way to find out if you can trust somebody is to trust them.', by: 'Hemingway' },
    { t: 'All animals are equal, but some animals are more equal than others.', by: 'Orwell' },
    { t: 'To see what is in front of one’s nose needs a constant struggle.', by: 'Orwell' },

    // and a few more worth overhearing
    { t: 'The heart has its reasons, of which reason knows nothing.', by: 'Pascal' },
    { t: 'The only true voyage would be to see the universe through another’s eyes.', by: 'Proust' },
    { t: 'The last of the human freedoms is to choose one’s attitude.', by: 'Viktor Frankl' },
    { t: 'A book must be the axe for the frozen sea within us.', by: 'Kafka' },
    { t: 'Time is a river which sweeps me along, but I am the river.', by: 'Borges' },
    { t: 'Have patience with everything unresolved, and try to love the questions themselves.', by: 'Rilke' },
    { t: 'Tread softly, because you tread on my dreams.', by: 'Yeats' },
    { t: 'One must imagine Sisyphus happy.', by: 'Camus' },
    { t: 'A person is a fluid process, not a fixed and static entity.', by: 'Carl Rogers' },
    { t: 'It is not that we have a short time to live, but that we waste a lot of it.', by: 'Seneca' },
    { t: 'Knowing others is intelligence; knowing yourself is true wisdom.', by: 'Lao Tzu' },
    { t: 'No man ever steps in the same river twice.', by: 'Heraclitus' },
    { t: 'I would rather be ashes than dust.', by: 'Jack London' },
    { t: 'The world is a comedy to those that think, a tragedy to those that feel.', by: 'Horace Walpole' },
    { t: 'Nothing is at last sacred but the integrity of your own mind.', by: 'Emerson' },
    { t: 'Not everything that is faced can be changed, but nothing can be changed until it is faced.', by: 'James Baldwin' }
  ];

  var BAR_FACTS = [
    // whisky
    'Two percent of every cask in Scotland evaporates each year and nobody gets it. ' +
      'They call it the angel’s share. In the heat of Kentucky the first year can take ten.',
    'A black fungus called Baudoinia lives on evaporating alcohol and grows on everything ' +
      'downwind of a warehouse. Whole towns near distilleries are stained with it.',
    'Japanese whisky exists because Masataka Taketsuru went to Glasgow in 1918 to study ' +
      'chemistry, apprenticed at three distilleries, and came home with two notebooks.',
    'Scotch must sit in oak for three years. Bourbon has no minimum at all unless the ' +
      'label says straight, and then it is two.',
    'Bourbon does not have to come from Kentucky. It does have to be at least fifty-one ' +
      'percent corn, and the barrel has to be new and charred.',
    'Whisky stops ageing the moment it leaves the barrel. A bottle opened in 1970 is the ' +
      'same age today as it was that night.',

    // wine and champagne
    'A cork oak is never felled for its cork. The bark is stripped every nine years and the ' +
      'tree lives two hundred, which makes cork one of the few things harvested by not killing it.',
    'There are about six atmospheres of pressure in a bottle of champagne, roughly three ' +
      'times a car tyre.',
    'Almost every vine in Europe is grafted onto American roots. Phylloxera killed the ' +
      'originals in the 1800s and American roots are immune.',
    'The legs running down the inside of a wine glass are the Marangoni effect — alcohol ' +
      'evaporating faster than water — and tell you nothing whatever about quality.',
    'The bubbles in champagne form on imperfections in the glass. A perfectly clean, ' +
      'perfectly smooth flute produces almost none, so glassmakers etch the bottom on purpose.',
    'Before machines, a remueur turned the bottles by hand. A good one could do tens of ' +
      'thousands in a day, an eighth of a turn each.',

    // sake and beer
    'Sake is the only drink in the world where the starch is being turned into sugar at the ' +
      'same time as the sugar is being turned into alcohol. That is why it reaches twenty percent.',
    'Kimoto sake is made by letting wild lactic bacteria into the starter and beating the ' +
      'rice to a paste with poles. It takes a month longer and tastes of it.',
    'Namazake is sake that was never pasteurised. It has to be kept cold its whole life and ' +
      'it changes in the bottle, which most sake does not.',
    'The Japanese highball is not an accident of taste. Suntory ran a campaign in the 2000s ' +
      'to get whisky back into the hands of people who had stopped drinking it, and it worked.',

    // cocktails
    'The first printed definition of a cocktail, in a New York paper in 1806, was spirits, ' +
      'sugar, water and bitters. That is an Old Fashioned. Everything else came later.',
    'The label on a bottle of Angostura is famously too big for the bottle. It was a printing ' +
      'mistake in the 1800s and the family decided to keep it.',
    'A Negroni is said to be what happened when Count Camillo Negroni asked a Florence ' +
      'bartender to put gin in his Americano instead of soda, in 1919.',
    'The Daiquiri is named after an iron mining village on the coast of Cuba.',
    'Shaking a drink does not just chill it. It adds about a quarter of its volume in water ' +
      'and beats air through it, which is why a shaken drink is paler and softer.',
    'The gimlet exists because of scurvy. British ships carried lime cordial by law, and ' +
      'lime cordial plus gin is a gimlet.',
    'The almond taste in maraschino is not almond. It is the stones of the marasca cherries, ' +
      'crushed and distilled along with the fruit.',
    'Vermouth is wine. It goes off like wine. An open bottle left on the back bar for six ' +
      'months has been quietly ruining every martini poured from it.',
    'Chartreuse is made by two Carthusian monks who are the only people alive who know what ' +
      'the hundred and thirty botanicals are.',
    'Campari was coloured with cochineal — crushed insects — until 2006.',
    'Absinthe never made anybody mad. The thujone in it is present in trace amounts; what ' +
      'ruined people was drinking sixty-eight percent alcohol all afternoon, and the adulterants.',
    'When water hits absinthe or ouzo and it goes cloudy, that is anethole coming out of ' +
      'solution because it dissolves in alcohol and not in water. Physicists call it the ouzo effect.',
    'Gin is legally almost nothing: neutral spirit in which juniper is the dominant flavour. ' +
      'Everything else is up to whoever is making it.',
    'A blue agave takes six to eight years before it is worth cutting, and the plant is ' +
      'killed to get at the heart. Tequila is a slower crop than most whisky.',

    // coffee
    'A coffee bean is the seed of a fruit. The dried flesh around it is called cascara and ' +
      'it makes a tea that tastes of hibiscus and raisins.',
    'Arabica is a natural hybrid: robusta crossed with a wild Sudanese species, some time in ' +
      'the last ten thousand years or so. That accident is most of the coffee on earth.',
    'Robusta has about twice the caffeine of arabica. The caffeine is the plant’s ' +
      'insecticide, which is why the hardier species has more of it.',
    'Espresso is not a bean or a roast. It is a way of pushing water through coffee, and you ' +
      'can do it with anything.',
    'Crema is carbon dioxide left over from roasting, forced into suspension by the pressure. ' +
      'It fades as the beans get older, which is why it is a freshness test and not a quality one.',
    'The first instant coffee to be sold was patented in 1909 by a Belgian living in ' +
      'Guatemala whose name happened to be George Washington.',
    'Pouring water on fresh grounds makes them swell and push back. That is the carbon ' +
      'dioxide leaving. Baristas call it the bloom and wait thirty seconds for it to finish.',

    // milk
    'Milk is white because the fat globules and the casein in it scatter every wavelength ' +
      'equally. Skimmed milk looks faintly blue because the fat is gone and the scattering shifts.',
    'Homogenised milk is milk that has been forced through a valve at enormous pressure so ' +
      'the fat droplets are too small to float back up. Unhomogenised milk separates overnight.',
    'Steamed milk tastes sweeter without any sugar being added. The sweetness peaks somewhere ' +
      'around sixty-five degrees; past seventy the proteins denature and it starts tasting cooked.',
    'Most adults on earth cannot digest lactose. Being able to is the mutation, and it spread ' +
      'through herding populations in the last few thousand years.',

    // water
    'In Europe, a water may only be called mineral water if it comes from one protected ' +
      'source, is bottled where it comes out of the ground, and has never had anything removed.',
    'The prickle of sparkling water is not the bubbles. It is carbonic acid on the tongue, ' +
      'detected by the same receptor that reacts to mustard and wasabi.',
    'Perrier’s spring in Vergèze is naturally carbonated. The gas is collected separately ' +
      'from the water and put back in at the bottling line.',
    'Seltzer is named after Selters, a village in Germany that has been sending its water ' +
      'abroad in stone jars since the 1500s.',
    'Vichy Catalán carries about ten times the dissolved minerals of Evian. It tastes salty ' +
      'because it is, and people either love it or will not finish the glass.',
    'Gerolsteiner carries so much calcium and bicarbonate that a litre of it is a meaningful ' +
      'part of a day’s calcium.',

    // the writers, for the ones still in copyright
    'Murakami ran a jazz bar in Tokyo called Peter Cat for seven years before he wrote a ' +
      'word. He decided to write a novel at a baseball game, in the middle of the innings.',
    'Kawabata was the first Japanese writer to win the Nobel. His acceptance lecture was ' +
      'largely about the poetry of medieval Zen monks.',
    'Mishima spent the morning of his death finishing a novel, sealed the manuscript, and ' +
      'posted it to his publisher before he left the house.',
    'Sōseki spent two miserable years in London on a government scholarship, hated it, and ' +
      'came back to write the funniest novel in modern Japanese.',
    'Dazai’s No Longer Human has never been out of print in Japan and is still, most ' +
      'years, one of the best-selling novels in the country.',
    'Akutagawa died at thirty-five. The most important literary prize in Japan is named after ' +
      'him, and the writer who set it up was his closest friend.',
    'Santōka walked. He spent the last fifteen years of his life on foot, begging, writing ' +
      'haiku that refused to have the right number of syllables in them.'
  ];

  function mountBar() {
    sceneOn = 'bar';
    sceneTone = 'bar';

    var scene = document.createElement('div');
    scene.id = 'scene';
    scene.className = 'basement';
    scene.setAttribute('aria-hidden', 'true');
    scene.innerHTML =
      '<pre id="barrain"></pre>' +
      '<div id="backbar"><pre id="shelfrow"></pre><pre id="record"></pre></div>' +
      '<pre id="barcat"></pre>' +
      '<div id="bartop"></div>';
    document.body.appendChild(scene);

    var rain = document.getElementById('barrain');
    var shelfrow = document.getElementById('shelfrow');
    var record = document.getElementById('record');
    var cat = document.getElementById('barcat');

    shelfrow.textContent = BOTTLES.join('');

    function poseCat(move) {
      cat.textContent = CAT_POSES[Math.floor(Math.random() * CAT_POSES.length)].join('\n');
      // Somewhere else along the bar, but only while nobody can see it go.
      if (move) cat.style.left = (7 + Math.floor(Math.random() * 26)) + 'vw';
    }
    poseCat(true);

    /* --------------------------------------------------- the record
       A disc with one groove mark on it, and the mark goes round. That
       is the whole of it, and it is enough: the eye reads any moving
       mark on a circle as thirty-three and a third. */

    var R = 5, spin = 0;
    function paintRecord() {
      var rows = [], r, c, dx, dy, d, ang, ch;
      var mark = spin;
      for (r = -R; r <= R; r++) {
        var line = '';
        for (c = -R * 2; c <= R * 2; c++) {
          dx = c / 2; dy = r;
          d = Math.sqrt(dx * dx + dy * dy);
          if (d > R) { line += ' '; continue; }
          if (d < 1.0) { line += '@'; continue; }        // the spindle
          ang = Math.atan2(dy, dx);
          var off = Math.abs(((ang - mark + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          ch = off < 0.26 ? '=' : (Math.round(d) % 2 ? 'o' : '.');
          line += ch;
        }
        rows.push(line);
      }
      record.textContent = rows.join('\n');
    }

    function paintRain() {
      var w = Math.ceil(window.innerWidth / 6.7);
      var rows = 12, out = '', r, c, n;
      for (r = 0; r < rows; r++) {
        for (c = 0; c < w; c++) {
          n = noise(r + (rainPhase % 7), c, 83);
          out += n > 0.955 ? '/' : n > 0.93 ? '.' : ' ';
        }
        if (r !== rows - 1) out += '\n';
      }
      rain.textContent = out;
    }
    var rainPhase = 0;
    paintRain();
    paintRecord();

    var say = document.createElement('p');
    say.className = 'bar-line';
    var main = document.querySelector('main');
    if (main) main.insertBefore(say, main.firstChild);
    sceneNodes.push(say);

    /* One shuffled deck of both kinds, walked through in order, so nothing
       repeats until everything has been said once. Shuffled fresh every
       time somebody comes in, so it is never the same evening twice. */
    var deck = [];
    BAR_QUOTES.forEach(function (q) { deck.push({ kind: 'quote', q: q }); });
    BAR_WORLD.forEach(function (q) { deck.push({ kind: 'quote', q: q }); });
    BAR_FACTS.forEach(function (f) { deck.push({ kind: 'fact', t: f }); });
    (function shuffle() {
      var i, j, t;
      for (i = deck.length - 1; i > 0; i--) {
        j = Math.floor(Math.random() * (i + 1));
        t = deck[i]; deck[i] = deck[j]; deck[j] = t;
      }
    })();

    var lineIdx = 0;

    function draw() {
      var card = deck[lineIdx % deck.length];
      lineIdx++;
      if (card.kind === 'quote') {
        return '<em>' + escapeText(card.q.t) + '</em>' +
               '<b class="bar-by">' + escapeText(card.q.by) + '</b>';
      }
      return '<span class="bar-fact">' + escapeText(card.t) + '</span>';
    }

    function nextLine() {
      say.classList.add('fading');
      setTimeout(function () {
        say.innerHTML = draw();
        say.classList.remove('fading');
      }, 700);
    }
    say.innerHTML = draw();

    sceneTimers.push(setInterval(function () {
      if (document.hidden) return;
      spin += 0.42;
      paintRecord();
      rainPhase++;
      if (rainPhase % 3 === 0) paintRain();
    }, 110));

    sceneTimers.push(setInterval(function () { if (!document.hidden) nextLine(); }, 13000));

    // The cat is there, and then it is not, and nobody sees it move. When
    // it comes back it has changed its mind about where and how to sit.
    sceneTimers.push(setInterval(function () {
      if (document.hidden) return;
      var here = Math.random() < 0.5;
      if (here && !cat.classList.contains('here')) poseCat(true);
      cat.classList.toggle('here', here);
    }, 9000));

    // And it shifts about even while it is there, the way a cat does.
    sceneTimers.push(setInterval(function () {
      if (document.hidden || !cat.classList.contains('here')) return;
      if (Math.random() < 0.4) poseCat(false);
    }, 21000));

    ambience('bar');
  }

  function boot() {
    mountClock();
    mountSecrets();
    mountCactus();
    mountStill();
    mountPogo();
    mountBin();
    mountTexture();
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
