import crypto from 'node:crypto';
import { ApiError, notFound } from '../errors.js';
import { isExpired, isoPlusSeconds, nowIso, randomToken, safeJsonParse, sha256 } from '../util.js';

/**
 * 启动票据：Redis 保存一次性票据（GETDEL 原子消费），MySQL 只做审计。
 * Redis 不可用时退化为 MySQL 的原子 UPDATE，功能不受影响。
 */
export async function issueTicket(db, {
  userId, app, deviceId = '', origin = '', ttl = 60, redis = null, prefix = 'mp:',
}) {
  const ticket = randomToken('lt_', 32);
  const hash = sha256(ticket);
  const now = new Date();
  const expiresAt = isoPlusSeconds(ttl, now.getTime());
  if (redis) {
    try {
      await redis.set(
        `${prefix}lt:${hash}`,
        JSON.stringify({ u: String(userId), a: app.app_key, d: String(deviceId || ''), o: String(origin || ''), e: expiresAt }),
        { EX: Math.max(ttl + 60, 120), NX: true },
      );
    } catch { /* Redis 故障时以 MySQL 为准 */ }
  }
  await db.prepare(`
    INSERT INTO mp_launch_tickets (ticket_hash, user_id, app_key, device_id, origin, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(hash, String(userId), app.app_key, String(deviceId || ''), String(origin || ''), nowIso(), expiresAt);
  await db.prepare('DELETE FROM mp_launch_tickets WHERE expires_at < ?')
    .run(new Date(Date.now() - 3600_000).toISOString());
  return { ticket, expiresAt, ttl };
}

export async function exchangeTicket(db, ticket, {
  origin = '', sessionTtl = 7200, redis = null, prefix = 'mp:',
} = {}) {
  const hash = sha256(ticket);
  let data = null;
  if (redis) {
    try {
      const raw = await redis.getDel(`${prefix}lt:${hash}`);
      if (raw) data = JSON.parse(raw);
    } catch { data = null; }
  }

  let row;
  if (data) {
    if (isExpired(data.e)) throw new ApiError(401, 'TICKET_EXPIRED', '启动票据已过期，请重新打开小程序');
    if (data.o && origin && data.o !== origin) {
      throw new ApiError(401, 'ORIGIN_MISMATCH', '启动来源与票据不匹配');
    }
    const used = await db.prepare(
      'UPDATE mp_launch_tickets SET used_at = ? WHERE ticket_hash = ? AND used_at IS NULL',
    ).run(nowIso(), hash);
    if (Number(used.changes) === 0) {
      const existing = await db.prepare('SELECT used_at FROM mp_launch_tickets WHERE ticket_hash = ?').get(hash);
      if (existing) throw new ApiError(401, 'TICKET_USED', '启动票据已被使用，请重新打开小程序');
    }
    row = {
      user_id: String(data.u),
      app_key: String(data.a),
      device_id: String(data.d || ''),
      origin: String(data.o || ''),
      expires_at: String(data.e),
    };
  } else {
    row = await db.prepare('SELECT * FROM mp_launch_tickets WHERE ticket_hash = ?').get(hash);
    if (!row) throw new ApiError(401, 'INVALID_TICKET', '启动票据无效');
    if (row.used_at) throw new ApiError(401, 'TICKET_USED', '启动票据已被使用，请重新打开小程序');
    if (isExpired(row.expires_at)) throw new ApiError(401, 'TICKET_EXPIRED', '启动票据已过期，请重新打开小程序');
    if (row.origin && origin && row.origin !== origin) {
      throw new ApiError(401, 'ORIGIN_MISMATCH', '启动来源与票据不匹配');
    }
    const used = await db.prepare(
      'UPDATE mp_launch_tickets SET used_at = ? WHERE ticket_hash = ? AND used_at IS NULL',
    ).run(nowIso(), hash);
    if (Number(used.changes) !== 1) throw new ApiError(401, 'TICKET_USED', '启动票据已被使用');
  }

  const app = await db.prepare('SELECT * FROM mp_apps WHERE app_key = ? AND deleted_at IS NULL')
    .get(row.app_key);
  if (!app) throw notFound('APP_NOT_FOUND', '小程序不存在');
  if (app.status !== 'published') throw new ApiError(403, 'APP_UNAVAILABLE', '小程序尚未发布或已下线');

  const scopes = safeJsonParse(app.scopes, []);
  const token = randomToken('mps_', 32);
  const now = nowIso();
  const expiresAt = isoPlusSeconds(sessionTtl);
  await db.prepare(`
    INSERT INTO mp_sessions
      (token_hash, user_id, app_key, device_id, scopes, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sha256(token), row.user_id, row.app_key, row.device_id, JSON.stringify(scopes), now, expiresAt, now);

  await db.prepare(`
    INSERT INTO mp_app_grants (user_id, app_key, scopes, granted_at, revoked_at)
    VALUES (?, ?, ?, ?, NULL)
    ON DUPLICATE KEY UPDATE
      scopes = VALUES(scopes),
      granted_at = IF(revoked_at IS NULL, granted_at, VALUES(granted_at)),
      revoked_at = NULL
  `).run(String(row.user_id), row.app_key, JSON.stringify(scopes), now);

  await touchAppOpen(db, row.user_id, row.app_key);

  return {
    token,
    session: {
      userId: row.user_id,
      appKey: row.app_key,
      deviceId: row.device_id,
      scopes,
      expiresAt,
    },
    app,
  };
}

export async function touchAppOpen(db, userId, appKey) {
  const now = nowIso();
  await db.prepare(`
    INSERT INTO mp_user_prefs (user_id, app_key, is_favorite, opened_at, sort_order, created_at, updated_at)
    VALUES (?, ?, 0, ?, 0, ?, ?)
    ON DUPLICATE KEY UPDATE opened_at = VALUES(opened_at), updated_at = VALUES(updated_at)
  `).run(String(userId), String(appKey), now, now, now);
}

export async function revokeSession(db, tokenHash) {
  await db.prepare('UPDATE mp_sessions SET revoked_at = ? WHERE token_hash = ?').run(nowIso(), tokenHash);
}

export async function revokeUserAppSessions(db, userId, appKey) {
  await db.prepare(
    'UPDATE mp_sessions SET revoked_at = ? WHERE user_id = ? AND app_key = ? AND revoked_at IS NULL',
  ).run(nowIso(), String(userId), String(appKey));
}

export function createSessionToken() {
  return randomToken('mps_', 32);
}

export function hashToken(token) {
  return sha256(token);
}

export function randomNonce() {
  return crypto.randomBytes(16).toString('hex');
}