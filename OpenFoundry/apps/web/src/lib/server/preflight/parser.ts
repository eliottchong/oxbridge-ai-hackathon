import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import type { ProtocolDraft } from '../../preflight/types';

export const MAX_PROTOCOL_BYTES = 2 * 1024 * 1024;
const MAX_PAGES = 10;
const MAX_TEXT_LENGTH = 100_000;

export class ProtocolParseError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'ProtocolParseError'; }
}

export type ParsedProtocol = Pick<ProtocolDraft,
  'protocol_id' | 'version' | 'title' | 'supported_layout' | 'extraction_method' |
  'rows' | 'fixed_controls' | 'replicates_per_specimen' | 'overage_percent' |
  'issues' | 'source_text' | 'file_hash'>;

type SourceLine = { page: number; row: number; text: string };
const RESOURCE_IDS: Record<string, string> = {
  'buffer a': 'buffer-a', 'indicator b': 'indicator-b', 'wash c': 'wash-c'
};
const ALLOWED_NOTES = new Set([
  'SYNTHETIC DEMO - benign placeholder reagents only.',
  'Sample count means test specimens, excluding controls.',
  'Notes:',
  'Researcher approval is required before planning.',
  'Preparation overage does not imply actual consumption.',
  'Recorded inventory is not a measurement of physical stock.'
]);
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const normalise = (value: string) => value.normalize('NFKC').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

