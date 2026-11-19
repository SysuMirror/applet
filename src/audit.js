import { nowIso } from './util.js';

export async function writeAudit(db, {
  actorType = 'system',
  actorId = '',
  action,
  targetType = '',
  targetKey = '',
  before = null,
  after = null,
  ip = '',
  requestId = '',
}) {
  const serialize = (value) => {
    if (value == null) return null;
    try {
      const text = JSON.stringify(value);
      return text.length > 20000 ? `${text.slice(0, 20000)}…` : text;
    } catch {
      return null;
    }
  };
  await db.prepare(`
    INSERT INTO mp_audit_logs
      (actor_type, actor_id, action, target_type, target_key, \`before\`, \`after\`, ip, request_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    actorType,
    String(actorId || ''),
    action,
    targetType,
    String(targetKey || ''),
    serialize(before),
    serialize(after),
    String(ip || ''),
    String(requestId || ''),
    nowIso(),
  );
}

export function mapAudit(row) {
  const parse = (text) => {
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  };
  return {
    id: Number(row.id),
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    targetType: row.target_type,
    targetKey: row.target_key,
    before: parse(row.before),
    after: parse(row.after),
    ip: row.ip,
    requestId: row.request_id,
    createdAt: row.created_at,
  };
}