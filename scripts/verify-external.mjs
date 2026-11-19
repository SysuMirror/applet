/**
 * 外部源接入验收（可重复运行）。
 *
 * 模拟第三方开发者：在自己的 origin 放一个只引入 SDK 的页面，走完
 * 创建应用 → 提交审核 → 发布 → 申请票据 → 跨源页面换会话 → 调用 /v1 → 刷新复用会话。
 *
 * 运行：node --no-warnings scripts/verify-external.mjs
 * 可选：MP_BASE（默认 http://localhost:8080）、MP_EXTERNAL_PORT（默认 8090）
 *
 * 说明：脚本会创建一个临时应用并在结束时删除；页面 origin 使用 localhost，
 * 以便平台的本地开发策略允许 http 与 CORS。
 */
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadConfig, ROOT } from '../src/config.js';
import { signJwt } from '../src/jwt.js';

process.loadEnvFile?.(path.join(ROOT, '.env'));
const base = (process.env.MP_BASE || 'http://localhost:8080').replace(/\/+$/, '');
const port = Number(process.env.MP_EXTERNAL_PORT || 8090);
const origin = `http://localhost:${port}`;
const suffix = Date.now().toString(36).slice(-6);
const appKey = `ext-verify-${suffix}`;
const appName = `外部源验收 ${suffix}`;
const devEmail = process.env.MP_VERIFY_DEV_EMAIL || 'demo@mp.local';
const devPassword = process.env.MP_VERIFY_DEV_PASSWORD || 'demo123456';
const adminEmail = process.env.MP_ADMIN_EMAIL || 'admin@mp.local';
const adminPassword = process.env.MP_ADMIN_PASSWORD || '';

const PLAIN = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>只引入 SDK 的页面</title></head>
<body>
<!-- 只加这一行，不写任何初始化代码 -->
<script src="${base}/sdk/mp-client.js"></script>
</body></html>`;

const PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>外部源验收</title></head>
<body style="font:14px/1.6 system-ui;padding:24px">
<div id="out">loading</div>
<script src="${base}/sdk/mp-client.js"></script>
<script>
(async function () {
  try {
    var session = await MP.ready;
    var prefs = await MP.prefs.get();
    document.getElementById('out').textContent =
      'OK user=' + session.userId + ' app=' + session.appKey +
      ' favorites=' + (prefs.favorites || []).length;
    window.__result = { ok: true, session: session, favorites: (prefs.favorites || []).length };
  } catch (err) {
    document.getElementById('out').textContent = 'ERR ' + err.message + ' ' + (err.code || '');
    window.__result = { ok: false, error: err.message, code: err.code || '', status: err.status || 0 };
  }
})();
</script></body></html>`;

