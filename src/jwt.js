import crypto from 'node:crypto';
import { ApiError } from './errors.js';

function b64u(input) {
  return Buffer.from(input).toString('base64url');
}

function b64uJson(obj) {
  return b64u(JSON.stringify(obj));
}

export function decodeJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new ApiError(401, 'INVALID_TOKEN', 'Token 格式错误');
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new ApiError(401, 'INVALID_TOKEN', 'Token 解析失败');
  }
  return {
    header,
    payload,
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: Buffer.from(parts[2], 'base64url'),
  };
}

export function signJwt(payload, secret, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { iat: now, exp: now + ttlSeconds, ...payload };
  const input = `${b64uJson(header)}.${b64uJson(body)}`;
  const sig = crypto.createHmac('sha256', secret).update(input).digest('base64url');
  return `${input}.${sig}`;
}

export function verifyHs256(token, secret) {
  const decoded = decodeJwt(token);
  if (decoded.header.alg !== 'HS256') {
    throw new ApiError(401, 'INVALID_TOKEN', '不支持的 Token 算法');
  }
  const expected = crypto.createHmac('sha256', secret).update(decoded.signingInput).digest();
  if (expected.length !== decoded.signature.length || !crypto.timingSafeEqual(expected, decoded.signature)) {
    throw new ApiError(401, 'INVALID_TOKEN', 'Token 签名校验失败');
  }
  return decoded.payload;
}

export function validateClaims(payload, { issuer = '', audience = '', clockTolerance = 30 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + clockTolerance < now) {
    throw new ApiError(401, 'TOKEN_EXPIRED', 'Token 已过期');
  }
  if (payload.nbf != null && Number(payload.nbf) - clockTolerance > now) {
    throw new ApiError(401, 'TOKEN_NOT_ACTIVE', 'Token 尚未生效');
  }
  if (issuer && payload.iss !== issuer) {
    throw new ApiError(401, 'INVALID_TOKEN', 'Token 签发方不匹配');
  }
  if (audience && payload.aud != null) {
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(audience)) throw new ApiError(401, 'INVALID_TOKEN', 'Token 受众不匹配');
  }
  return payload;
}

const jwksCache = new Map();
const JWKS_TTL = 5 * 60_000;

export async function fetchJwks(url, now = Date.now()) {
  const cached = jwksCache.get(url);
  if (cached && cached.expires > now) return cached.keys;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`JWKS HTTP ${res.status}`);
    const json = await res.json();
    const keys = Array.isArray(json.keys) ? json.keys : [];
    if (!keys.length) throw new Error('JWKS 为空');
    jwksCache.set(url, { keys, expires: now + JWKS_TTL });
    return keys;
  } finally {
    clearTimeout(timer);
  }
}

function verifyWithKey(alg, signingInput, signature, key) {
  if (alg === 'RS256') {
    return crypto.verify('sha256', Buffer.from(signingInput), key, signature);
  }
  if (alg === 'PS256') {
    return crypto.verify('sha256', Buffer.from(signingInput), {
      key,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    }, signature);
  }
  if (alg === 'ES256') {
    return crypto.verify('sha256', Buffer.from(signingInput), {
      key,
      dsaEncoding: 'ieee-p1363',
    }, signature);
  }
  return false;
}

/** 使用 JWKS 校验非对称签名 Token（RS256 / PS256 / ES256）。 */
export async function verifyJwks(token, jwksUrl, options = {}) {
  const decoded = decodeJwt(token);
  const alg = decoded.header.alg;
  if (!['RS256', 'PS256', 'ES256'].includes(alg)) {
    throw new ApiError(401, 'INVALID_TOKEN', `不支持的 Token 算法 ${alg}`);
  }
  const keys = await fetchJwks(jwksUrl);
  const candidates = keys.filter((k) => {
    if (decoded.header.kid && k.kid !== decoded.header.kid) return false;
    if (k.use && k.use !== 'sig') return false;
    if (k.alg && k.alg !== alg) return false;
    return true;
  });
  let verified = false;
  for (const jwk of candidates) {
    try {
      const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
      if (verifyWithKey(alg, decoded.signingInput, decoded.signature, key)) { verified = true; break; }
    } catch { /* 尝试下一个 key */ }
  }
  if (!verified) throw new ApiError(401, 'INVALID_TOKEN', 'Token 签名校验失败');
  return validateClaims(decoded.payload, options);
}

export function extractUserId(payload) {
  const raw = payload?.sub ?? payload?.userID ?? payload?.UserID ?? payload?.user_id ?? payload?.uid ?? payload?.userId ?? payload?.sso_sub;
  if (raw == null || raw === '') return '';
  return String(raw);
}

export function clearJwksCache() {
  jwksCache.clear();
}