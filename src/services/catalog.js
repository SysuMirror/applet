import crypto from 'node:crypto';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import {
  decodeCursor, encodeCursor, encryptSecret, decryptSecret, nowIso,
  normalizeOrigin, safeJsonParse, sha256,
} from '../util.js';
import { CATEGORIES, KNOWN_SCOPES } from '../config.js';

const RESERVED_KEYS = new Set([
  'admin', 'api', 'app', 'apps', 'open', 'docs', 'login', 'register', 'logout',
  'static', 'assets', 'healthz', 'readyz', 'metrics', 'internal',
  'v1', 'dev', 'sdk', 'launch', 'demo', 'system', 'support', 'null', 'undefined',
]);

const VISIBILITIES = new Set(['public', 'logged_in', 'allowlist']);
const CATEGORY_KEYS = new Set(CATEGORIES.map((c) => c.key));
export const APP_KEY_PATTERN = /^[a-z][a-z0-9_-]{2,31}$/;

function isLocalHostname(hostname) {
  return hostname === 'localhost' || hostname.endsWith('.localhost')
    || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

export function validateAppKey(value) {
  const key = String(value || '').trim();
  if (!APP_KEY_PATTERN.test(key)) {
    throw badRequest('INVALID_APP_KEY', 'appKey 需为 3~32 位小写字母开头，仅含小写字母、数字、下划线和短横线');
  }
  if (RESERVED_KEYS.has(key)) throw badRequest('RESERVED_APP_KEY', 'appKey 为系统保留字');
  return key;
}

export function assertEntryUrl(value, config, { required = false, field = 'entryURL' } = {}) {
  const raw = String(value || '').trim();
  if (!raw) {
    if (required) throw badRequest('ENTRY_URL_REQUIRED', '请填写小程序入口地址');
    return '';
  }
  let url;
  try { url = new URL(raw); } catch { throw badRequest('INVALID_URL', `${field} 不是合法 URL`); }
  const local = isLocalHostname(url.hostname);
  const httpsOk = url.protocol === 'https:';
  const localOk = config.allowHttpLocalhost && local && (url.protocol === 'http:' || url.protocol === 'https:');
  if (!httpsOk && !localOk) {
    throw badRequest('INVALID_URL', `${field} 必须使用 https（本地开发允许 http://localhost）`);
  }
  if (url.username || url.password) throw badRequest('INVALID_URL', `${field} 不允许包含账号密码`);
  if (raw.length > 512) throw badRequest('INVALID_URL', `${field} 过长`);
  return url.toString();
}

/**
 * 入口页 origin 必须出现在 allowedOrigins 中，否则票据绑定的 origin 与实际页面不一致，
 * 容器会报 `launchURL 不在允许的 origin 内 / ORIGIN_MISMATCH`。
 * 这里统一补上并放到第一位：旧客户端常用 allowedOrigins[0] 申请票据。
 */
export function normalizeOriginsForEntry(entryURL, allowedOrigins = []) {
  const list = [...new Set((Array.isArray(allowedOrigins) ? allowedOrigins : []).map((v) => String(v)))];
  let entryOrigin = '';
  try { entryOrigin = entryURL ? new URL(entryURL).origin : ''; } catch { entryOrigin = ''; }
  if (!entryOrigin) return list;
  return [entryOrigin, ...list.filter((o) => o !== entryOrigin)];
}

export function validateOrigins(value, config, { field = 'allowedOrigins' } = {}) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw badRequest('INVALID_ORIGINS', `${field} 必须是数组`);
  if (value.length > config.maxOriginsPerApp) {
    throw badRequest('TOO_MANY_ORIGINS', `最多配置 ${config.maxOriginsPerApp} 个 origin`);
  }
  const out = [];
  for (const item of value) {
    const origin = normalizeOrigin(item);
    if (!origin) throw badRequest('INVALID_ORIGIN', `origin 不合法：${String(item).slice(0, 80)}`);
    const url = new URL(origin);
    if (url.protocol !== 'https:' && !(config.allowHttpLocalhost && isLocalHostname(url.hostname))) {
      throw badRequest('INVALID_ORIGIN', 'origin 必须使用 https（本地开发允许 http://localhost）');
    }
    if (!out.includes(origin)) out.push(origin);
  }
  return out;
}

