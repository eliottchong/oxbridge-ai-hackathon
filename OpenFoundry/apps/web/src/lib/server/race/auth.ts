import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

export function verifierAuthorized(request: Request): boolean {
  const token = env.AGENT_STUDIO_VERIFIER_TOKEN;
  if (!token) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(request.headers.get('authorization') ?? ''), digest(`Bearer ${token}`));
}