function makeClient() {
  const jar = new Map();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const absorb = (res) => {
    for (const raw of res.headers.getSetCookie?.() || []) {
      const pair = raw.split(';')[0];
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  };
  return async function request(pathname, { method = 'GET', body } = {}) {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (jar.size) headers.cookie = cookie();
    const res = await fetch(`${base}${pathname}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    absorb(res);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`${method} ${pathname} → ${res.status} ${data?.code || ''} ${data?.message || ''}`);
    }
    return data;
  };
}

const dev = makeClient();
const admin = makeClient();
let server;
let browser;
let created = false;
const problems = [];

async function cleanup() {
  if (!created) return;
  try {
    const { app } = await dev(`/dev/v1/apps/${appKey}`);
    if (app.status === 'published') await dev(`/dev/v1/apps/${appKey}/unpublish`, { method: 'POST', body: {} });
    await dev(`/dev/v1/apps/${appKey}`, { method: 'DELETE' });
    console.log(`note: 已清理临时应用 ${appKey}`);
  } catch (err) {
    console.log(`note: 清理临时应用失败（不影响结论）：${err.message}`);
  }
}

try {
  // 1. 创建并发布一个外部托管应用
  await dev('/dev/v1/auth/login', { method: 'POST', body: { email: devEmail, password: devPassword } });
  const createdApp = await dev('/dev/v1/apps', {
    method: 'POST',
    body: {
      name: appName,
      appKey,
      description: '外部源接入验收临时应用',
      entryURL: `${origin}/`,
      allowedOrigins: [origin],
      scopes: ['profile:read', 'prefs:read', 'prefs:write'],
      visibility: 'logged_in',
    },
  });
  created = true;
  console.log('created:', createdApp.app.appKey);

  await dev(`/dev/v1/apps/${appKey}/submit`, {
    method: 'POST',
    body: {
      version: '1.0.0',
      changelog: '外部源验收',
      entryURL: `${origin}/`,
      allowedOrigins: [origin],
      scopes: ['profile:read', 'prefs:read', 'prefs:write'],
    },
  });
  await admin('/dev/v1/auth/login', { method: 'POST', body: { email: adminEmail, password: adminPassword } });
  await admin(`/admin/v1/apps/${appKey}/approve`, { method: 'POST', body: {} });
  await dev(`/dev/v1/apps/${appKey}/publish`, { method: 'POST', body: {} });
  console.log('published:', appKey);

  // 2. 在“开发者自己的 origin”上提供只引入 SDK 的页面
  server = http.createServer((req, res) => {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': origin,
    });
    res.end(String(req.url || '').startsWith('/plain') ? PLAIN : PAGE);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  // 3. 申请票据，用浏览器打开外部页面（跨源 SDK 自动换会话）
  const config = loadConfig();
  const token = signJwt({ sub: '561' }, config.mainJwtSecret, 600);
  const ticketRes = await fetch(`${base}/v1/launch-tickets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ appKey, deviceID: 'ext_verify', origin }),
  });
  const ticket = await ticketRes.json();
  if (!ticketRes.ok) throw new Error(`申请票据失败：${JSON.stringify(ticket)}`);

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('401')) problems.push(`console: ${m.text()}`);
  });

  await page.goto(ticket.launchURL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__result), null, { timeout: 10000 });
  const first = await page.evaluate(() => window.__result);
  if (!first.ok) throw new Error(`首次换会话失败：${first.error} ${first.code}`);
  if (first.session.appKey !== appKey) throw new Error(`会话 appKey 不匹配：${first.session.appKey}`);
  console.log('first load ok:', first.session.userId, first.session.appKey);

  // 4. 刷新页面：没有 ticket，靠 Cookie / X-MP-Session 复用会话
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__result), null, { timeout: 10000 });
  const second = await page.evaluate(() => window.__result);
  if (!second.ok) throw new Error(`刷新后复用会话失败：${second.error} ${second.code}`);
  console.log('reload ok:', second.session.appKey);

  // 5. “只加一行 script”是否就能自动换会话：页面不写任何初始化代码
  const plainTicketRes = await fetch(`${base}/v1/launch-tickets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ appKey, deviceID: 'ext_plain', origin }),
  });
  const plainTicket = await plainTicketRes.json();
  if (!plainTicketRes.ok) throw new Error(`申请票据失败：${JSON.stringify(plainTicket)}`);

  const plainPage = await ctx.newPage();
  plainPage.on('pageerror', (e) => problems.push(`plain pageerror: ${e.message}`));
  await plainPage.goto(`${origin}/plain?ticket=${encodeURIComponent(plainTicket.ticket)}`, { waitUntil: 'networkidle' });
  await plainPage.waitForTimeout(500);

  // 票据应已被 SDK 自动消费：再用同一个 ticket 换会话必须失败
  const reuse = await fetch(`${base}/v1/sessions/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ticket: plainTicket.ticket }),
  });
  if (reuse.ok) throw new Error('页面没有自动消费 ticket：仅引入 SDK 也应建立会话');

  const plain = await plainPage.evaluate(async () => {
    try {
      const s = await MP.ready;
      return { ok: true, appKey: s.appKey };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code || '' };
    }
  });
  if (!plain.ok) throw new Error(`只引入 SDK 的页面换会话失败：${plain.error} ${plain.code}`);
  console.log('plain page auto-exchange ok:', plain.appKey);

  await page.screenshot({ path: path.join(ROOT, 'screenshots', '28-external-source.png') });
  console.log('screenshot: 28-external-source');
} catch (err) {
  problems.push(err.message);
} finally {
  await browser?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  await cleanup();
}

if (problems.length) {
  console.error('\n外部源验收失败：');
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}
console.log('\n外部源验收通过：跨源 SDK 自动识别平台、票据换会话、刷新复用均正常');