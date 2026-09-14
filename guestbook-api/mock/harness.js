/* ==========================================================================
   Local verification harness.

   Runs worker.js itself — not a copy of it — against an in-memory SQLite
   database created from schema.sql, using real Request/Response objects. This
   is how the backend was checked without a Cloudflare account.

     node mock/harness.js          run the assertions, print a report
     node mock/harness.js --serve  serve the same handler on :8787 for test.sh

   Differences from the real thing: SQLite is node:sqlite instead of D1, and
   the visitor IP comes from a CF-Connecting-IP header the caller sets rather
   than from Cloudflare's edge. Everything else is the deployed code path.
   ========================================================================== */

import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import worker from '../worker.js';
import { makeD1 } from './d1.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.join(HERE, '..', 'schema.sql');

const ORIGIN = 'https://anmo.garden';
const BASE = 'https://guestbook.example.workers.dev';

function makeEnv(extra = {}) {
  return Object.assign({
    DB: makeD1(SCHEMA),
    ALLOWED_ORIGINS: 'https://anmo.garden,http://localhost:8000',
    ADMIN_TOKEN: 'test-admin-token',
    RATE_SALT: 'test-salt',
    MAX_NOTES: '500'
  }, extra);
}

const CTX = { waitUntil(p) { Promise.resolve(p).catch(() => {}); } };

/* Tests that are not about rate limiting each get their own visitor, so one
   group's traffic cannot spend another group's hourly allowance. */
let ipCounter = 0;
function nextIp() {
  ipCounter++;
  return '10.' + ((ipCounter >> 16) & 255) + '.' + ((ipCounter >> 8) & 255) + '.' + (ipCounter & 255);
}

async function call(env, method, pathname, { body, origin = ORIGIN, ip = nextIp(), token, headers = {} } = {}) {
  const init = { method, headers: Object.assign({}, headers) };
  if (origin) init.headers['Origin'] = origin;
  if (ip) init.headers['CF-Connecting-IP'] = ip;
  if (token) init.headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await worker.fetch(new Request(BASE + pathname, init), env, CTX);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* not json */ }
  return { status: res.status, headers: res.headers, json, text };
}

function newNote(over = {}) {
  return Object.assign({
    id: String(Date.now()) + Math.random().toString(36).slice(2, 7),
    name: 'anmo',
    body: 'hello from the garden',
    at: Date.now(),
    colour: 2,
    x: 120,
    y: 80,
    replies: []
  }, over);
}

/* ------------------------------------------------------------- assertions */

let pass = 0, fail = 0;
const failures = [];

function ok(label, condition, detail) {
  if (condition) { pass++; console.log('  ok   ' + label); }
  else {
    fail++; failures.push(label);
    console.log('  FAIL ' + label + (detail ? '\n         ' + detail : ''));
  }
}

function group(title) {
  console.log('\n' + title);
  console.log('-'.repeat(title.length));
}

/* ------------------------------------------------------------------ tests */

