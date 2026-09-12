import type { Env } from './types';

function storageDomain(env: Env): string | null {
  const configured = (env.PUBLIC_DOMAIN || env.R2_PUBLIC_DOMAIN || '').trim();
  if (!configured) return null;
  return configured.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

export function encodeStorageKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

export function getPublicFilePath(env: Env, key: string): string {
  const encoded = encodeStorageKey(key);
  return storageDomain(env) ? `/${encoded}` : `/f/${encoded}`;
}

export function getPublicFileUrl(env: Env, key: string, origin?: string): string | null {
  const encoded = encodeStorageKey(key);
  const domain = storageDomain(env);
  if (domain) return `https://${domain}/${encoded}`;
  if (!origin) return null;
  return `${origin.replace(/\/+$/, '')}/f/${encoded}`;
}
