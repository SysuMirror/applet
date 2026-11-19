import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from '../http.js';
import { ApiError, badRequest, conflict, forbidden, notFound, unauthorized } from '../errors.js';
import { findOrCreateSsoDeveloper, passwordVerify } from '../sso.js';
import {
  authenticateDeveloper, hashPassword, issueDeveloperToken, setDeveloperCookie,
  clearDeveloperCookie, verifyPassword,
} from '../auth.js';
import { enforce } from '../rate-limit.js';
import { writeAudit, mapAudit } from '../audit.js';
import {
  nowIso, normalizeEmail, safeJsonParse, randomToken, encryptSecret, decryptSecret, sha256,
} from '../util.js';
import {
  appSecret, appStats, assertEntryUrl, createAppRecord, generateSecret, getApp,
  listAllowlist, mapApp, requireApp, requireManageable, setAppSecret, updateApp,
  validateAppKey, validateCategory, validateIcon, validateOrigins, validateScopes,
  validateVersion, validateVisibility,
} from '../services/catalog.js';
import { KNOWN_SCOPES, CATEGORIES } from '../config.js';
import {
  listVersions, mapVersion, publishVersion, submitForReview, unpublishApp, upsertDraftVersion,
} from '../services/versions.js';
import { MAX_UPLOAD_BYTES } from '../storage.js';

const router = new Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function devDto(row) {
  return {
    id: Number(row.id),
    email: row.email,
    displayName: row.display_name,
    orgName: row.org_name,
    phone: row.phone,
    role: row.role,
    status: row.status,
    emailVerified: Boolean(row.email_verified),
    authSource: row.auth_source || 'password',
    authSourceLabel: row.auth_source === 'sso' ? '学校统一身份' : '邮箱密码',
    avatarUrl: row.avatar_url || '',
    ssoBound: Boolean(row.sso_sub),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
  };
}

async function dev(ctx, { admin = false } = {}) {
  return authenticateDeveloper(ctx, { admin });
}

async function limit(ctx, name, subject, capacity, windowSeconds = 60) {
  await enforce(ctx.services.limiter, { name, subject, capacity, windowSeconds });
}

function appDto(row, ctx, { includeSecret = false } = {}) {
  if (!row) return null;
  const dto = mapApp(row, {
    includeSecret,
    secret: includeSecret ? appSecret(row, ctx.config) : '',
  });
  return dto;
}

async function ensureApp(ctx, developer, appKey) {
  const app = await requireApp(ctx.db, appKey);
  requireManageable(app, developer);
  return app;
}

async function audit(ctx, developer, action, app, before, after) {
  await writeAudit(ctx.db, {
    actorType: developer.role === 'admin' ? 'admin' : 'developer',
    actorId: String(developer.id),
    action,
    targetType: 'app',
    targetKey: app?.app_key || '',
    before,
    after,
    ip: ctx.ip,
    requestId: ctx.requestId,
  });
}

// ── 账号 ────────────────────────────────────────────────────────────────
router.post('/dev/v1/auth/register', async (ctx) => {
  await limit(ctx, 'register-ip', ctx.ip, ctx.config.rateLimits.register, 3600);
  const body = await ctx.body();
  const email = normalizeEmail(body.email);
  if (!EMAIL_RE.test(email) || email.length > 128) throw badRequest('INVALID_EMAIL', '请输入有效邮箱');
  const password = String(body.password || '');
  if (password.length < 8 || password.length > 128) throw badRequest('WEAK_PASSWORD', '密码需为 8~128 位');
  const displayName = String(body.displayName || '').trim();
  if (displayName.length < 1 || displayName.length > 32) throw badRequest('INVALID_NAME', '请填写 1~32 字的称呼');
  const orgName = String(body.orgName || '').trim().slice(0, 64);
  const phone = String(body.phone || '').trim().slice(0, 32);

  const exists = await ctx.db.prepare('SELECT id FROM mp_developers WHERE email = ?').get(email);
  if (exists) throw conflict('EMAIL_TAKEN', '该邮箱已注册');
  const now = nowIso();
  const info = await ctx.db.prepare(`
    INSERT INTO mp_developers
      (email, password_hash, display_name, org_name, phone, role, status, token_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'developer', 'active', 0, ?, ?)
  `).run(email, hashPassword(password), displayName, orgName, phone, now, now);
  const developer = await ctx.db.prepare('SELECT * FROM mp_developers WHERE id = ?').get(info.lastInsertRowid);
  const token = issueDeveloperToken(developer, ctx.config);
  setDeveloperCookie(ctx, token);
  ctx.services.metrics.inc('mp_developer_registrations_total');
  await writeAudit(ctx.db, {
    actorType: 'developer', actorId: String(developer.id), action: 'developer.register',
    targetType: 'developer', targetKey: email, ip: ctx.ip, requestId: ctx.requestId,
  });
  ctx.json({ developer: devDto(developer), token }, 201);
});

