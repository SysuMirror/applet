import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { createContext } from './http.js';
import { ApiError } from './errors.js';
import { createLogger } from './logger.js';
import { openDb, cleanup } from './db.js';
import { Metrics } from './metrics.js';
import { RateLimiter, enforce } from './rate-limit.js';
import { UsageTracker } from './usage.js';
import { PushService } from './services/push.js';
import { createRedis } from './redis.js';
import { createStorage, mediaFile } from './storage.js';
import { seed as seedDb } from './seed.js';
import { clientIp, safeJsonParse, sha256, safeEqualHex } from './util.js';

import metaRouter from './routes/meta.js';
import clientRouter from './routes/client.js';
import devRouter from './routes/dev.js';
import adminRouter from './routes/admin.js';
import internalRouter from './routes/internal.js';
import ssoRouter from './routes/sso.js';
import appApiRouter from './routes/appapi.js';
import ttsRouter from './routes/tts.js';

const ROUTERS = [metaRouter, ssoRouter, clientRouter, devRouter, adminRouter, internalRouter, appApiRouter, ttsRouter];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.yaml': 'application/yaml; charset=utf-8',
  '.yml': 'application/yaml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.zip': 'application/zip',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.htm': 'text/html; charset=utf-8',
  '.dart': 'text/plain; charset=utf-8',
};

const CSP_PORTAL = [
  "default-src 'self'",
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

const CSP_HOSTED = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self'",
  "connect-src 'self' https://applet.ssemarket.cn",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const CSP_DEMO = [
  "default-src 'self'",
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
].join('; ');

function sanitizeQuery(search) {
  if (!search) return undefined;
  const params = new URLSearchParams(search);
  let changed = false;
  for (const key of ['ticket', 'token', 'access_token', 'refresh_token', 'signature', 'nonce', 'secret', 'source']) {
    if (params.has(key)) { params.set(key, '[redacted]'); changed = true; }
  }
  return changed ? `?${params.toString()}` : search;
}

function findRoute(method, pathname) {
  for (const router of ROUTERS) {
    const matched = router.match(method, pathname);
    if (matched) return matched;
  }
  return null;
}

function safeResolve(base, relative) {
  const resolved = path.resolve(base, `.${relative.startsWith('/') ? relative : `/${relative}`}`);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) return null;
  return resolved;
}

function serveFile(ctx, file, { cache = 'no-cache', immutable = false } = {}) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  if (ctx.headers['if-none-match'] === etag) {
    ctx.res.statusCode = 304;
    ctx.res.end();
    return true;
  }
  const ext = path.extname(file).toLowerCase();
  ctx.res.statusCode = 200;
  ctx.res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  ctx.res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : cache);
  ctx.res.setHeader('ETag', etag);
  const body = fs.readFileSync(file);
  ctx.res.end(ctx.method === 'HEAD' ? undefined : body);
  return true;
}

