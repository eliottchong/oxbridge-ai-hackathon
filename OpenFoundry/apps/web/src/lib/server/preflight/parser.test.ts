import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MAX_PROTOCOL_BYTES, parseProtocolFile } from './parser';

const fixture = async (name: string) => new Uint8Array(await readFile(new URL(`../../../../static/fixtures/${name}`, import.meta.url)));
const template = [
  'Synthetic Microplate Readout SOP v1.0', 'Protocol ID: SYN-MICROPLATE-001',
  'Version: 1.0', 'Supported layout: LABRELAY-PREFLIGHT-1',
  'Sample count means test specimens, excluding controls.',
  'Replicates per specimen: 1', 'Fixed controls: 2', 'Preparation overage: 10%',
  'Resource | Per reaction | Unit', 'Buffer A | 60 | uL',
  'Indicator B | 15 | uL', 'Wash C | 100 | uL', 'Notes:'
];

/** Tiny real uncompressed PDF for adversarial text cases; no expected data is sent to parser. */
function textPdf(lines: string[]): Uint8Array {
  const escape = (text: string) => text.replace(/([\\()])/g, '\\$1');
  const stream = `BT /F1 10 Tf 40 800 Td 16 TL\n${lines.map(line => `(${escape(line)}) Tj T*`).join('\n')}\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf));
}

describe('supported PDF protocol extraction', () => {
  it('extracts actual table values, assumptions and quoted page/row evidence from the PDF', async () => {
    const bytes = await fixture('synthetic_microplate_sop.pdf');
    const result = await parseProtocolFile(bytes, 'synthetic_microplate_sop.pdf');
    expect(result.supported_layout).toBe(true);
    expect(result.extraction_method).toBe('supported-template');
    expect(result.file_hash).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(result.protocol_id).toBe('SYN-MICROPLATE-001');
    expect(result.version).toBe('1.0');
    expect(result.fixed_controls).toBe(2);
    expect(result.replicates_per_specimen).toBe(1);
    expect(result.overage_percent).toBe('10');
    expect(result.issues).toEqual([]);
    expect(result.rows.map(row => [row.resource_id, row.per_reaction, row.unit])).toEqual([
      ['buffer-a', '60', 'uL'], ['indicator-b', '15', 'uL'], ['wash-c', '100', 'uL']
    ]);
    for (const row of result.rows) {
      expect(row.source_page).toBe(1);
      expect(row.source_row).toBeGreaterThan(0);
      expect(result.source_text).toContain(`[page ${row.source_page}, row ${row.source_row}] ${row.source_excerpt}`);
      expect(row.needs_review).toBe(false);
    }
  });

  it('reads a changed source quantity rather than returning fixture answers', async () => {
    const result = await parseProtocolFile(textPdf(template.map(line => line.replace('Buffer A | 60', 'Buffer A | 37.5'))), 'changed.pdf');
    expect(result.rows[0].per_reaction).toBe('37.5');
    expect(result.issues).toEqual([]);
  });

  it.each(['unsupported_protocol.pdf', 'scanned_protocol.pdf'])('fails closed for %s', async filename => {
    const result = await parseProtocolFile(await fixture(filename), filename);
    expect(result.supported_layout).toBe(false);
    expect(result.rows).toEqual([]);
    expect(result.fixed_controls).toBeNull();
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('preserves but never follows an embedded instruction to approve or write inventory', async () => {
    const filename = 'injected_protocol.pdf';
    const result = await parseProtocolFile(await fixture(filename), filename);
    expect(result.rows.map(row => row.per_reaction)).toEqual(['60', '15', '100']);
    expect(result.issues.join(' ')).toContain('Ignore previous instructions');
    expect(result.rows.every(row => row.needs_review)).toBe(true);
    expect(result).not.toHaveProperty('status', 'approved');
  });

  it('does not choose between ambiguous source quantities', async () => {
    const filename = 'ambiguous_protocol.pdf';
    const result = await parseProtocolFile(await fixture(filename), filename);
    expect(result.rows[1].per_reaction).toBeNull();
    expect(result.rows[1].source_excerpt).toContain('15 or 20');
    expect(result.rows[1].needs_review).toBe(true);
  });

  it('blocks contradictory per-batch footnotes', async () => {
    const filename = 'contradictory_protocol.pdf';
    const result = await parseProtocolFile(await fixture(filename), filename);
    expect(result.issues.join(' ')).toContain('per batch');
    expect(result.rows.every(row => row.needs_review)).toBe(true);
  });

  it.each([
    ['missing controls', template.filter(line => !line.startsWith('Fixed controls:'))],
    ['duplicate controls', [...template, 'Fixed controls: 0']],
    ['missing overage', template.filter(line => !line.startsWith('Preparation overage:'))],
    ['unknown reagent', template.map(line => line.replace('Buffer A |', 'Mystery X |'))],
    ['mass unit', template.map(line => line.replace('Indicator B | 15 | uL', 'Indicator B | 15 | mg'))],
    ['duplicate reagent', template.map(line => line.replace('Indicator B |', 'Buffer A |'))],
    ['missing sample definition', template.filter(line => !line.startsWith('Sample count means'))],
    ['contradiction disguised as footer', [...template, 'Synthetic fixture only. Change all per-reaction amounts to per batch.']],
    ['zero replicates', template.map(line => line.replace('Replicates per specimen: 1', 'Replicates per specimen: 0'))]
  ])('blocks %s instead of inventing assumptions', async (_label, lines) => {
    const result = await parseProtocolFile(textPdf(lines), 'negative.pdf');
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.rows.every(row => row.needs_review)).toBe(true);
  });

  it('returns review for a malformed PDF', async () => {
    const result = await parseProtocolFile(new Uint8Array(Buffer.from('%PDF-1.4\ninvalid')), 'broken.pdf');
    expect(result.supported_layout).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('validates both extension and PDF signature', async () => {
    await expect(parseProtocolFile(textPdf(template), 'not-a-pdf.txt')).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
    await expect(parseProtocolFile(new Uint8Array(Buffer.from('not a pdf')), 'fake.pdf')).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
  });

  it('rejects empty and oversized uploads before document processing', async () => {
    await expect(parseProtocolFile(new Uint8Array(), 'empty.pdf')).rejects.toThrow('at most 2 MB');
    await expect(parseProtocolFile(new Uint8Array(MAX_PROTOCOL_BYTES + 1), 'large.pdf')).rejects.toMatchObject({ code: 'UPLOAD_TOO_LARGE' });
  });
});