async function finishDeveloperLogin(ctx, developer) {
  if (developer.status !== 'active') throw forbidden('ACCOUNT_SUSPENDED', '账号已被停用，请联系平台管理员');
  const now = nowIso();
  await ctx.db.prepare('UPDATE mp_developers SET last_login_at = ?, updated_at = ? WHERE id = ?')
    .run(now, now, Number(developer.id));
  const fresh = await ctx.db.prepare('SELECT * FROM mp_developers WHERE id = ?').get(developer.id);
  const token = issueDeveloperToken(fresh, ctx.config);
  setDeveloperCookie(ctx, token);
  ctx.services.metrics.inc('mp_developer_logins_total', { role: fresh.role });
  ctx.json({ developer: devDto(fresh), token });
}

router.post('/dev/v1/auth/login', async (ctx) => {
  await limit(ctx, 'login-ip', ctx.ip, ctx.config.rateLimits.login, 300);
  const body = await ctx.body();
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  await limit(ctx, 'login-email', email, ctx.config.rateLimits.login, 300);
  const developer = await ctx.db.prepare('SELECT * FROM mp_developers WHERE email = ?').get(email);

  // 1) 平台本地密码（注册时设置的密码、初始化管理员密码）
  if (developer && verifyPassword(password, developer.password_hash)) {
    return finishDeveloperLogin(ctx, developer);
  }

  // 2) 本地密码失败后，直接走学校统一身份（M2M）校验。
  //    统一身份创建的账号没有平台密码，用户输入的其实就是学校密码；
  //    邮箱在统一身份中存在的，也会自动创建/绑定本地开发者账号。
  const sso = ctx.config.sso;
  const ssoReady = Boolean(sso.enabled && sso.m2mClientId && sso.m2mClientSecret);
  const localOnlyDomain = /\.local$/i.test(email);
  if (ssoReady && !localOnlyDomain) {
    try {
      const result = await passwordVerify(ctx.config, { email, password });
      const ssoDeveloper = await findOrCreateSsoDeveloper(ctx.db, ctx.config, result.user, { hashPassword, nowIso });
      if (ssoDeveloper.status !== 'active') throw forbidden('ACCOUNT_SUSPENDED', '账号已被停用，请联系平台管理员');
      if (result.ssoSession && result.cookieName && result.cookieDomain) {
        ctx.setCookie(result.cookieName, result.ssoSession, {
          maxAge: Number(result.maxAge) || 86400,
          domain: result.cookieDomain,
          sameSite: 'Lax',
          path: '/',
        });
      }
      ctx.services.log?.info('auth.login_sso', {
        email: ssoDeveloper.email, developerId: Number(ssoDeveloper.id),
        ip: ctx.ip, requestId: ctx.requestId,
      });
      return finishDeveloperLogin(ctx, ssoDeveloper);
    } catch (err) {
      if (err?.name !== 'SsoError') throw err;
      ctx.services.log?.warn('auth.login_failed', {
        email, reason: `sso_${err.code}`, ip: ctx.ip, requestId: ctx.requestId,
      });
      if (err.code === 'INVALID_CREDENTIALS') {
        const message = String(developer?.auth_source || '').startsWith('sso')
          ? '统一身份邮箱或密码错误。请使用学校统一身份密码重试，或点击上方「使用学校统一身份登录」完成跳转授权。'
          : '邮箱或密码错误';
        throw unauthorized('INVALID_CREDENTIALS', message);
      }
      if (err.code === 'TOO_MANY_ATTEMPTS') {
        throw new ApiError(429, 'TOO_MANY_ATTEMPTS', err.message || '尝试次数过多，请稍后再试');
      }
      if (err.code === 'M2M_DISABLED' || err.code === 'M2M_FORBIDDEN') {
        throw unauthorized('USE_SSO', '该账号需要学校统一身份登录：请点击上方「使用学校统一身份登录」完成跳转授权。');
      }
      throw new ApiError(err.status || 502, err.code || 'SSO_FAILED', err.message || '统一身份登录失败');
    }
  }

  // 3) 没有可用的统一身份无感登录
  ctx.services.log?.warn('auth.login_failed', {
    email, reason: developer ? 'bad_password' : 'no_account', ip: ctx.ip, requestId: ctx.requestId,
  });
  if (!developer) throw unauthorized('INVALID_CREDENTIALS', '邮箱或密码错误');
  if (String(developer.auth_source || '').startsWith('sso')) {
    throw unauthorized(
      'USE_SSO',
      '该账号使用学校统一身份登录。请点击上方「使用学校统一身份登录」完成跳转授权；如需邮箱密码登录，请先由管理员设置平台密码。',
    );
  }
  throw unauthorized('INVALID_CREDENTIALS', '邮箱或密码错误');
});

