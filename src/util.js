import crypto from 'node:crypto';

export function nowIso() {
  return new Date().toISOString();
}

export function isoPlusSeconds(seconds, from = Date.now()) {
  return new Date(from + seconds * 1000).toISOString();
}

export function isExpired(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  return !Number.isFinite(t) || t <= now;
}

export function randomToken(prefix, bytes = 32) {
  return `${prefix}${crypto.randomBytes(bytes).toString('base64url')}`;
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function hmacSha256(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest();
}

export function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a), 'hex');
  const bb = Buffer.from(String(b), 'hex');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function encryptSecret(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decryptSecret(payload, key) {
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function mask(value, keep = 4) {
  const s = String(value || '');
  if (s.length <= keep * 2) return '****';
  return `${s.slice(0, keep)}${'*'.repeat(Math.min(12, s.length - keep * 2))}${s.slice(-keep)}`;
}

export function safeJsonParse(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeOrigin(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value));
    if (url.pathname !== '/' && url.pathname !== '') return '';
    if (url.search || url.hash || url.username || url.password) return '';
    return url.origin;
  } catch {
    return '';
  }
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

/** 游标：base64url(JSON {s: sort, i: id})，用于稳定的 keyset 分页。 */
export function encodeCursor(sort, id) {
  return Buffer.from(JSON.stringify({ s: Number(sort) || 0, i: Number(id) || 0 }))
    .toString('base64url');
}

export function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const obj = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (!Number.isFinite(obj.s) || !Number.isFinite(obj.i)) return null;
    return { sort: obj.s, id: obj.i };
  } catch {
    return null;
  }
}

export function parseTimeRange(from, to) {
  const start = Date.parse(from || '');
  const end = Date.parse(to || '');
  return {
    start: Number.isFinite(start) ? new Date(start).toISOString() : null,
    end: Number.isFinite(end) ? new Date(end).toISOString() : null,
  };
}

/** "HH:MM" 字符串 → 分钟数；非法返回 null。 */
export function parseClock(value) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 判断某一时刻是否处于静默时段（支持跨零点），按给定时区偏移。 */
export function inQuietHours(from, to, date = new Date(), tzOffsetMinutes = 480) {
  const start = parseClock(from);
  const end = parseClock(to);
  if (start == null || end == null || start === end) return false;
  const minutes = (date.getUTCHours() * 60 + date.getUTCMinutes() + tzOffsetMinutes + 1440) % 1440;
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

export function clientIp(req, trustProxy = true) {
  if (trustProxy) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) return xff;
    const real = String(req.headers['x-real-ip'] || '').trim();
    if (real) return real;
  }
  return req.socket?.remoteAddress || '';
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}