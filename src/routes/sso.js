import { Router } from '../http.js';
import { badRequest, forbidden, unauthorized, ApiError } from '../errors.js';
import { issueDeveloperToken, setDeveloperCookie, hashPassword } from '../auth.js';
import { signJwt } from '../jwt.js';
import { writeAudit } from '../audit.js';
import { enforce } from '../rate-limit.js';
import { nowIso } from '../util.js';
import {
  SsoError, createPkce, signState, verifyState, safeNext, buildAuthorizeUrl,
  exchangeCode, fetchUserinfo, introspect, passwordVerify, sessionVerify, sessionRevoke,
  findOrCreateSsoDeveloper,
} from '../sso.js';

const router = new Router();
const STATE_COOKIE = 'mp_sso_state';

function errorRedirect(ctx, message, next = '') {
  const text = encodeURIComponent(String(message || '统一身份登录失败').slice(0, 180));
  // 官方小程序登录失败时回到小程序内置登录页，而不是主站登录页。
  const target = safeNext(next, '/#/login');
  const sep = target.includes('?') ? '&' : '?';
  ctx.redirect(`${ctx.config.publicBase}${target}${sep}sso_error=${text}`);
}

function rate(ctx, name, subject, capacity, windowSeconds = 60) {
  return enforce(ctx.services.limiter, { name, subject, capacity, windowSeconds });
}

router.get('/auth/sso/status', (ctx) => {
  const sso = ctx.config.sso;
  ctx.json({
    provider: 'UniSSO',
    enabled: Boolean(sso.enabled && sso.clientId && sso.clientSecret),
    m2m: Boolean(sso.m2mClientId && sso.m2mClientSecret),
    loginUrl: '/auth/sso/start',
  });
});

/**
 * 开始外部应用跳转授权。
 * 浏览器 → /auth/sso/start → SSO /authorize（登录/同意）→ /callback。
 */
router.get('/auth/sso/start', async (ctx) => {
  rate(ctx, 'sso-start', ctx.ip, 60);
  const sso = ctx.config.sso;
  if (!sso.enabled || !sso.clientId || !sso.clientSecret) {
    errorRedirect(ctx, '统一身份登录尚未配置', next);
    return;
  }
  const next = safeNext(ctx.query.get('next'));

  // 无感登录：浏览器已持有 .ssemarket.cn 的 UniSSO 共享会话时，直接建立本地会话
  if (sso.autoLogin) {
    for (const name of sso.sessionCookies) {
      const value = ctx.getCookie(name);
      if (!value) continue;
      try {
        const result = await sessionVerify(ctx.config, value);
        if (!result) continue;
        const developer = await findOrCreateSsoDeveloper(ctx.db, ctx.config, result.user, { hashPassword, nowIso });
        if (developer.status !== 'active') throw forbidden('ACCOUNT_SUSPENDED', '开发者账号已被停用');
        setDeveloperCookie(ctx, issueDeveloperToken(developer, ctx.config));
        if (result.ssoSession && result.cookieName && result.cookieDomain) {
          ctx.setCookie(result.cookieName, result.ssoSession, {
            maxAge: Number(result.maxAge) || 604800,
            domain: result.cookieDomain,
            sameSite: 'Lax',
            path: '/',
          });
        }
        ctx.services.metrics.inc('mp_sso_logins_total', { method: 'session' });
        ctx.redirect(`${ctx.config.publicBase}${next}`);
        return;
      } catch (err) {
        ctx.services.log?.warn('sso.session_verify_failed', {
          code: err?.code || 'SSO_SESSION_FAILED',
          requestId: ctx.requestId,
        });
      }
    }
  }

  const { verifier, challenge, state } = createPkce();
  const cookie = signState({ state, verifier, next, iat: Date.now() }, sso.stateSecret);
  ctx.setCookie(STATE_COOKIE, cookie, {
    maxAge: sso.stateTtl,
    sameSite: 'Lax',
    path: '/',
  });
  ctx.redirect(buildAuthorizeUrl(ctx.config, { state, challenge }));
});

