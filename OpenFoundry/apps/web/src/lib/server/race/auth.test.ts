import { describe, expect, it, vi } from 'vitest';
vi.mock('$env/dynamic/private', () => ({ env: { AGENT_STUDIO_VERIFIER_TOKEN: 'test-only-verifier-token' } }));
import { verifierAuthorized } from './auth';

describe('race verifier authentication', () => {
  it('accepts only the exact verifier bearer token', () => {
    const request = (authorization?: string) => new Request('https://example.test', {
      headers: authorization ? { authorization } : {}
    });
    expect(verifierAuthorized(request())).toBe(false);
    expect(verifierAuthorized(request('Bearer wrong'))).toBe(false);
    expect(verifierAuthorized(request('test-only-verifier-token'))).toBe(false);
    expect(verifierAuthorized(request('Bearer test-only-verifier-token'))).toBe(true);
  });
});