router.post('/dev/v1/auth/logout', async (ctx) => {
  clearDeveloperCookie(ctx);
  ctx.json({ ok: true });
});

router.get('/dev/v1/auth/me', async (ctx) => {
  const developer = await dev(ctx);
  ctx.json({ developer: devDto(developer) });
});

router.patch('/dev/v1/auth/me', async (ctx) => {
  const developer = await dev(ctx);
  const body = await ctx.body();
  const displayName = body.displayName == null ? developer.display_name : String(body.displayName).trim();
  if (displayName.length < 1 || displayName.length > 32) throw badRequest('INVALID_NAME', '称呼需为 1~32 字');
  const orgName = body.orgName == null ? developer.org_name : String(body.orgName).trim().slice(0, 64);
  const phone = body.phone == null ? developer.phone : String(body.phone).trim().slice(0, 32);
  await ctx.db.prepare('UPDATE mp_developers SET display_name = ?, org_name = ?, phone = ?, updated_at = ? WHERE id = ?')
    .run(displayName, orgName, phone, nowIso(), Number(developer.id));
  const fresh = await ctx.db.prepare('SELECT * FROM mp_developers WHERE id = ?').get(developer.id);
  ctx.json({ developer: devDto(fresh) });
});

router.post('/dev/v1/auth/password', async (ctx) => {
  const developer = await dev(ctx);
  await limit(ctx, 'password-change', String(developer.id), 5, 3600);
  const body = await ctx.body();
  const current = String(body.currentPassword || '');
  const next = String(body.newPassword || '');
  if (next.length < 8 || next.length > 128) throw badRequest('WEAK_PASSWORD', '新密码需为 8~128 位');
  if (!verifyPassword(current, developer.password_hash)) throw unauthorized('INVALID_CREDENTIALS', '当前密码错误');
  await ctx.db.prepare('UPDATE mp_developers SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?')
    .run(hashPassword(next), nowIso(), Number(developer.id));
  const fresh = await ctx.db.prepare('SELECT * FROM mp_developers WHERE id = ?').get(developer.id);
  const token = issueDeveloperToken(fresh, ctx.config);
  setDeveloperCookie(ctx, token);
  await writeAudit(ctx.db, {
    actorType: 'developer', actorId: String(developer.id), action: 'developer.password_change',
    targetType: 'developer', targetKey: developer.email, ip: ctx.ip, requestId: ctx.requestId,
  });
  ctx.json({ ok: true, token });
});

// ── 概览 ────────────────────────────────────────────────────────────────
router.get('/dev/v1/overview', async (ctx) => {
  const developer = await dev(ctx);
  const apps = await ctx.db.prepare(
    'SELECT * FROM mp_apps WHERE developer_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 5',
  ).all(Number(developer.id));
  const counts = await ctx.db.prepare(`
    SELECT status, COUNT(*) AS c FROM mp_apps
    WHERE developer_id = ? AND deleted_at IS NULL GROUP BY status
  `).all(Number(developer.id));
  const byStatus = Object.fromEntries(counts.map((row) => [row.status, Number(row.c)]));
  const totalApps = counts.reduce((sum, row) => sum + Number(row.c), 0);
  const days = 14;
  const from = new Date(Date.now() - (days - 1) * 86400_000).toISOString().slice(0, 10);
  const usage = await ctx.db.prepare(
    'SELECT SUM(calls) AS calls FROM mp_usage_daily WHERE app_key IN (SELECT app_key FROM mp_apps WHERE developer_id = ?) AND day >= ?',
  ).get(Number(developer.id), from);
  ctx.json({
    developer: devDto(developer),
    stats: {
      apps: totalApps,
      published: byStatus.published || 0,
      reviewing: (byStatus.reviewing || 0),
      drafts: (byStatus.draft || 0) + (byStatus.rejected || 0),
      calls14d: Number(usage?.calls || 0),
    },
    recentApps: apps.map((row) => appDto(row, ctx)),
  });
});

