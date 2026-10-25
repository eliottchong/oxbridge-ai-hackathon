import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { accessTokenValid, authenticate, csrfToken, demoEnabled, issueSession, requireMutation, requireProject } from './auth';
import { ApiError } from './errors';

const settings = vi.hoisted(() => ({ dev: false, env: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: settings.env }));
vi.mock('$app/environment', () => ({ get dev() { return settings.dev; } }));

function browserEvent(url = 'https://lab.example.test/api/lab/session', headers: Record<string, string> = {}) {
  const cookies = new Map<string, string>();
  const attributes = new Map<string, Record<string, unknown>>();
  const event = {
    url: new URL(url), request: new Request(url, { method: 'POST', headers }),
    cookies: {
      get: (name: string) => cookies.get(name),
      set: (name: string, value: string, options: Record<string, unknown>) => { cookies.set(name, value); attributes.set(name, options); }
    }
  } as unknown as RequestEvent;
  return { event, cookies, attributes };
}

function apiError(action: () => unknown, code: string, status: number) {
  try { action(); throw new Error('Expected authentication failure'); }
  catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code, status });
    return error as ApiError;
  }
}

describe('signed lab session and request authorisation', () => {
  beforeEach(() => {
    for (const key of Object.keys(settings.env)) delete settings.env[key];
    settings.env.LABRELAX_SESSION_SECRET = 'independent-unit-test-secret-never-a-production-secret';
    settings.dev = false;
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('rejects missing sessions with401', () => {
    apiError(() => authenticate(browserEvent().event), 'AUTHENTICATION_REQUIRED', 401);
  });

  it('issues a signed authenticated session in an HttpOnly same-site secure cookie', () => {
    const browser = browserEvent();
    const actor = issueSession(browser.event, false);
    expect(actor.id).toBe('lab-researcher');
    expect(actor.demo).toBe(false);
    expect(authenticate(browser.event)).toEqual(actor);
    expect(browser.attributes.get('labrelax_session')).toMatchObject({ path: '/', httpOnly: true, sameSite: 'strict', secure: true, maxAge: 28800 });
    expect(browser.cookies.get('labrelax_session')?.split('.')).toHaveLength(2);
  });

  it('permits the development HTTP cookie while preserving HttpOnly and same-site protections', () => {
    const browser = browserEvent('http://localhost:5173/api/lab/session');
    issueSession(browser.event, false);
    expect(browser.attributes.get('labrelax_session')).toMatchObject({ secure: false, httpOnly: true, sameSite: 'strict' });
  });

  it('rejects a modified actor payload even when the original signature is retained', () => {
    const browser = browserEvent();
    issueSession(browser.event, false);
    const [payload, signature] = browser.cookies.get('labrelax_session')!.split('.');
    const actor = JSON.parse(Buffer.from(payload, 'base64url').toString());
    actor.id = 'another-user';
    const modified = Buffer.from(JSON.stringify(actor)).toString('base64url');
    browser.cookies.set('labrelax_session', `${modified}.${signature}`);
    apiError(() => authenticate(browser.event), 'AUTHENTICATION_REQUIRED', 401);
  });

  it.each(['not-a-token', 'payload.short', 'a.b.c', '.signature', 'payload.'])('rejects malformed session%s without leaking verification errors', token => {
    const browser = browserEvent();
    browser.cookies.set('labrelax_session', token);
    const error = apiError(() => authenticate(browser.event), 'AUTHENTICATION_REQUIRED', 401);
    expect(error.message).toBe('Your session has expired. Sign in again.');
    expect(error.details).toBeUndefined();
  });

  it('rejects a correctly signed but expired session', () => {
    const time = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const browser = browserEvent();
    const actor = issueSession(browser.event, false);
    time.mockReturnValue(actor.expires + 1);
    apiError(() => authenticate(browser.event), 'AUTHENTICATION_REQUIRED', 401);
  });

  it('invalidates sessions if the configured signing secret changes', () => {
    const browser = browserEvent();
    issueSession(browser.event, false);
    settings.env.LABRELAX_SESSION_SECRET = 'rotated-signing-secret';
    apiError(() => authenticate(browser.event), 'AUTHENTICATION_REQUIRED', 401);
  });

  it('denies demo sessions by default in production and honours explicit enablement', () => {
    expect(demoEnabled()).toBe(false);
    settings.env.LABRELAX_DEMO_MODE = 'true';
    expect(demoEnabled()).toBe(true);
    const browser = browserEvent();
    const actor = issueSession(browser.event, true);
    expect(authenticate(browser.event)).toEqual(actor);
    settings.env.LABRELAX_DEMO_MODE = 'false';
    expect(demoEnabled()).toBe(false);
    apiError(() => authenticate(browser.event), 'AUTHENTICATION_REQUIRED', 401);
  });

  it('enables local-development demo by default and honours an explicit false setting', () => {
    settings.dev = true;
    expect(demoEnabled()).toBe(true);
    settings.env.LABRELAX_DEMO_MODE = 'false';
    expect(demoEnabled()).toBe(false);
    settings.env.LABRELAX_DEMO_MODE = 'true';
    expect(demoEnabled()).toBe(true);
  });

  it('accepts a same-origin mutation carrying the actor-specific CSRF token', () => {
    const actor = issueSession(browserEvent().event, false);
    const browser = browserEvent(undefined, { origin: 'https://lab.example.test', 'x-csrf-token': csrfToken(actor) });
    expect(() => requireMutation(browser.event, actor)).not.toThrow();
  });

  it.each([undefined, 'https://attacker.example', 'http://lab.example.test', 'https://lab.example.test.attacker.example'])('rejects origin%s even with a correct CSRF token', origin => {
    const actor = issueSession(browserEvent().event, false);
    const headers: Record<string, string> = { 'x-csrf-token': csrfToken(actor) };
    if (origin !== undefined) headers.origin = origin;
    apiError(() => requireMutation(browserEvent(undefined, headers).event, actor), 'ORIGIN_REJECTED', 403);
  });

  it.each([undefined, '', 'wrong-token'])('rejects missing or wrong CSRF value%s', token => {
    const actor = issueSession(browserEvent().event, false);
    const headers: Record<string, string> = { origin: 'https://lab.example.test' };
    if (token !== undefined) headers['x-csrf-token'] = token;
    apiError(() => requireMutation(browserEvent(undefined, headers).event, actor), 'CSRF_REJECTED', 403);
  });

  it('binds CSRF tokens to both actor identity and session nonce', () => {
    const first = issueSession(browserEvent().event, false);
    const second = issueSession(browserEvent().event, false);
    expect(first.id).toBe(second.id);
    expect(first.nonce).not.toBe(second.nonce);
    expect(csrfToken(first)).not.toBe(csrfToken(second));
    const browser = browserEvent(undefined, { origin: 'https://lab.example.test', 'x-csrf-token': csrfToken(first) });
    apiError(() => requireMutation(browser.event, second), 'CSRF_REJECTED', 403);
    expect(csrfToken({ ...first, id: 'other-user' })).not.toBe(csrfToken(first));
  });

  it('only accepts the configured access token and refuses an unconfigured deployment', () => {
    expect(accessTokenValid('')).toBe(false);
    expect(accessTokenValid('some-token')).toBe(false);
    settings.env.LABRELAX_ACCESS_TOKEN = 'team-access-token';
    expect(accessTokenValid('team-access-token')).toBe(true);
    for (const value of [undefined, null, 123, '', 'team-access-tokeN', 'longer-team-access-token', { token: 'team-access-token' }]) {
      expect(accessTokenValid(value)).toBe(false);
    }
  });

  it('only permits the provisioned project and returns a generic denial for every other project', () => {
    const actor = issueSession(browserEvent().event, false);
    expect(() => requireProject(actor, 'demo-lab')).not.toThrow();
    expect(() => requireProject(actor, 'demo-lab', true)).not.toThrow();
    for (const project of ['private-project', '', undefined, null, { id: 'demo-lab' }]) {
      const error = apiError(() => requireProject(actor, project, true), 'NOT_FOUND', 404);
      expect(error.message).toBe('Resource not found or access is not permitted.');
      expect(error.details).toBeUndefined();
      expect(JSON.stringify(error)).not.toContain('private-project');
    }
    apiError(() => requireProject({ ...actor, id: '' }, 'demo-lab'), 'NOT_FOUND', 404);
  });
});
