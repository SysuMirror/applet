import crypto from 'node:crypto';
import { signJwt, verifyHs256, verifyJwks, validateClaims, extractUserId, decodeJwt } from './jwt.js';
import { ApiError, unauthorized, forbidden } from './errors.js';
import { one } from './db.js';
import { isExpired, nowIso, safeJsonParse, sha256 } from './util.js';
import { signInternalRequest } from './signature.js';
import { fetchUserinfo } from './sso.js';

// ── 密码 ────────────────────────────────────────────────────────────────
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(password), salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ── 开放平台开发者会话 ──────────────────────────────────────────────────
export const DEV_COOKIE = 'mp_dev';

export function issueDeveloperToken(developer, config) {
  return signJwt(
    {
      sub: String(developer.id),
      typ: 'dev',
      role: developer.role,
      ver: Number(developer.token_version || 0),
    },
    config.devJwtSecret,
    config.devSessionTtl,
  );
}

export function readDeveloperToken(ctx) {
  const auth = String(ctx.headers.authorization || '');
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token.split('.').length === 3) return token;
  }
  return ctx.getCookie(DEV_COOKIE) || String(ctx.headers['x-mp-dev-token'] || '');
}

export async function authenticateDeveloper(ctx, { admin = false } = {}) {
  const token = readDeveloperToken(ctx);
  if (!token) throw unauthorized('NOT_LOGGED_IN', '请先登录开放平台');
  let payload;
  try {
    payload = verifyHs256(token, ctx.config.devJwtSecret);
    validateClaims(payload);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw unauthorized('INVALID_TOKEN', '登录状态无效，请重新登录');
  }
  if (payload.typ !== 'dev') throw unauthorized('INVALID_TOKEN', '登录状态无效');
  const developer = await one(ctx.db, 'SELECT * FROM mp_developers WHERE id = ?', Number(payload.sub));
  if (!developer) throw unauthorized('NOT_LOGGED_IN', '账号不存在');
  if (developer.status !== 'active') throw forbidden('ACCOUNT_SUSPENDED', '开发者账号已被停用');
  if (Number(payload.ver) !== Number(developer.token_version)) {
    throw unauthorized('SESSION_REVOKED', '登录状态已失效，请重新登录');
  }
  if (admin && developer.role !== 'admin') throw forbidden('ADMIN_REQUIRED', '需要平台管理员权限');
  return developer;
}

export function setDeveloperCookie(ctx, token, maxAge = ctx.config.devSessionTtl) {
  ctx.setCookie(DEV_COOKIE, token, { maxAge, sameSite: 'Lax', path: '/' });
}

export function clearDeveloperCookie(ctx) {
  ctx.clearCookie(DEV_COOKIE, { path: '/' });
}

// ── 主站用户身份 ────────────────────────────────────────────────────────
const internalVerifyCache = new Map();
const mainVerifyCache = new Map();
const ssoVerifyCache = new Map();

async function verifyViaSso(config, token) {
  const key = sha256(token);
  const cached = ssoVerifyCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;
  const user = await fetchUserinfo(config, token);
  const userId = String(user.sub || user.sso_sub || '');
  if (!userId) throw unauthorized('INVALID_TOKEN', '统一身份未返回用户标识');
  const payload = { ...user, sub: userId, sso: true };
  ssoVerifyCache.set(key, { payload, expiresAt: Date.now() + 30_000 });
  if (ssoVerifyCache.size > 2000) {
    const now = Date.now();
    for (const [k, v] of ssoVerifyCache) if (v.expiresAt <= now) ssoVerifyCache.delete(k);
  }
  return payload;
}

function pickUserId(value) {
  if (!value || typeof value !== 'object') return '';
  const candidates = [
    value.id, value.userId, value.userID, value.uid, value.sub,
  ];
  for (const candidate of candidates) {
    if (candidate != null && candidate !== '') return String(candidate);
  }
  return '';
}

function extractVerifiedUser(json) {
  const candidates = [
    json?.data?.user,
    json?.data?.profile,
    json?.data,
    json?.user,
    json,
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const id = pickUserId(candidate);
    if (id) return { id, user: candidate };
  }
  return null;
}