// ── 应用管理 ────────────────────────────────────────────────────────────
router.get('/dev/v1/apps', async (ctx) => {
  const developer = await dev(ctx);
  const rows = await ctx.db.prepare(
    'SELECT * FROM mp_apps WHERE developer_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC',
  ).all(Number(developer.id));
  ctx.json({ items: rows.map((row) => appDto(row, ctx)) });
});

router.post('/dev/v1/apps', async (ctx) => {
  const developer = await dev(ctx);
  await limit(ctx, 'app-create', String(developer.id), 20, 3600);
  const body = await ctx.body();
  const count = await ctx.db.prepare('SELECT COUNT(*) AS c FROM mp_apps WHERE developer_id = ? AND deleted_at IS NULL')
    .get(Number(developer.id));
  if (Number(count.c) >= ctx.config.maxDevApps) {
    throw forbidden('APP_LIMIT', `每个开发者最多创建 ${ctx.config.maxDevApps} 个小程序`);
  }
  const name = String(body.name || '').trim();
  if (name.length < 2 || name.length > 32) throw badRequest('INVALID_NAME', '小程序名称需为 2~32 字');
  const category = validateCategory(body.category);
  const description = String(body.description || '').trim().slice(0, 200);
  const icon = validateIcon(body.icon);
  const entryURL = assertEntryUrl(body.entryURL, ctx.config);
  const allowedOrigins = validateOrigins(body.allowedOrigins, ctx.config);
  const scopes = validateScopes(body.scopes);
  const visibility = validateVisibility(body.visibility);
  const webhookUrl = assertEntryUrl(body.webhookUrl, ctx.config, { field: 'webhookUrl' });
  const appKey = body.appKey ? validateAppKey(body.appKey) : '';

  const { app } = await createAppRecord(ctx.db, {
    appKey,
    name,
    description,
    icon,
    category,
    entryURL,
    allowedOrigins,
    scopes,
    visibility,
    developerId: Number(developer.id),
    ownerType: developer.role === 'admin' && body.ownerType === 'official' ? 'official' : 'partner',
    webhookUrl,
    keywords: String(body.keywords || '').slice(0, 200),
    config: ctx.config,
  });
  await audit(ctx, developer, 'app.create', app, null, mapApp(app));
  ctx.services.metrics.inc('mp_apps_created_total');
  ctx.json({ app: await appDto(app, ctx) }, 201);
});

router.get('/dev/v1/apps/:appKey', async (ctx) => {
  const developer = await dev(ctx);
  const app = await ensureApp(ctx, developer, ctx.params.appKey);
  const dto = await appDto(app, ctx, { includeSecret: false });
  dto.secretMasked = app.secret_hash ? '************************' : '';
  dto.versions = await listVersions(ctx.db, app.id);
  dto.allowlist = await listAllowlist(ctx.db, app.id);
  ctx.json({ app: dto });
});

