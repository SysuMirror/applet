import { Router } from '../http.js';
import { safeEqualHex } from '../util.js';

const router = new Router();
const STARTED = Date.now();

router.get('/healthz', (ctx) => {
  ctx.json({ ok: true, service: 'mp-service', version: '1.0.0', uptime: Math.floor((Date.now() - STARTED) / 1000) });
});

router.get('/readyz', async (ctx) => {
  try {
    await ctx.db.prepare('SELECT 1 AS ok').get();
    ctx.json({ ok: true, db: 'up' });
  } catch (err) {
    ctx.status(503, { ok: false, db: 'down', error: String(err?.message || err) });
  }
});

router.get('/metrics', async (ctx) => {
  const token = ctx.config.metricsToken;
  if (token) {
    const auth = String(ctx.headers.authorization || '');
    const provided = auth.startsWith('Bearer ') ? auth.slice(7) : String(ctx.query.get('token') || '');
    if (!provided || provided.length !== token.length || !safeEqualHex(
      Buffer.from(provided).toString('hex'), Buffer.from(token).toString('hex'),
    )) {
      ctx.status(403, { code: 'FORBIDDEN', message: '需要指标访问令牌', requestId: ctx.requestId });
      return;
    }
  }
  const db = ctx.db;
  const metrics = ctx.services.metrics;
  const counts = {
    apps: (await db.prepare('SELECT COUNT(*) AS c FROM mp_apps WHERE deleted_at IS NULL').get()).c,
    developers: (await db.prepare("SELECT COUNT(*) AS c FROM mp_developers WHERE role = 'developer'").get()).c,
    sessions: (await db.prepare('SELECT COUNT(*) AS c FROM mp_sessions WHERE revoked_at IS NULL AND expires_at > ?')
      .get(new Date().toISOString())).c,
    events: (await db.prepare('SELECT COUNT(*) AS c FROM mp_events').get()).c,
    notifications: (await db.prepare('SELECT COUNT(*) AS c FROM mp_notifications').get()).c,
  };
  metrics.set('mp_db_apps_total', Number(counts.apps));
  metrics.set('mp_db_developers_total', Number(counts.developers));
  metrics.set('mp_active_sessions', Number(counts.sessions));
  metrics.set('mp_events_total', Number(counts.events));
  metrics.set('mp_notifications_total', Number(counts.notifications));
  metrics.set('mp_process_resident_memory_bytes', process.memoryUsage().rss);
  metrics.set('mp_process_uptime_seconds', Math.floor((Date.now() - STARTED) / 1000));
  metrics.set('mp_rate_limit_buckets', ctx.services.limiter.size);
  ctx.text(metrics.render(), 200, 'text/plain; version=0.0.4; charset=utf-8');
});

export default router;