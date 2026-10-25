import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { Connection, Keypair } from '@solana/web3.js';
import { ApiError } from '$lib/server/preflight/errors';
import { getStore } from '$lib/server/preflight/store';
import { DEVNET_RPC } from '$lib/server/payments/solana';
import { parseTask, run_workflow } from '$lib/server/payments/workflow';

export const POST: RequestHandler = async ({ request }) => {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    if (env.LABRELAX_PAYMENTS_ENABLED !== 'true') throw new ApiError(503, 'PAYMENTS_DISABLED', 'Devnet payments are disabled on this server.');
    const configured = env.LABRELAX_PAYMENTS_API_TOKEN;
    if (!configured || configured.length < 32) throw new ApiError(503, 'PAYMENTS_NOT_CONFIGURED', 'Configure a separate payment API token of at least 32 characters.');
    const provided = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    const a = Buffer.from(provided), b = Buffer.from(configured);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiError(401, 'UNAUTHORISED_PAYMENT', 'A valid payment-agent bearer token is required.');
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError(400, 'INVALID_INPUT', 'Send a JSON task.');
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError(400, 'INVALID_INPUT', 'Send a JSON task.');
    const chunks: Uint8Array[] = []; let length = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > 8192) { await reader.cancel(); throw new ApiError(413, 'TASK_TOO_LARGE', 'Task exceeds 8 KB.'); } chunks.push(value); }
    let task;
    try { task = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new ApiError(400, 'INVALID_INPUT', 'Send a valid JSON task.'); }
    parseTask(task);
    if (!env.LABRELAX_SOLANA_KEYPAIR_PATH) throw new ApiError(503, 'SIGNER_REQUIRED', 'Configure the server-side devnet agent wallet file.');
    let signer;
    try {
      const bytes = JSON.parse(readFileSync(env.LABRELAX_SOLANA_KEYPAIR_PATH, 'utf8'));
      if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some(value => !Number.isInteger(value) || value < 0 || value > 255)) throw new Error();
      signer = Keypair.fromSecretKey(Uint8Array.from(bytes));
    } catch { throw new ApiError(503, 'INVALID_SIGNER', 'Could not load the devnet agent wallet. Server paths and keys are never returned.'); }
    const rpc = env.LABRELAX_SOLANA_RPC_URL || DEVNET_RPC;
    if (!rpc.startsWith('https://')) throw new ApiError(503, 'INVALID_RPC', 'Payment RPC must use HTTPS and pass the devnet genesis check.');
    const connection = new Connection(rpc, { commitment: 'confirmed', disableRetryOnRateLimit: true, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000), redirect: 'error' }) });
    return json(await run_workflow(task, { db: getStore().db, signer, connection }), { headers });
  } catch (error) {
    if (error instanceof ApiError) return json({ error: { code: error.code, message: error.message } }, { status: error.status, headers });
    // RPC errors can include endpoint credentials. Do not forward or log raw provider errors.
    return json({ error: { code: 'PAYMENT_UNAVAILABLE', message: 'Payment could not be confirmed. Retry the same task ID to reconcile its saved transaction.' } }, { status: 503, headers });
  }
};
