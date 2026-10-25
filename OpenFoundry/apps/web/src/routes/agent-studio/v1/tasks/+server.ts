import { json } from '@sveltejs/kit';
import { verifierAuthorized } from '$lib/server/race/auth';
import { RaceError, solveWithGemini } from '$lib/server/race/gemini';
import { solveDevnetPayment } from '$lib/server/race/devnet-payment';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  if (!verifierAuthorized(request)) return json({ protocol: 'asrp/1', status: 'error',
    error: { code: 'unauthorized', message: 'Unknown caller.' } }, { status: 401 });
  let body;
  try { body = await request.json(); } catch {
    return json({ protocol: 'asrp/1', status: 'error', error: { code: 'invalid_input', message: 'Expected JSON.' } }, { status: 400 });
  }
  if (body?.protocol !== 'asrp/1' || typeof body.nonce !== 'string' || !body.task?.type) {
    return json({ protocol: 'asrp/1', status: 'error', error: { code: 'invalid_input', message: 'Missing protocol, nonce or task.' } }, { status: 400 });
  }
  try {
    const result = body.task.type === 'run_workflow' ? await solveDevnetPayment(body.task, body.nonce) : await solveWithGemini(body.task);
    return json({ protocol: 'asrp/1', nonce: body.nonce, status: 'ok', ...result }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const failure = error instanceof RaceError ? error : new RaceError(500, 'internal', 'Task execution failed.');
    return json({ protocol: 'asrp/1', nonce: body.nonce, status: 'error', error: {
      code: failure.code, message: failure.message
    } }, { status: failure.status });
  }
};
