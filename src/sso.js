import crypto from 'node:crypto';

/**
 * UniSSO 客户端（外部应用：OAuth2 授权码 + PKCE S256）。
 * client_secret 只存在服务端环境变量中，不进入浏览器。
 */
export class SsoError extends Error {
  constructor(code, message, status = 502, details) {
    super(message || code);
    this.name = 'SsoError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

export function createPkce() {
  const verifier = crypto.randomBytes(48).toString('base64url'); // 64 chars, [A-Za-z0-9-_]
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge, state };
}

export function signState(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyState(value, secret, ttlSeconds = 600) {
  const raw = String(value || '');
  const idx = raw.lastIndexOf('.');
  if (idx <= 0) throw new SsoError('INVALID_STATE', '登录状态校验失败', 400);
  const body = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  const expected = crypto.createHmac('sha256', secret).update(body).digest();
  const actual = Buffer.from(sig, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new SsoError('INVALID_STATE', '登录状态校验失败', 400);
  }
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch {
    throw new SsoError('INVALID_STATE', '登录状态校验失败', 400);
  }
  const iat = Number(payload.iat);
  if (!Number.isFinite(iat) || Date.now() - iat > ttlSeconds * 1000) {
    throw new SsoError('STATE_EXPIRED', '登录状态已过期，请重试', 400);
  }
  return payload;
}

export function safeNext(next, fallback = '/#/dashboard') {
  const value = String(next || '').trim();
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback;
  // 管理后台是非 hash 路由，允许 SSO 直接回跳
  if (value === '/admin' || value.startsWith('/admin?')) return value;
  if (value.startsWith('/#')) return value;
  // 官方小程序内置登录页/页面：允许 SSO 登录后直接回到 /mp/<appKey>/...
  if (value.startsWith('/mp/')) return value;
  if (value === '/') return '/#/';
  return `/#${value}`;
}

export function buildAuthorizeUrl(config, { state, challenge, redirectUri, scopes }) {
  const url = new URL(`${config.sso.base}/authorize`);
  url.searchParams.set('client_id', config.sso.clientId);
  url.searchParams.set('redirect_uri', redirectUri || config.sso.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes || config.sso.scopes);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

async function request(config, url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.sso.timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    throw new SsoError('SSO_UNAVAILABLE', '统一身份服务暂时不可用，请稍后再试', 503);
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(res) {
  try { return await res.json(); } catch { return null; }
}

export async function exchangeCode(config, { code, verifier, redirectUri }) {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri || config.sso.redirectUri,
    client_id: config.sso.clientId,
    client_secret: config.sso.clientSecret,
    code_verifier: verifier,
  });
  const res = await request(config, `${config.sso.base}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form.toString(),
  });
  const json = await readJson(res);
  if (!res.ok) {
    const codeName = json?.error || `http_${res.status}`;
    throw new SsoError('TOKEN_EXCHANGE_FAILED', json?.error_description || `换取 token 失败（${codeName}）`, 502, { status: res.status, code: codeName });
  }
  if (!json?.access_token) throw new SsoError('TOKEN_EXCHANGE_FAILED', '统一身份未返回 access_token', 502);
  return json;
}

export async function fetchUserinfo(config, accessToken) {
  const res = await request(config, `${config.sso.base}/api/oauth/userinfo`, {
    headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
  });
  const json = await readJson(res);
  if (!res.ok) {
    throw new SsoError('USERINFO_FAILED', '获取统一身份用户信息失败', 401, { status: res.status, code: json?.error });
  }
  const user = json?.user || json?.data?.user || json?.data || json;
  if (!user || (!user.sub && !user.sso_sub)) {
    throw new SsoError('USERINFO_FAILED', '统一身份未返回用户标识', 502);
  }
  return user;
}

export async function introspect(config, token) {
  const form = new URLSearchParams({
    token,
    client_id: config.sso.clientId,
    client_secret: config.sso.clientSecret,
  });
  const res = await request(config, `${config.sso.base}/api/oauth/introspect`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form.toString(),
  });
  const json = await readJson(res);
  if (!res.ok) {
    throw new SsoError('INTROSPECT_FAILED', '统一身份 token 校验失败', 401, { status: res.status });
  }
  return json;
}

export async function sessionVerify(config, sessionValue) {
  const res = await request(config, `${config.sso.base}/api/oauth/session/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: config.sso.clientId,
      client_secret: config.sso.clientSecret,
      session: sessionValue,
    }),
  });
  const json = await readJson(res);
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) return null;
    throw new SsoError('SESSION_VERIFY_FAILED', '统一身份会话校验失败', res.status, { code: json?.error });
  }
  const user = json?.user || json?.data?.user || json?.data || json;
  if (!user || (!user.sub && !user.sso_sub)) return null;
  return {
    user,
    ssoSession: json?.sso_session || json?.data?.sso_session || '',
    cookieName: json?.sso_cookie_name || json?.data?.sso_cookie_name || '',
    cookieDomain: json?.sso_cookie_domain || json?.data?.sso_cookie_domain || '',
    maxAge: json?.sso_max_age || json?.data?.sso_max_age || 604800,
  };
}

