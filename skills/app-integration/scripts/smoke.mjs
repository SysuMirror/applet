#!/usr/bin/env node
/**
 * 接入冒烟测试：
 *   MP_BASE=http://localhost:8080 MP_TOKEN=<main access token> node scripts/smoke.mjs
 * 可选：MP_APP_KEY=novel MP_ORIGIN=http://localhost:8080
 */
import crypto from 'node:crypto';

const base = (process.env.MP_BASE || 'http://localhost:8080').replace(/\/+$/, '');
const token = process.env.MP_TOKEN || '';
const wantedApp = process.env.MP_APP_KEY || '';
const origin = process.env.MP_ORIGIN || (base.startsWith('http://localhost') ? base : '');

if (!token) {
  console.error('缺少 MP_TOKEN（主站 access token）');
  process.exit(2);
}

let cookie = '';
async function call(path, { method = 'GET', body, headers = {}, useToken = true } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(useToken ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const raw of res.headers.getSetCookie?.() || []) {
    const [pair] = raw.split(';');
    const name = pair.split('=')[0];
    cookie = cookie.split('; ').filter((c) => c && !c.startsWith(`${name}=`)).concat(pair).join('; ');
  }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    throw Object.assign(new Error(`${path} → HTTP ${res.status}`), { status: res.status, data });
  }
  return data;
}

function step(label, value) {
  console.log(`✔ ${label}${value ? `：${value}` : ''}`);
}

try {
  const catalog = await call('/v1/apps?limit=50');
  step('目录', `${catalog.items.length} 个小程序`);
  const app = wantedApp
    ? catalog.items.find((item) => item.appKey === wantedApp)
    : catalog.items[0];
  if (!app) throw new Error(`目录中找不到小程序 ${wantedApp || '（目录为空）'}`);
  step('目标小程序', `${app.name} (${app.appKey})`);

  const deviceID = `smoke_${crypto.randomBytes(4).toString('hex')}`;
  const ticket = await call('/v1/launch-tickets', {
    method: 'POST',
    body: { appKey: app.appKey, deviceID, ...(origin ? { origin } : {}) },
  });
  step('启动票据', `${ticket.ticket.slice(0, 12)}…（${ticket.expiresIn}s）`);

  const exchange = await call('/v1/sessions/exchange', {
    method: 'POST',
    useToken: false,
    body: { ticket: ticket.ticket },
    headers: origin ? { Origin: origin } : {},
  });
  step('会话', `user=${exchange.session.userId} app=${exchange.session.appKey} scopes=${exchange.session.scopes.join(',')}`);

  const me = await call('/v1/sessions/me', { useToken: false });
  step('会话校验', `expiresAt=${me.session.expiresAt}`);

  const prefs = await call('/v1/me/prefs', { useToken: false });
  step('偏好', `recent=${prefs.recent.length} favorites=${prefs.favorites.length}`);

  const replay = await fetch(`${base}/v1/sessions/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket: ticket.ticket }),
  });
  if (replay.status !== 401) throw new Error('票据重放未被拒绝');
  step('票据一次性', '重放返回 401');

  console.log('\n全部通过 ✅');
} catch (err) {
  console.error(`\n✘ ${err.message}`);
  if (err.data) console.error(JSON.stringify(err.data, null, 2));
  process.exit(1);
}