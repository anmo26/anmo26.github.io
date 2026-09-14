/**
 * imagesize.js — read pixel dimensions straight out of file headers.
 * Falls back to macOS `sips` for formats we don't parse (HEIC, TIFF, ...).
 */
import fs from 'fs';
import { spawnSync } from 'child_process';

function fromHeader(buf) {
  // PNG
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // GIF
  if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'GIF') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  // WebP (VP8 / VP8L / VP8X)
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') {
      const w = buf[24] | (buf[25] << 8) | (buf[26] << 16);
      const h = buf[27] | (buf[28] << 8) | (buf[29] << 16);
      return { width: w + 1, height: h + 1 };
    }
  }
  // JPEG — walk the segment markers to the SOFn frame header
  if (buf.length > 4 && buf.readUInt16BE(0) === 0xffd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      // SOF0..SOF15, excluding DHT(c4), JPG(c8) and DAC(cc)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  // SVG — pull width/height or the viewBox out of the opening tag
  const head = buf.toString('utf8', 0, Math.min(buf.length, 2048));
  if (head.includes('<svg')) {
    const w = head.match(/\bwidth="([\d.]+)/);
    const h = head.match(/\bheight="([\d.]+)/);
    if (w && h) return { width: Math.round(+w[1]), height: Math.round(+h[1]) };
    const vb = head.match(/viewBox="[\d.\-]+\s+[\d.\-]+\s+([\d.]+)\s+([\d.]+)/);
    if (vb) return { width: Math.round(+vb[1]), height: Math.round(+vb[2]) };
  }
  return null;
}

/**
 * The EXIF orientation flag of a JPEG, 1-8, or null when there isn't one.
 *
 * A camera held sideways does not rewrite the pixels -- it stores the photo
 * the way the sensor read it and notes which way up it should be shown. Both
 * the browser and `sips` honour that note, so the picture on screen is often
 * the transpose of the numbers sitting in the frame header. Reading the flag
 * is the only way the generator can describe a photo the way it will actually
 * appear rather than the way it happens to be stored.
 */
function jpegOrientation(buf) {
  if (!(buf.length > 4 && buf.readUInt16BE(0) === 0xffd8)) return null;
  let i = 2;
  while (i < buf.length - 4) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xda) return null;              // start of scan: past all metadata
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xe1 && buf.toString('ascii', i + 4, i + 10) === 'Exif\0\0') {
      const tiff = i + 10;
      if (tiff + 8 > buf.length) return null;
      const order = buf.toString('ascii', tiff, tiff + 2);
      if (order !== 'II' && order !== 'MM') return null;
      const be = order === 'MM';
      const u16 = o => (be ? buf.readUInt16BE(o) : buf.readUInt16LE(o));
      const u32 = o => (be ? buf.readUInt32BE(o) : buf.readUInt32LE(o));
      const ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > buf.length) return null;
      const count = u16(ifd);
      for (let e = 0; e < count; e++) {
        const entry = ifd + 2 + e * 12;
        if (entry + 12 > buf.length) return null;
        if (u16(entry) === 0x0112) {
          const v = u16(entry + 8);
          return v >= 1 && v <= 8 ? v : null;
        }
      }
      return null;
    }
    i += 2 + len;
  }
  return null;
}

function fromSips(filePath) {
  const r = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', filePath], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout) return null;
  const w = r.stdout.match(/pixelWidth:\s*(\d+)/);
  const h = r.stdout.match(/pixelHeight:\s*(\d+)/);
  return w && h ? { width: +w[1], height: +h[1] } : null;
}

export function imageSize(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(65536);
    const read = fs.readSync(fd, buf, 0, 65536, 0);
    fs.closeSync(fd);
    const head = buf.subarray(0, read);
    const size = fromHeader(head) ?? fromSips(filePath);
    if (!size) return null;

    // Orientations 5-8 are the quarter turns: the photo is displayed with its
    // stored width and height swapped. Reporting the stored pair would have
    // the page reserve a landscape hole for a portrait picture, so everything
    // below it jumps once the real image arrives.
    const o = jpegOrientation(head);
    if (o >= 5 && o <= 8) return { width: size.height, height: size.width };
    return size;
  } catch {
    return null;
  }
}

/** Dimensions of a video, via avconvert/ffprobe-free macOS tooling. */
export function videoSize(filePath) {
  const r = spawnSync('mdls', ['-name', 'kMDItemPixelWidth', '-name', 'kMDItemPixelHeight', '-raw', filePath], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout) return null;
  const [w, h] = r.stdout.trim().split('\n').map(s => parseInt(s, 10));
  return Number.isFinite(w) && Number.isFinite(h) ? { width: w, height: h } : null;
}
