// Erzeugt die App-Icons (Home-Bildschirm/PWA) ohne externe Bibliothek:
// ein paar Kreise, direkt als PNG geschrieben.  Aufruf: npm run icons
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const SIZES = [180, 192, 512];
const BACKGROUND = [20, 17, 15];
const RING = [200, 162, 90];
const LENS = [38, 33, 30];
const GLINT = [255, 250, 240];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(pixels, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Weicher Uebergang an der Kante eines Kreises - ergibt saubere Rundungen. */
function coverage(distance, radius, feather) {
  return Math.min(1, Math.max(0, (radius - distance) / feather));
}

function blend(base, layer, alpha) {
  return base.map((channel, i) => Math.round(channel + (layer[i] - channel) * alpha));
}

function renderIcon(size) {
  const feather = Math.max(1, size / 120);
  const center = (size - 1) / 2;
  // Eine Zeile besteht aus dem Filter-Byte 0 plus size * RGBA.
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - center, y - center);
      let color = BACKGROUND;
      color = blend(color, RING, coverage(distance, size * 0.38, feather));
      color = blend(color, LENS, coverage(distance, size * 0.3, feather));
      const glintDistance = Math.hypot(x - size * 0.4, y - size * 0.38);
      color = blend(color, GLINT, coverage(glintDistance, size * 0.06, feather) * 0.85);
      const offset = rowStart + 1 + x * 4;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = 255;
    }
  }
  return encodePng(size, raw);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = path.join(OUT_DIR, `icon-${size}.png`);
  fs.writeFileSync(file, renderIcon(size));
  console.log(`geschrieben: ${path.relative(process.cwd(), file)}`);
}
