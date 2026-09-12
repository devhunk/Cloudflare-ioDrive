import type { Env } from './types';

export const DEMO_HOST = 'demo.iodevo.com';

export function isDemoEnvironment(env: Pick<Env, 'DEMO_MODE'>, host: string | undefined): boolean {
  return env.DEMO_MODE === 'true' || (host || '').toLowerCase() === DEMO_HOST;
}

export function isDemoWrite(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}
