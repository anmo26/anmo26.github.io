/* ==========================================================================
   guestbook-api — a Cloudflare Worker + D1 backend for the garden guestbook
   ---------------------------------------------------------------------------
   Speaks exactly the protocol that src/assets/app.js already speaks:

     GET    <base>        -> { "notes": [ note, ... ] }
     POST   <base>        -> note            (body: a note object)
     PUT    <base>/<id>   -> note            (body: a note object)
     DELETE <base>/<id>   -> { "ok": true }  (owner only, bearer ADMIN_TOKEN)
     OPTIONS anything     -> 204 preflight

   A note is:
     { id, name, body, at, colour, x, y, replies: [ { name, body, at } ] }

   Two things about the client that shape this file:

   1. The client mints its own `id` (timestamp + random) and then uses that
      same id for PUT. So we store the id it gives us rather than minting our
      own — otherwise every reply would PUT to an id the database never saw.

   2. The client renders with `textContent` and never innerHTMLs user text, so
      text is stored verbatim, exactly as typed. We never build HTML here, so
      there is nothing on this side to escape. (Escaping on the way in would
      corrupt honest notes containing "<3" or "a && b".)

   Zero dependencies, plain ES modules — the same house rules as grow.js.
   ========================================================================== */

/* ------------------------------------------------------------------ limits */

const LIMITS = {
  bodyBytes: 2048,      // whole request payload, matching the ~2KB brief
  name: 40,             // the form's own maxlength
  body: 800,            // the form's own maxlength
  replyName: 40,
  replyBody: 400,
  repliesPerNote: 100,  // a note stops accepting replies past this
  repliesPerPut: 2,     // how many new replies one PUT may append
  idLength: 64,
  coord: 20000,         // x / y are page pixels; nothing sane exceeds this
  colours: 5            // app.js uses `note.colour % 5`
};

const RATE = {
  // action        limit  window
  note:   { limit: 5,  windowMs: 60 * 60 * 1000 },
  reply:  { limit: 20, windowMs: 60 * 60 * 1000 },
  update: { limit: 90, windowMs: 60 * 60 * 1000 }  // drags / position saves
};

const DEFAULT_MAX_NOTES = 500;

/* ------------------------------------------------------------------- entry */

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (err) {
      // Log for `wrangler tail`; the client only ever sees a flat message.
      console.error('guestbook error:', err && err.stack ? err.stack : err);
      return json({ error: 'internal error' }, 500, corsFor(request, env));
    }
  }
};

async function route(request, env, ctx) {
  const cors = corsFor(request, env);
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    // Preflight. If the Origin was not on the allow-list `cors` is empty, so
    // the browser sees no Access-Control-Allow-Origin and blocks the call.
    return new Response(null, { status: 204, headers: cors });
  }

  // A cross-origin browser request from an origin we do not know never gets
  // to touch the database — not even a read.
  if (!originAllowed(request, env)) {
    return json({ error: 'origin not allowed' }, 403, cors);
  }

  if (method === 'GET' || method === 'HEAD') return listNotes(request, env, cors);
  if (method === 'POST') return createNote(request, env, ctx, cors);
  if (method === 'PUT') return updateNote(request, env, ctx, cors);
  if (method === 'DELETE') return deleteNote(request, env, cors);

  return json({ error: 'method not allowed' }, 405, cors);
}

/* -------------------------------------------------------------------- CORS
   ALLOWED_ORIGINS is a comma-separated list of exact origins, e.g.
   "https://anmo.garden,https://anmoli.github.io". We echo back the one that
   matched, never "*" — a wildcard on a write route invites any page on the
   internet to post through the visitor's browser.

   A request with no Origin header at all (curl, a server-side fetch, some
   same-origin navigations) is allowed through: CORS is a browser mechanism
   and an attacker can set any header they like, so refusing here would only
   inconvenience honest tooling. The real write defences are below — rate
   limits, caps and the banned table.
   ------------------------------------------------------------------------ */

function allowList(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(function (s) { return s.trim().replace(/\/+$/, ''); })
    .filter(Boolean);
}

function requestOrigin(request) {
  const o = request.headers.get('Origin');
  return o ? o.trim().replace(/\/+$/, '') : null;
}

function originAllowed(request, env) {
  const origin = requestOrigin(request);
  if (!origin) return true;
  return allowList(env).indexOf(origin) !== -1;
}

function corsFor(request, env) {
  const headers = { 'vary': 'Origin' };
  const origin = requestOrigin(request);
  if (origin && allowList(env).indexOf(origin) !== -1) {
    headers['access-control-allow-origin'] = request.headers.get('Origin');
    headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    headers['access-control-allow-headers'] = 'content-type, accept, authorization';
    headers['access-control-max-age'] = '86400';
  }
  return headers;
}

/* ------------------------------------------------------------------ routes */

