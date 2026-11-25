import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDocument } from '../src/extract.js';
import { LIMITS } from '../src/config.js';
import { PAPER, pdfFixture } from './helpers.js';

test('extracts selectable text and page count from a real PDF', async () => {
  const result = await extractDocument(pdfFixture(2), 'paper.pdf');
  assert.equal(result.pages, 2); assert.match(result.text, /40 adults/); assert.match(result.text, /short\s+follow-up/);
});
test('extracts UTF-8 text and Markdown', async () => {
  for (const name of ['paper.txt', 'paper.md']) assert.equal((await extractDocument(Buffer.from(PAPER), name)).text, PAPER);
});
test('rejects excessive uploads, PDF pages, and text; rejects empty and unreadable files', async () => {
  await assert.rejects(extractDocument(Buffer.alloc(LIMITS.uploadBytes + 1), 'paper.pdf'), /20 MB/);
  await assert.rejects(extractDocument(pdfFixture(101), 'paper.pdf'), /100-page/);
  await assert.rejects(extractDocument(Buffer.from('a'.repeat(LIMITS.sourceChars + 1)), 'paper.txt'), /500,000/);
  await assert.rejects(extractDocument(pdfFixture(1, ''), 'scan.pdf'), /OCR/);
  await assert.rejects(extractDocument(Buffer.from(PAPER), 'fake.pdf'), /valid PDF/);
  await assert.rejects(extractDocument(Buffer.from('%PDF-1.4 broken'), 'broken.pdf'), /Could not read/);
  await assert.rejects(extractDocument(Buffer.from(PAPER), 'file.html'), /Choose a PDF/);
  await assert.rejects(extractDocument(Buffer.from([0xff,0xfe]), 'file.txt'), /UTF-8/);
  await assert.rejects(extractDocument(Buffer.alloc(0), 'file.txt'), /empty/);
});