/** SSO 回调：校验 state → code 换 token → userinfo → 本地开发者会话。 */
router.get('/callback', async (ctx) => {
  rate(ctx, 'sso-callback', ctx.ip, 60);
  const sso = ctx.config.sso;
  const cookie = ctx.getCookie(STATE_COOKIE);
  ctx.clearCookie(STATE_COOKIE, { path: '/' });

  const error = String(ctx.query.get('error') || '');
  if (error) {
    const message = error === 'access_denied' ? '你已取消统一身份授权' : (ctx.query.get('error_description') || '统一身份授权失败');
    errorRedirect(ctx, message, String(ctx.query.get('next') || ''));
    return;
  }
  if (!cookie) {
    errorRedirect(ctx, '登录状态已失效，请重新发起登录', String(ctx.query.get('next') || ''));
    return;
  }

  let statePayload;
  try {
    statePayload = verifyState(cookie, sso.stateSecret, sso.stateTtl);
  } catch (err) {
    errorRedirect(ctx, err.message || '登录状态校验失败', String(ctx.query.get('next') || ''));
    return;
  }
  const state = String(ctx.query.get('state') || '');
  if (!state || state !== statePayload.state) {
    errorRedirect(ctx, '登录状态不匹配，请重新发起登录', String(statePayload?.next || ''));
    return;
  }
  const code = String(ctx.query.get('code') || '');
  if (!code) {
    errorRedirect(ctx, '统一身份未返回授权码', String(statePayload?.next || ''));
    return;
  }

  try {
    const token = await exchangeCode(ctx.config, {
      code,
      verifier: statePayload.verifier,
      redirectUri: sso.redirectUri,
    });
    const user = await fetchUserinfo(ctx.config, token.access_token);
    const developer = await findOrCreateSsoDeveloper(ctx.db, ctx.config, user, { hashPassword, nowIso });
    if (developer.status !== 'active') throw forbidden('ACCOUNT_SUSPENDED', '开发者账号已被停用');
    const devToken = issueDeveloperToken(developer, ctx.config);
    setDeveloperCookie(ctx, devToken);
    await writeAudit(ctx.db, {
      actorType: 'developer',
      actorId: String(developer.id),
      action: 'sso.login',
      targetType: 'developer',
      targetKey: developer.email,
      after: { sub: user.sub || user.sso_sub, provider: 'unisso' },
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
    ctx.services.metrics.inc('mp_sso_logins_total', { method: 'oauth' });
    ctx.redirect(`${ctx.config.publicBase}${statePayload.next || '/#/dashboard'}`);
  } catch (err) {
    ctx.services.log?.warn('sso.callback_failed', {
      code: err?.code || 'SSO_FAILED',
      message: String(err?.message || err).slice(0, 200),
      requestId: ctx.requestId,
    });
    errorRedirect(ctx, err instanceof SsoError || err instanceof ApiError
      ? err.message
      : '统一身份登录失败，请稍后再试', String(statePayload?.next || ''));
  }
});

/**
 * 无感登录（M2M，仅内接应用 + 管理员开启 m2m 时可用）。
 * 若配置了内接 client_id/secret，可把邮箱密码交给 SSO 校验并同步 SSO 会话 Cookie。
 */
router.post('/auth/sso/m2m', async (ctx) => {
  const sso = ctx.config.sso;
  if (!sso.m2mClientId || !sso.m2mClientSecret) {
    throw new ApiError(403, 'M2M_DISABLED', '无感登录需要平台管理员开通内接应用（M2M）');
  }
  const body = await ctx.body();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) throw badRequest('INVALID_CREDENTIALS', '请填写邮箱和密码');
  rate(ctx, 'sso-m2m-ip', ctx.ip, 30, 900);
  rate(ctx, 'sso-m2m-email', email, 10, 900);

  const result = await passwordVerify(ctx.config, { email, password });
  const developer = await findOrCreateSsoDeveloper(ctx.db, ctx.config, result.user, { hashPassword, nowIso });
  if (developer.status !== 'active') throw forbidden('ACCOUNT_SUSPENDED', '开发者账号已被停用');
  setDeveloperCookie(ctx, issueDeveloperToken(developer, ctx.config));

  if (result.ssoSession && result.cookieName && result.cookieDomain) {
    ctx.setCookie(result.cookieName, result.ssoSession, {
      maxAge: Number(result.maxAge) || 86400,
      domain: result.cookieDomain,
      sameSite: 'Lax',
      path: '/',
    });
  }
  await writeAudit(ctx.db, {
    actorType: 'developer',
    actorId: String(developer.id),
    action: 'sso.m2m_login',
    targetType: 'developer',
    targetKey: developer.email,
    ip: ctx.ip,
    requestId: ctx.requestId,
  });
  ctx.services.metrics.inc('mp_sso_logins_total', { method: 'm2m' });
  ctx.json({ developer: publicDeveloper(developer) });
});

router.post('/auth/sso/logout', async (ctx) => {
  const sso = ctx.config.sso;
  for (const name of sso.sessionCookies) {
    const value = ctx.getCookie(name);
    if (value) {
      try { await sessionRevoke(ctx.config, value); } catch { /* best effort */ }
    }
    ctx.clearCookie(name, { path: '/' });
    ctx.clearCookie(name, { path: '/', domain: '.ssemarket.cn' });
  }
  ctx.clearCookie('mp_sso_state', { path: '/' });
  ctx.json({ ok: true });
});

/**
 * App 侧身份验证：用 SSO access_token 换平台 access token。
 * 平台 token 使用本地主站 JWT 密钥签名，可直接用于 /v1 接口。
 */
router.post('/auth/sso/verify', async (ctx) => {
  rate(ctx, 'sso-verify', ctx.ip, 60);
  const body = await ctx.body();
  const accessToken = String(body.accessToken || body.token || '').trim();
  if (!accessToken) throw badRequest('TOKEN_REQUIRED', '缺少统一身份 access_token');

  const introspected = await introspect(ctx.config, accessToken);
  if (!introspected?.active) throw unauthorized('INVALID_TOKEN', '统一身份 token 无效或已过期');
  const user = await fetchUserinfo(ctx.config, accessToken);
  const userId = String(user.sub || user.sso_sub);
  const ttl = ctx.config.sso.appTokenTtl;
  const platformToken = signJwt({
    sub: userId,
    name: user.name || user.preferred_username || '',
    email: user.email || '',
    sso: true,
    scope: 'app',
  }, ctx.config.mainJwtSecret, ttl);
  ctx.json({
    accessToken: platformToken,
    tokenType: 'Bearer',
    expiresIn: ttl,
    user: {
      userId,
      name: user.name || user.preferred_username || '',
      email: user.email || '',
      avatar: user.picture || '',
      sseSub: user.sse_sub || '',
    },
  });
});

function publicDeveloper(row) {
  return {
    id: Number(row.id),
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    authSource: row.auth_source,
    authSourceLabel: row.auth_source === 'sso' ? '学校统一身份' : '邮箱密码',
  };
}

export default router;