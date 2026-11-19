import { badRequest } from '../errors.js';
import { inQuietHours, nowIso, safeJsonParse } from '../util.js';

const MAX_FANOUT = 5000;

export function validateNewPostEvent(body) {
  if (!body || typeof body !== 'object') throw badRequest('INVALID_EVENT', '事件体必须是对象');
  const eventID = String(body.eventID || '').trim();
  if (!eventID || eventID.length > 128) throw badRequest('INVALID_EVENT', 'eventID 缺失或过长');
  const title = String(body.title || '').trim();
  if (!title || title.length > 200) throw badRequest('INVALID_EVENT', 'title 缺失或过长');
  const dedupKey = String(body.dedupKey || `post:${body.postID || eventID}`).trim();
  if (dedupKey.length > 128) throw badRequest('INVALID_EVENT', 'dedupKey 过长');
  return {
    eventID,
    type: 'new_post',
    dedupKey,
    title,
    postID: body.postID ?? null,
    partition: String(body.partition || ''),
    authorUserID: body.authorUserID == null ? null : String(body.authorUserID),
    createdAt: String(body.createdAt || nowIso()),
    raw: body,
  };
}

/**
 * 事件接入：去重 → 落库 → 订阅匹配 → 写通知（同步）→ 推送（异步）。
 * 调用方（旧服务）拿到的响应只表示事件已被接收，推送在后台完成。
 */
export async function ingestEvent({ db, event, config, push, log }) {
  const existing = await db.prepare('SELECT * FROM mp_events WHERE event_id = ?').get(event.eventID);
  if (existing) return { duplicate: true, eventId: existing.event_id, notified: 0 };

  const duplicateKey = await db.prepare('SELECT event_id FROM mp_events WHERE dedup_key = ? LIMIT 1')
    .get(event.dedupKey);
  if (duplicateKey) {
    return { duplicate: true, eventId: duplicateKey.event_id, notified: 0 };
  }

  const now = nowIso();
  const info = await db.prepare(`
    INSERT INTO mp_events (event_id, type, payload, dedup_key, source, received_at, status)
    VALUES (?, ?, ?, ?, 'main', ?, 'received')
  `).run(event.eventID, event.type, JSON.stringify(event.raw), event.dedupKey, now);

  const subscribers = await db.prepare(`
    SELECT user_id, quiet_from, quiet_to FROM mp_subscriptions
    WHERE topic = 'new_posts' AND enabled = 1
    ORDER BY created_at ASC LIMIT ?
  `).all(MAX_FANOUT);

  const since = new Date(Date.now() - 3600_000).toISOString();
  const recentCounts = new Map(
    (await db.prepare(`
      SELECT user_id, COUNT(*) AS c FROM mp_notifications
      WHERE created_at >= ? GROUP BY user_id
    `).all(since)).map((row) => [row.user_id, Number(row.c)]),
  );

  const insertNotification = db.prepare(`
    INSERT IGNORE INTO mp_notifications
      (user_id, event_id, app_key, dedup_key, title, body, status, created_at)
    VALUES (?, ?, 'new_posts', ?, ?, ?, ?, ?)
  `);

  const nowDate = new Date();
  let notified = 0;
  let quiet = 0;
  let suppressed = 0;
  const created = [];

  for (const sub of subscribers) {
    const isQuiet = inQuietHours(sub.quiet_from, sub.quiet_to, nowDate, config.notificationTzOffsetMinutes);
    const count = recentCounts.get(sub.user_id) || 0;
    let status = 'pending';
    if (isQuiet) { status = 'quiet'; quiet += 1; }
    else if (count >= config.maxNotificationsPerHour) { status = 'suppressed'; suppressed += 1; }
    const body = event.partition ? `${event.partition} · 新帖` : '新帖';
    const result = await insertNotification.run(
      sub.user_id, event.eventID, event.dedupKey,
      `新帖：${event.title}`.slice(0, 200), body, status, now,
    );
    if (Number(result.changes) === 1) {
      notified += 1;
      recentCounts.set(sub.user_id, count + 1);
      if (status === 'pending') {
        created.push({
          id: Number(result.lastInsertRowid),
          user_id: sub.user_id,
          app_key: 'new_posts',
          event_id: event.eventID,
          title: `新帖：${event.title}`.slice(0, 200),
          body,
        });
      }
    }
  }

  await db.prepare("UPDATE mp_events SET status = 'processed', processed_at = ? WHERE id = ?")
    .run(nowIso(), Number(info.lastInsertRowid));

  // 推送异步执行，避免阻塞旧服务的 outbox worker。
  if (created.length && push) {
    const dbRef = db;
    setImmediate(async () => {
      let index = 0;
      const worker = async () => {
        while (index < created.length) {
          const item = created[index];
          index += 1;
          try { await push.deliver(dbRef, item); } catch (err) {
            log?.warn('push.unhandled', { error: String(err?.message || err) });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(8, created.length) }, worker));
    });
  }

  return {
    duplicate: false,
    eventId: event.eventID,
    notified,
    stats: { subscribers: subscribers.length, notified, quiet, suppressed },
  };
}

