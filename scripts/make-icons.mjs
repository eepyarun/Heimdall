// Generates the PWA / iOS home-screen PNG icons without any image dependencies.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const YELLOW = [255, 210, 63, 255];
const DARK = [11, 13, 18, 255];

// A watchful eye: dark almond shape with a yellow iris on a yellow field.
function eye(u, v) {
  const x = (u - 0.5) * 2;
  const y = (v - 0.5) * 2;
  const almond = Math.abs(y) < 0.42 * (1 - x * x) && Math.abs(x) < 0.82;
  const r = Math.hypot(x, y);
  if (r < 0.13) return DARK;
  if (r < 0.27 && almond) return YELLOW;
  if (almond) return DARK;
  return YELLOW;
}

mkdirSync('public/icons', { recursive: true });
for (const s of [180, 192, 512]) writeFileSync(`public/icons/icon-${s}.png`, png(s, eye));
console.log('icons written');
