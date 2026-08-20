// Generates a 1024x1024 crosshair app icon (dark gradient + amber reticle).
// Pure Node built-ins only (zlib). Output: app-icon.png
const zlib = require('zlib');
const fs = require('fs');

const SIZE = 1024;
const CX = SIZE / 2;
const CY = SIZE / 2;
const img = Buffer.alloc(SIZE * SIZE * 4);

function setPx(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  img[i] = r; img[i + 1] = g; img[i + 2] = b; img[i + 3] = a;
}

// --- Background: vertical gradient (#0e1219 -> #1b2330) ---
for (let y = 0; y < SIZE; y++) {
  const t = y / (SIZE - 1);
  const r = Math.round(14 + (27 - 14) * t);
  const g = Math.round(18 + (35 - 18) * t);
  const b = Math.round(25 + (48 - 25) * t);
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    img[i] = r; img[i + 1] = g; img[i + 2] = b; img[i + 3] = 255;
  }
}

// --- Vignette: darken corners for depth ---
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dx = (x - CX) / CX, dy = (y - CY) / CY;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 0.8) {
      const k = Math.min(1, (d - 0.8) / 0.55);
      const i = (y * SIZE + x) * 4;
      img[i] = Math.round(img[i] * (1 - 0.45 * k));
      img[i + 1] = Math.round(img[i + 1] * (1 - 0.45 * k));
      img[i + 2] = Math.round(img[i + 2] * (1 - 0.45 * k));
    }
  }
}

// --- Reticle colors ---
const AMBER = [240, 165, 61];   // main crosshair
const WHITE = [255, 226, 180];  // center dot

const BAR_HALF = 250;   // bar extends from center to just before the ring
const BAR_T = 17;       // half thickness of bars
const RING_R = 270;     // ring radius
const RING_T = 14;      // ring half thickness
const DOT_R = 46;       // center dot radius

function drawRing() {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - CX, y - CY);
      if (Math.abs(d - RING_R) <= RING_T) {
        setPx(x, y, AMBER[0], AMBER[1], AMBER[2], 255);
      }
    }
  }
}

function drawBars() {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - CX, dy = y - CY;
      const inBar =
        (Math.abs(dx) <= BAR_T && Math.abs(dy) <= BAR_HALF) ||
        (Math.abs(dy) <= BAR_T && Math.abs(dx) <= BAR_HALF);
      if (inBar) setPx(x, y, AMBER[0], AMBER[1], AMBER[2], 255);
    }
  }
}

function drawDot() {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - CX, y - CY);
      if (d <= DOT_R) {
        // soft edge on the dot
        const edge = Math.max(0, Math.min(1, (DOT_R - d) / 6));
        setPx(x, y, WHITE[0], WHITE[1], WHITE[2], Math.round(255 * edge));
      }
    }
  }
}

drawRing();
drawBars();
drawDot();

// --- PNG encoding ---
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE((zlib.crc32(Buffer.concat([t, data])) >>> 0), 0);
  return Buffer.concat([len, t, data, crc]);
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type: RGBA

const stride = SIZE * 4 + 1;
const raw = Buffer.alloc(SIZE * stride);
for (let y = 0; y < SIZE; y++) {
  raw[y * stride] = 0; // filter: none
  img.copy(raw, y * stride + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const idat = zlib.deflateSync(raw, { level: 9 });

fs.writeFileSync('app-icon.png', Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]));
console.log('Wrote app-icon.png');
