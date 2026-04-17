/**
 * Generates icon PNG files for the Chrome extension.
 * Run: node generate-icons.js
 * Requires: Node.js (no external packages)
 */

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

function crc32(buf) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const td = Buffer.concat([t, data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crcBuf]);
}

function makePNG(size, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // RGB

  const cx = size / 2, cy = size / 2, radius = size * 0.42;
  const hi = [r, g, b], bg = [255, 255, 255];

  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0; // no filter
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const px = d <= radius ? hi : bg;
      row[1 + x * 3] = px[0];
      row[2 + x * 3] = px[1];
      row[3 + x * 3] = px[2];
    }
    rows.push(row);
  }

  const raw = Buffer.concat(rows);
  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = path.join(__dirname, 'icons');
if (!fs.existsSync(dir)) fs.mkdirSync(dir);

const MYNTRA_PINK = [255, 62, 108]; // #FF3E6C

for (const size of [16, 48, 128]) {
  const png = makePNG(size, MYNTRA_PINK);
  const file = path.join(dir, `icon${size}.png`);
  fs.writeFileSync(file, png);
  console.log(`✓ icons/icon${size}.png`);
}

console.log('\nDone. Load the extension in chrome://extensions → Load unpacked.');
