import { Router } from '../http.js';
import { badRequest, notFound } from '../errors.js';
import {
  requireUser, optionalUser, getSession, touchSession, readBearer, SESSION_COOKIE,
} from '../auth.js';
import { enforce } from '../rate-limit.js';
import {
  canSeeApp, listCatalog, publicApp, requireApp, searchCatalog,
} from '../services/catalog.js';
import { CATEGORIES as CATEGORY_LIST, PLATFORMS, PUSH_PROVIDERS } from '../config.js';
import {
  exchangeTicket, issueTicket, revokeSession,
} from '../services/tickets.js';
import { getPrefs, putPrefs, listGrants, revokeGrant } from '../services/prefs.js';
import {
  getSubscriptions, listNewPosts, markNotificationsRead, putSubscriptions,
} from '../services/events.js';
import {
  encryptSecret, mask, normalizeOrigin, nowIso, safeJsonParse, sha256,
} from '../util.js';

const router = new Router();

async function limit(ctx, name, subject, capacity, windowSeconds = 60) {
  await enforce(ctx.services.limiter, { name, subject, capacity, windowSeconds });
}

function isoDate(value, fallback) {
  const t = Date.parse(String(value || ''));
  return Number.isFinite(t) ? new Date(t).toISOString() : fallback;
}

async function userOrSession(ctx, scope) {
  const bearer = readBearer(ctx);
  if (bearer && bearer.split('.').length === 3) {
    const { userId } = await requireUser(ctx);
    return { userId, via: 'user' };
  }
  const result = await getSession(ctx, { requiredScope: scope });
  await touchSession(ctx, { ...result, config: ctx.config });
  ctx.services.usage.record(result.app.app_key, result.userId);
  return { userId: result.userId, via: 'session', app: result.app, scopes: result.scopes };
}

// ── 目录 ────────────────────────────────────────────────────────────────
router.get('/v1/apps', async (ctx) => {
  await limit(ctx, 'apps', ctx.ip, ctx.config.rateLimits.apiIp);
  const attempted = readBearer(ctx);
  if (attempted && attempted.split('.').length === 3) await optionalUser(ctx);
  const result = await listCatalog(ctx.db, {
    category: String(ctx.query.get('category') || ''),
    cursor: String(ctx.query.get('cursor') || ''),
    limit: ctx.query.get('limit'),
    userId: ctx.userId || '',
    publicBase: ctx.config.publicBase,
  });
  ctx.json(result);
});

router.get('/v1/apps/:appKey', async (ctx) => {
  await limit(ctx, 'app-detail', ctx.ip, ctx.config.rateLimits.apiIp);
  const attempted = readBearer(ctx);
  if (attempted && attempted.split('.').length === 3) await optionalUser(ctx);
  const app = await requireApp(ctx.db, ctx.params.appKey);
  if (!(await canSeeApp(ctx.db, app, ctx.userId || ''))) throw notFound('APP_NOT_FOUND', '小程序不存在或不可见');
  ctx.json({ app: publicApp(app, ctx.config.publicBase) });
});

router.get('/v1/categories', async (ctx) => {
  ctx.json({ items: CATEGORY_LIST.map((c) => ({ ...c, name: c.name })) });
});

router.get('/v1/search', async (ctx) => {
  await limit(ctx, 'search', ctx.ip, ctx.config.rateLimits.apiIp);
  const attempted = readBearer(ctx);
  if (attempted && attempted.split('.').length === 3) await optionalUser(ctx);
  const result = await searchCatalog(ctx.db, {
    q: ctx.query.get('q') || '',
    limit: ctx.query.get('limit'),
    userId: ctx.userId || '',
    publicBase: ctx.config.publicBase,
  });
  ctx.json(result);
});

