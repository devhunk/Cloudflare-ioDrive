import { Hono } from 'hono';
import type { Env, UploadPart } from './types';
import { verifyTurnstile } from './turnstile';
import { getContentType, uniqueKey } from './upload-utils';
import { writeUploadLog } from './upload-logs';
import { getAllS3ConfigsAsync } from './storage';
import { createStorageEngine } from './storage-engine';
import { createMetadataStore } from './metadata-store';
import { getUploadKeyRecord, incrementUploadKeyUsage } from './upload-keys';
import { moderateAndCleanup } from './moderation';
import { s3PutObject } from './s3-upload';
import { clearFileCache } from './cache';
import {
  MULTIPART_MAX_PARTS,
  MULTIPART_PART_SIZE,
  abortMultipartUpload,
  completeMultipartUpload,
  cleanupExpiredMultipartUploads,
  createMultipartCapability,
  hashMultipartCapability,
  startMultipartUpload,
  uploadMultipartPart,
} from './multipart';
import { errorMessage } from './errors';
import { normalizeUploadDirectory } from './storage-path';

export const uploadPublicRoutes = new Hono<{ Bindings: Env }>();
const SINGLE_UPLOAD_LIMIT = 20 * 1024 * 1024;
const DEFAULT_PUBLIC_MULTIPART_LIMIT = 2 * 1024 * 1024 * 1024;
const PUBLIC_MULTIPART_HARD_LIMIT = MULTIPART_PART_SIZE * MULTIPART_MAX_PARTS;

function getPublicMultipartLimit(env: Env): number {
  const configured = Number(env.PUBLIC_UPLOAD_MAX_BYTES);
  return Number.isSafeInteger(configured)
    && configured >= SINGLE_UPLOAD_LIMIT
    && configured <= PUBLIC_MULTIPART_HARD_LIMIT
    ? configured
    : DEFAULT_PUBLIC_MULTIPART_LIMIT;
}

function getPublicUploadPath(env: Env): string {
  const p = env.PUBLIC_UPLOAD_PATH || 'uploads/public/';
  return normalizeUploadDirectory(p);
}

// ── Single file upload (Turnstile + optional key) ──
uploadPublicRoutes.post('/single', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') || '';
  const body = await c.req.parseBody();
  const file = body['file'];
  const turnstile = body['turnstile'] as string;
  const uploadKeyId = body['uploadKeyId'] as string;
  let path = getPublicUploadPath(c.env);

  if (!file || !(file instanceof File)) return c.json({ error: '缺少文件' }, 400);
  if (file.size > SINGLE_UPLOAD_LIMIT) return c.json({ error: '单文件上传不能超过 20MB，请使用分片上传' }, 413);
  if (!turnstile) return c.json({ error: '缺少人机验证' }, 400);
  if (!(await verifyTurnstile(turnstile, c.env.TURNSTILE_SECRET, ip))) {
    return c.json({ error: '人机验证失败' }, 403);
  }

  const engine = await createStorageEngine(c.env);
  const meta = createMetadataStore(c.env);

  let keyLabel: string | undefined;
  if (uploadKeyId) {
    const key = await getUploadKeyRecord(meta, uploadKeyId);
    if (!key) return c.json({ error: '上传链接不存在' }, 404);
    if (!key.active) return c.json({ error: '上传链接已禁用' }, 403);
    if (new Date(key.expires) < new Date()) return c.json({ error: '上传链接已过期' }, 410);
    try {
      path = normalizeUploadDirectory(key.path);
    } catch {
      return c.json({ error: '上传链接路径无效' }, 500);
    }
    keyLabel = key.label;
  }

  const key2 = await uniqueKey(engine, path, file.name);
  const contentType = file.type || 'application/octet-stream';
  const buf = await file.arrayBuffer();

  // Primary upload
  await engine.put(key2, buf, { contentType });

  // Sync to other S3 backends（主后端已通过 engine.put 写入）
  const s3Cfgs = await getAllS3ConfigsAsync(c.env);
  const syncCfgs = engine.kind === 'r2' ? s3Cfgs : s3Cfgs.slice(1);
  let s3Ok = false;
  for (const s3cfg of syncCfgs) {
    try { const ok = await s3PutObject(s3cfg, key2, buf, contentType); if (ok) s3Ok = true; } catch (e) { console.error('S3 upload error:', e); }
  }

  if (uploadKeyId) await incrementUploadKeyUsage(meta, uploadKeyId);

  c.executionCtx.waitUntil(
    writeUploadLog(c.env, {
      key: key2, name: file.name, size: file.size, ip,
      country: c.req.header('CF-IPCountry') || '',
      ua: c.req.header('User-Agent') || '',
      referer: c.req.header('Referer') || '',
      source: uploadKeyId ? 'upload-key' : 'public',
      uploadKeyId, uploadKeyLabel: keyLabel,
    }),
  );

  c.executionCtx.waitUntil(
    moderateAndCleanup(c.env, {
      key: key2, name: file.name, size: file.size,
      contentType,
      ip,
      ua: c.req.header('User-Agent') || '',
      source: uploadKeyId ? 'upload-key' : 'public',
    }),
  );

  // 清除对应的 KV 缓存
  c.executionCtx.waitUntil(clearFileCache(c.env, '', key2));

  return c.json({ ok: true, key: key2, name: file.name, s3: s3Ok });
});

