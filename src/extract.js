import path from 'node:path';
import { LIMITS, UserError } from './config.js';

export async function extractDocument(buffer, filename) {
  if (!buffer.length) throw new UserError('The file is empty. Choose a PDF, text, or Markdown paper.');
  if (buffer.length > LIMITS.uploadBytes) throw new UserError('This file exceeds the 20 MB upload limit.', 413);
  const extension = path.extname(filename).toLowerCase();
  let text = '', pages = null;
  if (extension === '.pdf') {
    if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new UserError('This file is not a valid PDF.');
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true, verbosity: 0 });
    let pdf;
    try {
      pdf = await task.promise;
      pages = pdf.numPages;
      if (pages > LIMITS.sourcePages) throw new UserError('This PDF exceeds the 100-page source limit. Upload a shorter paper or an excerpt.', 413);
      for (let page = 1; page <= pages; page++) {
        const p = await pdf.getPage(page);
        const content = await p.getTextContent();
        text += content.items.map(item => (item.str || '') + (item.hasEOL ? '\n' : ' ')).join('') + '\n\n';
        p.cleanup();
        if (text.length > LIMITS.sourceChars) throw new UserError('The extracted text exceeds 500,000 characters. Upload a shorter excerpt.', 413);
      }
    } catch (error) {
      if (error instanceof UserError) throw error;
      throw new UserError('Could not read this PDF. Use an unencrypted PDF with selectable text.');
    } finally { await task.destroy(); }
  } else if (['.txt', '.md', '.markdown'].includes(extension)) {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch { throw new UserError('Please save the text file as UTF-8.'); }
  } else throw new UserError('Choose a PDF, .txt, or Markdown file.');
  text = text.replace(/\u0000/g, '').trim();
  if (text.length > LIMITS.sourceChars) throw new UserError('The source exceeds 500,000 characters. Upload a shorter excerpt.', 413);
  if (text.length < 80) throw new UserError('Not enough readable text. Scanned PDFs need OCR first; try a PDF with selectable text or a text file.');
  return { text, pages };
}
