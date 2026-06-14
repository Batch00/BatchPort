// Generates placeholder PWA icons (no external dependencies).
// Produces a dark icon with a brand-blue mark plus a full-bleed maskable variant.
// Re-run with: node scripts/generate-icons.mjs
import { deflateSync, crc32 } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "public", "icons");

const BRAND = [0x25, 0x63, 0xeb]; // #2563EB electric blue
const DARK = [0x0a, 0x0a, 0x0a]; // near black background

// Build a single PNG chunk: length, type, data, crc32(type + data).
function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// Render an RGBA solid-color background with a centered filled circle.
function renderPng(size, bg, fg, radiusRatio) {
  const radius = size * radiusRatio;
  const cx = size / 2;
  const cy = size / 2;
  const rowBytes = size * 4;
  // One extra byte per row for the PNG filter type (0 = none).
  const raw = Buffer.alloc(size * (rowBytes + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const inside = dx * dx + dy * dy <= radius * radius;
      const c = inside ? fg : bg;
      const p = rowStart + 1 + x * 4;
      raw[p] = c[0];
      raw[p + 1] = c[1];
      raw[p + 2] = c[2];
      raw[p + 3] = 0xff;
    }
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(outDir, { recursive: true });

const icons = [
  { file: "icon-192.png", size: 192, bg: DARK, fg: BRAND, radius: 0.32 },
  { file: "icon-512.png", size: 512, bg: DARK, fg: BRAND, radius: 0.32 },
  // Maskable: full-bleed brand background, mark stays inside the 80% safe zone.
  { file: "icon-maskable-512.png", size: 512, bg: BRAND, fg: DARK, radius: 0.3 },
];

for (const { file, size, bg, fg, radius } of icons) {
  const png = renderPng(size, bg, fg, radius);
  writeFileSync(join(outDir, file), png);
  console.log(`wrote public/icons/${file} (${png.length} bytes)`);
}