// ── Init multipart (Turnstile + optional key) ──
uploadPublicRoutes.post('/init', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') || '';
  const body = await c.req.json<{ filename: string; size: number; path?: string; turnstile?: string; uploadKeyId?: string }>();
  const { filename, turnstile, uploadKeyId } = body;
  let path = getPublicUploadPath(c.env);

  if (!filename) return c.json({ error: '缺少文件名' }, 400);
  if (!Number.isSafeInteger(body.size) || body.size <= 0) return c.json({ error: '文件大小无效' }, 400);
  if (body.size > getPublicMultipartLimit(c.env)) {
    return c.json({ error: '文件超过公开上传大小限制' }, 413);
  }
  if (!turnstile) return c.json({ error: '缺少人机验证' }, 400);
  if (!(await verifyTurnstile(turnstile, c.env.TURNSTILE_SECRET, ip))) {
    return c.json({ error: '人机验证失败' }, 403);
  }

  const engine = await createStorageEngine(c.env);
  const meta = createMetadataStore(c.env);
  c.executionCtx.waitUntil(
    cleanupExpiredMultipartUploads(c.env, engine)
      .catch(error => console.error('Expired multipart cleanup failed:', error)),
  );

  let keyLabel: string | undefined;
  if (uploadKeyId) {
    const key = await getUploadKeyRecord(meta, uploadKeyId);
    if (!key) return c.json({ error: '上传链接不存在' }, 404);
    if (!key.active) return c.json({ error: '上传链接已禁用' }, 403);
    if (new Date(key.expires) < new Date()) return c.json({ error: '上传链接已过期' }, 410);
    try {
      path = normalizeUploadDirectory(key.path);
    } catch {
      return c.json({ error: '上传链接路径无效' }, 500);
    }
    keyLabel = key.label;
  }

  const key2 = await uniqueKey(engine, path, filename);
  const ct = getContentType(filename);
  const uploadToken = createMultipartCapability();
  const uploadId = await startMultipartUpload(c.env, engine, key2, filename, ct, {
    uploadKeyId,
    uploadKeyLabel: keyLabel,
    source: uploadKeyId ? 'upload-key' : 'public',
    expectedSize: body.size,
    capabilityHash: await hashMultipartCapability(uploadToken),
  });
  return c.json({ uploadId, key: key2, uploadToken });
});