async function listNotes(request, env, cors) {
  const url = new URL(request.url);
  const admin = isAdmin(request, env);
  const includeHidden = admin && url.searchParams.get('include_hidden') === '1';

  const sql = includeHidden
    ? 'SELECT * FROM notes ORDER BY at ASC'
    : 'SELECT * FROM notes WHERE hidden = 0 ORDER BY at ASC';

  const rows = (await env.DB.prepare(sql).all()).results || [];
  return json({ notes: rows.map(function (r) { return toNote(r, admin); }) }, 200, cors);
}

async function createNote(request, env, ctx, cors) {
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, parsed.status, cors);
  const input = parsed.value;

  // Honeypot: the real form has no such field, so anything that fills one in
  // is a bot that hoovered up the DOM and guessed. Answer 200 so it does not
  // learn to try again with the field removed.
  if (isHoneypotFilled(input)) {
    return json(shape({
      id: safeId(input.id) || newId(),
      name: clamp(input.name, LIMITS.name) || 'anonymous',
      body: clamp(input.body, LIMITS.body),
      at: Date.now(),
      colour: 0, x: 0, y: 0, replies: '[]', hidden: 1
    }, false), 200, cors);
  }

  const ipHash = await hashIp(request, env);
  if (await ipBanned(env, ipHash)) {
    return json({ error: 'posting is not available' }, 403, cors);
  }

  const name = clamp(input.name, LIMITS.name) || 'anonymous';
  const body = clamp(input.body, LIMITS.body);
  if (!body) return json({ error: 'body is required' }, 400, cors);

  const colour = num(input.colour, 0, LIMITS.colours - 1, 0);
  const x = num(input.x, 0, LIMITS.coord, 0);
  const y = num(input.y, 0, LIMITS.coord, 0);
  if (colour === null || x === null || y === null) {
    return json({ error: 'colour, x and y must be finite numbers' }, 400, cors);
  }

  if (await hasBannedWord(env, name + ' ' + body)) {
    return json({ error: 'that note was not accepted' }, 422, cors);
  }

  const gate = await rateLimit(env, ctx, ipHash, 'note', RATE.note);
  if (!gate.ok) {
    return json(
      { error: 'too many notes — try again later', retry_after: gate.retryAfter },
      429,
      Object.assign({ 'retry-after': String(gate.retryAfter) }, cors)
    );
  }

  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM notes').first();
  const maxNotes = num(env.MAX_NOTES, 1, 1e9, DEFAULT_MAX_NOTES) || DEFAULT_MAX_NOTES;
  if ((total ? total.n : 0) >= maxNotes) {
    return json({ error: 'the guestbook is full' }, 409, cors);
  }

  // Honour the id the client minted (it PUTs to it later), but only after
  // checking it is a short, boring token.
  const id = safeId(input.id) || newId();
  const now = Date.now();

  const row = {
    id: id,
    name: name,
    body: body,
    at: now,          // server clock, so a wrong client clock cannot reorder
    colour: colour,
    x: x,
    y: y,
    replies: '[]',
    hidden: 0
  };

  try {
    await env.DB.prepare(
      `INSERT INTO notes (id, name, body, at, colour, x, y, replies, hidden, ip_hash, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?4, ?4)`
    ).bind(id, name, body, now, colour, x, y, '[]', ipHash).run();
  } catch (err) {
    if (String(err && err.message).indexOf('UNIQUE') !== -1) {
      return json({ error: 'that id already exists' }, 409, cors);
    }
    throw err;
  }

  return json(shape(row, false), 201, cors);
}