export async function createApp(config, { seedData = true, logger } = {}) {
  const log = logger || createLogger({ level: config.logLevel, logDir: config.logDir });
  const db = await openDb(config);
  const redis = await createRedis(config, log);
  const storage = await createStorage(config, log);

  const services = {
    log,
    db,
    redis,
    storage,
    metrics: new Metrics(),
    limiter: new RateLimiter({
      redis,
      prefix: config.redisPrefix,
      logger: log,
    }),
    usage: new UsageTracker(),
    push: new PushService({ config, log }),
    startedAt: Date.now(),
  };

  if (seedData) await seedDb(db, config, log);

  const publicDir = path.join(config.root, 'public');
  const skillDir = path.join(config.root, 'skills', 'app-integration');

  let originCache = { expires: 0, set: new Set() };
  async function publishedOrigins() {
    const now = Date.now();
    if (now < originCache.expires) return originCache.set;
    const list = await db.prepare("SELECT allowed_origins FROM mp_apps WHERE status = 'published' AND deleted_at IS NULL")
      .all();
    const set = new Set();
    for (const row of list) {
      for (const origin of safeJsonParse(row.allowed_origins, [])) set.add(origin);
    }
    originCache = { expires: now + 60_000, set };
    return set;
  }

  let cachedOrigins = new Set();

  function sameOrigin(origin) {
    try { return new URL(config.publicBase).origin === origin; } catch { return false; }
  }

  function originAllowed(origin) {
    if (!origin) return false;
    if (sameOrigin(origin)) return true;
    if (config.corsExtraOrigins.includes(origin)) return true;
    if (config.allowHttpLocalhost && /^http:\/\/localhost(:\d+)?$/.test(origin)) return true;
    return cachedOrigins.has(origin);
  }

  async function resolveMedia(ctx, filename) {
    const meta = mediaFile(filename);
    if (!meta) return false;
    const media = await services.storage.getMedia(filename);
    if (!media) return false;
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', media.contentType || meta.contentType);
    ctx.res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    ctx.res.setHeader('X-Content-Type-Options', 'nosniff');
    ctx.res.end(ctx.method === 'HEAD' ? undefined : media.buffer);
    return true;
  }

  async function serveHostedMiniApp(ctx) {
    const match = /^\/mp\/([a-z][a-z0-9_-]{2,31})(?:\/(.*))?$/.exec(ctx.pathname);
    if (!match) return false;
    const appKey = match[1];
    const app = await db.prepare(
      'SELECT * FROM mp_apps WHERE app_key = ? AND deleted_at IS NULL',
    ).get(appKey);
    if (!app || app.hosting_mode !== 'internal' || !app.hosting_build) {
      ctx.status(404, { code: 'HOSTED_APP_NOT_FOUND', message: '小程序源不存在或未启用平台托管', requestId: ctx.requestId });
      return true;
    }
    if (ctx.pathname === `/mp/${appKey}`) {
      const search = ctx.url.search || '';
      ctx.redirect(`${ctx.config.publicBase}/mp/${appKey}/${search}`);
      return true;
    }
    const cookieName = `mp_src_${appKey}`;
    const queryToken = String(ctx.query.get('source') || '');
    const token = queryToken || ctx.getCookie(cookieName);
    if (!token || !app.hosting_token_hash || !safeEqualHex(sha256(token), app.hosting_token_hash)) {
      ctx.res.statusCode = 403;
      ctx.res.setHeader('Content-Type', 'text/html; charset=utf-8');
      ctx.res.setHeader('Cache-Control', 'no-store');
      ctx.res.end('<!doctype html><meta charset="utf-8"><p style="font-family:system-ui;padding:40px">该小程序源需要有效的 source token，请从 App 内打开。</p>');
      return true;
    }
    if (queryToken) {
      ctx.setCookie(cookieName, token, {
        maxAge: 7 * 24 * 3600,
        sameSite: 'Lax',
        path: `/mp/${appKey}`,
      });
    }
    const root = path.join(config.dataDir, 'miniapps', appKey, app.hosting_build);
    let rel = '';
    try { rel = decodeURIComponent(match[2] || ''); } catch { rel = ''; }
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    if (rel.includes('..') || rel.includes('\0')) {
      ctx.status(404, { code: 'NOT_FOUND', message: '文件不存在', requestId: ctx.requestId });
      return true;
    }
    let file = path.resolve(root, rel);
    if (!file.startsWith(`${path.resolve(root)}${path.sep}`)) {
      ctx.status(404, { code: 'NOT_FOUND', message: '文件不存在', requestId: ctx.requestId });
      return true;
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      if (!path.extname(rel)) {
        file = path.join(root, 'index.html');
      }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        ctx.status(404, { code: 'NOT_FOUND', message: '文件不存在', requestId: ctx.requestId });
        return true;
      }
    }
    const ext = path.extname(file).toLowerCase();
    const isHtml = ext === '.html' || ext === '.htm';
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    ctx.res.setHeader('Cache-Control', 'no-cache');
    ctx.res.setHeader('X-Content-Type-Options', 'nosniff');
    ctx.res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    ctx.res.setHeader('Content-Security-Policy', CSP_HOSTED);
    const body = fs.readFileSync(file);
    ctx.res.end(ctx.method === 'HEAD' ? undefined : body);
    return true;
  }

  async function handleStatic(ctx) {
    if (ctx.pathname.startsWith('/mp/') && await serveHostedMiniApp(ctx)) return true;
    const p = ctx.pathname;
    if (p === '/' || p === '/index.html') return serveFile(ctx, path.join(publicDir, 'index.html'));
    if (p === '/admin' || p === '/admin/') return serveFile(ctx, path.join(publicDir, 'admin.html'));
    if (p === '/launch') return serveFile(ctx, path.join(publicDir, 'launch.html'));
    if (p === '/demo/app' || p === '/demo/app/') return serveFile(ctx, path.join(publicDir, 'demo', 'app.html'));
    if (p === '/sdk/mp-client.js') return serveFile(ctx, path.join(publicDir, 'sdk', 'mp-client.js'));
    if (p === '/openapi.yaml' || p === '/openapi.yml') {
      return serveFile(ctx, path.join(publicDir, 'openapi.yaml'));
    }
    if (p.startsWith('/assets/')) {
      if (!/^\/assets\/(?:fonts|audio)\/[a-zA-Z0-9._-]+$/.test(p) && !/^\/assets\/[a-zA-Z0-9._-]+$/.test(p)) return false;
      return serveFile(ctx, path.join(publicDir, p), { cache: 'no-cache' });
    }
    if (p.startsWith('/downloads/')) {
      if (!/^\/downloads\/[a-zA-Z0-9._-]+\.zip$/.test(p)) return false;
      return serveFile(ctx, path.join(publicDir, p), { immutable: true });
    }
    if (p.startsWith('/skill/')) {
      if (!/^\/skill\/[a-zA-Z0-9._/-]+$/.test(p) || p.includes('..')) return false;
      const file = safeResolve(skillDir, p.slice('/skill'.length));
      if (!file) return false;
      return serveFile(ctx, file, { cache: 'public, max-age=60' });
    }
    if (p.startsWith('/media/')) {
      const filename = p.slice('/media/'.length);
      return resolveMedia(ctx, filename);
    }
    if (p === '/docs') { ctx.redirect('/#/docs'); return true; }
    if (p === '/app-docs' || p === '/app-docs/') {
      ctx.redirect('/app-docs/README.md');
      return true;
    }
    if (p.startsWith('/app-docs/')) {
      if (!/^\/app-docs\/[a-zA-Z0-9._-]+$/.test(p)) return false;
      const file = path.join(config.root, 'docs', 'app-integration', p.slice('/app-docs/'.length));
      return serveFile(ctx, file, { cache: 'public, max-age=60' });
    }
    if (['/login', '/register', '/dashboard', '/apps', '/account'].includes(p)) {
      ctx.redirect(`/#${p}`);
      return true;
    }
    return false;
  }

  const idempotency = new Map();

  async function handleRequest(req, res) {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    const ctx = createContext({ req, res, config, requestId });
    ctx.services = services;
    ctx.db = db;
    ctx.ip = clientIp(req, config.trustProxy);

    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.publicBase.startsWith('https://')) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    const isDemo = ctx.pathname.startsWith('/demo/');
    res.setHeader('X-Frame-Options', isDemo ? 'SAMEORIGIN' : 'DENY');
    res.setHeader('Content-Security-Policy', isDemo ? CSP_DEMO : CSP_PORTAL);

    res.on('finish', () => {
      const ms = Date.now() - started;
      const routeLabel = ctx.routePattern || (ctx.pathname.startsWith('/media/') ? 'media' : 'static');
      services.metrics.inc('mp_http_requests_total', {
        method: req.method,
        route: routeLabel,
        status: String(res.statusCode),
      });
      services.metrics.inc('mp_http_duration_ms_total', { route: routeLabel }, ms);
      if (config.requestLog && !['/healthz', '/readyz', '/metrics'].includes(ctx.pathname)) {
        log.info('http.request', {
          requestId,
          method: req.method,
          path: ctx.pathname,
          query: sanitizeQuery(ctx.url.search),
          status: res.statusCode,
          ms,
          ip: ctx.ip,
          userId: ctx.userId || undefined,
        });
      }
    });

    // CORS
    const origin = String(req.headers.origin || '');
    try { cachedOrigins = await publishedOrigins(); } catch { /* 保留旧缓存 */ }
    if (origin && originAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Authorization,Content-Type,Idempotency-Key,X-MP-Session,X-Requested-With,X-MP-Dev-Token',
      );
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') {
      if (origin && !originAllowed(origin)) {
        ctx.status(403, { code: 'CORS_FORBIDDEN', message: '该 origin 未登记', requestId });
        return;
      }
      res.statusCode = 204;
      res.end();
      return;
    }

    if (await handleStatic(ctx)) return;

    const matched = findRoute(req.method, ctx.pathname);
    if (!matched) {
      if (/^\/(v1|dev|admin|internal|app|media)(\/|$)/.test(ctx.pathname)) {
        ctx.status(404, { code: 'NOT_FOUND', message: '接口不存在', requestId });
      } else {
        const page = path.join(publicDir, '404.html');
        if (!serveFile(ctx, page)) {
          ctx.status(404, { code: 'NOT_FOUND', message: '页面不存在', requestId });
        }
      }
      return;
    }

    ctx.params = matched.params;
    ctx.routePattern = matched.route.pattern;

    // 预处理阶段的错误（CSRF、全局限流）也必须走统一错误映射，
    // 否则会被 server 级 catch 吞成 500“服务暂时不可用”。
    try {
      // 预防 CSRF：开放平台/管理后台的写操作若带 Origin，必须同源
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
        && /^\/(dev|admin)\//.test(ctx.pathname) && origin && !originAllowed(origin)) {
        throw new ApiError(403, 'CROSS_ORIGIN_BLOCKED', '跨站请求被拒绝');
      }

      // 全局 IP 限流（内部签名接口单独限流）
      if (!ctx.pathname.startsWith('/internal/')) {
        await enforce(services.limiter, {
          name: 'ip-global',
          subject: ctx.ip,
          capacity: config.rateLimits.apiIp * 2,
          windowSeconds: 60,
        });
      }

      // 幂等键：仅对写接口生效，缓存 10 分钟
      const idemKey = String(req.headers['idempotency-key'] || '').trim();
      let idemCacheKey = '';
      if (idemKey && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
        && !ctx.pathname.endsWith('/uploads')) {
        const authPart = sha256(`${req.headers.authorization || ''}|${ctx.getCookie('mp_dev')}|${ctx.ip}`);
        idemCacheKey = `${authPart}:${req.method}:${ctx.pathname}:${idemKey}`;
        const hit = idempotency.get(idemCacheKey);
        if (hit && hit.expires > Date.now()) {
          ctx.json(hit.body, hit.status, { 'Idempotency-Replayed': 'true' });
          return;
        }
        const originalJson = ctx.json;
        ctx.json = (data, status = 200, headers = {}) => {
          if (status < 400) {
            idempotency.set(idemCacheKey, { body: data, status, expires: Date.now() + 600_000 });
            if (idempotency.size > 5000) {
              const now = Date.now();
              for (const [key, value] of idempotency) if (value.expires <= now) idempotency.delete(key);
            }
          }
          originalJson(data, status, headers);
        };
      }

      await matched.route.handler(ctx);
    } catch (err) {
      handleError(ctx, err);
    }
  }

  function handleError(ctx, err) {
    if (ctx.res.headersSent) {
      try { ctx.res.end(); } catch { /* ignore */ }
      return;
    }
    if (err?.name === 'SsoError') {
      ctx.json({ code: err.code || 'SSO_ERROR', message: err.message, requestId: ctx.requestId }, err.status || 502);
      return;
    }
    if (err instanceof ApiError) {
      if (err.retryAfter) ctx.res.setHeader('Retry-After', String(err.retryAfter));
      if (err.status >= 500) {
        log.error('http.api_error', { requestId: ctx.requestId, code: err.code, error: err.message });
      } else if (err.code === 'INVALID_TOKEN' && err.details) {
        log.warn('auth.token_rejected', { requestId: ctx.requestId, ...err.details });
      }
      ctx.json(err.toJSON(ctx.requestId), err.status);
      return;
    }
    log.error('http.unhandled_error', {
      requestId: ctx.requestId,
      path: ctx.pathname,
      error: String(err?.message || err),
      stack: err?.stack,
    });
    ctx.status(500, { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后再试', requestId: ctx.requestId });
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      try {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ code: 'INTERNAL_ERROR', message: '服务暂时不可用', requestId: null }));
        } else {
          res.end();
        }
      } catch { /* ignore */ }
      log.error('http.fatal', { error: String(err?.message || err), stack: err?.stack });
    });
  });

  const flushTimer = setInterval(async () => {
    try { await services.usage.flush(db); } catch (err) {
      log.warn('usage.flush_failed', { error: String(err?.message || err) });
    }
  }, 15_000);
  flushTimer.unref?.();

  const cleanupTimer = setInterval(async () => {
    try { await cleanup(db, config.dataRetentionDays); } catch (err) {
      log.warn('db.cleanup_failed', { error: String(err?.message || err) });
    }
  }, 3600_000);
  cleanupTimer.unref?.();

  async function close() {
    clearInterval(flushTimer);
    clearInterval(cleanupTimer);
    try { await services.usage.flush(db); } catch { /* ignore */ }
    await new Promise((resolve) => server.close(() => resolve()));
    try { await db.close(); } catch { /* ignore */ }
    try { if (redis) await redis.quit(); } catch { try { await redis?.destroy(); } catch { /* ignore */ } }
    log.close?.();
  }

  return { server, db, redis, services, close, log };
}