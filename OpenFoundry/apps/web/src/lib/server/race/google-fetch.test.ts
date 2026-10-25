import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
import { spawn } from 'node:child_process';
import { geminiTransport } from './google-fetch';

const url = 'https://generativelanguage.googleapis.com/v1beta/models/test:generateContent';
let child: any;
beforeEach(() => {
  child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  vi.mocked(spawn).mockReturnValue(child);
});
describe('system Google transport', () => {
  it('keeps the API key out of process arguments and preserves HTTP errors', async () => {
    const pending = geminiTransport(url, { method: 'POST', headers: { 'x-goog-api-key': 'test-secret' }, body: '{"contents":[]}' });
    const stdin = child.stdin.read().toString();
    expect(stdin).toContain('test-secret');
    expect(JSON.stringify(vi.mocked(spawn).mock.calls.at(-1))).not.toContain('test-secret');
    expect(vi.mocked(spawn).mock.calls.at(-1)?.[1]).not.toContain('--insecure');
    child.stdout.write('{"error":"quota"}\n429'); child.emit('close', 0);
    const response = await pending;
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'quota' });
  });
  it('kills the request when the task deadline expires', async () => {
    const controller = new AbortController();
    const pending = geminiTransport(url, { method: 'POST', body: '{}', signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(child.kill).toHaveBeenCalledOnce();
  });
  it('classifies a system HTTP timeout', async () => {
    const pending = geminiTransport(url, { method: 'POST', body: '{}' });
    child.emit('close', 28);
    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
