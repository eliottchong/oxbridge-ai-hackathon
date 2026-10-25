import { json } from '@sveltejs/kit';
import { verifierAuthorized } from '$lib/server/race/auth';
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
  // Health can be verified while the real model/tool adapter is still unconfigured.
  // Never substitute canned answers for actual AI or tool execution.
  return json({ protocol: 'asrp/1', nonce: body.nonce, status: 'error',
    error: { code: 'upstream_unavailable', message: 'Model and tool verification are not configured yet.' }
  }, { status: 503 });
};
