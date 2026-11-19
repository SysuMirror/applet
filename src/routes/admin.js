import { Router } from '../http.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { authenticateDeveloper } from '../auth.js';
import { writeAudit, mapAudit } from '../audit.js';
import { nowIso, safeJsonParse } from '../util.js';
import {
  appSecret, appStats, assertEntryUrl, createAppRecord, getApp, listAllowlist, mapApp,
  requireApp, setAllowlist, updateApp, validateCategory, validateIcon, validateOrigins,
  validateScopes, validateVisibility,
} from '../services/catalog.js';
import { APP_STATUSES } from '../config.js';
import {
  approveVersion, listVersions, mapVersion, publishVersion, rejectVersion,
  unpublishApp,
} from '../services/versions.js';

const router = new Router();

async function admin(ctx) {
  return authenticateDeveloper(ctx, { admin: true });
}

async function audit(ctx, developer, action, targetType, targetKey, before, after) {
  await writeAudit(ctx.db, {
    actorType: 'admin',
    actorId: String(developer.id),
    action,
    targetType,
    targetKey,
    before,
    after,
    ip: ctx.ip,
    requestId: ctx.requestId,
  });
}

async function adminAppDto(row, ctx, { includeSecret = false } = {}) {
  if (!row) return null;
  const dto = mapApp(row, {
    includeSecret,
    secret: includeSecret ? appSecret(row, ctx.config) : '',
  });
  if (row.developer_id != null) {
    const owner = await ctx.db.prepare('SELECT email, display_name, org_name FROM mp_developers WHERE id = ?')
      .get(Number(row.developer_id));
    dto.developer = owner
      ? { email: owner.email, displayName: owner.display_name, orgName: owner.org_name }
      : null;
  }
  dto.allowlist = await listAllowlist(ctx.db, row.id);
  return dto;
}

// ── 概览 ────────────────────────────────────────────────────────────────
router.get('/admin/v1/me', async (ctx) => {
  const developer = await admin(ctx);
  ctx.json({
    admin: {
      id: Number(developer.id),
      email: developer.email,
      displayName: developer.display_name,
      avatarUrl: developer.avatar_url || '',
      role: developer.role,
    },
  });
});

router.get('/admin/v1/overview', async (ctx) => {
  await admin(ctx);
  const byStatus = Object.fromEntries(
    (await ctx.db.prepare('SELECT status, COUNT(*) AS c FROM mp_apps WHERE deleted_at IS NULL GROUP BY status')
      .all()).map((row) => [row.status, Number(row.c)]),
  );
  const since24 = new Date(Date.now() - 86400_000).toISOString();
  const counts = {
    apps: Object.values(byStatus).reduce((a, b) => a + b, 0),
    published: byStatus.published || 0,
    reviewing: byStatus.reviewing || 0,
    developers: Number((await ctx.db.prepare('SELECT COUNT(*) AS c FROM mp_developers WHERE role = ?').get('developer')).c),
    events24h: Number((await ctx.db.prepare('SELECT COUNT(*) AS c FROM mp_events WHERE received_at >= ?').get(since24)).c),
    notifications24h: Number((await ctx.db.prepare('SELECT COUNT(*) AS c FROM mp_notifications WHERE created_at >= ?').get(since24)).c),
    launches24h: Number((await ctx.db.prepare('SELECT COUNT(*) AS c FROM mp_launch_tickets WHERE created_at >= ?').get(since24)).c),
    openFeedback: Number((await ctx.db.prepare("SELECT COUNT(*) AS c FROM mp_feedback WHERE status = 'open'").get()).c),
  };
  const pending = await ctx.db.prepare(`
    SELECT a.*, v.id AS version_id, v.version AS version_no, v.changelog, v.submitted_at
    FROM mp_apps a
    LEFT JOIN mp_app_versions v ON v.app_id = a.id AND v.status = 'reviewing'
    WHERE a.status = 'reviewing' AND a.deleted_at IS NULL
    ORDER BY v.submitted_at ASC LIMIT 20
  `).all();
  ctx.json({
    counts,
    pending: pending.map((row) => ({
      appKey: row.app_key,
      name: row.name,
      icon: row.icon,
      category: row.category,
      developerId: row.developer_id,
      versionId: row.version_id == null ? null : Number(row.version_id),
      version: row.version_no,
      changelog: row.changelog || '',
      submittedAt: row.submitted_at,
    })),
  });
});

