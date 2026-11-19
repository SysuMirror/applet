import { badRequest } from '../errors.js';
import { nowIso } from '../util.js';
import { getApp, publicApp } from './catalog.js';

const MAX_RECENT = 20;
const MAX_FAVORITES = 50;

function normalizeList(value, field, max) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw badRequest('INVALID_PREFS', `${field} 必须是数组`);
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string') throw badRequest('INVALID_PREFS', `${field} 只能包含 appKey 字符串`);
    const key = item.trim();
    if (!key) continue;
    if (!out.includes(key)) out.push(key);
    if (out.length >= max) break;
  }
  return out;
}

async function appFor(db, appKey) {
  const row = await getApp(db, appKey);
  return row && row.status === 'published' ? row : null;
}

export async function getPrefs(db, userId, publicBase = '') {
  const [recentRows, favoriteRows] = await Promise.all([
    db.prepare(`
      SELECT * FROM mp_user_prefs WHERE user_id = ? AND opened_at IS NOT NULL
      ORDER BY opened_at DESC LIMIT ?
    `).all(String(userId), MAX_RECENT),
    db.prepare(`
      SELECT * FROM mp_user_prefs WHERE user_id = ? AND is_favorite = 1
      ORDER BY updated_at DESC LIMIT ?
    `).all(String(userId), MAX_FAVORITES),
  ]);

  const decorate = async (row, timeField) => {
    const app = await appFor(db, row.app_key);
    if (!app) return null;
    return {
      appKey: row.app_key,
      [timeField]: timeField === 'openedAt' ? row.opened_at : row.updated_at,
      app: publicApp(app, publicBase),
    };
  };

  const [recent, favorites] = await Promise.all([
    Promise.all(recentRows.map((row) => decorate(row, 'openedAt'))),
    Promise.all(favoriteRows.map((row) => decorate(row, 'addedAt'))),
  ]);

  return {
    recent: recent.filter(Boolean),
    favorites: favorites.filter(Boolean),
    limits: { recent: MAX_RECENT, favorites: MAX_FAVORITES },
  };
}

export async function putPrefs(db, userId, { recent, favorites }, publicBase = '') {
  const recentList = normalizeList(recent, 'recent', MAX_RECENT);
  const favoriteList = normalizeList(favorites, 'favorites', MAX_FAVORITES);
  const now = Date.now();
  const nowText = nowIso();

  const upsert = db.prepare(`
    INSERT INTO mp_user_prefs (user_id, app_key, is_favorite, opened_at, sort_order, created_at, updated_at)
    VALUES (?, ?, 0, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      opened_at = COALESCE(VALUES(opened_at), opened_at),
      sort_order = VALUES(sort_order),
      updated_at = VALUES(updated_at)
  `);

  for (const [index, appKey] of recentList.entries()) {
    if (!(await appFor(db, appKey))) continue;
    const openedAt = new Date(now - index * 1000).toISOString();
    await upsert.run(String(userId), appKey, openedAt, index, nowText, nowText);
  }

  // 只传 favorites 时才覆盖收藏；只传 recent 时保留原收藏（增量更新语义）
  if (Array.isArray(favorites)) {
    await db.prepare('UPDATE mp_user_prefs SET is_favorite = 0, updated_at = ? WHERE user_id = ?')
      .run(nowText, String(userId));
    for (const [index, appKey] of favoriteList.entries()) {
      if (!(await appFor(db, appKey))) continue;
      await db.prepare(`
        INSERT INTO mp_user_prefs (user_id, app_key, is_favorite, opened_at, sort_order, created_at, updated_at)
        VALUES (?, ?, 1, NULL, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          is_favorite = 1, sort_order = VALUES(sort_order), updated_at = VALUES(updated_at)
      `).run(String(userId), appKey, index, nowText, nowText);
    }
  }

  // 显式提交 recent 列表时，清空不在列表中的旧打开时间
  if (Array.isArray(recent)) {
    if (recentList.length === 0) {
      await db.prepare('UPDATE mp_user_prefs SET opened_at = NULL WHERE user_id = ?').run(String(userId));
    } else {
      const placeholders = recentList.map(() => '?').join(',');
      await db.prepare(`UPDATE mp_user_prefs SET opened_at = NULL WHERE user_id = ? AND app_key NOT IN (${placeholders})`)
        .run(String(userId), ...recentList);
    }
  }
  return getPrefs(db, userId, publicBase);
}

export async function listGrants(db, userId) {
  const rows = await db.prepare(
    'SELECT * FROM mp_app_grants WHERE user_id = ? AND revoked_at IS NULL ORDER BY granted_at DESC',
  ).all(String(userId));
  return rows.map((row) => ({
    appKey: row.app_key,
    scopes: JSON.parse(row.scopes || '[]'),
    grantedAt: row.granted_at,
  }));
}

export async function revokeGrant(db, userId, appKey) {
  await db.prepare('UPDATE mp_app_grants SET revoked_at = ? WHERE user_id = ? AND app_key = ?')
    .run(nowIso(), String(userId), String(appKey));
  await db.prepare('UPDATE mp_sessions SET revoked_at = ? WHERE user_id = ? AND app_key = ? AND revoked_at IS NULL')
    .run(nowIso(), String(userId), String(appKey));
}