// Canvas plumbing shared by the poster and the share card: how big a bitmap
// this browser will actually give us, how to get the app's own typeface onto
// it, how to load a photo without tainting it, and how to get the result off
// the page.
//
// Client-only. Every entry point here is called from a "use client" component.

// --- Resolution -------------------------------------------------------------

/**
 * Browsers cap canvas size, and they disagree about where. Chrome and Firefox
 * allow hundreds of megapixels; Safari (desktop and iOS alike) stops at
 * 16,777,216 pixels of area and hands back a canvas that silently reads as
 * blank past it. There is no feature query for this, so the only reliable
 * answer is to make one and look at it.
 */
function canvasUsable(width: number, height: number): boolean {
  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    if (canvas.width !== width || canvas.height !== height) return false;
    const context = canvas.getContext("2d");
    if (!context) return false;
    // The far corner is the part an over-large canvas fails to allocate.
    context.fillStyle = "#ffffff";
    context.fillRect(width - 1, height - 1, 1, 1);
    return context.getImageData(width - 1, height - 1, 1, 1).data[3] === 255;
  } catch {
    return false;
  } finally {
    if (canvas) {
      // Release the backing store immediately rather than waiting for GC to
      // notice tens of megabytes it cannot see the size of.
      canvas.width = 1;
      canvas.height = 1;
    }
  }
}

export interface ResolvedSize {
  width: number;
  height: number;
  /** Dots per inch actually achieved for the requested physical size. */
  dpi: number;
}

/**
 * The largest of a ladder of DPIs this browser will render the given physical
 * size at. Stepping down rather than failing is deliberate: a 150 DPI poster
 * is a real poster, and refusing to export on a phone would be worse. The
 * caller shows the result, so nobody is told they got 300 when they got 150.
 */
export function resolvePrintSize(
  widthInches: number,
  heightInches: number,
  ladder: number[] = [300, 240, 180, 150, 110],
): ResolvedSize {
  for (const dpi of ladder) {
    const width = Math.round(widthInches * dpi);
    const height = Math.round(heightInches * dpi);
    if (canvasUsable(width, height)) return { width, height, dpi };
  }
  const dpi = ladder[ladder.length - 1];
  return {
    width: Math.round(widthInches * dpi),
    height: Math.round(heightInches * dpi),
    dpi,
  };
}

// --- Typography -------------------------------------------------------------

/**
 * The app's own font stack, read off the document rather than hardcoded.
 * next/font hashes the family name into something like "__Inter_36bd41", so
 * naming "Inter" in a canvas font string quietly falls through to whatever
 * sans-serif the operating system has. Reading the computed value is the only
 * way a canvas gets the same typeface as the page.
 */
export function appFontStack(): string {
  if (typeof window === "undefined") return "sans-serif";
  const family = getComputedStyle(document.body).fontFamily;
  return family && family.trim().length > 0 ? family : "sans-serif";
}

/**
 * Wait for the weights a composition uses to be loadable. Canvas does not
 * trigger a font load the way laying out text does, so without this the first
 * export of a session renders in the fallback face.
 */
export async function ensureFonts(stack: string): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.all(
      ["400", "500", "600", "700"].map((weight) =>
        document.fonts.load(`${weight} 48px ${stack}`),
      ),
    );
    await document.fonts.ready;
  } catch {
    // A font that will not load is not a reason to refuse to export.
  }
}

export function setFont(
  context: CanvasRenderingContext2D,
  weight: number,
  size: number,
  stack: string,
): void {
  context.font = `${weight} ${size}px ${stack}`;
}

/**
 * Draw letterspaced small caps by hand. canvas letterSpacing exists but is
 * still missing on Safari, and every label in these compositions depends on
 * it, so the manual version is the one that renders the same everywhere.
 */
export function drawTracked(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
  align: "left" | "center" | "right" = "left",
): void {
  const characters = Array.from(text);
  const width =
    characters.reduce(
      (total, character) => total + context.measureText(character).width,
      0,
    ) +
    tracking * Math.max(0, characters.length - 1);
  let cursor = x;
  if (align === "center") cursor = x - width / 2;
  if (align === "right") cursor = x - width;
  const previousAlign = context.textAlign;
  context.textAlign = "left";
  for (const character of characters) {
    context.fillText(character, cursor, y);
    cursor += context.measureText(character).width + tracking;
  }
  context.textAlign = previousAlign;
  return;
}

