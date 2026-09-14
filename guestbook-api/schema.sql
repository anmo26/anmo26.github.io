-- ===========================================================================
-- guestbook-api — D1 (SQLite) schema
--
-- Apply with:
--   npx wrangler d1 execute garden-guestbook --remote --file=./schema.sql
--
-- Safe to re-run: every statement is IF NOT EXISTS.
-- ===========================================================================

-- --------------------------------------------------------------- the notes
-- `replies` is a JSON array of { name, body, at }. Replies are append-only,
-- are read and written only as a whole note, and a note holds at most a
-- hundred of them — so a column is simpler and faster here than a join table.
CREATE TABLE IF NOT EXISTS notes (
  id         TEXT    PRIMARY KEY,              -- the id the client minted
  name       TEXT    NOT NULL DEFAULT 'anonymous',
  body       TEXT    NOT NULL,
  at         INTEGER NOT NULL,                 -- ms since epoch, server clock
  colour     INTEGER NOT NULL DEFAULT 0,       -- 0..4, app.js does `colour % 5`
  x          INTEGER NOT NULL DEFAULT 0,       -- dragged position, page pixels
  y          INTEGER NOT NULL DEFAULT 0,
  replies    TEXT    NOT NULL DEFAULT '[]',
  hidden     INTEGER NOT NULL DEFAULT 0,       -- 1 = withheld from GET
  ip_hash    TEXT,                             -- salted SHA-256, never the IP
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- The only read the site ever makes: visible notes, oldest first.
CREATE INDEX IF NOT EXISTS notes_visible ON notes (hidden, at);

-- For moderation: "show me everything this poster left".
CREATE INDEX IF NOT EXISTS notes_ip_hash ON notes (ip_hash);

-- ------------------------------------------------------------ rate limiting
-- One row per (ip_hash, action, hour). Counted in D1 rather than the Cache
-- API because the Cache API is per-datacentre and evictable, so a count kept
-- there is neither global nor reliable. See the comment in worker.js.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       TEXT    PRIMARY KEY,            -- "<ip_hash>:<action>:<window>"
  hits         INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);

-- Used by the occasional sweep of dead windows.
CREATE INDEX IF NOT EXISTS rate_limits_expires ON rate_limits (expires_at);

-- ------------------------------------------------------------------ banning
-- Filled in by hand by the site owner. Two kinds:
--
--   word     a lowercase substring; a note or reply containing it is refused
--   ip_hash  the opaque token from the notes table, not an actual IP
--
--   npx wrangler d1 execute garden-guestbook --remote \
--     --command "INSERT INTO banned (kind, value, note) VALUES ('word','casino','spam wave')"
CREATE TABLE IF NOT EXISTS banned (
  kind     TEXT    NOT NULL CHECK (kind IN ('word', 'ip_hash')),
  value    TEXT    NOT NULL,
  note     TEXT,                               -- why, for your own memory
  added_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (kind, value)
);

-- The word list is scanned in full on every post, so keep it short; the index
-- is what makes the ip_hash lookup a single probe.
CREATE INDEX IF NOT EXISTS banned_kind ON banned (kind);