// ── 启动票据 ────────────────────────────────────────────────────────────
router.post('/v1/launch-tickets', async (ctx) => {
  await limit(ctx, 'launch-ip', ctx.ip, ctx.config.rateLimits.launch * 2);
  const { userId } = await requireUser(ctx);
  await limit(ctx, 'launch-user', userId, ctx.config.rateLimits.launch);
  const body = await ctx.body();
  const appKey = String(body.appKey || '').trim();
  if (!appKey) throw badRequest('APP_KEY_REQUIRED', '缺少 appKey');
  const deviceID = String(body.deviceID || '').trim().slice(0, 128);
  const app = await requireApp(ctx.db, appKey);
  if (!(await canSeeApp(ctx.db, app, userId))) throw notFound('APP_NOT_FOUND', '小程序不存在或不可见');

  const allowed = safeJsonParse(app.allowed_origins, []);
  let origin = '';
  if (body.origin) {
    origin = normalizeOrigin(body.origin);
    if (!origin) throw badRequest('INVALID_ORIGIN', 'origin 不合法');
    if (allowed.length && !allowed.includes(origin)) {
      throw badRequest('ORIGIN_NOT_ALLOWED', '该 origin 未在小程序中登记');
    }
  } else if (allowed.length) {
    // 未显式传 origin 时，优先绑定入口页 origin（与 launchURL 实际打开的位置一致），
    // 而不是盲目取 allowedOrigins[0]，避免票据 origin 与页面 origin 不一致。
    let entryOrigin = '';
    try { entryOrigin = new URL(app.entry_url).origin; } catch { entryOrigin = ''; }
    origin = entryOrigin && allowed.includes(entryOrigin) ? entryOrigin : allowed[0];
  }

  const { ticket, expiresAt, ttl } = await issueTicket(ctx.db, {
    userId, app, deviceId: deviceID, origin, ttl: ctx.config.ticketTtl,
    redis: ctx.services.redis, prefix: ctx.config.redisPrefix,
  });

  let launchURL;
  if (ctx.config.launchMode === 'gateway') {
    const url = new URL(ctx.config.launchBase);
    url.searchParams.set('ticket', ticket);
    url.searchParams.set('app', app.app_key);
    launchURL = url.toString();
  } else {
    const url = new URL(app.entry_url);
    url.searchParams.set('ticket', ticket);
    launchURL = url.toString();
  }

  ctx.services.metrics.inc('mp_launch_tickets_created_total');
  ctx.services.usage.record(app.app_key, userId);
  ctx.json({ ticket, launchURL, expiresIn: ttl, expiresAt, app: publicApp(app, ctx.config.publicBase) }, 201);
});

// ── 票据换会话 ──────────────────────────────────────────────────────────
router.post('/v1/sessions/exchange', async (ctx) => {
  await limit(ctx, 'exchange-ip', ctx.ip, ctx.config.rateLimits.exchange);
  const body = await ctx.body();
  const ticket = String(body.ticket || '').trim();
  if (!ticket || ticket.length > 128) throw badRequest('TICKET_REQUIRED', '缺少 ticket');

  const requestOrigin = normalizeOrigin(String(ctx.headers.origin || ''));
  const result = await exchangeTicket(ctx.db, ticket, {
    origin: requestOrigin,
    sessionTtl: ctx.config.sessionTtl,
    redis: ctx.services.redis, prefix: ctx.config.redisPrefix,
  });

  ctx.setCookie(SESSION_COOKIE, result.token, {
    maxAge: ctx.config.sessionTtl,
    sameSite: 'Lax',
    path: '/',
  });
  ctx.services.metrics.inc('mp_sessions_exchanged_total');
  ctx.services.usage.record(result.app.app_key, result.session.userId);

  ctx.json({
    session: {
      userId: result.session.userId,
      appKey: result.session.appKey,
      deviceId: result.session.deviceId,
      scopes: result.session.scopes,
      expiresAt: result.session.expiresAt,
    },
    // 供小程序页面交给自己的服务端做会话校验（app-scoped，勿持久化/打日志）
    sessionToken: result.token,
    app: publicApp(result.app, ctx.config.publicBase),
    expiresIn: ctx.config.sessionTtl,
  });
});