async function main() {
  console.log('guestbook-api — local harness (worker.js + node:sqlite)\n');

  /* ---------------------------------------------------- the happy path */
  group('the client contract');
  {
    const env = makeEnv();

    const empty = await call(env, 'GET', '/');
    ok('GET on an empty guestbook returns { notes: [] }',
      empty.status === 200 && Array.isArray(empty.json.notes) && empty.json.notes.length === 0,
      JSON.stringify(empty.json));

    const note = newNote();
    const posted = await call(env, 'POST', '/', { body: note });
    ok('POST returns 201 and the created note', posted.status === 201, posted.status + ' ' + posted.text);
    ok('POST keeps the id the client minted (PUT depends on it)',
      posted.json && posted.json.id === note.id, JSON.stringify(posted.json));
    ok('POST echoes every field app.js reads',
      posted.json && posted.json.name === 'anmo' && posted.json.body === 'hello from the garden'
      && posted.json.colour === 2 && posted.json.x === 120 && posted.json.y === 80
      && Array.isArray(posted.json.replies) && typeof posted.json.at === 'number',
      JSON.stringify(posted.json));

    const listed = await call(env, 'GET', '/');
    ok('GET reads the note back', listed.json.notes.length === 1 && listed.json.notes[0].id === note.id);

    // The reply flow exactly as app.js does it: mutate the local note, PUT it whole.
    note.replies.push({ name: 'visitor', body: 'nice garden', at: Date.now() });
    const replied = await call(env, 'PUT', '/' + note.id, { body: note, ip: '203.0.113.8' });
    ok('PUT /<id> appends a reply', replied.status === 200 && replied.json.replies.length === 1
      && replied.json.replies[0].body === 'nice garden', replied.text);

    const afterReply = await call(env, 'GET', '/');
    ok('the reply survives a reload', afterReply.json.notes[0].replies.length === 1);

    // A drag: same note, new coordinates.
    note.x = 640; note.y = 300;
    const moved = await call(env, 'PUT', '/' + note.id, { body: note, ip: '203.0.113.8' });
    ok('PUT /<id> moves the note', moved.json.x === 640 && moved.json.y === 300, moved.text);

    // Replies already stored are not re-added when the client PUTs again.
    const again = await call(env, 'PUT', '/' + note.id, { body: note, ip: '203.0.113.8' });
    ok('re-PUTting the same replies does not duplicate them', again.json.replies.length === 1,
      JSON.stringify(again.json.replies));

    const tamper = await call(env, 'PUT', '/' + note.id, {
      body: Object.assign({}, note, { body: 'REWRITTEN BY A STRANGER', name: 'not anmo' }),
      ip: '198.51.100.1'
    });
    ok('PUT cannot rewrite someone else\'s name or body',
      tamper.json.body === 'hello from the garden' && tamper.json.name === 'anmo', tamper.text);

    const missing = await call(env, 'PUT', '/does-not-exist', { body: newNote() });
    ok('PUT to an unknown id is 404', missing.status === 404, missing.text);
  }

  /* --------------------------------------------------------- validation */
  group('validation');
  {
    const env = makeEnv();

    const big = await call(env, 'POST', '/', { body: newNote({ body: 'x'.repeat(4000) }) });
    ok('a body over ~2KB is refused with 413', big.status === 413, big.status + ' ' + big.text);

    const clamped = await call(env, 'POST', '/', {
      body: newNote({ name: 'n'.repeat(120), body: 'b'.repeat(900) })
    });
    ok('name is clamped to 40 chars', clamped.json.name.length === 40, String(clamped.json.name.length));
    ok('body is clamped to 800 chars', clamped.json.body.length === 800, String(clamped.json.body.length));

    const nan = await call(env, 'POST', '/', { body: newNote({ x: 'over there' }) });
    ok('a non-numeric x is rejected with 400', nan.status === 400, nan.text);

    // Sent as raw JSON: 1e400 is legal JSON that JSON.parse turns into
    // Infinity, which would otherwise sail past a naive typeof check.
    const infinite = await call(env, 'POST', '/', {
      body: JSON.stringify(newNote()).replace(/"y":\s*\d+/, '"y":1e400')
    });
    ok('a non-finite y (JSON 1e400 -> Infinity) is rejected with 400',
      infinite.status === 400, infinite.status + ' ' + infinite.text);

    const huge = await call(env, 'POST', '/', { body: newNote({ x: 99999999, colour: 42 }) });
    ok('out-of-range x and colour are clamped, not rejected',
      huge.json.x === 20000 && huge.json.colour === 4, JSON.stringify(huge.json));

    const emptyBody = await call(env, 'POST', '/', { body: newNote({ body: '   ' }) });
    ok('an empty body is rejected with 400', emptyBody.status === 400, emptyBody.text);

    const noName = await call(env, 'POST', '/', { body: newNote({ name: '' }) });
    ok('a missing name becomes "anonymous"', noName.json.name === 'anonymous');

    const junk = await call(env, 'POST', '/', { body: '{not json' });
    ok('malformed json is rejected with 400', junk.status === 400, junk.text);

    const array = await call(env, 'POST', '/', { body: '[1,2,3]' });
    ok('a json array is rejected with 400', array.status === 400, array.text);

    const verbatim = await call(env, 'POST', '/', {
      body: newNote({ body: '<3 & </marquee> "quotes" éà中' })
    });
    ok('text is stored verbatim (the client uses textContent, so no escaping)',
      verbatim.json.body === '<3 & </marquee> "quotes" éà中', JSON.stringify(verbatim.json.body));

    const badId = await call(env, 'POST', '/', { body: newNote({ id: '../../etc/passwd' }) });
    ok('a dangerous id is replaced with a generated one',
      badId.status === 201 && /^[A-Za-z0-9._-]+$/.test(badId.json.id), JSON.stringify(badId.json && badId.json.id));

    const dup = newNote();
    await call(env, 'POST', '/', { body: dup });
    const dup2 = await call(env, 'POST', '/', { body: dup });
    ok('a duplicate id is refused with 409', dup2.status === 409, dup2.text);

    const wrongMethod = await call(env, 'PATCH', '/', { body: newNote() });
    ok('an unsupported method is 405', wrongMethod.status === 405, wrongMethod.text);
  }

  /* --------------------------------------------------------------- CORS */
  group('CORS');
  {
    const env = makeEnv();

    const preflight = await call(env, 'OPTIONS', '/');
    ok('OPTIONS preflight from an allowed origin is 204',
      preflight.status === 204
      && preflight.headers.get('access-control-allow-origin') === ORIGIN
      && /POST/.test(preflight.headers.get('access-control-allow-methods') || ''),
      preflight.status + ' ' + preflight.headers.get('access-control-allow-origin'));

    const good = await call(env, 'POST', '/', { body: newNote() });
    ok('an allowed origin is echoed back, never "*"',
      good.headers.get('access-control-allow-origin') === ORIGIN,
      String(good.headers.get('access-control-allow-origin')));
    ok('the response varies on Origin', (good.headers.get('vary') || '').includes('Origin'));

    const evilPost = await call(env, 'POST', '/', { body: newNote(), origin: 'https://evil.example' });
    ok('a write from an unknown origin is refused with 403', evilPost.status === 403, evilPost.text);
    ok('...and carries no allow-origin header',
      evilPost.headers.get('access-control-allow-origin') === null,
      String(evilPost.headers.get('access-control-allow-origin')));

    const evilGet = await call(env, 'GET', '/', { origin: 'https://evil.example' });
    ok('a read from an unknown origin is refused too', evilGet.status === 403, evilGet.text);

    const evilPreflight = await call(env, 'OPTIONS', '/', { origin: 'https://evil.example' });
    ok('preflight from an unknown origin gets no CORS headers',
      evilPreflight.headers.get('access-control-allow-origin') === null);

    const curl = await call(env, 'GET', '/', { origin: null });
    ok('a request with no Origin at all (curl) still works', curl.status === 200, curl.text);

    const other = await call(env, 'GET', '/', { origin: 'http://localhost:8000' });
    ok('a second allowed origin also works',
      other.headers.get('access-control-allow-origin') === 'http://localhost:8000');
  }

  /* ------------------------------------------------------- rate limiting */
  group('rate limiting');
  {
    const env = makeEnv();
    const ip = '192.0.2.50';

    const codes = [];
    for (let i = 0; i < 6; i++) {
      const r = await call(env, 'POST', '/', { body: newNote({ body: 'note ' + i }), ip });
      codes.push(r.status);
    }
    ok('the first 5 notes from one IP are accepted',
      codes.slice(0, 5).every(c => c === 201), codes.join(','));
    ok('the 6th note in the hour is 429', codes[5] === 429, codes.join(','));

    const limited = await call(env, 'POST', '/', { body: newNote(), ip });
    ok('429 carries a Retry-After header',
      Number(limited.headers.get('retry-after')) > 0, String(limited.headers.get('retry-after')));

    const otherIp = await call(env, 'POST', '/', { body: newNote(), ip: '192.0.2.51' });
    ok('a different IP is unaffected', otherIp.status === 201, otherIp.text);

    ok('the stored rate-limit key is a hash, never the raw IP',
      env.DB.raw.prepare('SELECT bucket FROM rate_limits').all()
        .every(r => !r.bucket.includes('192.0.2.') && /^[0-9a-f]{32}:/.test(r.bucket)),
      JSON.stringify(env.DB.raw.prepare('SELECT bucket FROM rate_limits').all()));

    ok('the note rows store a hashed IP, never the raw one',
      env.DB.raw.prepare('SELECT ip_hash FROM notes').all()
        .every(r => /^[0-9a-f]{32}$/.test(r.ip_hash)));

    // Replies get their own, larger budget.
    const host = newNote();
    await call(env, 'POST', '/', { body: host, ip: '192.0.2.60' });
    const replyCodes = [];
    for (let i = 0; i < 21; i++) {
      host.replies.push({ name: 'r', body: 'reply ' + i, at: Date.now() });
      const r = await call(env, 'PUT', '/' + host.id, { body: host, ip: '192.0.2.61' });
      replyCodes.push(r.status);
      if (r.status !== 200) host.replies.pop();
    }
    ok('the first 20 replies from one IP are accepted',
      replyCodes.slice(0, 20).every(c => c === 200), replyCodes.join(','));
    ok('the 21st reply in the hour is 429', replyCodes[20] === 429, replyCodes.join(','));
  }

  /* -------------------------------------------------------------- abuse */
  group('abuse controls');
  {
    const env = makeEnv({ MAX_NOTES: '3' });

    const hp = await call(env, 'POST', '/', { body: newNote({ website: 'http://spam.example' }) });
    ok('a filled honeypot field looks accepted to the bot', hp.status === 200, hp.text);
    const afterHp = await call(env, 'GET', '/');
    ok('...but the note is never stored', afterHp.json.notes.length === 0,
      JSON.stringify(afterHp.json.notes));

    env.DB.raw.prepare(`INSERT INTO banned (kind, value, note) VALUES ('word', 'casino', 'spam')`).run();
    const banned = await call(env, 'POST', '/', { body: newNote({ body: 'best CASINO bonus' }), ip: '198.51.100.9' });
    ok('a banned word is refused with 422', banned.status === 422, banned.text);
    const clean = await call(env, 'POST', '/', { body: newNote({ body: 'no spam here' }), ip: '198.51.100.9' });
    ok('an innocent note still goes through', clean.status === 201, clean.text);

    // Ban the poster by the hash the notes table recorded.
    const hash = env.DB.raw.prepare('SELECT ip_hash FROM notes LIMIT 1').get().ip_hash;
    env.DB.raw.prepare(`INSERT INTO banned (kind, value) VALUES ('ip_hash', ?)`).run(hash);
    const bannedIp = await call(env, 'POST', '/', { body: newNote(), ip: '198.51.100.9' });
    ok('a banned ip_hash is refused with 403', bannedIp.status === 403, bannedIp.text);

    const other1 = await call(env, 'POST', '/', { body: newNote(), ip: '198.51.100.20' });
    const other2 = await call(env, 'POST', '/', { body: newNote(), ip: '198.51.100.21' });
    const overflow = await call(env, 'POST', '/', { body: newNote(), ip: '198.51.100.22' });
    ok('the guestbook fills up to MAX_NOTES',
      other1.status === 201 && other2.status === 201, other1.status + ',' + other2.status);
    ok('past MAX_NOTES a new note is refused with 409', overflow.status === 409, overflow.text);

    const flood = newNote();
    await call(env, 'POST', '/', { body: flood, ip: '198.51.100.30' }); // rejected: full
    const host = (await call(env, 'GET', '/')).json.notes[0];
    host.replies = [{ name: 'a', body: 'x' }, { name: 'b', body: 'y' }, { name: 'c', body: 'z' }];
    const tooMany = await call(env, 'PUT', '/' + host.id, { body: host, ip: '198.51.100.31' });
    ok('more than 2 new replies in one PUT is refused with 422', tooMany.status === 422, tooMany.text);
  }

  /* --------------------------------------------------------- moderation */
  group('moderation');
  {
    const env = makeEnv();
    const note = newNote();
    await call(env, 'POST', '/', { body: note });

    const noToken = await call(env, 'DELETE', '/' + note.id);
    ok('DELETE without a token is 401', noToken.status === 401, noToken.text);

    const wrongToken = await call(env, 'DELETE', '/' + note.id, { token: 'not-the-token' });
    ok('DELETE with the wrong token is 401', wrongToken.status === 401, wrongToken.text);

    const hidden = await call(env, 'DELETE', '/' + note.id + '?hide=1', { token: 'test-admin-token' });
    ok('DELETE ?hide=1 with the token hides the note', hidden.status === 200, hidden.text);

    const publicList = await call(env, 'GET', '/');
    ok('a hidden note is excluded from GET', publicList.json.notes.length === 0,
      JSON.stringify(publicList.json.notes));

    const adminList = await call(env, 'GET', '/?include_hidden=1', { token: 'test-admin-token' });
    ok('the owner can still see it with include_hidden=1',
      adminList.json.notes.length === 1 && adminList.json.notes[0].hidden === true,
      JSON.stringify(adminList.json.notes));

    const unhide = await call(env, 'PUT', '/' + note.id, {
      body: Object.assign({}, note, { hidden: false }), token: 'test-admin-token'
    });
    ok('the owner can unhide with a PUT', unhide.status === 200 && unhide.json.hidden === false, unhide.text);
    ok('the unhidden note is public again', (await call(env, 'GET', '/')).json.notes.length === 1);

    const edited = await call(env, 'PUT', '/' + note.id, {
      body: Object.assign({}, note, { body: 'edited by the owner' }), token: 'test-admin-token'
    });
    ok('the owner may edit the text a visitor cannot',
      edited.json.body === 'edited by the owner', edited.text);

    const gone = await call(env, 'DELETE', '/' + note.id, { token: 'test-admin-token' });
    ok('DELETE with the token removes the note', gone.status === 200, gone.text);
    ok('the guestbook is empty again', (await call(env, 'GET', '/')).json.notes.length === 0);

    const missing = await call(env, 'DELETE', '/nope', { token: 'test-admin-token' });
    ok('DELETE of an unknown id is 404', missing.status === 404, missing.text);

    const noAdminConfigured = makeEnv({ ADMIN_TOKEN: '' });
    const n2 = newNote();
    await call(noAdminConfigured, 'POST', '/', { body: n2 });
    const empty = await call(noAdminConfigured, 'DELETE', '/' + n2.id, { token: '' });
    ok('with no ADMIN_TOKEN configured, nobody is an admin', empty.status === 401, empty.text);
  }

  /* ------------------------------------------------------------- errors */
  group('error handling');
  {
    const broken = makeEnv();
    broken.DB = { prepare() { throw new Error('D1_ERROR: at line 42 in some/internal/path.js'); } };
    const res = await call(broken, 'GET', '/');
    ok('a database failure is a flat 500', res.status === 500, res.text);
    ok('no stack trace reaches the client',
      res.json && res.json.error === 'internal error' && !/line 42|path\.js/.test(res.text), res.text);
    ok('even the 500 keeps its CORS header',
      res.headers.get('access-control-allow-origin') === ORIGIN);
  }

  /* ------------------------------------------------------------- report */
  console.log('\n' + '='.repeat(62));
  console.log(pass + ' passed, ' + fail + ' failed');
  if (fail) {
    console.log('\nfailures:');
    failures.forEach(f => console.log('  - ' + f));
  }
  console.log('='.repeat(62));
  process.exit(fail ? 1 : 0);
}

/* ----------------------------------------------------------- serve mode
   `node mock/harness.js --serve` puts the same handler behind a plain Node
   http server so test.sh can be pointed at http://127.0.0.1:8787. */

async function serve() {
  const env = makeEnv();
  const port = Number(process.env.PORT || 8787);

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers.set(k, v);
    }
    // Stand in for Cloudflare's edge header so the rate limiter sees an IP.
    if (!headers.has('cf-connecting-ip')) {
      headers.set('cf-connecting-ip', req.socket.remoteAddress || '127.0.0.1');
    }

    const request = new Request('http://localhost:' + port + req.url, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body
    });

    const out = await worker.fetch(request, env, CTX);
    const outBody = Buffer.from(await out.arrayBuffer());
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(outBody);
  });

  server.listen(port, '127.0.0.1', () => {
    console.log('guestbook mock listening on http://127.0.0.1:' + port);
    console.log('allowed origins: ' + env.ALLOWED_ORIGINS);
    console.log('admin token:     ' + env.ADMIN_TOKEN);
  });
}

if (process.argv.includes('--serve')) serve();
else main();