export function validateScopes(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw badRequest('INVALID_SCOPES', 'scopes 必须是数组');
  const out = [];
  for (const scope of value) {
    if (!KNOWN_SCOPES.includes(scope)) throw badRequest('UNKNOWN_SCOPE', `不支持的权限：${scope}`);
    if (!out.includes(scope)) out.push(scope);
  }
  return out;
}

export function validateIcon(value) {
  const icon = String(value || '').trim();
  if (!icon) return '';
  if (/^tabler:[a-z0-9-]{1,40}$/.test(icon)) return icon;
  if (/^\/media\/[a-f0-9]{32}\.(png|jpg|gif|webp)$/.test(icon)) return icon;
  throw badRequest('INVALID_ICON', '图标需为 tabler:name 或上传后的 /media/ 地址');
}

export function validateCategory(value) {
  const category = String(value || 'content');
  if (!CATEGORY_KEYS.has(category)) throw badRequest('INVALID_CATEGORY', '分类不存在');
  return category;
}

export function validateVisibility(value) {
  const visibility = String(value || 'logged_in');
  if (!VISIBILITIES.has(visibility)) throw badRequest('INVALID_VISIBILITY', '可见范围不合法');
  return visibility;
}

export function validateVersion(value) {
  const version = String(value || '1.0.0').trim();
  if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version)) {
    throw badRequest('INVALID_VERSION', '版本号需形如 1.0.0');
  }
  return version;
}

export function mapApp(row, { includeSecret = false, secret = '' } = {}) {
  if (!row) return null;
  const app = {
    id: Number(row.id),
    appKey: row.app_key,
    developerId: row.developer_id == null ? null : Number(row.developer_id),
    name: row.name,
    description: row.description || '',
    icon: row.icon || '',
    category: row.category,
    entryURL: row.entry_url,
    allowedOrigins: safeJsonParse(row.allowed_origins, []),
    scopes: safeJsonParse(row.scopes, []),
    requestedScopes: safeJsonParse(row.requested_scopes, []),
    visibility: row.visibility,
    status: row.status,
    ownerType: row.owner_type,
    sort: Number(row.sort),
    version: row.version,
    pinyin: row.pinyin || '',
    keywords: row.keywords || '',
    webhookUrl: row.webhook_url || '',
    rejectReason: row.reject_reason || '',
    hostingMode: row.hosting_mode || 'external',
    hostingBuild: row.hosting_build || '',
    hostingUpdatedAt: row.hosting_updated_at || null,
    hostedAt: row.hosting_mode === 'internal' ? `${row.entry_url || ''}` : null,
    publishedAt: row.published_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
  };
  if (includeSecret) {
    app.secret = secret;
    app.secretMasked = secret ? `${secret.slice(0, 4)}${'*'.repeat(20)}${secret.slice(-4)}` : '';
  }
  return app;
}

/** 给 App/WebView 的公开字段，不暴露开发者、密钥、审核信息。 */
export function publicApp(row, publicBase = '') {
  if (!row) return null;
  const rawIcon = row.icon || '';
  // 上传图标存的是 /media/... 相对地址；API 消费者（App/WebView）需要绝对 URL，
  // 否则 Image.network('/media/...') 会失败并回退到默认图标。
  const icon = rawIcon.startsWith('/media/') && publicBase ? `${publicBase}${rawIcon}` : rawIcon;
  return {
    appKey: row.app_key,
    name: row.name,
    description: row.description || '',
    icon,
    category: row.category,
    entryURL: row.entry_url,
    scopes: safeJsonParse(row.scopes, []),
    allowedOrigins: safeJsonParse(row.allowed_origins, []),
    visibility: row.visibility,
    version: row.version,
    ownerType: row.owner_type,
    sort: Number(row.sort),
    badge: null,
    publishedAt: row.published_at || null,
  };
}

export function categoryName(key) {
  return CATEGORIES.find((c) => c.key === key)?.name || key;
}

export async function getApp(db, appKey, { includeDeleted = false } = {}) {
  const row = await db.prepare(
    `SELECT * FROM mp_apps WHERE app_key = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`,
  ).get(String(appKey));
  return row || null;
}

export async function requireApp(db, appKey) {
  const app = await getApp(db, appKey);
  if (!app) throw notFound('APP_NOT_FOUND', '小程序不存在');
  return app;
}

export function requireManageable(app, developer) {
  if (!app) throw notFound('APP_NOT_FOUND', '小程序不存在');
  if (developer.role === 'admin') return app;
  if (Number(app.developer_id) !== Number(developer.id)) {
    throw forbidden('APP_FORBIDDEN', '无权管理该小程序');
  }
  return app;
}

