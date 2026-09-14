/* ==========================================================================
   A D1 stand-in built on node:sqlite (Node 22.5+), so worker.js can be run
   and tested on this laptop without a Cloudflare account.

   It implements the slice of the D1 client API that worker.js actually uses:

     db.prepare(sql).bind(...).first()  -> first row or null
     db.prepare(sql).bind(...).all()    -> { results: [...] }
     db.prepare(sql).bind(...).run()    -> { meta: { changes } }

   D1 uses ?1 / ?2 positional parameters, which is also plain SQLite syntax,
   so the statements go through untouched.
   ========================================================================== */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

class Statement {
  constructor(db, sql, args) {
    this.db = db;
    this.sql = sql;
    this.args = args || [];
  }

  bind(...args) {
    return new Statement(this.db, this.sql, args);
  }

  #prepared() {
    return this.db.prepare(this.sql);
  }

  // SELECT, or anything with RETURNING, comes back as rows.
  #returnsRows() {
    return /^\s*(select|with)/i.test(this.sql) || /\breturning\b/i.test(this.sql);
  }

  async first() {
    const stmt = this.#prepared();
    if (this.#returnsRows()) {
      const row = stmt.get(...this.args);
      return row === undefined ? null : row;
    }
    stmt.run(...this.args);
    return null;
  }

  async all() {
    const stmt = this.#prepared();
    if (this.#returnsRows()) return { results: stmt.all(...this.args), success: true };
    const info = stmt.run(...this.args);
    return { results: [], success: true, meta: { changes: Number(info.changes) } };
  }

  async run() {
    const stmt = this.#prepared();
    if (this.#returnsRows()) {
      const rows = stmt.all(...this.args);
      return { results: rows, success: true, meta: { changes: rows.length } };
    }
    const info = stmt.run(...this.args);
    return {
      success: true,
      meta: {
        changes: Number(info.changes),
        last_row_id: Number(info.lastInsertRowid)
      }
    };
  }
}

export function makeD1(schemaPath, file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec(fs.readFileSync(schemaPath, 'utf8'));
  return {
    raw: db,
    prepare(sql) { return new Statement(db, sql); }
  };
}
