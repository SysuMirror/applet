import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { loadConfig, ROOT } from '../src/config.js';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { signJwt } from '../src/jwt.js';
import { signInternalRequest, signAppRequest } from '../src/signature.js';

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  try { process.loadEnvFile(envFile); } catch { /* ignore */ }
}

const silent = { debug() {}, info() {}, warn() {}, error() {}, close() {} };
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-test-'));
process.env.MP_ADMIN_PASSWORD = 'TestAdmin!123';
process.env.MP_MINIO_ENABLED = '0';
const config = loadConfig({
  dataDir,
  dbName: process.env.MP_TEST_DB || 'ssemarket_mp_test',
  publicBase: 'http://localhost:8080',
  adminPassword: 'TestAdmin!123',
  redisUrl: '',
  mainJwksUrl: '',
  mainVerifyUrl: '',
  internalVerifyUrl: '',
});
config.requestLog = false;

let app;
let base;
let adminCookie = '';
let developerCookie = '';
let userToken = '';
const json = (body) => ({ 'Content-Type': 'application/json', ...(body ? {} : {}) });

async function request(pathname, { method = 'GET', body, headers = {}, cookie = '' } = {}) {
  const init = { method, headers: { ...headers }, redirect: 'manual' };
  if (cookie) init.headers.cookie = cookie;
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${base}${pathname}`, init);
  const setCookies = res.headers.getSetCookie?.() || [];
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json().catch(() => null) : await res.text();
  return { status: res.status, data, setCookies, headers: res.headers };
}

function pickCookie(setCookies, name) {
  const raw = setCookies.find((c) => c.startsWith(`${name}=`));
  return raw ? raw.split(';')[0] : '';
}

before(async () => {
  // 清空测试库，保证幂等
  const db = await openDb(config);
  const tables = await db.prepare(
    'SELECT table_name FROM information_schema.tables WHERE table_schema = ?',
  ).all(config.db.name);
  await db.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const row of tables) {
    const name = row.table_name || row.TABLE_NAME;
    await db.query(`TRUNCATE TABLE \`${name}\``);
  }
  await db.query('SET FOREIGN_KEY_CHECKS = 1');
  await db.close();

  app = await createApp(config, { seedData: true, logger: silent });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => {
  await app?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('health 与就绪检查', async () => {
  const health = await request('/healthz');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);
  const ready = await request('/readyz');
  assert.equal(ready.status, 200);
  assert.equal(ready.data.db, 'up');
});

test('管理员登录与概览', async () => {
  const login = await request('/dev/v1/auth/login', {
    method: 'POST',
    body: { email: 'admin@mp.local', password: 'TestAdmin!123' },
  });
  assert.equal(login.status, 200);
  assert.equal(login.data.developer.role, 'admin');
  adminCookie = pickCookie(login.setCookies, 'mp_dev');
  assert.match(adminCookie, /^mp_dev=/);

  const overview = await request('/admin/v1/overview', { cookie: adminCookie });
  assert.equal(overview.status, 200);
  assert.equal(overview.data.counts.apps, 7); // 6 官方 + 1 演示待审
  assert.equal(overview.data.counts.reviewing, 1);
  assert.equal(overview.data.pending.length, 1);
});