async function updateNote(request, env, ctx, cors) {
  const id = idFromPath(request);
  if (!id) return json({ error: 'missing note id' }, 400, cors);

  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, parsed.status, cors);
  const input = parsed.value;

  const admin = isAdmin(request, env);
  const row = await env.DB.prepare('SELECT * FROM notes WHERE id = ?1').bind(id).first();
  if (!row || (row.hidden && !admin)) return json({ error: 'no such note' }, 404, cors);

  if (isHoneypotFilled(input)) return json(toNote(row, false), 200, cors);

  const ipHash = await hashIp(request, env);
  if (!admin && await ipBanned(env, ipHash)) {
    return json({ error: 'posting is not available' }, 403, cors);
  }

  /* Position and colour are free to change — that is what dragging a note is.
     `name`, `body` and `at` are NOT: the client sends the whole note back on
     every reply, and if we trusted that field wholesale anyone could rewrite
     anyone else's note by PUTting over it. The original text is authoritative
     and only the owner may edit it. */
  const colour = num(input.colour, 0, LIMITS.colours - 1, row.colour);
  const x = num(input.x, 0, LIMITS.coord, row.x);
  const y = num(input.y, 0, LIMITS.coord, row.y);
  if (colour === null || x === null || y === null) {
    return json({ error: 'colour, x and y must be finite numbers' }, 400, cors);
  }

  const existing = parseReplies(row.replies);
  const incoming = Array.isArray(input.replies) ? input.replies : [];

  // The client appends to the array it already has, so anything past the
  // stored length is new. Anything at or before it is ignored — replies are
  // append-only and nobody edits one after the fact.
  let added = incoming.slice(existing.length);
  if (added.length > LIMITS.repliesPerPut) {
    return json({ error: 'too many replies at once' }, 422, cors);
  }
  if (existing.length + added.length > LIMITS.repliesPerNote) {
    return json({ error: 'this note has all the replies it can hold' }, 409, cors);
  }

  const clean = [];
  for (const r of added) {
    if (!r || typeof r !== 'object') continue;
    const rbody = clamp(r.body, LIMITS.replyBody);
    if (!rbody) continue;
    const rname = clamp(r.name, LIMITS.replyName) || 'anonymous';
    if (!admin && await hasBannedWord(env, rname + ' ' + rbody)) {
      return json({ error: 'that reply was not accepted' }, 422, cors);
    }
    clean.push({ name: rname, body: rbody, at: Date.now() });
  }

  if (!admin) {
    const action = clean.length ? 'reply' : 'update';
    const gate = await rateLimit(env, ctx, ipHash, action, RATE[action]);
    if (!gate.ok) {
      return json(
        { error: 'too many updates — try again later', retry_after: gate.retryAfter },
        429,
        Object.assign({ 'retry-after': String(gate.retryAfter) }, cors)
      );
    }
  }

  const replies = existing.concat(clean);

  // Owner-only fields, all gated behind the bearer token.
  let name = row.name;
  let body = row.body;
  let hidden = row.hidden ? 1 : 0;
  if (admin) {
    if (typeof input.name === 'string') name = clamp(input.name, LIMITS.name) || 'anonymous';
    if (typeof input.body === 'string') body = clamp(input.body, LIMITS.body) || body;
    if (input.hidden !== undefined) hidden = input.hidden ? 1 : 0;
  }

  await env.DB.prepare(
    `UPDATE notes SET name = ?2, body = ?3, colour = ?4, x = ?5, y = ?6,
                      replies = ?7, hidden = ?8, updated_at = ?9
     WHERE id = ?1`
  ).bind(id, name, body, colour, x, y, JSON.stringify(replies), hidden, Date.now()).run();

  return json(shape({
    id: id, name: name, body: body, at: row.at, colour: colour,
    x: x, y: y, replies: JSON.stringify(replies), hidden: hidden
  }, admin), 200, cors);
}

async function deleteNote(request, env, cors) {
  if (!isAdmin(request, env)) return json({ error: 'unauthorised' }, 401, cors);

  const id = idFromPath(request);
  if (!id) return json({ error: 'missing note id' }, 400, cors);

  const url = new URL(request.url);
  const hideOnly = url.searchParams.get('hide') === '1';

  const res = hideOnly
    ? await env.DB.prepare('UPDATE notes SET hidden = 1, updated_at = ?2 WHERE id = ?1')
        .bind(id, Date.now()).run()
    : await env.DB.prepare('DELETE FROM notes WHERE id = ?1').bind(id).run();

  const changed = res && res.meta ? res.meta.changes : 0;
  if (!changed) return json({ error: 'no such note' }, 404, cors);

  return json({ ok: true, id: id, hidden: hideOnly }, 200, cors);
}

/* --------------------------------------------------------------- moderation */

