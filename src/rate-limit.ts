import type { MiddlewareHandler } from 'hono';
import type { Env } from './types';

/**
 * Cloudflare Workers 速率限制限流中间件（防火墙限流）
 */
export const rateLimitMiddleware = (): MiddlewareHandler<{ Bindings: Env }> => {
  return async (c, next) => {
    if (c.env.RATE_LIMITER) {
      const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
      try {
        const { success } = await c.env.RATE_LIMITER.limit({ key: ip });
        if (!success) {
          return c.json({ error: '请求过于频繁，请稍后再试 (Rate limit exceeded)' }, 429);
        }
      } catch (err) {
        console.error('Rate limiter check failed:', err);
        const isCostSensitiveWrite = c.req.method !== 'GET'
          && c.req.method !== 'HEAD'
          && c.req.method !== 'OPTIONS'
          && c.req.path.startsWith('/api/upload');
        if (isCostSensitiveWrite) {
          return c.json({ error: '上传保护服务暂时不可用，请稍后重试' }, 503);
        }
      }
    }
    await next();
  };
};