router.patch('/dev/v1/apps/:appKey', async (ctx) => {
  const developer = await dev(ctx);
  const app = await ensureApp(ctx, developer, ctx.params.appKey);
  if (app.status === 'reviewing') throw conflict('APP_REVIEWING', '审核中的小程序暂不能修改，请等待审核结果');
  const body = await ctx.body();
  const fields = {};
  if (body.name != null) {
    const name = String(body.name).trim();
    if (name.length < 2 || name.length > 32) throw badRequest('INVALID_NAME', '小程序名称需为 2~32 字');
    fields.name = name;
  }
  if (body.description != null) fields.description = String(body.description).trim().slice(0, 200);
  if (body.icon != null) fields.icon = validateIcon(body.icon);
  if (body.category != null) fields.category = validateCategory(body.category);
  if (body.entryURL != null) fields.entryURL = assertEntryUrl(body.entryURL, ctx.config);
  if (body.allowedOrigins != null) fields.allowedOrigins = validateOrigins(body.allowedOrigins, ctx.config);
  if (body.scopes != null) fields.scopes = validateScopes(body.scopes);
  if (body.visibility != null) fields.visibility = validateVisibility(body.visibility);
  if (body.webhookUrl != null) fields.webhookUrl = assertEntryUrl(body.webhookUrl, ctx.config, { field: 'webhookUrl' });
  if (body.keywords != null) fields.keywords = String(body.keywords).slice(0, 200);
  if (!Object.keys(fields).length) throw badRequest('NO_CHANGES', '没有需要更新的字段');

  const before = mapApp(app);
  await updateApp(ctx.db, app.id, fields);
  const fresh = await getApp(ctx.db, app.app_key);
  await audit(ctx, developer, 'app.update', fresh, before, mapApp(fresh));
  ctx.json({ app: await appDto(fresh, ctx) });
});

router.delete('/dev/v1/apps/:appKey', async (ctx) => {
  const developer = await dev(ctx);
  const app = await ensureApp(ctx, developer, ctx.params.appKey);
  if (['published', 'reviewing'].includes(app.status)) {
    throw conflict('APP_ACTIVE', '已发布或审核中的小程序不能删除，请先下架');
  }
  await ctx.db.prepare('UPDATE mp_apps SET deleted_at = ?, updated_at = ? WHERE id = ?')
    .run(nowIso(), nowIso(), Number(app.id));
  await audit(ctx, developer, 'app.delete', app, mapApp(app), null);
  ctx.json({ ok: true });
});

router.post('/dev/v1/apps/:appKey/secret/reveal', async (ctx) => {
  const developer = await dev(ctx);
  await limit(ctx, 'secret-reveal', String(developer.id), 10, 3600);
  const app = await ensureApp(ctx, developer, ctx.params.appKey);
  const secret = appSecret(app, ctx.config);
  await writeAudit(ctx.db, {
    actorType: developer.role === 'admin' ? 'admin' : 'developer',
    actorId: String(developer.id), action: 'app.secret.reveal', targetType: 'app',
    targetKey: app.app_key, ip: ctx.ip, requestId: ctx.requestId,
  });
  ctx.json({ appKey: app.app_key, secret });
});

router.post('/dev/v1/apps/:appKey/secret/rotate', async (ctx) => {
  const developer = await dev(ctx);
  await limit(ctx, 'secret-rotate', String(developer.id), 10, 3600);
  const app = await ensureApp(ctx, developer, ctx.params.appKey);
  const secret = generateSecret();
  await setAppSecret(ctx.db, app.id, secret, ctx.config);
  const fresh = await getApp(ctx.db, app.app_key);
  await audit(ctx, developer, 'app.secret.rotate', fresh, null, { rotatedAt: nowIso() });
  ctx.json({ appKey: app.app_key, secret });
});

// ── 版本与审核 ──────────────────────────────────────────────────────────
router.get('/dev/v1/apps/:appKey/versions', async (ctx) => {
  const developer = await dev(ctx);
  const app = await ensureApp(ctx, developer, ctx.params.appKey);
  ctx.json({ items: await listVersions(ctx.db, app.id) });
});

router.post('/dev/v1/apps/:appKey/versions', async (ctx) => {
  const developer = await dev(ctx);
  const app = await ensureApp(ctx, developer, ctx.params.appKey);
  if (app.status === 'reviewing') throw conflict('APP_REVIEWING', '审核中的小程序暂不能创建新版本');
  const body = await ctx.body();
  const version = validateVersion(body.version);
  const entryURL = assertEntryUrl(body.entryURL ?? app.entry_url, ctx.config, { required: true });
  const allowedOrigins = validateOrigins(body.allowedOrigins ?? safeJsonParse(app.allowed_origins, []), ctx.config);
  const scopes = validateScopes(body.scopes ?? safeJsonParse(app.scopes, []));
  const row = await upsertDraftVersion(ctx.db, app, {
    version, entryURL, allowedOrigins, scopes, changelog: String(body.changelog || '').slice(0, 2000),
  });
  await audit(ctx, developer, 'app.version.create', app, null, { version });
  ctx.json({ version: mapVersion(row) }, 201);
});