test('开发者注册 → 创建 → 提交 → 审核 → 发布', async () => {
  const email = `dev_${Date.now()}@test.local`;
  const register = await request('/dev/v1/auth/register', {
    method: 'POST',
    body: { email, password: 'Passw0rd!', displayName: '测试开发者', orgName: '测试团队' },
  });
  assert.equal(register.status, 201);
  developerCookie = pickCookie(register.setCookies, 'mp_dev');
  assert.ok(developerCookie);

  const created = await request('/dev/v1/apps', {
    method: 'POST',
    cookie: developerCookie,
    body: {
      name: '测试小程序',
      appKey: 'e2e-app',
      category: 'tool',
      description: '端到端测试应用',
      entryURL: 'http://localhost:8080/demo/app?app=e2e-app',
      allowedOrigins: ['http://localhost:8080'],
      scopes: ['profile:read', 'prefs:read', 'prefs:write'],
      visibility: 'public',
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.app.appKey, 'e2e-app');

  const submitted = await request('/dev/v1/apps/e2e-app/submit', {
    method: 'POST',
    cookie: developerCookie,
    body: {
      version: '1.0.0',
      changelog: '首个版本',
      entryURL: 'http://localhost:8080/demo/app?app=e2e-app',
      allowedOrigins: ['http://localhost:8080'],
      scopes: ['profile:read', 'prefs:read', 'prefs:write'],
    },
  });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.data.app.status, 'reviewing');

  const approved = await request('/admin/v1/apps/e2e-app/approve', {
    method: 'POST',
    cookie: adminCookie,
    body: { note: 'ok' },
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.data.app.status, 'approved');

  const published = await request('/dev/v1/apps/e2e-app/publish', {
    method: 'POST',
    cookie: developerCookie,
    body: {},
  });
  assert.equal(published.status, 200);
  assert.equal(published.data.app.status, 'published');

  const catalog = await request('/v1/apps');
  assert.equal(catalog.status, 200);
  assert.ok(catalog.data.items.some((item) => item.appKey === 'e2e-app'));

  const secret = await request('/dev/v1/apps/e2e-app/secret/reveal', {
    method: 'POST',
    cookie: developerCookie,
    body: {},
  });
  assert.equal(secret.status, 200);
  assert.ok(secret.data.secret.length >= 24);
});

test('平台托管内部源：上传 → 激活 → source token 访问', async () => {
  const detail = await request('/dev/v1/apps/e2e-app', { cookie: developerCookie });
  const original = { entryURL: detail.data.app.entryURL, allowedOrigins: detail.data.app.allowedOrigins };

  const build = await request('/dev/v1/apps/e2e-app/hosting/builds', {
    method: 'POST', cookie: adminCookie, body: {},
  });
  assert.equal(build.status, 201);

  const uploadUrl = `${base}/dev/v1/apps/e2e-app/hosting/builds/${build.data.buildId}/files?path=index.html`;
  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { cookie: adminCookie, 'content-type': 'text/html; charset=utf-8' },
    body: '<!doctype html><title>hosted</title><p>hosted ok</p>',
  });
  assert.equal(upload.status, 201);

  const activated = await request(`/dev/v1/apps/e2e-app/hosting/builds/${build.data.buildId}/activate`, {
    method: 'POST', cookie: adminCookie, body: {},
  });
  assert.equal(activated.status, 200);
  assert.equal(activated.data.mode, 'internal');
  assert.ok(activated.data.sourceToken.startsWith('src_'));

  const hostedUrl = new URL(activated.data.entryURL);
  const ok = await fetch(`${base}${hostedUrl.pathname}${hostedUrl.search}`);
  assert.equal(ok.status, 200);
  assert.ok((await ok.text()).includes('hosted ok'));

  const denied = await fetch(`${base}${hostedUrl.pathname}`);
  assert.equal(denied.status, 403);

  await request('/dev/v1/apps/e2e-app/hosting', { method: 'DELETE', cookie: adminCookie });
  await request('/admin/v1/apps/e2e-app', {
    method: 'PATCH',
    cookie: adminCookie,
    body: { entryURL: original.entryURL, allowedOrigins: original.allowedOrigins },
  });
});