export async function canSeeApp(db, app, userId) {
  if (!app || app.status !== 'published' || app.deleted_at) return false;
  if (app.visibility === 'public') return true;
  if (!userId) return false;
  if (app.visibility === 'logged_in') return true;
  if (app.visibility === 'allowlist') {
    const row = await db.prepare('SELECT 1 AS ok FROM mp_app_allowlist WHERE app_id = ? AND user_id = ?')
      .get(Number(app.id), String(userId));
    return Boolean(row);
  }
  return false;
}

export async function listCatalog(db, { category = '', cursor = '', limit = 20, userId = '', publicBase = '' } = {}) {
  const size = Math.min(50, Math.max(1, Number(limit) || 20));
  const params = [];
  let where = `deleted_at IS NULL AND status = 'published'`;
  if (userId) {
    where += ` AND (visibility IN ('public','logged_in') OR (visibility = 'allowlist' AND EXISTS (
      SELECT 1 FROM mp_app_allowlist al WHERE al.app_id = mp_apps.id AND al.user_id = ?)))`;
    params.push(String(userId));
  } else {
    where += ` AND visibility = 'public'`;
  }
  if (category) {
    where += ' AND category = ?';
    params.push(category);
  }
  const decoded = decodeCursor(cursor);
  if (decoded) {
    where += ' AND (sort < ? OR (sort = ? AND id > ?))';
    params.push(decoded.sort, decoded.sort, decoded.id);
  }
  const rows = await db.prepare(
    `SELECT * FROM mp_apps WHERE ${where} ORDER BY sort DESC, id ASC LIMIT ?`,
  ).all(...params, size + 1);
  const hasMore = rows.length > size;
  const page = hasMore ? rows.slice(0, size) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map((row) => publicApp(row, publicBase)),
    nextCursor: hasMore && last ? encodeCursor(last.sort, last.id) : null,
  };
}

export async function searchCatalog(db, { q = '', limit = 20, userId = '', publicBase = '' } = {}) {
  const term = String(q || '').trim();
  if (!term) return { items: [], nextCursor: null };
  if (term.length > 64) throw badRequest('QUERY_TOO_LONG', '搜索词过长');
  const like = `%${term.toLowerCase()}%`;
  const size = Math.min(50, Math.max(1, Number(limit) || 20));
  const params = [like, like, like, like];
  let visibility = `deleted_at IS NULL AND status = 'published'`;
  if (userId) {
    visibility += ` AND (visibility IN ('public','logged_in') OR (visibility = 'allowlist' AND EXISTS (
      SELECT 1 FROM mp_app_allowlist al WHERE al.app_id = mp_apps.id AND al.user_id = ?)))`;
    params.push(String(userId));
  } else {
    visibility += ` AND visibility = 'public'`;
  }
  const rows = await db.prepare(`
    SELECT * FROM mp_apps
    WHERE ${visibility}
      AND (lower(name) LIKE ? OR lower(app_key) LIKE ? OR lower(pinyin) LIKE ? OR lower(keywords) LIKE ?)
    ORDER BY sort DESC, id ASC
    LIMIT ?
  `).all(...params, size);
  return { items: rows.map((row) => publicApp(row, publicBase)), nextCursor: null };
}

export async function generateAppKey(db) {
  for (let i = 0; i < 20; i += 1) {
    const key = `mp${crypto.randomBytes(4).toString('hex')}`;
    if (!(await getApp(db, key, { includeDeleted: true }))) return key;
  }
  throw new Error('无法生成 appKey');
}

export function generateSecret() {
  return crypto.randomBytes(24).toString('base64url');
}

export function appSecret(app, config) {
  if (!app.secret_cipher) return '';
  return decryptSecret(app.secret_cipher, config.appSecretMasterKey);
}

export async function setAppSecret(db, appId, secret, config) {
  await db.prepare('UPDATE mp_apps SET secret_hash = ?, secret_cipher = ?, updated_at = ? WHERE id = ?')
    .run(
      sha256(secret),
      encryptSecret(secret, config.appSecretMasterKey),
      nowIso(),
      Number(appId),
    );
}