// ── 应用 ────────────────────────────────────────────────────────────────
router.get('/admin/v1/apps', async (ctx) => {
  await admin(ctx);
  const limitValue = Math.min(100, Math.max(1, Number(ctx.query.get('limit')) || 30));
  const before = Number(ctx.query.get('cursor')) || 0;
  const status = String(ctx.query.get('status') || '');
  const q = String(ctx.query.get('q') || '').trim();
  const where = ['deleted_at IS NULL'];
  const params = [];
  if (status && APP_STATUSES.includes(status)) { where.push('status = ?'); params.push(status); }
  if (q) {
    where.push('(lower(name) LIKE ? OR lower(app_key) LIKE ? OR lower(description) LIKE ?)');
    const like = `%${q.toLowerCase()}%`;
    params.push(like, like, like);
  }
  if (before) { where.push('id < ?'); params.push(before); }
  const rows = await ctx.db.prepare(
    `SELECT * FROM mp_apps WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`,
  ).all(...params, limitValue + 1);
  const hasMore = rows.length > limitValue;
  const page = hasMore ? rows.slice(0, limitValue) : rows;
  ctx.json({
    items: await Promise.all(page.map((row) => adminAppDto(row, ctx))),
    nextCursor: hasMore ? String(page[page.length - 1].id) : null,
  });
});

router.post('/admin/v1/apps', async (ctx) => {
  const developer = await admin(ctx);
  const body = await ctx.body();
  const name = String(body.name || '').trim();
  if (name.length < 2 || name.length > 32) throw badRequest('INVALID_NAME', '名称需为 2~32 字');
  const entryURL = assertEntryUrl(body.entryURL, ctx.config, { required: true });
  const allowedOrigins = validateOrigins(body.allowedOrigins, ctx.config);
  const scopes = validateScopes(body.scopes ?? []);
  const { app } = await createAppRecord(ctx.db, {
    appKey: body.appKey || undefined,
    name,
    description: String(body.description || '').slice(0, 200),
    icon: validateIcon(body.icon),
    category: validateCategory(body.category),
    entryURL,
    allowedOrigins,
    scopes,
    visibility: validateVisibility(body.visibility ?? 'public'),
    ownerType: 'official',
    sort: Number(body.sort) || 0,
    status: 'published',
    config: ctx.config,
  });
  await ctx.db.prepare('UPDATE mp_apps SET published_at = ? WHERE id = ?').run(nowIso(), Number(app.id));
  await audit(ctx, developer, 'admin.app.create', 'app', app.app_key, null, mapApp(app));
  ctx.json({ app: await adminAppDto(await getApp(ctx.db, app.app_key), ctx) }, 201);
});

router.get('/admin/v1/apps/:appKey', async (ctx) => {
  await admin(ctx);
  const app = await requireApp(ctx.db, ctx.params.appKey);
  const dto = await adminAppDto(app, ctx);
  dto.versions = await listVersions(ctx.db, app.id);
  dto.stats = await appStats(ctx.db, app.app_key, 14);
  const events = await ctx.db.prepare('SELECT COUNT(*) AS c FROM mp_events').get();
  dto.eventCount = Number(events.c);
  ctx.json({ app: dto });
});

router.patch('/admin/v1/apps/:appKey', async (ctx) => {
  const developer = await admin(ctx);
  const app = await requireApp(ctx.db, ctx.params.appKey);
  const body = await ctx.body();
  const fields = {};
  if (body.name != null) fields.name = String(body.name).trim().slice(0, 32);
  if (body.description != null) fields.description = String(body.description).slice(0, 200);
  if (body.icon != null) fields.icon = validateIcon(body.icon);
  if (body.category != null) fields.category = validateCategory(body.category);
  if (body.entryURL != null) fields.entryURL = assertEntryUrl(body.entryURL, ctx.config, { required: true });
  if (body.allowedOrigins != null) fields.allowedOrigins = validateOrigins(body.allowedOrigins, ctx.config);
  if (body.scopes != null) fields.scopes = validateScopes(body.scopes);
  if (body.visibility != null) fields.visibility = validateVisibility(body.visibility);
  if (body.sort != null) fields.sort = Math.max(-10000, Math.min(10000, Number(body.sort) || 0));
  if (!Object.keys(fields).length) throw badRequest('NO_CHANGES', '没有需要更新的字段');
  const before = mapApp(app);
  await updateApp(ctx.db, app.id, fields);
  const fresh = await getApp(ctx.db, app.app_key);
  await audit(ctx, developer, 'admin.app.update', 'app', app.app_key, before, mapApp(fresh));
  ctx.json({ app: await adminAppDto(fresh, ctx) });
});