test('启动票据一次性 / 会话 / 偏好 / 设备', async () => {
  userToken = signJwt({ sub: '9001' }, config.mainJwtSecret, 3600);
  const auth = { authorization: `Bearer ${userToken}` };

  const ticketRes = await request('/v1/launch-tickets', {
    method: 'POST',
    headers: auth,
    body: { appKey: 'e2e-app', deviceID: 'test-device', origin: 'http://localhost:8080' },
  });
  assert.equal(ticketRes.status, 201);
  assert.ok(ticketRes.data.launchURL.includes(ticketRes.data.ticket));

  const exchange = await request('/v1/sessions/exchange', {
    method: 'POST',
    body: { ticket: ticketRes.data.ticket },
    headers: { origin: 'http://localhost:8080' },
  });
  assert.equal(exchange.status, 200);
  assert.equal(exchange.data.session.appKey, 'e2e-app');
  assert.ok(exchange.data.sessionToken.startsWith('mps_'));
  const sessionCookie = pickCookie(exchange.setCookies, 'mp_session');
  assert.ok(sessionCookie);

  const replay = await request('/v1/sessions/exchange', {
    method: 'POST',
    body: { ticket: ticketRes.data.ticket },
  });
  assert.equal(replay.status, 401);
  assert.equal(replay.data.code, 'TICKET_USED');

  const me = await request('/v1/sessions/me', { cookie: sessionCookie });
  assert.equal(me.status, 200);
  assert.equal(me.data.session.userId, '9001');

  const putPrefs = await request('/v1/me/prefs', {
    method: 'PUT',
    cookie: sessionCookie,
    body: { recent: ['novel', 'e2e-app'], favorites: ['novel'] },
  });
  assert.equal(putPrefs.status, 200);
  assert.deepEqual(putPrefs.data.favorites.map((f) => f.appKey), ['novel']);
  assert.equal(putPrefs.data.recent[0].appKey, 'novel');

  const favoritesOnly = await request('/v1/me/prefs', {
    method: 'PUT',
    cookie: sessionCookie,
    body: { favorites: ['novel'] },
  });
  assert.deepEqual(favoritesOnly.data.recent.map((r) => r.appKey), ['novel', 'e2e-app']);

  const recentOnly = await request('/v1/me/prefs', {
    method: 'PUT',
    cookie: sessionCookie,
    body: { recent: ['e2e-app'] },
  });
  assert.deepEqual(recentOnly.data.favorites.map((f) => f.appKey), ['novel']);

  const device = await request('/v1/devices', {
    method: 'POST',
    headers: auth,
    body: { deviceID: 'device-a', platform: 'android', pushProvider: 'fcm', pushToken: 'token-abc' },
  });
  assert.equal(device.status, 201);
  assert.ok(device.data.device.pushToken.includes('*'));
});

test('内部事件签名 / 去重 / 订阅分发', async () => {
  const auth = { authorization: `Bearer ${userToken}` };
  const sub = await request('/v1/me/subscriptions', {
    method: 'PUT',
    headers: auth,
    body: { topics: [{ topic: 'new_posts', enabled: true, quietHours: null }] },
  });
  assert.equal(sub.status, 200);

  const payload = JSON.stringify({
    eventID: `evt_${Date.now()}`,
    postID: 7726,
    title: '测试新帖',
    partition: '主页',
    authorUserID: 561,
    dedupKey: `post:${Date.now()}`,
  });
  const signed = signInternalRequest(config.internalSecret, payload);
  const res = await fetch(`${base}/internal/v1/events/new-post`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...signed.headers },
    body: payload,
  });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.duplicate, false);
  assert.ok(body.notified >= 1);

  const poll = await request('/v1/events/new-posts', { headers: auth });
  assert.equal(poll.status, 200);
  assert.ok(poll.data.items.some((item) => item.title.includes('测试新帖')));

  const replay = await fetch(`${base}/internal/v1/events/new-post`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...signed.headers },
    body: payload,
  });
  assert.equal(replay.status, 401);
  assert.equal((await replay.json()).code, 'REPLAY_DETECTED');
});

test('第三方服务端签名校验会话', async () => {
  const reveal = await request('/dev/v1/apps/e2e-app/secret/reveal', {
    method: 'POST',
    cookie: developerCookie,
    body: {},
  });
  const appSecret = reveal.data.secret;

  const ticket = await request('/v1/launch-tickets', {
    method: 'POST',
    headers: { authorization: `Bearer ${userToken}` },
    body: { appKey: 'e2e-app', deviceID: 'device-b', origin: 'http://localhost:8080' },
  });
  const exchange = await request('/v1/sessions/exchange', {
    method: 'POST',
    body: { ticket: ticket.data.ticket },
    headers: { origin: 'http://localhost:8080' },
  });
  const sessionToken = pickCookie(exchange.setCookies, 'mp_session').split('=').slice(1).join('=');

  const body = JSON.stringify({ sessionToken });
  const signed = signAppRequest(appSecret, 'e2e-app', body);
  const res = await fetch(`${base}/app/v1/sessions/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...signed.headers },
    body,
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.valid, true);
  assert.equal(data.userId, '9001');
  assert.ok(data.scopes.includes('prefs:read'));
});

test('错误签名被拒绝', async () => {
  const payload = JSON.stringify({ eventID: 'evt_bad', title: 'bad' });
  const ts = Math.floor(Date.now() / 1000);
  const res = await fetch(`${base}/internal/v1/events/new-post`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-timestamp': String(ts),
      'x-internal-nonce': crypto.randomBytes(8).toString('hex'),
      'x-internal-signature': 'deadbeef',
    },
    body: payload,
  });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, 'INVALID_SIGNATURE');
});