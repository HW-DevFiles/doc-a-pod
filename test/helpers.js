export const PAPER = `Research on walking and attention. The study investigated whether short walks improve attention. The researchers randomly assigned 40 adults to a short walk or a seated rest and measured attention before and after. The results showed a small increase in attention scores after walking. The study was limited by a small sample and short follow-up, so longer studies are needed.`;
// A real, selectable-text PDF fixture generated without another dependency.
export function pdfFixture(pages = 1, text = PAPER) {
  const objects = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${Array.from({length: pages}, (_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let i = 0; i < pages; i++) {
    const lines = text.match(/.{1,85}(?:\s|$)/g) || [''];
    const commands = lines.map(line => `(${line.replace(/[\\()]/g, '\\$&')}) Tj 0 -14 Td`).join('\n');
    const stream = `BT /F1 10 Tf 30 700 Td ${commands} ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let body = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}
