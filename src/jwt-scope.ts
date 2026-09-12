import type { Env } from './types';

export const JWT_ISSUER = 'iodrive';

export function jwtAudience(env: Pick<Env, 'SITE_ID'>): string {
  const siteId = env.SITE_ID?.trim();
  if (!siteId) throw new Error('SITE_ID is required for JWT isolation');
  return `iodrive:${siteId}`;
}
