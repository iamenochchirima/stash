import { readFile } from "node:fs/promises";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
const path = process.argv[2];
try {
  if (!path) throw new Error("invalid_pdf");
  const bytes = await readFile(path);
  if (bytes.length > 20 * 1024 * 1024 || !bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new Error("invalid_pdf");
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: VerbosityLevel.ERRORS, useSystemFonts: false, disableFontFace: true, useWorkerFetch: false, stopAtErrors: true });
  try {
    const doc = await task.promise;
    if (doc.numPages > 100) throw new Error("too_many_pages");
    /** @type {Array<{page: number, text: string}>} */
    const pages = []; let length = 0;
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber), content = await page.getTextContent();
      const text = content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
      length += text.length;
      if (length > 250000) throw new Error("too_much_text");
      pages.push({ page: pageNumber, text }); page.cleanup();
    }
    if (!pages.some(p => p.text.trim())) throw new Error("no_extractable_text");
    process.stdout.write(JSON.stringify({ pages, pageCount: doc.numPages }));
  } finally { await task.destroy(); }
} catch (error) {
  const known = ["invalid_pdf", "too_many_pages", "too_much_text", "no_extractable_text"];
  const e = error instanceof Error ? error : new Error("invalid_pdf");
  process.stderr.write(e.name === "PasswordException" ? "password_protected" : known.includes(e.message) ? e.message : "invalid_pdf");
  process.exitCode = 1;
}