export async function createAppRecord(db, {
  appKey, name, description = '', icon = '', category = 'content', entryURL = '',
  allowedOrigins = [], scopes = [], visibility = 'logged_in', developerId = null,
  ownerType = 'partner', sort = 0, webhookUrl = '', pinyin = '', keywords = '',
  status = 'draft', version = '1.0.0', createdBy = null, config,
}) {
  const key = appKey ? validateAppKey(appKey) : await generateAppKey(db);
  if (await getApp(db, key, { includeDeleted: true })) throw conflict('APP_KEY_TAKEN', 'appKey 已被占用');
  const secret = generateSecret();
  const now = nowIso();
  const origins = normalizeOriginsForEntry(entryURL, allowedOrigins);
  const info = await db.prepare(`
    INSERT INTO mp_apps
      (app_key, developer_id, name, description, icon, category, entry_url, allowed_origins,
       scopes, requested_scopes, visibility, status, owner_type, sort, version, pinyin,
       keywords, webhook_url, secret_hash, secret_cipher, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    key, developerId, name, description, icon, category, entryURL,
    JSON.stringify(origins), JSON.stringify(scopes), JSON.stringify(scopes),
    visibility, status, ownerType, sort, version, pinyin, keywords, webhookUrl,
    sha256(secret), encryptSecret(secret, config.appSecretMasterKey), createdBy, now, now,
  );
  const appId = Number(info.lastInsertRowid);
  await db.prepare(`
    INSERT INTO mp_app_versions
      (app_id, version, entry_url, allowed_origins, scopes, changelog, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '', ?, ?, ?)
  `).run(
    appId, version, entryURL, JSON.stringify(origins), JSON.stringify(scopes),
    status === 'published' ? 'published' : 'draft', now, now,
  );
  return { app: await getApp(db, key), secret };
}

const EDITABLE = {
  name: 'name',
  description: 'description',
  icon: 'icon',
  category: 'category',
  entryURL: 'entry_url',
  allowedOrigins: 'allowed_origins',
  scopes: 'scopes',
  visibility: 'visibility',
  sort: 'sort',
  webhookUrl: 'webhook_url',
  pinyin: 'pinyin',
  keywords: 'keywords',
};

export async function updateApp(db, appId, fields) {
  const next = { ...fields };
  if (next.entryURL !== undefined || next.allowedOrigins !== undefined) {
    const row = await db.prepare('SELECT entry_url, allowed_origins FROM mp_apps WHERE id = ?').get(Number(appId));
    if (row) {
      const entryURL = next.entryURL !== undefined ? next.entryURL : row.entry_url;
      const origins = next.allowedOrigins !== undefined
        ? next.allowedOrigins
        : safeJsonParse(row.allowed_origins, []);
      next.allowedOrigins = normalizeOriginsForEntry(entryURL, origins);
    }
  }
  const sets = [];
  const params = [];
  for (const [key, column] of Object.entries(EDITABLE)) {
    if (next[key] === undefined) continue;
    sets.push(`${column} = ?`);
    params.push(Array.isArray(next[key]) ? JSON.stringify(next[key]) : next[key]);
  }
  if (!sets.length) return;
  sets.push('updated_at = ?');
  params.push(nowIso(), Number(appId));
  await db.prepare(`UPDATE mp_apps SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export async function listAllowlist(db, appId) {
  return db.prepare('SELECT user_id FROM mp_app_allowlist WHERE app_id = ? ORDER BY user_id')
    .all(Number(appId)).then((rows) => rows.map((row) => row.user_id));
}

export async function setAllowlist(db, appId, userIds) {
  const clean = [...new Set((Array.isArray(userIds) ? userIds : []).map((v) => String(v).trim()).filter(Boolean))];
  await db.prepare('DELETE FROM mp_app_allowlist WHERE app_id = ?').run(Number(appId));
  const stmt = db.prepare('INSERT IGNORE INTO mp_app_allowlist (app_id, user_id) VALUES (?, ?)');
  for (const userId of clean.slice(0, 5000)) await stmt.run(Number(appId), userId);
  return clean;
}

export async function appStats(db, appKey, days = 14) {
  const from = new Date(Date.now() - (days - 1) * 86400_000).toISOString().slice(0, 10);
  const rows = await db.prepare(
    'SELECT day, calls, users FROM mp_usage_daily WHERE app_key = ? AND day >= ? ORDER BY day ASC',
  ).all(String(appKey), from);
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    const row = byDay.get(day);
    out.push({ date: day, calls: row ? Number(row.calls) : 0, users: row ? Number(row.users) : 0 });
  }
  return out;
}