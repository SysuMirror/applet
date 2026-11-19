import { Router } from '../http.js';
import { badRequest, notFound } from '../errors.js';
import { verifySignature } from '../signature.js';
import { appSecret, getApp, mapApp, publicApp } from '../services/catalog.js';
import { isExpired, safeJsonParse, sha256 } from '../util.js';

const router = new Router();

/**
 * 第三方小程序服务端 API。
 * 认证：X-App-Key + X-App-Timestamp + X-App-Nonce + X-App-Signature。
 * appSecret 只存在于服务端，绝不能下发到 WebView。
 */
async function verifyAppSignature(ctx, raw) {
  const appKey = String(ctx.headers['x-app-key'] || '').trim();
  if (!appKey) throw badRequest('APP_KEY_REQUIRED', '缺少 X-App-Key');
  const app = await getApp(ctx.db, appKey);
  if (!app) throw notFound('APP_NOT_FOUND', '小程序不存在');
  if (app.status === 'offline') throw notFound('APP_OFFLINE', '小程序已下线');
  const secret = appSecret(app, ctx.config);
  if (!secret) throw notFound('APP_SECRET_MISSING', '小程序未配置密钥');
  await verifySignature(ctx.db, {
    scope: `app:${appKey}`,
    secret,
    parts: [
      appKey,
      String(ctx.headers['x-app-timestamp'] || ''),
      String(ctx.headers['x-app-nonce'] || ''),
      raw,
    ],
    timestamp: ctx.headers['x-app-timestamp'],
    nonce: ctx.headers['x-app-nonce'],
    signature: ctx.headers['x-app-signature'],
  });
  ctx.app = app;
  return app;
}

router.get('/app/v1/apps/self', async (ctx) => {
  const raw = '';
  const app = await verifyAppSignature(ctx, raw);
  ctx.json({ app: publicApp(app, ctx.config.publicBase) });
});

router.post('/app/v1/sessions/verify', async (ctx) => {
  const raw = (await ctx.rawBody()).toString('utf8');
  const app = await verifyAppSignature(ctx, raw);
  let body;
  try { body = JSON.parse(raw || '{}'); } catch { throw badRequest('INVALID_JSON', '请求体不是合法 JSON'); }
  const token = String(body.sessionToken || ctx.headers['x-mp-session'] || '').trim();
  if (!token) throw badRequest('SESSION_REQUIRED', '缺少 sessionToken');
  const row = await ctx.db.prepare('SELECT * FROM mp_sessions WHERE token_hash = ?').get(sha256(token));
  if (!row || row.revoked_at || isExpired(row.expires_at) || row.app_key !== app.app_key) {
    ctx.json({ valid: false });
    return;
  }
  ctx.services.usage.record(app.app_key, row.user_id);
  ctx.json({
    valid: true,
    userId: row.user_id,
    appKey: row.app_key,
    scopes: safeJsonParse(row.scopes, []),
    deviceId: row.device_id,
    expiresAt: row.expires_at,
  });
});

router.get('/app/v1/apps/me', async (ctx) => {
  const app = await verifyAppSignature(ctx, '');
  ctx.json({ app: mapApp(app) });
});

export default router;