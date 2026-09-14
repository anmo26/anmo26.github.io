/**
 * dsstore.js — a minimal .DS_Store reader.
 *
 * .DS_Store is an Apple "Buddy allocator" (magic "Bud1") file containing a
 * B-tree of records keyed by filename. We only care about the `Iloc` record,
 * which holds the icon's (x, y) position inside the Finder icon view.
 *
 * No dependencies. Returns {} for anything it can't understand, so a missing
 * or exotic .DS_Store just means "this folder has no freeform layout".
 */
import fs from 'fs';

function readRecord(buf, q, out) {
  const nameLen = buf.readUInt32BE(q); q += 4;
  const nameBuf = Buffer.from(buf.subarray(q, q + nameLen * 2));
  nameBuf.swap16(); // UTF-16BE on disk -> UTF-16LE for node
  const name = nameBuf.toString('utf16le');
  q += nameLen * 2;

  const structId = buf.toString('ascii', q, q + 4); q += 4;
  const dataType = buf.toString('ascii', q, q + 4); q += 4;

  let value = null;
  switch (dataType) {
    case 'bool': value = buf.readUInt8(q) !== 0; q += 1; break;
    case 'long':
    case 'shor': value = buf.readUInt32BE(q); q += 4; break;
    case 'type': value = buf.toString('ascii', q, q + 4); q += 4; break;
    case 'comp':
    case 'dutc': value = buf.readBigUInt64BE(q); q += 8; break;
    case 'blob': {
      const n = buf.readUInt32BE(q); q += 4;
      value = buf.subarray(q, q + n); q += n;
      break;
    }
    case 'ustr': {
      const n = buf.readUInt32BE(q); q += 4;
      const b = Buffer.from(buf.subarray(q, q + n * 2));
      b.swap16();
      value = b.toString('utf16le'); q += n * 2;
      break;
    }
    default:
      throw new Error(`unknown .DS_Store data type "${dataType}"`);
  }

  if (structId === 'Iloc' && Buffer.isBuffer(value) && value.length >= 8) {
    const x = value.readUInt32BE(0);
    const y = value.readUInt32BE(4);
    // 0xFFFFFFFF means "no position recorded"
    if (x !== 0xffffffff && y !== 0xffffffff) {
      (out[name] ??= {}).Iloc = { x, y };
    }
  } else if (structId === 'BKGD' || structId === 'ICVO' || structId === 'icvo') {
    (out[name] ??= {})[structId] = value;
  }

  return q;
}

export function parseDSStore(filePath) {
  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch {
    return {};
  }

  try {
    if (buf.length < 36) return {};
    if (buf.readUInt32BE(0) !== 1) return {};
    if (buf.toString('ascii', 4, 8) !== 'Bud1') return {};

    // All allocator offsets are relative to byte 4 of the file.
    const infoOffset = buf.readUInt32BE(8) + 4;

    let p = infoOffset;
    const numBlocks = buf.readUInt32BE(p); p += 4;
    p += 4; // unknown

    const blocks = [];
    for (let i = 0; i < numBlocks; i++) {
      blocks.push(buf.readUInt32BE(p)); p += 4;
    }

    // The block-address table is zero-padded out to a multiple of 256 entries.
    p = infoOffset + 8 + Math.max(1, Math.ceil(numBlocks / 256)) * 256 * 4;

    const numDirs = buf.readUInt32BE(p); p += 4;
    const dirs = {};
    for (let i = 0; i < numDirs; i++) {
      const len = buf.readUInt8(p); p += 1;
      const name = buf.toString('ascii', p, p + len); p += len;
      dirs[name] = buf.readUInt32BE(p); p += 4;
    }

    if (!('DSDB' in dirs)) return {};

    const blockAt = (id) => {
      const addr = blocks[id];
      if (addr === undefined) throw new Error(`bad block id ${id}`);
      return { offset: (addr & ~0x1f) + 4, size: 1 << (addr & 0x1f) };
    };

    const master = blockAt(dirs['DSDB']).offset;
    const rootId = buf.readUInt32BE(master);

    const out = {};
    const seen = new Set();

    const visit = (id) => {
      if (seen.has(id)) return; // cycle guard
      seen.add(id);

      let q = blockAt(id).offset;
      const P = buf.readUInt32BE(q); q += 4;
      const count = buf.readUInt32BE(q); q += 4;

      if (P === 0) {
        for (let i = 0; i < count; i++) q = readRecord(buf, q, out);
      } else {
        for (let i = 0; i < count; i++) {
          const child = buf.readUInt32BE(q); q += 4;
          visit(child);
          q = readRecord(buf, q, out);
        }
        visit(P);
      }
    };

    visit(rootId);
    return out;
  } catch {
    return {};
  }
}
