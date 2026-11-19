import crypto from 'node:crypto';
import { ApiError } from './errors.js';
import { safeEqualHex } from './util.js';

const WINDOW_SECONDS = 300;

function nonce(prefix) {
  return `${prefix}${crypto.randomBytes(16).toString('hex')}`;
}

/** 内部 API 出站签名：HMAC(secret, timestamp \n nonce \n body)。 */
export function signInternalRequest(secret, bodyString, now = Date.now()) {
  const timestamp = Math.floor(now / 1000);
  const n = nonce('in_');
  const signature = crypto.createHmac('sha256', secret)
    .update([timestamp, n, bodyString].join('\n'))
    .digest('hex');
  return {
    timestamp,
    nonce: n,
    signature,
    headers: {
      'X-Internal-Timestamp': String(timestamp),
      'X-Internal-Nonce': n,
      'X-Internal-Signature': signature,
    },
  };
}

/** 第三方小程序服务端出站签名：HMAC(appSecret, appKey \n timestamp \n nonce \n body)。 */
export function signAppRequest(appSecret, appKey, bodyString, now = Date.now()) {
  const timestamp = Math.floor(now / 1000);
  const n = nonce('ap_');
  const signature = crypto.createHmac('sha256', appSecret)
    .update([appKey, timestamp, n, bodyString].join('\n'))
    .digest('hex');
  return {
    timestamp,
    nonce: n,
    signature,
    headers: {
      'X-App-Key': appKey,
      'X-App-Timestamp': String(timestamp),
      'X-App-Nonce': n,
      'X-App-Signature': signature,
    },
  };
}

/**
 * 校验入站签名：
 *   internal: HMAC(secret, timestamp \n nonce \n rawBody)
 *   app:      HMAC(appSecret, appKey \n timestamp \n nonce \n rawBody)
 * 校验时间窗（±5 分钟）与 nonce 重放。
 */
export async function verifySignature(db, { scope, secret, parts, timestamp, nonce: n, signature, now = Date.now() }) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(now / 1000) - ts) > WINDOW_SECONDS) {
    throw new ApiError(401, 'SIGNATURE_EXPIRED', '签名时间戳超出允许范围');
  }
  if (!n || String(n).length < 8 || String(n).length > 128) {
    throw new ApiError(401, 'INVALID_SIGNATURE', 'nonce 不合法');
  }
  const expected = crypto.createHmac('sha256', secret).update(parts.join('\n')).digest('hex');
  if (!signature || !safeEqualHex(expected, String(signature))) {
    throw new ApiError(401, 'INVALID_SIGNATURE', '签名校验失败');
  }
  const expiresAt = new Date(now + WINDOW_SECONDS * 1000).toISOString();
  const result = await db
    .prepare('INSERT IGNORE INTO mp_nonces (scope, nonce, expires_at) VALUES (?, ?, ?)')
    .run(scope, String(n), expiresAt);
  if (Number(result.changes) === 0) {
    throw new ApiError(401, 'REPLAY_DETECTED', '检测到重复请求（nonce 已使用）');
  }
}

export const SIGNATURE_WINDOW_SECONDS = WINDOW_SECONDS;