async function doSubmit(ctx, developer, app, body) {
  if (app.status === 'reviewing') throw conflict('APP_REVIEWING', '小程序正在审核中');
  const version = validateVersion(body.version || app.version);
  const entryURL = assertEntryUrl(body.entryURL ?? app.entry_url, ctx.config, { required: true });
  const allowedOrigins = validateOrigins(body.allowedOrigins ?? safeJsonParse(app.allowed_origins, []), ctx.config);
  if (!allowedOrigins.length) throw badRequest('ORIGINS_REQUIRED', '请至少配置一个允许的 origin');
  const scopes = validateScopes(body.scopes ?? safeJsonParse(app.scopes, []));
  const changelog = String(body.changelog || '').slice(0, 2000);
  if (!changelog) throw badRequest('CHANGELOG_REQUIRED', '请填写版本说明，便于审核');
  const row = await submitForReview(ctx.db, app, version, { changelog, entryURL, allowedOrigins, scopes });
  await audit(ctx, developer, 'app.submit', app, mapApp(app), { version, changelog });
  ctx.services.metrics.inc('mp_app_submissions_total');
  ctx.json({ app: await appDto(await getApp(ctx.db, app.app_key), ctx), version: mapVersion(row) });
}

router.post('/dev/v1/apps/:appKey/submit', async (ctx) => {
  const developer = await dev(ctx);
  await limit(ctx, 'submit', String(developer.id), 20, 3600);
  const app = await ensureApp(ctx, developer, ctx.params.appKey);
  const body = await ctx.body();
  await doSubmit(ctx, developer, app, body);
});

router.post('/dev/v1/apps/:appKey/publish', async (ctx) => {
  const developer = await dev(ctx);
  const app = await ensureApp(ctx, developer, ctx.params.appKey);
  const body = await ctx.body();
  let versionRow = null;
  if (body.versionId) {
    versionRow = await ctx.db.prepare('SELECT * FROM mp_app_versions WHERE id = ? AND app_id = ?')
      .get(Number(body.versionId), Number(app.id));
  } else {
    versionRow = await ctx.db.prepare(
      "SELECT * FROM mp_app_versions WHERE app_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 1",
    ).get(Number(app.id));
  }
  if (!versionRow) throw conflict('NO_APPROVED_VERSION', '没有审核通过的版本可发布');
  const result = await publishVersion(ctx.db, app, versionRow.id);
  await audit(ctx, developer, 'app.publish', result.app, { version: app.version, status: app.status }, { version: result.version.version });
  ctx.services.metrics.inc('mp_app_publishes_total');
  ctx.json({ app: await appDto(result.app, ctx), version: mapVersion(result.version) });
});

router.post('/dev/v1/apps/:appKey/unpublish', async (ctx) => {
  const developer = await dev(ctx);
  const app = await ensureApp(ctx, developer, ctx.params.appKey);
  if (app.status !== 'published') throw conflict('APP_NOT_PUBLISHED', '小程序当前不是已发布状态');
  const updated = await unpublishApp(ctx.db, app);
  await audit(ctx, developer, 'app.unpublish', updated, { status: app.status }, { status: updated.status });
  ctx.json({ app: await appDto(await getApp(ctx.db, app.app_key), ctx) });
});

// ── 数据与审计 ──────────────────────────────────────────────────────────
router.get('/dev/v1/apps/:appKey/stats', async (ctx) => {
  const developer = await dev(ctx);
  const app = await ensureApp(ctx, developer, ctx.params.appKey);
  const days = Math.min(90, Math.max(1, Number(ctx.query.get('days')) || 14));
  ctx.json({ appKey: app.app_key, days, items: await appStats(ctx.db, app.app_key, days) });
});

router.get('/dev/v1/apps/:appKey/audit-logs', async (ctx) => {
  const developer = await dev(ctx);
  const app = await ensureApp(ctx, developer, ctx.params.appKey);
  const limitValue = Math.min(100, Math.max(1, Number(ctx.query.get('limit')) || 50));
  const rows = await ctx.db.prepare(
    'SELECT * FROM mp_audit_logs WHERE target_key = ? ORDER BY id DESC LIMIT ?',
  ).all(app.app_key, limitValue);
  ctx.json({ items: rows.map(mapAudit) });
});