router.post('/admin/v1/apps/:appKey/approve', async (ctx) => {
  const developer = await admin(ctx);
  const app = await requireApp(ctx.db, ctx.params.appKey);
  const body = await ctx.body();
  let versionRow = null;
  if (body.versionId) {
    versionRow = await ctx.db.prepare('SELECT * FROM mp_app_versions WHERE id = ? AND app_id = ?')
      .get(Number(body.versionId), Number(app.id));
  } else {
    versionRow = await ctx.db.prepare(
      "SELECT * FROM mp_app_versions WHERE app_id = ? AND status = 'reviewing' ORDER BY id DESC LIMIT 1",
    ).get(Number(app.id));
  }
  if (!versionRow) throw conflict('NO_REVIEWING_VERSION', '没有待审核的版本');
  const result = await approveVersion(ctx.db, app, versionRow.id);
  await audit(ctx, developer, 'admin.app.approve', 'app', app.app_key,
    { status: app.status, version: versionRow.version }, { status: 'approved', note: String(body.note || '') });
  ctx.services.metrics.inc('mp_app_approvals_total');
  ctx.json({ app: await adminAppDto(await getApp(ctx.db, app.app_key), ctx), version: mapVersion(result) });
});

router.post('/admin/v1/apps/:appKey/reject', async (ctx) => {
  const developer = await admin(ctx);
  const app = await requireApp(ctx.db, ctx.params.appKey);
  const body = await ctx.body();
  const reason = String(body.reason || '').trim();
  if (reason.length < 2 || reason.length > 500) throw badRequest('REASON_REQUIRED', '请填写 2~500 字的驳回原因');
  let versionRow = null;
  if (body.versionId) {
    versionRow = await ctx.db.prepare('SELECT * FROM mp_app_versions WHERE id = ? AND app_id = ?')
      .get(Number(body.versionId), Number(app.id));
  } else {
    versionRow = await ctx.db.prepare(
      "SELECT * FROM mp_app_versions WHERE app_id = ? AND status = 'reviewing' ORDER BY id DESC LIMIT 1",
    ).get(Number(app.id));
  }
  if (!versionRow) throw conflict('NO_REVIEWING_VERSION', '没有待审核的版本');
  const result = await rejectVersion(ctx.db, app, versionRow.id, reason);
  await audit(ctx, developer, 'admin.app.reject', 'app', app.app_key,
    { status: app.status, version: versionRow.version }, { status: 'rejected', reason });
  ctx.services.metrics.inc('mp_app_rejections_total');
  ctx.json({ app: await adminAppDto(await getApp(ctx.db, app.app_key), ctx), version: mapVersion(result) });
});

router.post('/admin/v1/apps/:appKey/publish', async (ctx) => {
  const developer = await admin(ctx);
  const app = await requireApp(ctx.db, ctx.params.appKey);
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
  await audit(ctx, developer, 'admin.app.publish', 'app', app.app_key,
    { status: app.status, version: app.version }, { status: 'published', version: result.version.version });
  ctx.json({ app: await adminAppDto(result.app, ctx), version: mapVersion(result.version) });
});

router.post('/admin/v1/apps/:appKey/unpublish', async (ctx) => {
  const developer = await admin(ctx);
  const app = await requireApp(ctx.db, ctx.params.appKey);
  if (app.status !== 'published') throw conflict('APP_NOT_PUBLISHED', '小程序当前不是已发布状态');
  const updated = await unpublishApp(ctx.db, app);
  await audit(ctx, developer, 'admin.app.unpublish', 'app', app.app_key, { status: app.status }, { status: updated.status });
  ctx.json({ app: await adminAppDto(await getApp(ctx.db, app.app_key), ctx) });
});

router.put('/admin/v1/apps/:appKey/allowlist', async (ctx) => {
  const developer = await admin(ctx);
  const app = await requireApp(ctx.db, ctx.params.appKey);
  const body = await ctx.body();
  if (!Array.isArray(body.userIds)) throw badRequest('INVALID_ALLOWLIST', 'userIds 必须是数组');
  const list = await setAllowlist(ctx.db, app.id, body.userIds);
  await audit(ctx, developer, 'admin.app.allowlist', 'app', app.app_key, null, { count: list.length });
  ctx.json({ userIds: list });
});

// ── 开发者 ──────────────────────────────────────────────────────────────
router.get('/admin/v1/developers', async (ctx) => {
  await admin(ctx);
  const limitValue = Math.min(100, Math.max(1, Number(ctx.query.get('limit')) || 50));
  const q = String(ctx.query.get('q') || '').trim();
  const params = [];
  let where = '';
  if (q) {
    where = 'WHERE lower(email) LIKE ? OR lower(display_name) LIKE ? OR lower(org_name) LIKE ?';
    const like = `%${q.toLowerCase()}%`;
    params.push(like, like, like);
  }
  const rows = await ctx.db.prepare(
    `SELECT * FROM mp_developers ${where} ORDER BY id DESC LIMIT ?`,
  ).all(...params, limitValue);
  const result = await Promise.all(rows.map(async (row) => {
    const apps = await ctx.db.prepare('SELECT COUNT(*) AS c FROM mp_apps WHERE developer_id = ? AND deleted_at IS NULL')
      .get(Number(row.id));
    return {
      id: Number(row.id),
      email: row.email,
      displayName: row.display_name,
      orgName: row.org_name,
      phone: row.phone,
      role: row.role,
      status: row.status,
      emailVerified: Boolean(row.email_verified),
      appCount: Number(apps.c),
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at || null,
    };
  }));
  ctx.json({ items: result });
});

