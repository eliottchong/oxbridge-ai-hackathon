import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParsedProtocol } from './parser';
vi.mock('$env/dynamic/private', () => ({ env: process.env }));
import { transcribeWithAI } from './ai-transcription';

function source(): ParsedProtocol {
  return {
    protocol_id: 'SYN-MICROPLATE-001', version: '1.0', title: 'Synthetic Microplate Readout SOP v1.0',
    supported_layout: true, extraction_method: 'supported-template', fixed_controls: 2,
    replicates_per_specimen: 1, overage_percent: '10', issues: [], file_hash: 'hash',
    source_text: '[page 1, row 12] Buffer A | 60 | uL',
    rows: [{ id: 'row-1', resource_id: 'buffer-a', resource_name: 'Buffer A', per_reaction: '60', unit: 'uL',
      source_page: 1, source_row: 12, source_excerpt: 'Buffer A | 60 | uL', needs_review: false, issues: [] }]
  };
}
function answer(parsed = source()) {
  return {
    protocol_id: parsed.protocol_id, version: parsed.version, fixed_controls: parsed.fixed_controls,
    replicates_per_specimen: parsed.replicates_per_specimen, overage_percent: parsed.overage_percent,
    rows: parsed.rows.map(({ id, resource_id, per_reaction, unit, source_excerpt }) => ({ id, resource_id, per_reaction, unit, source_excerpt }))
  };
}
function success(value: unknown) {
  return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }), { status: 200 });
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('optional source-validated AI transcription', () => {
  it('does not claim AI or call a provider without a configured key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const input = source();
    expect(await transcribeWithAI(input)).toBe(input);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not send unsupported or already-ambiguous documents to a model', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await transcribeWithAI({ ...source(), supported_layout: false });
    await transcribeWithAI({ ...source(), issues: ['Contradiction'] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses the real Responses schema without tools and labels only validated output openai', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only');
    vi.stubEnv('OPENAI_MODEL', 'configured-model');
    const fetcher = vi.fn().mockResolvedValue(success(answer())); vi.stubGlobal('fetch', fetcher);
    const result = await transcribeWithAI(source());
    expect(result.extraction_method).toBe('openai');
    expect(result.rows).toEqual(source().rows);
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(request.body);
    expect(body.model).toBe('configured-model');
    expect(body.store).toBe(false);
    expect(body.text.format.strict).toBe(true);
    expect(body).not.toHaveProperty('tools');
    expect(body.input[0].content[0].text).toBe(source().source_text);
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  it.each(['amount', 'unit', 'mapping', 'source', 'controls', 'overage', 'extra row', 'extra field'])('fails closed for model disagreement in %s', async field => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only');
    const value = answer();
    if (field === 'amount') value.rows[0].per_reaction = '61';
    if (field === 'unit') value.rows[0].unit = 'mL';
    if (field === 'mapping') value.rows[0].resource_id = 'indicator-b';
    if (field === 'source') value.rows[0].source_excerpt = 'Invented evidence';
    if (field === 'controls') value.fixed_controls = 0;
    if (field === 'overage') value.overage_percent = '0';
    if (field === 'extra row') value.rows.push({ ...value.rows[0] });
    if (field === 'extra field') Object.assign(value, { approved: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(success(value)));
    const result = await transcribeWithAI(source());
    expect(result.extraction_method).toBe('supported-template');
    expect(result.rows[0].per_reaction).toBe('60');
    expect(result.rows[0].source_excerpt).toBe(source().rows[0].source_excerpt);
    expect(result.rows[0].needs_review).toBe(true);
    expect(result.issues.join(' ')).toContain('disagreed');
  });

  it.each(['provider error', 'network failure', 'invalid JSON', 'refusal', 'incomplete'])('sanitises %s and never claims AI success', async kind => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only-secret');
    const fetcher = vi.fn();
    if (kind === 'provider error') fetcher.mockResolvedValue(new Response('test-only-secret', { status: 401 }));
    if (kind === 'network failure') fetcher.mockRejectedValue(new Error('test-only-secret'));
    if (kind === 'invalid JSON') fetcher.mockResolvedValue(new Response('broken json', { status: 200 }));
    if (kind === 'refusal') fetcher.mockResolvedValue(new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] })));
    if (kind === 'incomplete') fetcher.mockResolvedValue(new Response(JSON.stringify({ status: 'incomplete', output: [] })));
    vi.stubGlobal('fetch', fetcher);
    await expect(transcribeWithAI(source())).rejects.toMatchObject({ status: 502, code: 'AI_TRANSCRIPTION_UNAVAILABLE' });
    await expect(transcribeWithAI(source())).rejects.not.toThrow('test-only-secret');
  });
});