/**
 * 通过主站现成的鉴权接口校验 token，无需共享 JWT_KEY。
 * 默认约定：GET {url} + Authorization: Bearer <token>，返回用户对象或 {code:0,data:user}。
 */
async function verifyViaMainApi(token, config) {
  const cacheKey = sha256(token);
  const cached = mainVerifyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(config.mainVerifyUrl, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new ApiError(401, 'INVALID_TOKEN', 'Token 签名校验失败', { strategy: 'main-api', status: res.status });
    }
    if (!res.ok) {
      throw new ApiError(502, 'MAIN_VERIFY_UNAVAILABLE', `主站校验接口返回 HTTP ${res.status}`, { strategy: 'main-api' });
    }
    const json = await res.json();
    if (json && json.code != null && ![0, 200].includes(Number(json.code))) {
      throw new ApiError(401, 'INVALID_TOKEN', 'Token 无效', { strategy: 'main-api', code: json.code });
    }
    const user = extractVerifiedUser(json);
    if (!user) {
      throw new ApiError(401, 'INVALID_TOKEN', '主站未返回用户标识', { strategy: 'main-api' });
    }
    const payload = { ...user.user, sub: user.id };
    mainVerifyCache.set(cacheKey, { payload, expiresAt: Date.now() + 30_000 });
    if (mainVerifyCache.size > 2000) {
      const now = Date.now();
      for (const [key, value] of mainVerifyCache) if (value.expiresAt <= now) mainVerifyCache.delete(key);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function verifyViaInternal(token, config) {
  const cacheKey = sha256(token);
  const cached = internalVerifyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;

  const body = JSON.stringify({ token });
  const signed = signInternalRequest(config.internalSecret, body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(config.internalVerifyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...signed.headers },
      body,
      signal: controller.signal,
    });
    if (!res.ok) throw new ApiError(401, 'INVALID_TOKEN', '主站 Token 校验失败');
    const json = await res.json();
    if (!json?.valid || !json?.userID) throw new ApiError(401, 'INVALID_TOKEN', '主站 Token 无效');
    const payload = {
      sub: String(json.userID),
      exp: json.expiresAt ? Math.floor(Date.parse(json.expiresAt) / 1000) : Math.floor(Date.now() / 1000) + 60,
    };
    const ttl = Math.max(5, Math.min(60, payload.exp - Math.floor(Date.now() / 1000)));
    internalVerifyCache.set(cacheKey, { payload, expiresAt: Date.now() + ttl * 1000 });
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyMainToken(token, config) {
  if (!token) throw unauthorized('UNAUTHORIZED', '缺少主站登录凭证');

  const done = (payload) => {
    const userId = extractUserId(payload);
    if (!userId) throw unauthorized('INVALID_TOKEN', 'Token 缺少用户标识');
    return { userId, payload };
  };

  let header = null;
  let decodedPayload = null;
  try {
    const decoded = decodeJwt(token);
    header = decoded.header;
    decodedPayload = decoded.payload;
  } catch { header = null; }
  const alg = String(header?.alg || 'opaque');
  const strategies = [];
  let lastError = null;

  const remember = (err, strategy) => {
    lastError = err;
    strategies.push({ strategy, status: err?.status, code: err?.code });
  };

  // 1) 本地 HS256（自签测试 token / 与主站共享密钥时）
  if (alg === 'HS256') {
    try {
      const payload = validateClaims(verifyHs256(token, config.mainJwtSecret));
      return done(payload);
    } catch (err) { remember(err, 'local-hs256'); }
  }

  // 2) 主站 JWKS（RS256 等非对称签名）
  if (config.mainJwksUrl && alg !== 'HS256' && alg !== 'opaque') {
    try {
      const payload = await verifyJwks(token, config.mainJwksUrl, {
        issuer: config.mainJwtIssuer,
        audience: config.mainJwtAudience,
      });
      return done(payload);
    } catch (err) { remember(err, 'jwks'); }
  }

  // 3) 主站现成鉴权接口（GET + Bearer），无需共享密钥
  if (config.mainVerifyUrl) {
    try {
      const payload = await verifyViaMainApi(token, config);
      return done(payload);
    } catch (err) { remember(err, 'main-api'); }
  }

  // 4) 主站内部签名校验接口
  if (config.internalVerifyUrl) {
    try {
      const payload = await verifyViaInternal(token, config);
      return done(payload);
    } catch (err) { remember(err, 'internal'); }
  }

  // 5) UniSSO access_token（App 侧可用统一身份 token 直接调用平台）
  if (config.sso?.enabled) {
    try {
      const payload = await verifyViaSso(config, token);
      return done(payload);
    } catch (err) { remember(err, 'sso-userinfo'); }
  }

  // 6) 兜底：如果没有配置任何主站校验方式，继续用本地 HS256
  if (!config.mainJwksUrl && !config.mainVerifyUrl && !config.internalVerifyUrl && !config.sso?.enabled) {
    const payload = validateClaims(verifyHs256(token, config.mainJwtSecret));
    return done(payload);
  }

  const userError = lastError instanceof ApiError ? lastError : unauthorized('INVALID_TOKEN', 'Token 签名校验失败');
  if (userError.details && typeof userError.details === 'object') {
    userError.details = { ...userError.details, alg, iss: decodedPayload?.iss || null, kid: header?.kid || null, strategies };
  } else {
    userError.details = { alg, iss: decodedPayload?.iss || null, kid: header?.kid || null, strategies };
  }
  throw userError;
}

export function readBearer(ctx) {
  const auth = String(ctx.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return '';
  return auth.slice(7).trim();
}

export async function requireUser(ctx) {
  const result = await verifyMainToken(readBearer(ctx), ctx.config);
  ctx.userId = result.userId;
  ctx.userClaims = result.payload;
  return result;
}

export async function optionalUser(ctx) {
  const bearer = readBearer(ctx);
  if (!bearer) return null;
  return requireUser(ctx);
}

// ── 小程序会话（ticket → session） ──────────────────────────────────────
export const SESSION_COOKIE = 'mp_session';

export function readSessionToken(ctx) {
  const auth = String(ctx.headers.authorization || '');
  if (auth.startsWith('Bearer mps_')) return auth.slice(7).trim();
  const header = String(ctx.headers['x-mp-session'] || '').trim();
  if (header) return header;
  return ctx.getCookie(SESSION_COOKIE) || '';
}

export async function getSession(ctx, { rawToken, requiredScope } = {}) {
  const token = rawToken || readSessionToken(ctx);
  if (!token) throw unauthorized('SESSION_REQUIRED', '缺少小程序会话，请重新启动小程序');
  const row = await one(ctx.db, 'SELECT * FROM mp_sessions WHERE token_hash = ?', sha256(token));
  if (!row) throw unauthorized('SESSION_INVALID', '小程序会话无效，请重新启动小程序');
  if (row.revoked_at) throw unauthorized('SESSION_REVOKED', '小程序会话已注销');
  if (isExpired(row.expires_at)) throw unauthorized('SESSION_EXPIRED', '小程序会话已过期，请重新启动小程序');
  const scopes = safeJsonParse(row.scopes, []);
  if (requiredScope && !scopes.includes(requiredScope)) {
    throw forbidden('SCOPE_REQUIRED', `小程序未获得 ${requiredScope} 权限`);
  }
  const app = await one(ctx.db, 'SELECT * FROM mp_apps WHERE app_key = ? AND deleted_at IS NULL', row.app_key);
  if (!app) throw unauthorized('APP_NOT_FOUND', '小程序不存在或已下线');
  ctx.session = { ...row, scopes };
  ctx.sessionToken = token;
  return { session: row, scopes, app, userId: row.user_id, token };
}

/** 滑动续期：剩余有效期不足一半时延长，并重写 Cookie。 */
export async function touchSession(ctx, { session, token, config }) {
  const now = Date.now();
  const expires = Date.parse(session.expires_at);
  if (!Number.isFinite(expires)) return;
  const remaining = expires - now;
  if (remaining > (config.sessionTtl * 1000) / 2) {
    await ctx.db.prepare('UPDATE mp_sessions SET last_seen_at = ? WHERE token_hash = ?')
      .run(nowIso(), session.token_hash);
    return;
  }
  const next = new Date(now + config.sessionTtl * 1000).toISOString();
  await ctx.db.prepare('UPDATE mp_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?')
    .run(nowIso(), next, session.token_hash);
  ctx.setCookie(SESSION_COOKIE, token, { maxAge: config.sessionTtl, sameSite: 'Lax', path: '/' });
}