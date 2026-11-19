import { Router } from '../http.js';
import { badRequest } from '../errors.js';
import { verifySignature } from '../signature.js';
import { verifyMainToken } from '../auth.js';
import { ingestEvent, validateNewPostEvent } from '../services/events.js';
import { enforce } from '../rate-limit.js';

const router = new Router();

async function verifyInternal(ctx, raw) {
  await verifySignature(ctx.db, {
    scope: 'internal',
    secret: ctx.config.internalSecret,
    parts: [String(ctx.headers['x-internal-timestamp'] || ''), String(ctx.headers['x-internal-nonce'] || ''), raw],
    timestamp: ctx.headers['x-internal-timestamp'],
    nonce: ctx.headers['x-internal-nonce'],
    signature: ctx.headers['x-internal-signature'],
  });
}

router.post('/internal/v1/events/new-post', async (ctx) => {
  await enforce(ctx.services.limiter, {
    name: 'internal-events',
    subject: ctx.ip,
    capacity: ctx.config.rateLimits.internal,
    windowSeconds: 60,
  });
  const raw = (await ctx.rawBody()).toString('utf8');
  await verifyInternal(ctx, raw);
  let body;
  try { body = JSON.parse(raw || '{}'); } catch { throw badRequest('INVALID_JSON', '事件体不是合法 JSON'); }
  const event = validateNewPostEvent(body);
  const result = await ingestEvent({
    db: ctx.db,
    event,
    config: ctx.config,
    push: ctx.services.push,
    log: ctx.services.log,
  });
  ctx.services.metrics.inc('mp_events_received_total', { duplicate: String(result.duplicate) });
  if (result.notified) ctx.services.metrics.inc('mp_notifications_created_total', {}, result.notified);
  ctx.json({ accepted: true, ...result }, result.duplicate ? 200 : 202);
});

router.post('/internal/v1/token/verify', async (ctx) => {
  const raw = (await ctx.rawBody()).toString('utf8');
  await verifyInternal(ctx, raw);
  let body;
  try { body = JSON.parse(raw || '{}'); } catch { throw badRequest('INVALID_JSON', '请求体不是合法 JSON'); }
  const token = String(body.token || '');
  if (!token) throw badRequest('TOKEN_REQUIRED', '缺少 token');
  try {
    const { userId, payload } = await verifyMainToken(token, ctx.config);
    ctx.json({
      valid: true,
      userID: userId,
      expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
    });
  } catch {
    ctx.json({ valid: false });
  }
});

export default router;