export async function sessionRevoke(config, sessionValue) {
  const res = await request(config, `${config.sso.base}/api/oauth/session/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: config.sso.clientId,
      client_secret: config.sso.clientSecret,
      session: sessionValue,
    }),
  });
  return res.ok;
}

export async function passwordVerify(config, { email, password }) {
  if (!config.sso.m2mClientId || !config.sso.m2mClientSecret) {
    throw new SsoError('M2M_DISABLED', '当前应用未配置无感登录（需要管理员开通内接应用）', 403);
  }
  const res = await request(config, `${config.sso.base}/api/oauth/password/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: config.sso.m2mClientId,
      client_secret: config.sso.m2mClientSecret,
      email,
      password,
    }),
  });
  const json = await readJson(res);
  if (!res.ok) {
    const codeName = json?.error || `http_${res.status}`;
    if (res.status === 401) throw new SsoError('INVALID_CREDENTIALS', '邮箱或密码错误', 401);
    if (res.status === 429) throw new SsoError('TOO_MANY_ATTEMPTS', '尝试次数过多，请 15 分钟后再试', 429);
    if (res.status === 403) throw new SsoError('M2M_FORBIDDEN', '统一身份无感登录未开通（内接应用 + 无感开关）', 403);
    throw new SsoError('M2M_FAILED', '统一身份登录失败', 502, { status: res.status, code: codeName });
  }
  const user = json?.user || json?.data?.user || json?.data || json;
  if (!user || (!user.sub && !user.sso_sub)) {
    throw new SsoError('M2M_FAILED', '统一身份未返回用户标识', 502);
  }
  return {
    user,
    ssoSession: json?.sso_session || json?.data?.sso_session || '',
    cookieName: json?.sso_cookie_name || json?.data?.sso_cookie_name || '',
    cookieDomain: json?.sso_cookie_domain || json?.data?.sso_cookie_domain || '',
    maxAge: json?.sso_max_age || json?.data?.sso_max_age || 86400,
  };
}

/** 统一身份用户 → 本地开发者账号（首次登录自动创建，已有邮箱账号自动绑定）。 */
export async function findOrCreateSsoDeveloper(db, config, user, { hashPassword, nowIso }) {
  const ssoSub = String(user.sub || user.sso_sub || '').trim();
  if (!ssoSub) throw new SsoError('USERINFO_FAILED', '统一身份缺少 sub', 502);
  const email = String(user.email || '').trim().toLowerCase();
  const name = String(user.name || user.preferred_username || (email ? email.split('@')[0] : '开发者')).slice(0, 64);
  let avatarUrl = String(user.picture || user.avatar || '').trim().slice(0, 512);
  if (avatarUrl.startsWith('//')) avatarUrl = `https:${avatarUrl}`;
  else if (avatarUrl.startsWith('/')) avatarUrl = `${config.sso.base}${avatarUrl}`;
  const ssoEmail = email || `${ssoSub}@sso.local`;
  const now = nowIso();

  let developer = await db.prepare('SELECT * FROM mp_developers WHERE sso_sub = ?').get(ssoSub);
  if (!developer && email) {
    developer = await db.prepare('SELECT * FROM mp_developers WHERE email = ?').get(email);
    if (developer && developer.sso_sub && developer.sso_sub !== ssoSub) {
      throw new SsoError('EMAIL_CONFLICT', '该邮箱已绑定其他统一身份账号', 409);
    }
  }

  const sseSub = String(user.sse_sub || user.sseSub || '').trim();
  const isAdmin = config.sso.adminEmails.includes(email)
    || (sseSub && config.sso.adminIds.includes(sseSub))
    || config.sso.adminIds.includes(String(user.sub || ''));
  const role = isAdmin ? 'admin' : null;
  if (developer) {
    await db.prepare(`
      UPDATE mp_developers SET sso_sub = ?, auth_source = 'sso',
        avatar_url = COALESCE(NULLIF(?, ''), avatar_url),
        display_name = CASE WHEN display_name = '' THEN ? ELSE display_name END,
        email_verified = 1, last_login_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      ssoSub, avatarUrl, name, now, now, Number(developer.id),
    );
    if (role === 'admin' && developer.role !== 'admin') {
      await db.prepare("UPDATE mp_developers SET role = 'admin', updated_at = ? WHERE id = ?")
        .run(now, Number(developer.id));
    }
  } else {
    const passwordHash = hashPassword(crypto.randomBytes(32).toString('hex'));
    const info = await db.prepare(`
      INSERT INTO mp_developers
        (email, password_hash, display_name, org_name, phone, role, status, token_version,
         email_verified, sso_sub, auth_source, avatar_url, created_at, updated_at, last_login_at)
      VALUES (?, ?, ?, '', '', ?, 'active', 0, 1, ?, 'sso', ?, ?, ?, ?)
    `).run(
      ssoEmail, passwordHash, name, role || 'developer', ssoSub, avatarUrl, now, now, now,
    );
    developer = await db.prepare('SELECT * FROM mp_developers WHERE id = ?').get(info.lastInsertRowid);
  }

  return db.prepare('SELECT * FROM mp_developers WHERE id = ?').get(developer.id);
}