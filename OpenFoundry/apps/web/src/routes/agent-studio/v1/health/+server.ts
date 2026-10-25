import { json } from '@sveltejs/kit';
import { verifierAuthorized } from '$lib/server/race/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request }) => {
  if (!verifierAuthorized(request)) return json({ error: 'unauthorized' }, { status: 401 });
  return json({ protocol: 'asrp/1', status: 'ready', name: 'LabRelax' }, {
    headers: { 'cache-control': 'no-store' }
  });
};