// ── Upload part (no Turnstile needed) ──
uploadPublicRoutes.post('/part', async (c) => {
  const body = await c.req.parseBody();
  const uploadId = body['uploadId'] as string;
  const key = body['key'] as string;
  const uploadToken = body['uploadToken'] as string;
  const partNumber = parseInt(body['partNumber'] as string, 10);
  const chunk = body['chunk'];

  if (!uploadId || !key || !uploadToken || !partNumber || !chunk) return c.json({ error: '缺少参数' }, 400);
  if (!(chunk instanceof File)) return c.json({ error: '无效的文件数据' }, 400);
  if (chunk.size === 0 || chunk.size > MULTIPART_PART_SIZE) return c.json({ error: '分片大小无效' }, 413);

  const engine = await createStorageEngine(c.env);
  const chunkBuf = await chunk.arrayBuffer();
  try {
    const partResult = await uploadMultipartPart(c.env, engine, uploadId, key, partNumber, chunkBuf, {
      token: uploadToken,
      requireCapability: true,
    });
    return c.json(partResult);
  } catch (error) {
    return c.json({ error: errorMessage(error, '分片上传失败') }, 400);
  }
});

// ── Complete multipart ──
uploadPublicRoutes.post('/complete', async (c) => {
  const body = await c.req.json<{ uploadId: string; key: string; uploadToken: string; parts: UploadPart[] }>();
  const { uploadId, key, uploadToken, parts } = body;

  if (!uploadId || !key || !uploadToken || !parts?.length) return c.json({ error: '缺少参数' }, 400);

  const engine = await createStorageEngine(c.env);
  let completed: Awaited<ReturnType<typeof completeMultipartUpload>>;
  try {
    completed = await completeMultipartUpload(c.env, engine, uploadId, key, parts, {
      token: uploadToken,
      requireCapability: true,
    });
  } catch (error) {
    return c.json({ error: errorMessage(error, '完成分片上传失败') }, 400);
  }
  const { object, metadata: mpMeta, syncFailures } = completed;

  // 获取实际文件大小（S3 primary 时 complete 不返回 size）
  if (object.size === 0) {
    try {
      const head = await engine.head(key);
      if (head) object.size = head.size;
    } catch {}
  }

  if (mpMeta.uploadKeyId) await incrementUploadKeyUsage(createMetadataStore(c.env), mpMeta.uploadKeyId);

  const name = key.split('/').pop() || key;
  // contentType 在 S3 primary 模式下 complete 不返回；从 mpMeta 恢复
  const filename = mpMeta?.filename || name;
  const contentType = getContentType(filename);
  c.executionCtx.waitUntil(
    writeUploadLog(c.env, {
      key, name, size: object.size,
      ip: c.req.header('CF-Connecting-IP') || '',
      country: c.req.header('CF-IPCountry') || '',
      ua: c.req.header('User-Agent') || '',
      referer: c.req.header('Referer') || '',
      source: (mpMeta?.source || 'public') as 'dashboard' | 'public' | 'upload-key',
      uploadKeyId: mpMeta?.uploadKeyId,
      uploadKeyLabel: mpMeta?.uploadKeyLabel,
    }),
  );

  c.executionCtx.waitUntil(
    moderateAndCleanup(c.env, {
      key, name, size: object.size, contentType,
      ip: c.req.header('CF-Connecting-IP') || '',
      ua: c.req.header('User-Agent') || '',
      source: (mpMeta?.source || 'public') as 'dashboard' | 'public' | 'upload-key',
    }),
  );

  // 清除对应的 KV 缓存
  c.executionCtx.waitUntil(clearFileCache(c.env, '', key));

  return c.json({ ok: true, key: object.key, name, syncFailures });
});

// ── Abort ──
uploadPublicRoutes.post('/abort', async (c) => {
  const body = await c.req.json<{ uploadId: string; key: string; uploadToken: string }>();
  const { uploadId, key, uploadToken } = body;

  if (!uploadId || !key || !uploadToken) return c.json({ error: '缺少参数' }, 400);

  const engine = await createStorageEngine(c.env);
  try {
    await abortMultipartUpload(c.env, engine, uploadId, key, {
      token: uploadToken,
      requireCapability: true,
    });
  } catch (error) {
    return c.json({ error: errorMessage(error, '取消分片上传失败') }, 400);
  }

  return c.json({ ok: true });
});