function isAdmin(request, env) {
  const token = String(env.ADMIN_TOKEN || '');
  if (!token) return false;                      // no token configured, no admin
  const header = request.headers.get('Authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  return constantTimeEqual(match[1], token);
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function ipBanned(env, ipHash) {
  const row = await env.DB
    .prepare(`SELECT 1 AS hit FROM banned WHERE kind = 'ip_hash' AND value = ?1`)
    .bind(ipHash).first();
  return !!row;
}

async function hasBannedWord(env, text) {
  const rows = (await env.DB.prepare(`SELECT value FROM banned WHERE kind = 'word'`).all()).results || [];
  if (!rows.length) return false;
  const hay = String(text).toLowerCase();
  return rows.some(function (r) {
    const needle = String(r.value || '').toLowerCase().trim();
    return needle && hay.indexOf(needle) !== -1;
  });
}

// The form these bots think they are filling in does not exist. Any of these
// keys arriving with content means it was not a human at the keyboard.
const HONEYPOT_KEYS = ['website', 'url', 'email', 'homepage', 'company', '_hp', 'hp'];

function isHoneypotFilled(input) {
  return HONEYPOT_KEYS.some(function (k) {
    const v = input[k];
    return typeof v === 'string' ? v.trim() !== '' : v != null && v !== false;
  });
}

/* ------------------------------------------------------------ rate limiting
   Counted in D1 rather than the Cache API, on purpose.

   The Cache API is per-colo and best-effort: Cloudflare runs the Worker in
   whichever datacentre is nearest the visitor, entries can be evicted at any
   time, and a script rotating through a few exit nodes would get a fresh
   allowance in each city. That is fine for shedding accidental load, useless
   against someone deliberately flooding a guestbook.

   D1 is one logical SQLite database with strongly consistent writes, so a
   count in it is global and exact. The cost is one small write per attempt —
   at 5 notes/hour per visitor that is nowhere near the free tier's 100,000
   writes a day.

   Fixed windows rather than a sliding log: one row per (ip, action, hour)
   instead of one row per event, and the worst case is a visitor getting two
   allowances across a window boundary. For a guestbook that is fine.
   ------------------------------------------------------------------------ */

async function rateLimit(env, ctx, ipHash, action, conf) {
  const now = Date.now();
  const windowStart = Math.floor(now / conf.windowMs) * conf.windowMs;
  const expires = windowStart + conf.windowMs;
  const bucket = ipHash + ':' + action + ':' + windowStart;

  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (bucket, hits, window_start, expires_at)
     VALUES (?1, 1, ?2, ?3)
     ON CONFLICT(bucket) DO UPDATE SET hits = hits + 1
     RETURNING hits`
  ).bind(bucket, windowStart, expires).first();

  const hits = row ? row.hits : 1;

  // Sweep dead rows now and then so the table cannot grow forever. Cheap,
  // rare, and off the response path where the runtime allows it.
  if (Math.random() < 0.02) {
    const sweep = env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?1').bind(now).run();
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(sweep);
    else await sweep.catch(function () {});
  }

  return {
    ok: hits <= conf.limit,
    hits: hits,
    retryAfter: Math.max(1, Math.ceil((expires - now) / 1000))
  };
}

/* The visitor's IP is hashed with a secret salt and never stored raw: the
   table only ever holds an opaque token, which is all a rate limiter or a
   ban list actually needs. */
async function hashIp(request, env) {
  const ip = request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')
    || 'unknown';
  const salt = String(env.RATE_SALT || env.ADMIN_TOKEN || 'garden');
  const data = new TextEncoder().encode(salt + '|' + String(ip).split(',')[0].trim());
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map(function (b) { return b.toString(16).padStart(2, '0'); })
    .join('')
    .slice(0, 32);
}

/* ------------------------------------------------------------- input plumbing */

async function readJson(request) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > LIMITS.bodyBytes) {
    return { error: 'body too large', status: 413 };
  }

  const type = request.headers.get('Content-Type') || '';
  if (type && type.indexOf('application/json') === -1) {
    return { error: 'expected application/json', status: 415 };
  }

  let raw;
  try {
    raw = await request.text();
  } catch (e) {
    return { error: 'could not read body', status: 400 };
  }

  if (new TextEncoder().encode(raw).length > LIMITS.bodyBytes) {
    return { error: 'body too large', status: 413 };
  }

  let value;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    return { error: 'invalid json', status: 400 };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'expected a json object', status: 400 };
  }

  return { value: value };
}

/* The note id is always the last path segment, so the Worker does not care
   whether it is mounted at a workers.dev root or behind a route like
   example.com/guestbook/*. GET and POST never carry an id in this protocol. */
function idFromPath(request) {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  return parts.length ? safeId(decodeURIComponent(parts[parts.length - 1])) : null;
}

function safeId(v) {
  if (typeof v !== 'string') return null;
  const id = v.trim();
  if (!id || id.length > LIMITS.idLength) return null;
  return /^[A-Za-z0-9._-]+$/.test(id) ? id : null;
}

function newId() {
  return String(Date.now()) + Math.random().toString(36).slice(2, 7);
}

function clamp(v, max) {
  if (typeof v !== 'string') return '';
  // Strip control characters (a pasted NUL or a stray \r breaks nothing here,
  // but there is no reason to keep them) and collapse runaway blank lines.
  return v
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, max);
}

/* Returns a number, or `fallback` when the field was absent, or null when it
   was present but not a finite number — which the caller turns into a 400. */
function num(v, min, max, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function parseReplies(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

/* ----------------------------------------------------------------- output */

function toNote(row, admin) {
  return shape(row, admin);
}

function shape(row, admin) {
  const note = {
    id: row.id,
    name: row.name,
    body: row.body,
    at: row.at,
    colour: row.colour,
    x: row.x,
    y: row.y,
    replies: parseReplies(row.replies)
  };
  if (admin) note.hidden = !!row.hidden;
  return note;
}

function json(payload, status, headers) {
  return new Response(JSON.stringify(payload), {
    status: status,
    headers: Object.assign(
      {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      },
      headers || {}
    )
  });
}