router.get('/v1/sessions/me', async (ctx) => {
  const result = await getSession(ctx);
  await touchSession(ctx, { ...result, config: ctx.config });
  ctx.services.usage.record(result.app.app_key, result.userId);
  ctx.json({
    session: {
      userId: result.session.user_id,
      appKey: result.session.app_key,
      deviceId: result.session.device_id,
      scopes: result.scopes,
      expiresAt: result.session.expires_at,
    },
    app: publicApp(result.app, ctx.config.publicBase),
  });
});

router.delete('/v1/sessions/me', async (ctx) => {
  const result = await getSession(ctx);
  await revokeSession(ctx.db, sha256(result.token));
  ctx.clearCookie(SESSION_COOKIE, { path: '/' });
  ctx.json({ ok: true });
});

// ── 偏好（最近使用 / 我的小程序） ───────────────────────────────────────
router.get('/v1/me/prefs', async (ctx) => {
  await limit(ctx, 'prefs-get', ctx.ip, ctx.config.rateLimits.apiIp);
  const { userId } = await userOrSession(ctx, 'prefs:read');
  ctx.json(await getPrefs(ctx.db, userId, ctx.config.publicBase));
});

router.put('/v1/me/prefs', async (ctx) => {
  const { userId } = await userOrSession(ctx, 'prefs:write');
  await limit(ctx, 'prefs-put', userId, ctx.config.rateLimits.userApi);
  const body = await ctx.body();
  ctx.json(await putPrefs(ctx.db, userId, body, ctx.config.publicBase));
});

router.post('/v1/me/prefs/import', async (ctx) => {
  const { userId } = await userOrSession(ctx, 'prefs:write');
  await limit(ctx, 'prefs-import', userId, 5, 3600);
  const body = await ctx.body();
  const result = await putPrefs(ctx.db, userId, {
    recent: Array.isArray(body.recent)
      ? body.recent.map((item) => (typeof item === 'string' ? item : item?.appKey))
      : undefined,
    favorites: Array.isArray(body.favorites)
      ? body.favorites.map((item) => (typeof item === 'string' ? item : item?.appKey))
      : undefined,
  }, ctx.config.publicBase);
  ctx.json({ imported: true, ...result });
});

// ── 授权 ────────────────────────────────────────────────────────────────
router.get('/v1/me/grants', async (ctx) => {
  const { userId } = await requireUser(ctx);
  ctx.json({ items: await listGrants(ctx.db, userId) });
});

router.delete('/v1/me/grants/:appKey', async (ctx) => {
  const { userId } = await requireUser(ctx);
  await revokeGrant(ctx.db, userId, ctx.params.appKey);
  ctx.json({ ok: true });
});

// ── 设备 ────────────────────────────────────────────────────────────────
router.post('/v1/devices', async (ctx) => {
  const { userId } = await requireUser(ctx);
  await limit(ctx, 'device-register', userId, 60);
  const body = await ctx.body();
  const deviceID = String(body.deviceID || '').trim();
  if (deviceID.length < 3 || deviceID.length > 128) throw badRequest('INVALID_DEVICE_ID', 'deviceID 长度需为 3~128');
  const platform = String(body.platform || '');
  if (!PLATFORMS.includes(platform)) throw badRequest('INVALID_PLATFORM', 'platform 不合法');
  const pushProvider = String(body.pushProvider || 'local');
  if (!PUSH_PROVIDERS.includes(pushProvider)) throw badRequest('INVALID_PUSH_PROVIDER', 'pushProvider 不合法');
  const pushToken = String(body.pushToken || '');
  if (pushToken.length > 2048) throw badRequest('INVALID_PUSH_TOKEN', 'pushToken 过长');
  const notificationEnabled = body.notificationEnabled === false ? 0 : 1;
  const appVersion = String(body.appVersion || '').slice(0, 32);
  const locale = String(body.locale || '').slice(0, 20);
  const now = nowIso();
  const cipher = pushToken ? encryptSecret(pushToken, ctx.config.appSecretMasterKey) : null;
  await ctx.db.prepare(`
    INSERT INTO mp_devices
      (user_id, device_id, platform, app_version, push_provider, push_token_hash,
       push_token_cipher, notification_enabled, locale, last_seen_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      platform = VALUES(platform), app_version = VALUES(app_version),
      push_provider = VALUES(push_provider), push_token_hash = VALUES(push_token_hash),
      push_token_cipher = COALESCE(VALUES(push_token_cipher), push_token_cipher),
      notification_enabled = VALUES(notification_enabled),
      locale = VALUES(locale), last_seen_at = VALUES(last_seen_at), updated_at = VALUES(updated_at)
  `).run(
    userId, deviceID, platform, appVersion, pushProvider,
    pushToken ? sha256(pushToken) : '', cipher, notificationEnabled, locale, now, now, now,
  );
  ctx.json({
    device: {
      deviceID, platform, appVersion, pushProvider,
      pushToken: pushToken ? mask(pushToken) : '',
      notificationEnabled: Boolean(notificationEnabled), lastSeenAt: now,
    },
  }, 201);
});

