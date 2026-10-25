import { Keypair } from '@solana/web3.js';
import type { RequestEvent } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { run_workflow } from '$lib/server/payments/workflow';
import { POST } from './+server';

const settings = vi.hoisted(() => ({ env: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: settings.env }));
vi.mock('node:fs', async () => ({ ...await vi.importActual<typeof import('node:fs')>('node:fs'), readFileSync: vi.fn() }));
vi.mock('$lib/server/preflight/store', () => ({ getStore: () => ({ db: {} }) }));
vi.mock('$lib/server/payments/workflow', async () => ({ ...await vi.importActual<typeof import('$lib/server/payments/workflow')>('$lib/server/payments/workflow'), run_workflow: vi.fn() }));

const token = 'test-only-payment-agent-token-not-a-real-credential';
const task = { type: 'run_workflow', taskId: 'route-test-1', instructions: { network: 'solana-devnet', to: Keypair.generate().publicKey.toBase58(), amountUsdc: '0.01', memo: 'required memo' } };
function call(body: unknown = task, bearer = token) {
  return POST({ request: new Request('https://lab.example/api/agent/run_workflow', { method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) } as RequestEvent);
}
beforeEach(() => {
  vi.clearAllMocks(); for (const key of Object.keys(settings.env)) delete settings.env[key];
  Object.assign(settings.env, { LABRELAX_PAYMENTS_ENABLED: 'true', LABRELAX_PAYMENTS_API_TOKEN: token, LABRELAX_SOLANA_KEYPAIR_PATH: '/test-only/devnet-agent.json' });
  vi.mocked(readFileSync).mockReturnValue(JSON.stringify(Array.from(Keypair.generate().secretKey)));
  vi.mocked(run_workflow).mockResolvedValue({ output: { data: { signature: 'confirmed-test-signature' } } });
});

describe('payment task HTTP boundary', () => {
  it('requires explicit enablement and a separate bearer token', async () => {
    delete settings.env.LABRELAX_PAYMENTS_ENABLED;
    expect((await call()).status).toBe(503);
    settings.env.LABRELAX_PAYMENTS_ENABLED = 'true';
    expect((await call(task, '')).status).toBe(401);
    expect((await call(task, 'shared-researcher-session')).status).toBe(401);
    expect(readFileSync).not.toHaveBeenCalled(); expect(run_workflow).not.toHaveBeenCalled();
  });
  it('passes valid tasks to the payment service and emits output.data.signature', async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ output: { data: { signature: 'confirmed-test-signature' } } });
    expect(run_workflow).toHaveBeenCalledTimes(1);
  });
  it('validates network and amount before loading any secret', async () => {
    const response = await call({ ...task, instructions: { ...task.instructions, network: 'mainnet-beta' } });
    expect(response.status).toBe(400); expect(readFileSync).not.toHaveBeenCalled();
  });
  it('caps request size, requires configured signer and sanitises failures', async () => {
    expect((await call({ extra: 'x'.repeat(9000) })).status).toBe(413);
    delete settings.env.LABRELAX_SOLANA_KEYPAIR_PATH;
    expect((await call()).status).toBe(503);
    settings.env.LABRELAX_SOLANA_KEYPAIR_PATH = '/secret-path/agent.json';
    vi.mocked(readFileSync).mockImplementationOnce(() => { throw new Error('/secret-path/agent.json'); });
    const badSigner = await call(); expect(await badSigner.text()).not.toContain('/secret-path');
    vi.mocked(run_workflow).mockRejectedValueOnce(new Error('https://rpc.example/?api-key=secret'));
    const failure = await call(); expect(failure.status).toBe(503); expect(await failure.text()).not.toContain('api-key');
  });
});