/** Supported synthetic layout only. Untrusted document text never invokes a tool or executes code. */
export async function parseProtocolFile(bytes: Uint8Array, filename: string): Promise<ParsedProtocol> {
  if (!bytes.length || bytes.length > MAX_PROTOCOL_BYTES) {
    throw new ProtocolParseError('UPLOAD_TOO_LARGE', 'Upload a nonempty PDF of at most 2 MB.');
  }
  if (!/\.pdf$/i.test(filename) || Buffer.from(bytes.subarray(0, 5)).toString('ascii') !== '%PDF-') {
    throw new ProtocolParseError('UNSUPPORTED_FILE_TYPE', 'Only PDF files with a valid PDF signature are accepted.');
  }
  const file_hash = createHash('sha256').update(bytes).digest('hex');
  const result: ParsedProtocol = {
    protocol_id: '', version: '', title: 'Unsupported protocol', supported_layout: false,
    extraction_method: 'supported-template', rows: [], fixed_controls: null,
    replicates_per_specimen: null, overage_percent: null, issues: [], source_text: '', file_hash
  };
  let document: import('pdfjs-dist').PDFDocumentProxy | undefined;
  let loadingTask: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
  let lines: SourceLine[] = [];
  try {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const packageRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
    loadingTask = getDocument({
      data: new Uint8Array(bytes), useSystemFonts: false,
      disableFontFace: true, stopAtErrors: true, disableAutoFetch: true,
      useWorkerFetch: false, standardFontDataUrl: join(packageRoot, 'standard_fonts') + sep
    });
    document = await loadingTask.promise;
    if (document.numPages > MAX_PAGES) {
      result.issues.push(`Unsupported document: maximum ${MAX_PAGES} pages.`);
      return result;
    }
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const text = await page.getTextContent();
      // Group visual baselines rather than treating individual PDF glyph chunks as rows.
      const chunks = text.items.filter((item): item is import('pdfjs-dist/types/src/display/api').TextItem => 'str' in item);
      const baselines = new Map<number, { x: number; text: string }[]>();
      for (const chunk of chunks) {
        const key = Math.round(chunk.transform[5] * 2) / 2;
        const row = baselines.get(key) ?? [];
        row.push({ x: chunk.transform[4], text: chunk.str });
        baselines.set(key, row);
      }
      const pageLines = [...baselines.entries()].sort(([a], [b]) => b - a)
        .map(([, chunks]) => normalise(chunks.sort((a, b) => a.x - b.x).map(chunk => chunk.text).join(' ')))
        .filter(Boolean).map((text, index) => ({ page: pageNumber, row: index + 1, text }));
      lines.push(...pageLines);
      page.cleanup();
      if (lines.reduce((count, line) => count + line.text.length, 0) > MAX_TEXT_LENGTH) {
        result.issues.push('Unsupported document: too much extracted text.');
        return result;
      }
    }
  } catch {
    result.issues.push('PDF could not be read. Encrypted, malformed and image-only documents are unsupported; use the provided text-based fixture.');
    return result;
  } finally {
    await loadingTask?.destroy();
  }
  result.source_text = lines.map(line => `[page ${line.page}, row ${line.row}] ${line.text}`).join('\n');
  if (lines.reduce((count, line) => count + line.text.length, 0) < 40) {
    result.issues.push('No usable text layer. Scanned/image-only protocols are unsupported; OCR is not performed.');
    return result;
  }
  const marker = lines.filter(line => line.text === 'Supported layout: LABRELAY-PREFLIGHT-1');
  const header = lines.filter(line => line.text === 'Resource | Per reaction | Unit');
  const titles = lines.filter(line => /^Synthetic Microplate Readout SOP v\d+\.\d+$/.test(line.text));
  if (marker.length !== 1 || header.length !== 1 || titles.length !== 1) {
    result.issues.push('Unsupported layout. Only the supplied LABRELAY-PREFLIGHT-1 machine-readable synthetic SOP is supported.');
    return result;
  }
  result.supported_layout = true;
  result.title = titles[0].text;
  const uniqueValue = (pattern: RegExp, label: string): string | null => {
    const matches = lines.map(line => line.text.match(pattern)).filter((match): match is RegExpMatchArray => !!match);
    if (matches.length !== 1) { result.issues.push(`${label} must be stated exactly once; researcher review is required.`); return null; }
    return matches[0][1];
  };
  result.protocol_id = uniqueValue(/^Protocol ID: ([A-Z0-9-]+)$/, 'Protocol ID') ?? '';
  result.version = uniqueValue(/^Version: (\d+\.\d+)$/, 'Protocol version') ?? '';
  if (result.version && !result.title.endsWith(`v${result.version}`)) result.issues.push('Title and protocol version disagree.');
  const controls = uniqueValue(/^Fixed controls: (\d+)$/, 'Fixed controls');
  const replicates = uniqueValue(/^Replicates per specimen: (\d+)$/, 'Replicates per specimen');
  const overage = uniqueValue(/^Preparation overage: ((?:0|[1-9]\d*)(?:\.\d+)?)%$/, 'Preparation overage');
  if (controls !== null && Number.isSafeInteger(Number(controls)) && Number(controls) <= 1000) result.fixed_controls = Number(controls);
  else if (controls !== null) result.issues.push('Fixed controls are outside supported limits.');
  if (replicates !== null && Number.isSafeInteger(Number(replicates)) && Number(replicates) > 0 && Number(replicates) <= 1000) result.replicates_per_specimen = Number(replicates);
  else if (replicates !== null) result.issues.push('Replicates must be a positive integer within supported limits.');
  if (overage !== null && Number(overage) <= 100) result.overage_percent = overage;
  else if (overage !== null) result.issues.push('Preparation overage must be between 0 and 100 percent.');
  if (!lines.some(line => line.text === 'Sample count means test specimens, excluding controls.')) {
    result.issues.push('The meaning of sample count is not stated; researcher review is required.');
  }

  const tableStart = lines.indexOf(header[0]);
  const notesIndex = lines.findIndex((line, index) => index > tableStart && line.text === 'Notes:');
  if (notesIndex === -1) result.issues.push('The table terminator Notes: is missing.');
  const tableLines = lines.slice(tableStart + 1, notesIndex === -1 ? undefined : notesIndex)
    .filter(line => !/^Synthetic fixture only\./.test(line.text));
  for (const [index, line] of tableLines.entries()) {
    const cells = line.text.split('|').map(cell => cell.trim());
    const issues: string[] = [];
    const [resource_name = '', quantity = '', rawUnit = ''] = cells;
    const resource_id = RESOURCE_IDS[resource_name.toLowerCase()] ?? null;
    if (cells.length !== 3) issues.push('Expected exactly three source table cells.');
    if (!resource_id) issues.push('Unknown reagent: an authorised researcher must map it to inventory.');
    const validQuantity = DECIMAL.test(quantity) && Number(quantity) > 0 && Number(quantity) <= 1_000_000;
    if (!validQuantity) issues.push('Per-reaction amount is missing, ambiguous or outside supported limits.');
    // Keep source units. Unit conversion belongs to the independently tested calculator.
    const unit = /^(uL|µL|μL|mL|L)$/.test(rawUnit) ? rawUnit.replace(/[µμ]/, 'u') : null;
    if (!unit) issues.push('Unit is missing or unsupported. No mass-to-volume conversion is inferred.');
    result.rows.push({
      id: `row-${index + 1}`, resource_id, resource_name,
      per_reaction: validQuantity ? quantity : null, unit,
      source_page: line.page, source_row: line.row, source_excerpt: line.text,
      needs_review: issues.length > 0, issues
    });
  }
  if (!result.rows.length) result.issues.push('No reagent table rows were extracted.');
  const mapped = result.rows.map(row => row.resource_id).filter(Boolean);
  if (new Set(mapped).size !== mapped.length) result.issues.push('Duplicate reagent rows require explicit review.');
  if (result.rows.some(row => row.needs_review)) result.issues.push('One or more reagent rows need review before approval.');

  // The supported layout has a deliberately closed vocabulary. Unexpected footnotes,
  // contradictory quantities and instructions are displayed as evidence, never followed.
  for (const [index, line] of lines.entries()) {
    if (index > tableStart && index < (notesIndex === -1 ? lines.length : notesIndex)) continue;
    if (ALLOWED_NOTES.has(line.text) || line === marker[0] || line === header[0] || line === titles[0]) continue;
    if (/^(Protocol ID: [A-Z0-9-]+|Version: \d+\.\d+|Fixed controls: \d+|Replicates per specimen: \d+|Preparation overage: (?:0|[1-9]\d*)(?:\.\d+)?%)$/.test(line.text)) continue;
    if (line.text === 'LABRELAY / SUPPORTED PROTOCOL FIXTURE' || /^Synthetic fixture only\. No scientific or clinical instructions\. Page \d+$/.test(line.text)) continue;
    result.issues.push(`Unrecognised source text at page ${line.page}, row ${line.row}: ${line.text}`);
  }
  if (result.issues.length) {
    for (const row of result.rows) {
      row.needs_review = true;
      if (!row.issues.includes('Document-level assumptions require review.')) row.issues.push('Document-level assumptions require review.');
    }
  }
  return result;
}