router.patch('/admin/v1/developers/:id', async (ctx) => {
  const developer = await admin(ctx);
  const target = await ctx.db.prepare('SELECT * FROM mp_developers WHERE id = ?').get(Number(ctx.params.id));
  if (!target) throw notFound('DEVELOPER_NOT_FOUND', '开发者不存在');
  if (Number(target.id) === Number(developer.id)) throw conflict('CANNOT_SUSPEND_SELF', '不能停用自己的账号');
  const body = await ctx.body();
  const status = String(body.status || '');
  if (!['active', 'suspended'].includes(status)) throw badRequest('INVALID_STATUS', 'status 只能是 active 或 suspended');
  await ctx.db.prepare(
    'UPDATE mp_developers SET status = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?',
  ).run(status, nowIso(), Number(target.id));
  await audit(ctx, developer, 'admin.developer.status', 'developer', target.email,
    { status: target.status }, { status });
  ctx.json({ ok: true, status });
});

// ── 审计 / 事件 / 反馈 ──────────────────────────────────────────────────
router.get('/admin/v1/audit-logs', async (ctx) => {
  await admin(ctx);
  const limitValue = Math.min(200, Math.max(1, Number(ctx.query.get('limit')) || 50));
  const before = Number(ctx.query.get('cursor')) || 0;
  const action = String(ctx.query.get('action') || '').trim();
  const target = String(ctx.query.get('target') || '').trim();
  const where = ['1 = 1'];
  const params = [];
  if (before) { where.push('id < ?'); params.push(before); }
  if (action) { where.push('action LIKE ?'); params.push(`%${action}%`); }
  if (target) { where.push('target_key = ?'); params.push(target); }
  const rows = await ctx.db.prepare(
    `SELECT * FROM mp_audit_logs WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`,
  ).all(...params, limitValue + 1);
  const hasMore = rows.length > limitValue;
  const page = hasMore ? rows.slice(0, limitValue) : rows;
  ctx.json({
    items: page.map(mapAudit),
    nextCursor: hasMore ? String(page[page.length - 1].id) : null,
  });
});

router.get('/admin/v1/events', async (ctx) => {
  await admin(ctx);
  const limitValue = Math.min(100, Math.max(1, Number(ctx.query.get('limit')) || 30));
  const before = Number(ctx.query.get('cursor')) || 0;
  const params = [];
  let where = '1 = 1';
  if (before) { where = 'id < ?'; params.push(before); }
  const rows = await ctx.db.prepare(
    `SELECT * FROM mp_events WHERE ${where} ORDER BY id DESC LIMIT ?`,
  ).all(...params, limitValue + 1);
  const hasMore = rows.length > limitValue;
  const page = hasMore ? rows.slice(0, limitValue) : rows;
  ctx.json({
    items: page.map((row) => ({
      id: Number(row.id),
      eventId: row.event_id,
      type: row.type,
      dedupKey: row.dedup_key,
      payload: safeJsonParse(row.payload, {}),
      status: row.status,
      receivedAt: row.received_at,
      processedAt: row.processed_at,
      error: row.error,
    })),
    nextCursor: hasMore ? String(page[page.length - 1].id) : null,
  });
});

router.get('/admin/v1/feedback', async (ctx) => {
  await admin(ctx);
  const status = String(ctx.query.get('status') || '');
  const params = [];
  let where = '1 = 1';
  if (['open', 'resolved'].includes(status)) { where = 'status = ?'; params.push(status); }
  const rows = await ctx.db.prepare(
    `SELECT * FROM mp_feedback WHERE ${where} ORDER BY id DESC LIMIT 100`,
  ).all(...params);
  ctx.json({
    items: rows.map((row) => ({
      id: Number(row.id),
      userId: row.user_id,
      appKey: row.app_key,
      content: row.content,
      contact: row.contact,
      status: row.status,
      createdAt: row.created_at,
    })),
  });
});

router.patch('/admin/v1/feedback/:id', async (ctx) => {
  const developer = await admin(ctx);
  const body = await ctx.body();
  const status = String(body.status || '');
  if (!['open', 'resolved'].includes(status)) throw badRequest('INVALID_STATUS', 'status 不合法');
  await ctx.db.prepare('UPDATE mp_feedback SET status = ? WHERE id = ?').run(status, Number(ctx.params.id));
  await audit(ctx, developer, 'admin.feedback.status', 'feedback', String(ctx.params.id), null, { status });
  ctx.json({ ok: true });
});

export default router;