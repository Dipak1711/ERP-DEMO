// PDF library import in one place (Deno resolves the npm: specifier; the local Node test maps it to node_modules).
export { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
export type { PDFFont, PDFPage } from 'npm:pdf-lib@1.17.1';
