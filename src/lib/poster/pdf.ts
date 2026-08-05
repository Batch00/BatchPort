// A one-page PDF wrapper around a rendered poster.
//
// Why bother, when the PNG is the same pixels: a PNG carries no physical size,
// so a print shop has to be told what to do with it and often guesses wrong.
// A PDF states the page is 18 by 12 inches, and the poster comes back the size
// it was designed at. That is the entire feature, which is why it is written
// by hand here rather than pulled in as a dependency: the file is a fixed
// five-object skeleton around one image, and a PDF library would be a
// megabyte of parser the app never uses.
//
// The image is embedded as JPEG with the DCTDecode filter, which every PDF
// consumer since 1993 understands and which no re-encoding step touches. At
// 300 DPI and quality 0.94 the loss is well below what a printer resolves.

const ENCODER = new TextEncoder();

function bytes(value: string): Uint8Array {
  return ENCODER.encode(value);
}

/**
 * Wrap JPEG bytes in a single-page PDF at an exact physical size. Offsets in
 * the cross-reference table have to be byte-accurate, so the file is assembled
 * as a list of chunks whose lengths are measured as they are appended.
 */
export function jpegToPdf(
  jpeg: Uint8Array,
  pixelWidth: number,
  pixelHeight: number,
  widthInches: number,
  heightInches: number,
  title: string,
): Blob {
  // PDF user space is 1/72 inch.
  const pageWidth = (widthInches * 72).toFixed(2);
  const pageHeight = (heightInches * 72).toFixed(2);

  const chunks: Uint8Array[] = [];
  let length = 0;
  const push = (chunk: Uint8Array | string) => {
    const value = typeof chunk === "string" ? bytes(chunk) : chunk;
    chunks.push(value);
    length += value.length;
  };

  // Object offsets, indexed by object number. Index 0 is the free head.
  const offsets: number[] = [0];
  const startObject = (id: number) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
  };

  // A title with a parenthesis or a backslash in it would end the string
  // literal early, so escape the three characters that matter.
  const safeTitle = title.replace(/([\\()])/g, "\\$1").slice(0, 200);

  push("%PDF-1.4\n");
  // A binary comment marks the file as binary for tools that sniff it.
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  startObject(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  startObject(2);
  push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

  startObject(3);
  push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
  );

  startObject(4);
  push(
    `<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
      `/Length ${jpeg.length} >>\nstream\n`,
  );
  push(jpeg);
  push("\nendstream\nendobj\n");

  // The image is placed by scaling the unit square to the full page.
  const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`;
  startObject(5);
  push(`<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);

  startObject(6);
  push(
    `<< /Title (${safeTitle}) /Producer (BatchPort) /Creator (BatchPort) >>\nendobj\n`,
  );

  const objectCount = 7; // objects 1..6 plus the free entry
  const xrefOffset = length;
  push(`xref\n0 ${objectCount}\n`);
  push("0000000000 65535 f \n");
  for (let id = 1; id < objectCount; id += 1) {
    push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  }
  push(
    `trailer\n<< /Size ${objectCount} /Root 1 0 R /Info 6 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`,
  );

  return new Blob(chunks as BlobPart[], { type: "application/pdf" });
}