router.get('/v1/devices', async (ctx) => {
  const { userId } = await requireUser(ctx);
  const rows = await ctx.db.prepare(
    'SELECT device_id, platform, app_version, push_provider, notification_enabled, locale, last_seen_at FROM mp_devices WHERE user_id = ? ORDER BY last_seen_at DESC',
  ).all(userId);
  ctx.json({
    items: rows.map((row) => ({
      deviceID: row.device_id,
      platform: row.platform,
      appVersion: row.app_version,
      pushProvider: row.push_provider,
      notificationEnabled: Boolean(row.notification_enabled),
      locale: row.locale,
      lastSeenAt: row.last_seen_at,
    })),
  });
});

router.delete('/v1/devices/:deviceID', async (ctx) => {
  const { userId } = await requireUser(ctx);
  await ctx.db.prepare('DELETE FROM mp_devices WHERE user_id = ? AND device_id = ?')
    .run(userId, ctx.params.deviceID);
  ctx.json({ ok: true });
});

// ── 订阅 ────────────────────────────────────────────────────────────────
router.get('/v1/me/subscriptions', async (ctx) => {
  const { userId } = await requireUser(ctx);
  ctx.json(await getSubscriptions(ctx.db, userId));
});

router.put('/v1/me/subscriptions', async (ctx) => {
  const { userId } = await requireUser(ctx);
  await limit(ctx, 'subs-put', userId, 60);
  const body = await ctx.body();
  ctx.json(await putSubscriptions(ctx.db, userId, body.topics));
});

// ── 新帖提醒（推送兜底轮询） ────────────────────────────────────────────
router.get('/v1/events/new-posts', async (ctx) => {
  const { userId } = await requireUser(ctx);
  await limit(ctx, 'events-poll', userId, 120);
  const since = isoDate(ctx.query.get('since'), new Date(Date.now() - 86400_000).toISOString());
  const result = await listNewPosts(ctx.db, userId, { since, limit: ctx.query.get('limit') });
  ctx.json(result);
});

router.post('/v1/me/notifications/read', async (ctx) => {
  const { userId } = await requireUser(ctx);
  const body = await ctx.body();
  const changed = await markNotificationsRead(ctx.db, userId, {
    ids: body.ids,
    all: body.all === true,
  });
  ctx.json({ updated: changed });
});

// ── 反馈 ────────────────────────────────────────────────────────────────
router.post('/v1/feedback', async (ctx) => {
  const { userId } = await userOrSession(ctx, 'profile:read');
  await limit(ctx, 'feedback', userId, 5, 3600);
  const body = await ctx.body();
  const content = String(body.content || '').trim();
  if (content.length < 2 || content.length > 1000) throw badRequest('INVALID_FEEDBACK', '反馈内容需为 2~1000 字');
  const appKey = String(body.appKey || '').slice(0, 64);
  if (appKey) await requireApp(ctx.db, appKey);
  const contact = String(body.contact || '').slice(0, 200);
  await ctx.db.prepare(
    'INSERT INTO mp_feedback (user_id, app_key, content, contact, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(String(userId), appKey, content, contact, nowIso());
  ctx.json({ ok: true }, 201);
});

export default router;