export async function listNewPosts(db, userId, { since, limit = 30 } = {}) {
  const cut = since ? new Date(since) : new Date(Date.now() - 24 * 3600_000);
  const sinceIso = Number.isFinite(cut.getTime()) ? cut.toISOString() : new Date(Date.now() - 86400_000).toISOString();
  const size = Math.min(100, Math.max(1, Number(limit) || 30));
  const rows = await db.prepare(`
    SELECT n.*, e.payload AS event_payload
    FROM mp_notifications n
    LEFT JOIN mp_events e ON e.event_id = n.event_id
    WHERE n.user_id = ? AND n.created_at > ?
    ORDER BY n.created_at DESC
    LIMIT ?
  `).all(String(userId), sinceIso, size);
  const unread = await db.prepare(
    'SELECT COUNT(*) AS c FROM mp_notifications WHERE user_id = ? AND read_at IS NULL',
  ).get(String(userId));
  return {
    items: rows.map((row) => ({
      id: Number(row.id),
      eventId: row.event_id,
      appKey: row.app_key,
      title: row.title,
      body: row.body,
      status: row.status,
      createdAt: row.created_at,
      readAt: row.read_at || null,
      event: row.event_payload ? safeJsonParse(row.event_payload, null) : null,
    })),
    unread: Number(unread?.c || 0),
    nextCursor: null,
  };
}

export async function markNotificationsRead(db, userId, { ids, all = false } = {}) {
  const now = nowIso();
  if (all) {
    const res = await db.prepare('UPDATE mp_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
      .run(now, String(userId));
    return Number(res.changes);
  }
  const list = Array.isArray(ids) ? ids.map((v) => Number(v)).filter((v) => Number.isFinite(v)).slice(0, 200) : [];
  if (!list.length) return 0;
  const placeholders = list.map(() => '?').join(',');
  const res = await db.prepare(
    `UPDATE mp_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${placeholders})`,
  ).run(now, String(userId), ...list);
  return Number(res.changes);
}

export async function getSubscriptions(db, userId) {
  const rows = await db.prepare('SELECT * FROM mp_subscriptions WHERE user_id = ?').all(String(userId));
  const map = new Map(rows.map((row) => [row.topic, row]));
  const topics = ['new_posts'].map((topic) => {
    const row = map.get(topic);
    return {
      topic,
      enabled: row ? Boolean(row.enabled) : true,
      quietHours: row && (row.quiet_from || row.quiet_to)
        ? { from: row.quiet_from, to: row.quiet_to }
        : null,
    };
  });
  return { topics };
}

export async function putSubscriptions(db, userId, topics) {
  if (!Array.isArray(topics)) throw badRequest('INVALID_SUBSCRIPTIONS', 'topics 必须是数组');
  const now = nowIso();
  for (const item of topics) {
    if (!item || typeof item !== 'object') throw badRequest('INVALID_SUBSCRIPTIONS', 'topic 项不合法');
    if (item.topic !== 'new_posts') throw badRequest('UNKNOWN_TOPIC', `不支持的主题：${item.topic}`);
    const enabled = item.enabled === false ? 0 : 1;
    let quietFrom = '';
    let quietTo = '';
    if (item.quietHours) {
      const from = String(item.quietHours.from || '');
      const to = String(item.quietHours.to || '');
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(from) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(to)) {
        throw badRequest('INVALID_QUIET_HOURS', '静默时段需为 HH:MM 格式');
      }
      quietFrom = from;
      quietTo = to;
    }
    await db.prepare(`
      INSERT INTO mp_subscriptions (user_id, topic, enabled, quiet_from, quiet_to, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        enabled = VALUES(enabled), quiet_from = VALUES(quiet_from),
        quiet_to = VALUES(quiet_to), updated_at = VALUES(updated_at)
    `).run(String(userId), item.topic, enabled, quietFrom, quietTo, now, now);
  }
  return getSubscriptions(db, userId);
}