router.get('/dev/v1/categories', async (ctx) => {
  ctx.json({ items: CATEGORIES, scopes: KNOWN_SCOPES });
});

// ── 图标上传 ────────────────────────────────────────────────────────────
router.post('/dev/v1/uploads', async (ctx) => {
  const developer = await dev(ctx);
  await limit(ctx, 'upload', String(developer.id), 30, 3600);
  const contentType = String(ctx.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const raw = await ctx.rawBody(MAX_UPLOAD_BYTES + 1);
  if (raw.length > MAX_UPLOAD_BYTES) throw badRequest('FILE_TOO_LARGE', '图片不能超过 2MB');
  const saved = await ctx.services.storage.saveUpload(raw, contentType);
  ctx.json({ ...saved, path: saved.url, url: `${ctx.config.publicBase}${saved.url}` }, 201);
});


// ── 平台托管小程序源码（内部源） ──────────────────────────────────────────
const HOSTING_MAX_FILE = 5 * 1024 * 1024;
const HOSTING_MAX_TOTAL = 25 * 1024 * 1024;
const HOSTING_MAX_FILES = 300;
const HOSTING_EXTENSIONS = new Set([
  'html', 'htm', 'js', 'mjs', 'css', 'json', 'txt', 'xml', 'map',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico',
  'woff', 'woff2', 'ttf', 'otf', 'mp3', 'mp4', 'webm', 'wav', 'wasm',
]);

function hostingRoot(config, appKey) {
  return path.join(config.dataDir, 'miniapps', String(appKey));
}

function hostingBuildDir(config, appKey, buildId) {
  if (!/^[a-f0-9]{16,64}$/.test(String(buildId))) throw badRequest('INVALID_BUILD', '构建 ID 不合法');
  return path.join(hostingRoot(config, appKey), String(buildId));
}

function safeHostingPath(raw) {
  const value = String(raw || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!value || value.length > 240) throw badRequest('INVALID_PATH', '文件路径不合法');
  if (value.includes('..') || value.includes('\0')) throw badRequest('INVALID_PATH', '文件路径不合法');
  const ext = value.split('.').pop().toLowerCase();
  if (!HOSTING_EXTENSIONS.has(ext)) throw badRequest('INVALID_FILE_TYPE', `不支持的文件类型：.${ext}`);
  return value;
}

function buildStats(dir) {
  let files = 0;
  let bytes = 0;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        files += 1;
        bytes += fs.statSync(full).size;
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return { files, bytes };
}

router.post('/dev/v1/apps/:appKey/hosting/builds', async (ctx) => {
  const developer = await dev(ctx);
  limit(ctx, 'hosting-build', String(developer.id), 30, 3600);
  const app = await ensureApp(ctx, developer, ctx.params.appKey);
  if (developer.role !== 'admin' && app.owner_type !== 'official') {
    throw forbidden('INTERNAL_HOSTING_FORBIDDEN', '平台内部托管仅限官方应用；第三方小程序请使用外部 HTTPS 源');
  }
  if (app.status === 'reviewing') throw conflict('APP_REVIEWING', '审核中不能部署新版本');
  const buildId = crypto.randomBytes(16).toString('hex');
  const dir = hostingBuildDir(ctx.config, app.app_key, buildId);
  fs.mkdirSync(dir, { recursive: true });
  ctx.json({ buildId, appKey: app.app_key }, 201);
});

router.put('/dev/v1/apps/:appKey/hosting/builds/:buildId/files', async (ctx) => {
  const developer = await dev(ctx);
  const app = await ensureApp(ctx, developer, ctx.params.appKey);
  const dir = hostingBuildDir(ctx.config, app.app_key, ctx.params.buildId);
  if (!fs.existsSync(dir)) throw notFound('BUILD_NOT_FOUND', '构建不存在或已过期');
  const rel = safeHostingPath(ctx.query.get('path'));
  const raw = await ctx.rawBody(HOSTING_MAX_FILE + 1);
  if (raw.length > HOSTING_MAX_FILE) throw badRequest('FILE_TOO_LARGE', '单个文件不能超过 5MB');
  if (!raw.length) throw badRequest('EMPTY_FILE', '文件为空');
  const target = path.resolve(dir, rel);
  if (!target.startsWith(`${path.resolve(dir)}${path.sep}`)) throw badRequest('INVALID_PATH', '文件路径不合法');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, raw);
  const stats = buildStats(dir);
  if (stats.files > HOSTING_MAX_FILES || stats.bytes > HOSTING_MAX_TOTAL) {
    fs.unlinkSync(target);
    throw badRequest('BUILD_TOO_LARGE', `构建不能超过 ${HOSTING_MAX_FILES} 个文件 / 25MB`);
  }
  ctx.json({ path: rel, size: raw.length, ...stats }, 201);
});

