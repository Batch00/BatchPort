// Generates the BatchPort PWA icon set from a single SVG mark (a minimal globe
// in electric blue on the dark app background). Uses sharp to rasterize.
//
// Outputs:
//   public/icons/icon-{48,72,96,128,144,192,384,512}.png  (purpose: any)
//   public/icons/icon-maskable-{192,512}.png              (Android safe zone)
//   public/icons/apple-touch-icon.png                     (180, full bleed)
//   public/icons/icon-32.png                              (favicon size)
//   src/app/favicon.ico                                   (32px PNG in an ICO)
//
// Re-run with: node scripts/generate-icons.mjs

import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const iconsDir = join(root, "public", "icons");
mkdirSync(iconsDir, { recursive: true });

const BRAND = "#2563eb"; // electric blue, matches var(--brand)
const DARK = "#0a0a0a"; // app background

// A minimal globe: a ring, a meridian ellipse, and three latitude lines.
// fullBleed drops the rounded corners (for maskable and apple icons); markScale
// keeps the mark inside the maskable safe zone when smaller.
function buildSvg(size, { fullBleed = false, markScale = 0.3 } = {}) {
  const center = size / 2;
  const radius = size * markScale;
  const stroke = Math.max(1.5, size * 0.05);
  const corner = fullBleed ? 0 : size * 0.22;
  const latitude = (dy, halfWidth) =>
    `<line x1="${center - halfWidth}" y1="${center + dy}" x2="${
      center + halfWidth
    }" y2="${center + dy}" />`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${corner}" fill="${DARK}"/>
  <g fill="none" stroke="${BRAND}" stroke-width="${stroke}" stroke-linecap="round">
    <circle cx="${center}" cy="${center}" r="${radius}"/>
    <ellipse cx="${center}" cy="${center}" rx="${radius * 0.5}" ry="${radius}"/>
    ${latitude(0, radius)}
    ${latitude(-radius * 0.5, radius * 0.86)}
    ${latitude(radius * 0.5, radius * 0.86)}
  </g>
</svg>`;
}

function renderPng(size, options) {
  return sharp(Buffer.from(buildSvg(size, options))).png().toBuffer();
}

// Wrap a 32x32 PNG in a single-image ICO container. Modern browsers read the
// embedded PNG directly.
function buildIco(pngBuffer) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // image count
  const entry = Buffer.alloc(16);
  entry.writeUInt8(32, 0); // width
  entry.writeUInt8(32, 1); // height
  entry.writeUInt8(0, 2); // palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8); // size of image data
  entry.writeUInt32LE(22, 12); // offset (6 + 16)
  return Buffer.concat([header, entry, pngBuffer]);
}

const STANDARD_SIZES = [48, 72, 96, 128, 144, 192, 384, 512];

for (const size of STANDARD_SIZES) {
  writeFileSync(join(iconsDir, `icon-${size}.png`), await renderPng(size));
}

for (const size of [192, 512]) {
  writeFileSync(
    join(iconsDir, `icon-maskable-${size}.png`),
    await renderPng(size, { fullBleed: true, markScale: 0.22 }),
  );
}

writeFileSync(
  join(iconsDir, "apple-touch-icon.png"),
  await renderPng(180, { fullBleed: true, markScale: 0.3 }),
);

const favicon = await renderPng(32);
writeFileSync(join(iconsDir, "icon-32.png"), favicon);
writeFileSync(join(root, "src", "app", "favicon.ico"), buildIco(favicon));

console.log(
  `Generated ${STANDARD_SIZES.length} standard icons, 2 maskable, apple-touch, favicon-32, and favicon.ico.`,
);