/** The width drawTracked would occupy, for centring a rule under a label. */
export function trackedWidth(
  context: CanvasRenderingContext2D,
  text: string,
  tracking: number,
): number {
  const characters = Array.from(text);
  return (
    characters.reduce(
      (total, character) => total + context.measureText(character).width,
      0,
    ) + tracking * Math.max(0, characters.length - 1)
  );
}

/** Break text into lines that fit a width at the current font. */
export function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.length > 0) {
    // Ellipsize the last line only if there was something left over.
    const joined = lines.join(" ");
    if (joined.length < text.replace(/\s+/g, " ").trim().length) {
      let last = lines[lines.length - 1];
      while (
        last.length > 1 &&
        context.measureText(`${last}...`).width > maxWidth
      ) {
        last = last.slice(0, -1);
      }
      lines[lines.length - 1] = `${last.trimEnd()}...`;
    }
  }
  return lines;
}

/**
 * The largest size at or below `start` at which the text fits, stepping down
 * to `min`. A long trip name shrinks rather than overflowing the card.
 */
export function fitFontSize(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  weight: number,
  start: number,
  min: number,
  stack: string,
): number {
  let size = start;
  while (size > min) {
    setFont(context, weight, size, stack);
    if (context.measureText(text).width <= maxWidth) break;
    size -= Math.max(1, Math.round(size * 0.04));
  }
  setFont(context, weight, size, stack);
  return size;
}

// --- Drawing helpers --------------------------------------------------------

export function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

/** Draw an image cropped to fill a box, centred, preserving aspect. */
export function drawImageCover(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  focus: { x: number; y: number } = { x: 50, y: 50 },
): void {
  if (naturalWidth <= 0 || naturalHeight <= 0) return;
  const scale = Math.max(width / naturalWidth, height / naturalHeight);
  const drawWidth = naturalWidth * scale;
  const drawHeight = naturalHeight * scale;
  const offsetX = x - ((drawWidth - width) * focus.x) / 100;
  const offsetY = y - ((drawHeight - height) * focus.y) / 100;
  context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
}

// --- Images -----------------------------------------------------------------

export interface LoadedImage {
  image: HTMLImageElement;
  width: number;
  height: number;
}

/**
 * Load an image in a state a canvas can read back from.
 *
 * crossOrigin="anonymous" is mandatory: without it the image loads and draws
 * fine and then taints the canvas, so toBlob throws a SecurityError at the
 * very end. Both photo sources cooperate: Supabase Storage answers public
 * objects with `access-control-allow-origin: *`, and the Wikimedia proxy is
 * same-origin (its redirect lands on that same Storage CDN).
 *
 * A failure is not fatal anywhere it is used. The share card falls back to a
 * plain gradient, which is a design, not an error state.
 */
export function loadImage(url: string): Promise<LoadedImage | null> {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      resolve({
        image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      });
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

// --- Output -----------------------------------------------------------------

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The image could not be encoded."));
      },
      type,
      quality,
    );
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately cancels the download in Safari; one tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A filesystem-safe slug for a download name. */
export function filenameSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "batchport";
}

/** Whether this browser can share a generated image through the OS sheet. */
export function canShareFiles(): boolean {
  if (typeof navigator === "undefined" || !navigator.canShare) return false;
  try {
    const probe = new File([new Blob([""], { type: "image/png" })], "p.png", {
      type: "image/png",
    });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export async function shareImage(
  blob: Blob,
  filename: string,
  title: string,
): Promise<boolean> {
  if (!navigator.share) return false;
  const file = new File([blob], filename, { type: blob.type });
  try {
    await navigator.share({ files: [file], title });
    return true;
  } catch {
    // A dismissed share sheet is a normal outcome, not a failure to report.
    return false;
  }
}

/** Release a canvas's backing store. These are tens of megabytes each. */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 1;
  canvas.height = 1;
}