router.post('/dev/v1/apps/:appKey/hosting/builds/:buildId/activate', async (ctx) => {
  const developer = await dev(ctx);
  const app = await ensureApp(ctx, developer, ctx.params.appKey);
  if (developer.role !== 'admin' && app.owner_type !== 'official') {
    throw forbidden('INTERNAL_HOSTING_FORBIDDEN', '平台内部托管仅限官方应用；第三方小程序请使用外部 HTTPS 源');
  }
  if (app.status === 'reviewing') throw conflict('APP_REVIEWING', '审核中不能切换托管版本');
  const dir = hostingBuildDir(ctx.config, app.app_key, ctx.params.buildId);
  if (!fs.existsSync(path.join(dir, 'index.html'))) {
    throw badRequest('INDEX_REQUIRED', '构建缺少 index.html');
  }
  const stats = buildStats(dir);
  if (stats.bytes > HOSTING_MAX_TOTAL) throw badRequest('BUILD_TOO_LARGE', '构建超过 25MB');

  let token = '';
  try {
    if (app.hosting_token_cipher) token = decryptSecret(app.hosting_token_cipher, ctx.config.appSecretMasterKey);
  } catch { token = ''; }
  if (!token) token = randomToken('src_', 32);
  const cipher = encryptSecret(token, ctx.config.appSecretMasterKey);
  const entryURL = `${ctx.config.publicBase}/mp/${app.app_key}/?source=${token}`;
  const origin = new URL(ctx.config.publicBase).origin;
  const origins = [...new Set([...(safeJsonParse(app.allowed_origins, [])), origin])];
  const now = nowIso();
  await ctx.db.prepare(`
    UPDATE mp_apps SET hosting_mode = 'internal', hosting_build = ?, hosting_token_hash = ?,
      hosting_token_cipher = ?, hosting_updated_at = ?, entry_url = ?, allowed_origins = ?, updated_at = ?
    WHERE id = ?
  `).run(
    ctx.params.buildId, sha256(token), cipher, now, entryURL, JSON.stringify(origins), now, Number(app.id),
  );
  audit(ctx, developer, 'app.hosting.activate', app, null, { build: ctx.params.buildId, entryURL });
  ctx.services.metrics.inc('mp_hosting_activations_total');

  // 保留当前 + 最近一个构建，清理更早目录
  const root = hostingRoot(ctx.config, app.app_key);
  const builds = fs.existsSync(root)
    ? fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse()
    : [];
  for (const old of builds.slice(2)) {
    if (old === ctx.params.buildId) continue;
    fs.rmSync(path.join(root, old), { recursive: true, force: true });
  }

  ctx.json({
    appKey: app.app_key,
    mode: 'internal',
    build: ctx.params.buildId,
    entryURL,
    sourceToken: token,
    files: stats.files,
    bytes: stats.bytes,
  });
});

router.get('/dev/v1/apps/:appKey/hosting', async (ctx) => {
  const developer = await dev(ctx);
  const app = await ensureApp(ctx, developer, ctx.params.appKey);
  ctx.json({
    mode: app.hosting_mode || 'external',
    build: app.hosting_build || '',
    entryURL: app.entry_url,
    updatedAt: app.hosting_updated_at || null,
  });
});

router.delete('/dev/v1/apps/:appKey/hosting', async (ctx) => {
  const developer = await dev(ctx);
  const app = await ensureApp(ctx, developer, ctx.params.appKey);
  const now = nowIso();
  await ctx.db.prepare(`
    UPDATE mp_apps SET hosting_mode = 'external', hosting_build = NULL, hosting_token_hash = '',
      hosting_token_cipher = '', hosting_updated_at = ?, updated_at = ? WHERE id = ?
  `).run(now, now, Number(app.id));
  audit(ctx, developer, 'app.hosting.disable', app, null, null);
  ctx.json({ ok: true });
});


export default router;