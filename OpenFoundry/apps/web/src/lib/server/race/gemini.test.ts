import { describe, expect, it, vi } from 'vitest';
vi.mock('$env/dynamic/private', () => ({ env: { GEMINI_API_KEY: 'unit-test-only-google-key' } }));
import { solveWithGemini } from './gemini';

const answer = (text: string) => Response.json({ candidates: [{ content: { role: 'model', parts: [{ text }] } }] });
const call = () => Response.json({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'lookup_record', args: { id: 'alpha' } }, thoughtSignature: 'retained-signature' }] } }] });
const task = (limits = {}) => ({ type: 'use_tools', input: 'Look up alpha and report its value.', challengeToken: 'challenge-only-token',
  tools: [{ name: 'lookup_record', url: 'https://superteam-agent-studio.vercel.app/api/tools/lookup_record', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }], limits });

describe('Gemini race execution', () => {
  it('returns a real provider answer with truthful model metadata', async () => {
    const fetcher = vi.fn().mockResolvedValue(answer('42'));
    const result = await solveWithGemini({ type: 'respond', input: 'Calculate six times seven.' }, fetcher);
    expect(result.output.text).toBe('42');
    expect(result.meta.model).toBe('gemini-3.5-flash-lite');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('executes the model-selected tool and keeps the challenge token out of model requests', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(call()).mockResolvedValueOnce(Response.json({ value: 37 })).mockResolvedValueOnce(answer('37'));
    const result = await solveWithGemini(task(), fetcher);
    expect(result.output.toolResults).toEqual([{ tool: 'lookup_record', result: { value: 37 } }]);
    expect(fetcher.mock.calls[1][1].headers.authorization).toBe('Bearer challenge-only-token');
    expect(fetcher.mock.calls[0][1].body).not.toContain('challenge-only-token');
    expect(fetcher.mock.calls[2][1].body).toContain('retained-signature');
    expect(fetcher.mock.calls[2][1].body).toContain('37');
  });
  it('rejects an invented tool-free answer', async () => {
    await expect(solveWithGemini(task(), vi.fn().mockResolvedValue(answer('Invented result')))).rejects.toMatchObject({ code: 'upstream_unavailable' });
  });
  it('retries a transient tool 503 before using the successful result', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(call()).mockResolvedValueOnce(Response.json({ error: 'retry' }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ value: 9 })).mockResolvedValueOnce(answer('9'));
    const result = await solveWithGemini(task(), fetcher);
    expect(result.output.text).toBe('9');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('enforces tool limits before issuing an extra HTTP call', async () => {
    const fetcher = vi.fn().mockResolvedValue(call());
    await expect(solveWithGemini(task({ maxToolCalls: 0 }), fetcher)).rejects.toMatchObject({ code: 'limit_exceeded' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('rejects untrusted tool origins before transmitting a challenge token', async () => {
    const malicious = task(); malicious.tools[0].url = 'https://other.example/steal';
    const fetcher = vi.fn();
    await expect(solveWithGemini(malicious, fetcher)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('returns a quota error without falling back to a paid provider', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: 'quota' }, { status: 429 }));
    await expect(solveWithGemini({ type: 'respond', input: 'Hello' }, fetcher)).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('rejects missing tools and reports timeouts accurately', async () => {
    await expect(solveWithGemini({ type: 'use_tools', input: 'Look up a record.' })).rejects.toMatchObject({ status: 400 });
    await expect(solveWithGemini({ type: 'respond', input: 'Hello' }, vi.fn().mockRejectedValue(new DOMException('Timed out', 'TimeoutError')))).rejects.toMatchObject({ status: 504 });
  });
});
