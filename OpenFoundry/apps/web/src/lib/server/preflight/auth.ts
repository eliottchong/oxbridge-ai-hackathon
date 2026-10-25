import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { ApiError, notFound } from './errors';

const ephemeralSecret = randomBytes(32).toString('hex');
const COOKIE = 'labrelax_session';
export type Actor = { id: string; name: string; role: string; nonce: string; expires: number; demo: boolean };
const secret = () => env.LABRELAX_SESSION_SECRET || ephemeralSecret;
const signature = (value: string) => createHmac('sha256', secret()).update(value).digest('base64url');
const equals = (a: string, b: string) => {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};
export const demoEnabled = () => env.LABRELAX_DEMO_MODE === 'true' || (dev && env.LABRELAX_DEMO_MODE !== 'false');
export function issueSession(event: RequestEvent, demo: boolean): Actor {
  const actor: Actor = {
    id: demo ? 'demo-researcher' : 'lab-researcher',
    name: demo ? 'Demo researcher' : 'Lab researcher', role: 'researcher', demo,
    nonce: randomBytes(24).toString('base64url'), expires: Date.now() + 8 * 60 * 60 * 1000
  };
  const payload = Buffer.from(JSON.stringify(actor)).toString('base64url');
  event.cookies.set(COOKIE, `${payload}.${signature(payload)}`, {
    path: '/', httpOnly: true, sameSite: 'strict', secure: event.url.protocol === 'https:', maxAge: 8 * 60 * 60
  });
  return actor;
}
export function authenticate(event: RequestEvent): Actor {
  const token = event.cookies.get(COOKIE);
  if (!token) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to the lab workspace first.');
  try {
    const [payload, sig, extra] = token.split('.');
    if (extra || !payload || !sig || !equals(signature(payload), sig)) throw new Error();
    const actor = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Actor;
    if (!actor.id || !actor.nonce || actor.expires < Date.now() || (actor.demo && !demoEnabled())) throw new Error();
    return actor;
  } catch { throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Your session has expired. Sign in again.'); }
}
export function accessTokenValid(value: unknown): boolean {
  return typeof value === 'string' && !!env.LABRELAX_ACCESS_TOKEN && equals(value, env.LABRELAX_ACCESS_TOKEN);
}
export const csrfToken = (actor: Actor) => signature(`csrf:${actor.id}:${actor.nonce}`);
export function requireMutation(event: RequestEvent, actor: Actor) {
  if (event.request.headers.get('origin') !== event.url.origin) throw new ApiError(403, 'ORIGIN_REJECTED', 'Use the same lab application origin.');
  const value = event.request.headers.get('x-csrf-token');
  if (!value || !equals(value, csrfToken(actor))) throw new ApiError(403, 'CSRF_REJECTED', 'Refresh the workspace before submitting changes.');
}
export function requireProject(actor: Actor, projectId: unknown, _write = false): asserts projectId is string {
  // The hackathon workspace has one provisioned membership; every other project is denied.
  if (!actor.id || projectId !== 'demo-lab') throw notFound();
}
