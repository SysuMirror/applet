import crypto from 'node:crypto';

/**
 * 第三方小程序服务端签名。
 * 签名串：appKey + "\n" + timestamp + "\n" + nonce + "\n" + rawBody
 */
export function signAppRequest(appSecret, appKey, bodyString, now = Date.now()) {
  const timestamp = Math.floor(now / 1000);
  const nonce = crypto.randomBytes(16).toString('hex');
  const signature = crypto
    .createHmac('sha256', appSecret)
    .update([appKey, timestamp, nonce, bodyString].join('\n'))
    .digest('hex');
  return {
    timestamp,
    nonce,
    signature,
    headers: {
      'X-App-Key': appKey,
      'X-App-Timestamp': String(timestamp),
      'X-App-Nonce': nonce,
      'X-App-Signature': signature,
    },
  };
}

/**
 * 主站 → 小程序平台内部签名。
 * 签名串：timestamp + "\n" + nonce + "\n" + rawBody
 */
export function signInternalRequest(secret, bodyString, now = Date.now()) {
  const timestamp = Math.floor(now / 1000);
  const nonce = crypto.randomBytes(16).toString('hex');
  const signature = crypto
    .createHmac('sha256', secret)
    .update([timestamp, nonce, bodyString].join('\n'))
    .digest('hex');
  return {
    timestamp,
    nonce,
    signature,
    headers: {
      'X-Internal-Timestamp': String(timestamp),
      'X-Internal-Nonce': nonce,
      'X-Internal-Signature': signature,
    },
  };
}

/** 服务端校验会话示例。 */
export async function verifyMiniProgramSession({
  baseUrl, appKey, appSecret, sessionToken, fetchImpl = fetch,
}) {
  const body = JSON.stringify({ sessionToken });
  const signed = signAppRequest(appSecret, appKey, body);
  const res = await fetchImpl(`${baseUrl}/app/v1/sessions/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...signed.headers },
    body,
  });
  if (!res.ok) throw new Error(`verify failed: HTTP ${res.status}`);
  return res.json();
}