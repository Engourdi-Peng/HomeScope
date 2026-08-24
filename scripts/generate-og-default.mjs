// Quick generator for og-default.png (1200x630) — produces a solid color
// background with brand text. Pure Node, no external deps.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const W = 1200;
const H = 630;

// Solid background color (dark indigo)
const BG = [22, 27, 56];
// Accent gradient for stripes
const ACCENT = [99, 102, 241];
const FG = [255, 255, 255];
const MUTED = [180, 185, 220];

// Pre-rendered "raster" content using a tiny PPM-style buffer is heavy; instead,
// we write a real PNG with zlib + manual scanlines and a gradient/dot pattern.
// Keeping it dependency-free.

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  const crcVal = crc32(Buffer.concat([typeBuf, data]));
  crc.writeUInt32BE(crcVal >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Build raw RGB scanlines (filter byte 0 + RGB triplets).
const raw = Buffer.alloc(H * (1 + W * 3));
let off = 0;
for (let y = 0; y < H; y++) {
  raw[off++] = 0; // filter: None
  for (let x = 0; x < W; x++) {
    // Soft gradient + diagonal accent strip
    const t = y / H;
    const r = Math.round(BG[0] + (ACCENT[0] - BG[0]) * t * 0.35);
    const g = Math.round(BG[1] + (ACCENT[1] - BG[1]) * t * 0.35);
    const b = Math.round(BG[2] + (ACCENT[2] - BG[2]) * t * 0.35);
    // Accent diagonal band
    const inBand = (x + y) > W * 1.05 && (x + y) < W * 1.18;
    let R = r, G = g, B = b;
    if (inBand) {
      const k = ((x + y) - W * 1.05) / (W * 0.13);
      R = Math.round(r + (ACCENT[0] - r) * k);
      G = Math.round(g + (ACCENT[1] - g) * k);
      B = Math.round(b + (ACCENT[2] - b) * k);
    }
    raw[off++] = R;
    raw[off++] = G;
    raw[off++] = B;
  }
}

// Add simple bitmap text by overwriting pixels.
// We render "HomeScope" + tagline using a hard-coded 5x7 bitmap glyph set for the chars we need.
const GLYPHS = {
  'H': ['01110','10001','10001','11111','10001','10001','10001'],
  'o': ['00000','00000','01110','10001','10001','10001','01110'],
  'm': ['00000','00000','11010','10101','10101','10101','10101'],
  'e': ['00000','00000','01110','10001','11111','10000','01110'],
  'S': ['01111','10000','10000','01110','00001','00001','11110'],
  'c': ['00000','00000','01110','10000','10000','10000','01110'],
  'p': ['00000','00000','11110','10001','11110','10000','10000'],
  '|': ['00100','00100','00100','00100','00100','00100','00100'],
  'A': ['01110','10001','10001','11111','10001','10001','10001'],
  'I': ['11111','00100','00100','00100','00100','00100','11111'],
  'r': ['00000','00000','10110','11000','10000','10000','10000'],
  'n': ['00000','00000','10110','11001','10001','10001','10001'],
  'l': ['10000','10000','10000','10000','10000','10000','01110'],
  'y': ['00000','00000','10001','10001','01010','00100','11000'],
  'z': ['00000','00000','11111','00010','00100','01000','11111'],
  'u': ['00000','00000','10001','10001','10001','10011','01101'],
  'd': ['00001','00001','01111','10001','10001','10001','01110'],
  ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  ',': ['00000','00000','00000','00000','00000','01100','01000'],
  'g': ['00000','00000','01110','10001','01111','00001','01110'],
  't': ['01000','01000','11110','01000','01000','01001','00110'],
  'b': ['10000','10000','11110','10001','10001','10001','11110'],
  'k': ['10000','10000','10010','10100','11000','10100','10010'],
  'f': ['00110','01000','11110','01000','01000','01000','01000'],
  'h': ['10000','10000','11110','10001','10001','10001','10001'],
  'w': ['00000','00000','10001','10001','10101','10101','01010'],
  'a': ['00000','00000','01110','00001','01111','10001','01111'],
  'v': ['00000','00000','10001','10001','10001','01010','00100'],
  'i': ['00100','00000','01100','00100','00100','00100','01110'],
  'q': ['00000','00000','01110','10001','01111','00001','11110'],
  'R': ['11110','10001','10001','11110','10100','10010','10001'],
  'P': ['11110','10001','10001','11110','10000','10000','10000'],
  'x': ['00000','00000','10001','01010','00100','01010','10001'],
  'j': ['00100','00000','01100','00100','00100','00100','11000'],
  '.': ['00000','00000','00000','00000','00000','00000','01000'],
  'O': ['01110','10001','10001','10001','10001','10001','01110'],
  'T': ['11111','00100','00100','00100','00100','00100','00100'],
};

function drawText(text, x0, y0, scale, color) {
  let cursor = x0;
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    if (!glyph) { cursor += 6 * scale; continue; }
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] === '1') {
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const px = cursor + col * scale + dx;
              const py = y0 + row * scale + dy;
              if (px < 0 || px >= W || py < 0 || py >= H) continue;
              const idx = py * (1 + W * 3) + 1 + px * 3;
              raw[idx] = color[0];
              raw[idx + 1] = color[1];
              raw[idx + 2] = color[2];
            }
          }
        }
      }
    }
    cursor += 6 * scale;
  }
}

// Center brand mark + tagline
const title = 'HomeScope';
const tagline = 'AI Property Analyzer for Zillow and realestate.com.au';
const sub = 'tryhomescope.com';

// Measure text widths (5 cols + 1 spacing per glyph).
function textWidth(text, scale) { return text.length * 6 * scale - scale; }

const titleScale = 12;
const taglineScale = 4;
const subScale = 3;

drawText(title, Math.round((W - textWidth(title, titleScale)) / 2), 220, titleScale, FG);
drawText(tagline, Math.round((W - textWidth(tagline, taglineScale)) / 2), 360, taglineScale, MUTED);
drawText(sub, Math.round((W - textWidth(sub, subScale)) / 2), 560, subScale, MUTED);

// Add a thin horizontal accent line under the title.
const lineY = 340;
for (let x = 380; x < 820; x++) {
  const idx = lineY * (1 + W * 3) + 1 + x * 3;
  raw[idx] = ACCENT[0]; raw[idx + 1] = ACCENT[1]; raw[idx + 2] = ACCENT[2];
}

// PNG encode
const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type RGB
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const idat = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  sig,
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', idat),
  pngChunk('IEND', Buffer.alloc(0)),
]);

const outPath = path.resolve(process.argv[2] || 'public/og-default.png');
fs.writeFileSync(outPath, png);
console.log(`Wrote ${outPath} (${png.length} bytes, ${W}x${H})`);