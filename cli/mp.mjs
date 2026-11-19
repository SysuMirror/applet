#!/usr/bin/env node
/**
 * 集市小程序平台 CLI
 * 无第三方依赖，Node 22+。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const CONFIG_PATH = process.env.MP_CLI_CONFIG || path.join(os.homedir(), '.mp-cli.json');
const DEFAULT_BASE = 'https://applet.ssemarket.cn';
const VERSION = '1.0.0';

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}

function saveConfig(next) {
  const data = { ...loadConfig(), ...next };
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(CONFIG_PATH, 0o600); } catch { /* ignore */ }
  return data;
}

function clearConfig() {
  try { fs.unlinkSync(CONFIG_PATH); } catch { /* ignore */ }
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const eq = arg.indexOf('=');
    if (eq > 0) { flags[arg.slice(2, eq)] = arg.slice(eq + 1); continue; }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { flags[key] = next; i += 1; }
    else flags[key] = true;
  }
  return { positional, flags };
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const config = loadConfig();
const BASE = String(flags.base || process.env.MP_BASE || config.base || DEFAULT_BASE).replace(/\/+$/, '');
const TOKEN = String(flags.token || process.env.MP_TOKEN || config.token || '');

function need(value, message) {
  if (value === undefined || value === null || value === '') {
    console.error(`缺少参数：${message}`);
    process.exit(2);
  }
  return value;
}

function listArg(value) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  return String(value).split(',').map((v) => v.trim()).filter(Boolean);
}

function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

function table(rows, columns) {
  if (!rows.length) { console.log('（空）'); return; }
  const widths = columns.map((c) => Math.max(c.title.length, ...rows.map((r) => String(c.get(r) ?? '').length)));
  const line = (cells) => cells.map((cell, i) => {
    const text = String(cell ?? '');
    return text + ' '.repeat(Math.max(0, widths[i] - [...text].length));
  }).join('  ');
  console.log(line(columns.map((c) => c.title)));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(columns.map((c) => c.get(row))));
}

async function request(pathname, { method = 'GET', body, token = TOKEN, base = BASE, allowAnonymous = false } = {}) {
  if (!token && !allowAnonymous) {
    console.error(`未登录。先执行：mp login --email <邮箱> --password <密码> --base ${base}`);
    process.exit(2);
  }
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${base}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new Error(`无法连接 ${base}：${err.message}`);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (!res.ok) {
    const error = new Error(`${data?.code || res.status} ${data?.message || '请求失败'}${data?.requestId ? `（requestId: ${data.requestId}）` : ''}`);
    error.status = res.status;
    error.code = data?.code;
    error.data = data;
    throw error;
  }
  return data;
}

function bumpVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || '1.0.0'));
  if (!m) return '1.0.0';
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

async function whoAmI({ admin = false } = {}) {
  const data = await request('/dev/v1/auth/me');
  if (admin) await request('/admin/v1/me');
  return data.developer;
}

// ── 认证 ────────────────────────────────────────────────────────────────
async function cmdLogin() {
  const email = need(flags.email || config.email, '--email');
  const password = need(flags.password, '--password');
  const data = await request('/dev/v1/auth/login', {
    method: 'POST',
    body: { email, password },
    token: '',
    allowAnonymous: true,
  });
  let role = data.developer.role;
  if (flags.admin) {
    await request('/admin/v1/me', { token: data.token, base: BASE });
    role = 'admin';
  }
  saveConfig({ base: BASE, token: data.token, email, role, savedAt: new Date().toISOString() });
  console.log(`已登录：${data.developer.displayName || data.developer.email}（${role}）`);
  console.log(`配置：${CONFIG_PATH}`);
}

async function cmdRegister() {
  const email = need(flags.email, '--email');
  const password = need(flags.password, '--password');
  const displayName = need(flags.name || flags['display-name'], '--name');
  const data = await request('/dev/v1/auth/register', {
    method: 'POST',
    body: {
      email,
      password,
      displayName,
      orgName: flags.org || '',
    },
    token: '',
    allowAnonymous: true,
  });
  saveConfig({ base: BASE, token: data.token, email, role: data.developer.role, savedAt: new Date().toISOString() });
  console.log(`注册成功：${data.developer.email}`);
  console.log(`后续创建应用：mp apps create --name "我的小程序" --entry https://mp-app.example.com/my-app --origins https://mp-app.example.com`);
}

async function cmdWhoami() {
  const who = await whoAmI({ admin: Boolean(flags.admin) });
  console.log(`${who.displayName || '—'} <${who.email}>`);
  console.log(`角色：${who.role}  登录方式：${who.authSourceLabel || who.authSource || 'password'}`);
  console.log(`平台：${BASE}`);
}

function cmdLogout() {
  clearConfig();
  console.log('已清除本地 CLI 登录信息');
}

// ── 应用 ────────────────────────────────────────────────────────────────
function appColumns() {
  return [
    { title: 'APPKEY', get: (a) => a.appKey },
    { title: '名称', get: (a) => a.name },
    { title: '状态', get: (a) => a.status },
    { title: '版本', get: (a) => a.version },
    { title: '分类', get: (a) => a.category },
    { title: '入口', get: (a) => a.entryURL || '—' },
  ];
}

async function cmdApps() {
  const sub = positional[1] || 'list';
  const key = positional[2];
  if (sub === 'list') {
    const data = await request('/dev/v1/apps');
    if (flags.json) return printJson(data);
    table(data.items, appColumns());
    return;
  }
  if (sub === 'get') {
    const data = await request(`/dev/v1/apps/${encodeURIComponent(need(key, 'appKey'))}`);
    if (flags.json) return printJson(data);
    const app = data.app;
    console.log(`${app.name}（${app.appKey}）  ${app.status}  v${app.version}`);
    console.log(`入口：${app.entryURL || '—'}`);
    console.log(`origin：${(app.allowedOrigins || []).join(', ') || '—'}`);
    console.log(`scopes：${(app.scopes || []).join(', ') || '—'}`);
    console.log(`可见：${app.visibility}`);
    console.log(`版本：${(app.versions || []).map((v) => `${v.version}:${v.status}`).join(', ') || '—'}`);
    return;
  }
  if (sub === 'create') {
    const name = need(flags.name, '--name');
    const body = {
      name,
      category: flags.category || 'content',
      description: flags.description || '',
      entryURL: flags.entry || '',
      allowedOrigins: listArg(flags.origins) || [],
      scopes: listArg(flags.scopes) || ['profile:read', 'prefs:read', 'prefs:write'],
      visibility: flags.visibility || 'logged_in',
      icon: flags.icon || '',
      webhookUrl: flags.webhook || '',
    };
    if (flags.key) body.appKey = String(flags.key).toLowerCase();
    const data = await request('/dev/v1/apps', { method: 'POST', body });
    console.log(`已创建：${data.app.appKey}（${data.app.name}）`);
    console.log('下一步：mp apps get ' + data.app.appKey + ' / mp apps submit ' + data.app.appKey + ' --changelog "..."');
    return;
  }
  if (sub === 'update') {
    const appKey = need(key, 'appKey');
    const body = {};
    if (flags.name !== undefined) body.name = flags.name;
    if (flags.description !== undefined) body.description = flags.description;
    if (flags.category !== undefined) body.category = flags.category;
    if (flags.entry !== undefined) body.entryURL = flags.entry;
    if (flags.origins !== undefined) body.allowedOrigins = listArg(flags.origins);
    if (flags.scopes !== undefined) body.scopes = listArg(flags.scopes);
    if (flags.visibility !== undefined) body.visibility = flags.visibility;
    if (flags.icon !== undefined) body.icon = flags.icon;
    if (flags.webhook !== undefined) body.webhookUrl = flags.webhook;
    if (!Object.keys(body).length) throw new Error('没有需要更新的字段');
    const data = await request(`/dev/v1/apps/${encodeURIComponent(appKey)}`, { method: 'PATCH', body });
    console.log(`已更新：${data.app.appKey}`);
    return;
  }
  if (sub === 'delete') {
    const appKey = need(key, 'appKey');
    if (!flags.yes) throw new Error('确认删除请加 --yes');
    await request(`/dev/v1/apps/${encodeURIComponent(appKey)}`, { method: 'DELETE' });
    console.log(`已删除：${appKey}`);
    return;
  }
  if (sub === 'versions') {
    const appKey = need(key, 'appKey');
    const data = await request(`/dev/v1/apps/${encodeURIComponent(appKey)}/versions`);
    table(data.items, [
      { title: '版本', get: (v) => v.version },
      { title: '状态', get: (v) => v.status },
      { title: '说明', get: (v) => (v.changelog || '').slice(0, 36) },
      { title: '提交时间', get: (v) => v.submittedAt || '—' },
    ]);
    return;
  }
  if (sub === 'submit') {
    const appKey = need(key, 'appKey');
    const detail = await request(`/dev/v1/apps/${encodeURIComponent(appKey)}`);
    const app = detail.app;
    const version = String(flags.version || bumpVersion(app.version));
    const changelog = need(flags.changelog || flags.message, '--changelog');
    const body = {
      version,
      changelog,
      entryURL: flags.entry || app.entryURL,
      allowedOrigins: listArg(flags.origins) || app.allowedOrigins,
      scopes: listArg(flags.scopes) || app.scopes,
    };
    const data = await request(`/dev/v1/apps/${encodeURIComponent(appKey)}/submit`, { method: 'POST', body });
    console.log(`已提交审核：${data.version.version}（${data.app.status}）`);
    console.log('等待管理员在 /admin 审核，或由管理员执行：mp admin approve ' + appKey);
    return;
  }
  if (sub === 'publish') {
    const appKey = need(key, 'appKey');
    const data = await request(`/dev/v1/apps/${encodeURIComponent(appKey)}/publish`, { method: 'POST', body: {} });
    console.log(`已发布：${data.app.appKey} v${data.version?.version || ''}`);
    return;
  }
  if (sub === 'unpublish') {
    const appKey = need(key, 'appKey');
    await request(`/dev/v1/apps/${encodeURIComponent(appKey)}/unpublish`, { method: 'POST', body: {} });
    console.log(`已下架：${appKey}`);
    return;
  }
  if (sub === 'stats') {
    const appKey = need(key, 'appKey');
    const days = Number(flags.days) || 14;
    const data = await request(`/dev/v1/apps/${encodeURIComponent(appKey)}/stats?days=${days}`);
    table(data.items, [
      { title: '日期', get: (r) => r.date },
      { title: '调用', get: (r) => r.calls },
      { title: '用户', get: (r) => r.users },
    ]);
    return;
  }
  if (sub === 'secret') {
    const action = positional[3] || 'reveal';
    const appKey = need(key, 'appKey');
    const data = await request(`/dev/v1/apps/${encodeURIComponent(appKey)}/secret/${action}`, { method: 'POST', body: {} });
    console.log(`AppKey：${data.appKey}`);
    console.log(`AppSecret：${data.secret}`);
    console.log('仅保存在服务端，不要提交到仓库或放入前端。');
    return;
  }
  if (sub === 'check' || sub === 'deploy') {
    const appKey = need(key, 'appKey');
    const detail = await request(`/dev/v1/apps/${encodeURIComponent(appKey)}`);
    const app = detail.app;
    const url = String(flags.url || app.entryURL || '');
    if (!url) throw new Error('缺少 --url，或应用尚未配置 entryURL');
    const result = await probeUrl(url);
    console.log(`入口：${url}`);
    console.log(`HTTP ${result.status}  ${result.contentType || ''}  ${result.ms}ms`);
    console.log(`最终地址：${result.finalUrl}`);
    console.log(`origin：${result.origin}`);
    const origins = app.allowedOrigins || [];
    if (!origins.includes(result.origin)) {
      console.log(`⚠ origin 未在 allowedOrigins 内：${origins.join(', ') || '（空）'}`);
    }
    if (!result.ok) {
      console.log('⚠ 入口不可用：请先部署页面，确保 HTTPS 可访问');
      process.exitCode = 1;
      return;
    }
    if (sub === 'check') return;

    const nextOrigins = flags.replaceOrigins
      ? [result.origin]
      : [...new Set([...origins, result.origin])];
    if (flags['dry-run']) {
      console.log('dry-run：将更新 entryURL / allowedOrigins：');
      console.log(JSON.stringify({ entryURL: result.finalUrl, allowedOrigins: nextOrigins }, null, 2));
      return;
    }
    if (app.status === 'reviewing') throw new Error('应用审核中，不能修改入口；请等待审核结果');
    const updated = await request(`/dev/v1/apps/${encodeURIComponent(appKey)}`, {
      method: 'PATCH',
      body: { entryURL: result.finalUrl, allowedOrigins: nextOrigins },
    });
    console.log(`已绑定入口：${updated.app.entryURL}`);
    console.log(`allowedOrigins：${updated.app.allowedOrigins.join(', ')}`);
    console.log(`下一步：mp apps submit ${appKey} --version ${bumpVersion(app.version)} --changelog "切换真实页面"`);
    return;
  }
  throw new Error(`未知子命令：apps ${sub}`);
}

async function probeUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error(`不是合法 URL：${rawUrl}`); }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('入口必须是 HTTPS（本地开发允许 http://localhost）');
  }
  const started = Date.now();
  let res;
  try {
    res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    return { ok: false, status: 0, contentType: '', ms: Date.now() - started, finalUrl: url.toString(), origin: url.origin, error: err.message };
  }
  const finalUrl = res.url || url.toString();
  return {
    ok: res.status >= 200 && res.status < 400,
    status: res.status,
    contentType: res.headers.get('content-type') || '',
    ms: Date.now() - started,
    finalUrl,
    origin: new URL(finalUrl).origin,
  };
}

// ── 管理端 ──────────────────────────────────────────────────────────────
async function ensureAdmin() {
  await request('/admin/v1/me');
}

async function cmdAdmin() {
  const sub = positional[1] || 'queue';
  await ensureAdmin();
  if (sub === 'overview') {
    const data = await request('/admin/v1/overview');
    printJson(data);
    return;
  }
  if (sub === 'queue') {
    const data = await request('/admin/v1/overview');
    table(data.pending || [], [
      { title: 'APPKEY', get: (p) => p.appKey },
      { title: '名称', get: (p) => p.name },
      { title: '版本', get: (p) => p.version },
      { title: '说明', get: (p) => (p.changelog || '').slice(0, 40) },
      { title: '提交时间', get: (p) => p.submittedAt || '—' },
    ]);
    return;
  }
  if (sub === 'create') {
    const name = need(flags.name, '--name');
    const body = {
      name,
      category: flags.category || 'official',
      description: flags.description || '',
      entryURL: flags.entry || 'https://applet.ssemarket.cn/',
      allowedOrigins: listArg(flags.origins) || ['https://applet.ssemarket.cn'],
      scopes: listArg(flags.scopes) || ['profile:read'],
      visibility: flags.visibility || 'public',
      sort: Number(flags.sort) || 10,
    };
    if (flags.key) body.appKey = String(flags.key).toLowerCase();
    const data = await request('/admin/v1/apps', { method: 'POST', body });
    console.log(`已创建官方应用：${data.app.appKey}（${data.app.name}）`);
    console.log('内部托管：mp deploy internal ' + data.app.appKey + ' --dir <目录>');
    return;
  }
  if (sub === 'apps') {
    const status = flags.status ? `?status=${encodeURIComponent(flags.status)}` : '';
    const data = await request(`/admin/v1/apps${status}`);
    table(data.items, [
      { title: 'APPKEY', get: (a) => a.appKey },
      { title: '名称', get: (a) => a.name },
      { title: '状态', get: (a) => a.status },
      { title: '开发者', get: (a) => a.developer?.email || '官方' },
    ]);
    return;
  }
  if (sub === 'developers') {
    const data = await request('/admin/v1/developers');
    table(data.items, [
      { title: 'ID', get: (d) => d.id },
      { title: '邮箱', get: (d) => d.email },
      { title: '名称', get: (d) => d.displayName },
      { title: '角色', get: (d) => d.role },
      { title: '状态', get: (d) => d.status },
      { title: '应用', get: (d) => d.appCount },
    ]);
    return;
  }
  const appKey = positional[2];
  if (sub === 'approve') {
    const body = { note: flags.note || '' };
    if (flags['version-id']) body.versionId = Number(flags['version-id']);
    const data = await request(`/admin/v1/apps/${encodeURIComponent(need(appKey, 'appKey'))}/approve`, { method: 'POST', body });
    console.log(`已通过：${data.app.appKey}（${data.app.status}）`);
    return;
  }
  if (sub === 'reject') {
    const reason = need(flags.reason, '--reason');
    const body = { reason };
    if (flags['version-id']) body.versionId = Number(flags['version-id']);
    const data = await request(`/admin/v1/apps/${encodeURIComponent(need(appKey, 'appKey'))}/reject`, { method: 'POST', body });
    console.log(`已驳回：${data.app.appKey}`);
    return;
  }
  if (sub === 'publish') {
    const body = {};
    if (flags['version-id']) body.versionId = Number(flags['version-id']);
    const data = await request(`/admin/v1/apps/${encodeURIComponent(need(appKey, 'appKey'))}/publish`, { method: 'POST', body });
    console.log(`已发布：${data.app.appKey} v${data.version?.version || ''}`);
    return;
  }
  if (sub === 'unpublish') {
    await request(`/admin/v1/apps/${encodeURIComponent(need(appKey, 'appKey'))}/unpublish`, { method: 'POST', body: {} });
    console.log(`已下架：${appKey}`);
    return;
  }
  throw new Error(`未知子命令：admin ${sub}`);
}

// ── 初始化小程序页面 ────────────────────────────────────────────────────
function writeFile(file, content, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, mode ? { mode } : undefined);
}

function cmdInit() {
  const dir = path.resolve(positional[1] || '');
  if (!positional[1]) throw new Error('用法：mp init <目录> [--app-key novel] [--base https://applet.ssemarket.cn] [--title 小说]');
  if (fs.existsSync(dir) && fs.readdirSync(dir).length && !flags.force) {
    throw new Error(`目录非空：${dir}（加 --force 覆盖）`);
  }
  const appKey = String(flags['app-key'] || 'my-app');
  const title = String(flags.title || appKey);
  const base = String(flags.base || BASE).replace(/\/+$/, '');
  fs.mkdirSync(dir, { recursive: true });

  writeFile(path.join(dir, 'index.html'), `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <main class="app">
    <header class="head">
      <span class="logo">${title.slice(0, 1)}</span>
      <div><h1>${title}</h1><p id="subtitle">正在建立小程序会话…</p></div>
    </header>
    <section class="card" id="content">
      <div class="loading">正在进入…</div>
    </section>
    <footer>由集市小程序开放平台提供 · <span id="app-key">${appKey}</span></footer>
  </main>
  <script src="${base}/sdk/mp-client.js"></script>
  <script type="module" src="./app.js"></script>
</body>
</html>
`);

  writeFile(path.join(dir, 'app.js'), `// 集市小程序页面模板
// 关键点：只用 ticket 换 mp_session，不接触主站 token。
const MP_BASE = '${base}';
MP.configure({ base: MP_BASE });

const $ = (sel) => document.querySelector(sel);
const content = $('#content');
const subtitle = $('#subtitle');
let state = { session: null, app: null, favorite: false };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function load() {
  try {
    const session = await MP.ready;
    const app = MP.app();
    const prefs = await MP.prefs.get();
    state.session = session;
    state.app = app;
    state.favorite = (prefs.favorites || []).some((item) => item.appKey === session.appKey);
    subtitle.textContent = app?.name || session.appKey;
    render();
  } catch (err) {
    subtitle.textContent = '启动失败';
    content.innerHTML = \`<div class="error"><b>无法打开小程序</b><p>\${esc(err.message || '会话建立失败')}</p><p class="hint">请从 App 内重新打开。</p></div>\`;
  }
}

function render() {
  const s = state.session;
  content.innerHTML = \`
    <div class="hero">
      <span class="badge">Session Ready</span>
      <h2>\${esc(state.app?.name || s.appKey)}</h2>
      <p>这是一个真实的 UniSSO/小程序容器接入示例页面。替换本文件内容即可发布你自己的小程序。</p>
    </div>
    <div class="kv"><span>用户</span><b>\${esc(s.userId)}</b></div>
    <div class="kv"><span>AppKey</span><b>\${esc(s.appKey)}</b></div>
    <div class="kv"><span>权限</span><b>\${esc((s.scopes || []).join(', '))}</b></div>
    <button id="fav" class="btn primary">\${state.favorite ? '★ 已添加到我的小程序' : '☆ 添加到我的小程序'}</button>
    <button id="share" class="btn">分享给好友</button>
    <p class="hint">关闭小程序才会销毁 WebView；收起时页面保持运行。</p>\`;
  $('#fav').onclick = toggleFavorite;
  $('#share').onclick = () => MP.share({ title: state.app?.name, path: location.pathname });
}

async function toggleFavorite() {
  if (state.favorite) await MP.prefs.removeFavorite(state.session.appKey);
  else await MP.prefs.addFavorite(state.session.appKey);
  state.favorite = !state.favorite;
  render();
}

load();
`);

  writeFile(path.join(dir, 'styles.css'), `:root { --ink:#171717; --muted:#5f6368; --line:#e8e8e8; --brand:#3370ff; --bg:#fbfbfa; }
* { box-sizing: border-box; }
body { margin:0; font-family:"Inter","PingFang SC","Microsoft YaHei",system-ui,sans-serif; background:var(--bg); color:var(--ink); }
.app { max-width:680px; margin:0 auto; padding:28px 20px 60px; }
.head { display:flex; align-items:center; gap:12px; margin-bottom:20px; }
.logo { width:42px; height:42px; border-radius:12px; background:var(--ink); color:#fff; display:grid; place-items:center; font-weight:800; }
.head h1 { font-size:20px; margin:0; letter-spacing:-.03em; }
.head p { margin:2px 0 0; color:var(--muted); font-size:12px; }
.card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:20px; }
.hero { padding-bottom:16px; border-bottom:1px solid var(--line); margin-bottom:12px; }
.badge { font-size:10px; font-weight:700; letter-spacing:.08em; color:var(--brand); text-transform:uppercase; }
.hero h2 { font-size:24px; margin:8px 0 6px; letter-spacing:-.04em; }
.hero p { color:var(--muted); font-size:13px; line-height:1.7; margin:0; }
.kv { display:flex; justify-content:space-between; gap:16px; padding:9px 0; border-bottom:1px dashed var(--line); font-size:12.5px; }
.kv span { color:var(--muted); }
.kv b { font-weight:600; text-align:right; word-break:break-all; }
.btn { width:100%; height:42px; margin-top:10px; border:1px solid var(--line); border-radius:10px; background:#fff; color:var(--ink); font-size:13px; font-weight:600; cursor:pointer; }
.btn.primary { background:var(--ink); color:#fff; border-color:var(--ink); }
.hint { color:var(--muted); font-size:11px; line-height:1.7; margin-top:12px; }
.loading,.error { padding:40px 0; text-align:center; color:var(--muted); font-size:13px; }
footer { color:var(--muted); font-size:11px; margin-top:18px; text-align:center; }
`);

  writeFile(path.join(dir, 'nginx.conf.example'), `server {
  listen 443 ssl http2;
  server_name mp-app.example.com;

  ssl_certificate     /etc/letsencrypt/live/mp-app.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/mp-app.example.com/privkey.pem;

  root /var/www/mp-app/${appKey};
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  add_header Content-Security-Policy "default-src 'self'; script-src 'self' ${base}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${base}; frame-ancestors 'self';" always;
}
`);

  writeFile(path.join(dir, 'deploy.sh.example'), `#!/usr/bin/env bash
# 例：把静态页面同步到自己的 mp-app 主机
set -euo pipefail
TARGET="user@mp-app.example.com:/var/www/mp-app/${appKey}/"
rsync -av --delete "$(dirname "$0")/" "$TARGET"
echo "已同步；现在执行：mp apps deploy ${appKey} --url https://mp-app.example.com/${appKey}"
`, 0o755);

  writeFile(path.join(dir, 'README.md'), `# ${title}（小程序页面）

由 \`mp init\` 生成。

## 本地开发

\`\`\`bash
python3 -m http.server 5173
# 需要一个启动票据才能打开：从 App / 平台申请后访问
# http://localhost:5173/?ticket=lt_...
\`\`\`

## 部署（二选一）

### A. 内部托管（平台托管源，仅官方应用）

\`\`\`bash
mp deploy internal ${appKey} --dir .
mp apps submit ${appKey} --changelog "内部托管首版"
\`\`\`

入口会变成 \`${base}/mp/${appKey}/?source=...\`，source token 由平台生成并写入 entryURL。

### B. 外部托管（自有 HTTPS 源）

1. 把本目录部署到独立 HTTPS 源（例如 \`https://mp-app.example.com/${appKey}\`）；
2. 确保 origin 已登记到 \`allowedOrigins\`；
3. 绑定并提交审核：

\`\`\`bash
mp deploy external ${appKey} --url https://mp-app.example.com/${appKey}
mp apps submit ${appKey} --changelog "外部托管首版"
\`\`\`

页面通过 \`${base}/sdk/mp-client.js\` 用 URL 里的 ticket 换 HttpOnly 会话；不要在这里读写主站 token。

详细文档：
- 内部：${base}/app-docs/deploy-internal.md
- 外部：${base}/app-docs/deploy-external.md
`);

  console.log(`已生成：${dir}`);
  console.log('');
  console.log('下一步：');
  console.log(`  1. 修改 index.html / app.js / styles.css`);
  console.log(`  2. 部署到独立 HTTPS 源，例如 https://mp-app.example.com/${appKey}`);
  console.log(`  3. mp apps deploy ${appKey} --url https://mp-app.example.com/${appKey}`);
  console.log(`  4. mp apps submit ${appKey} --changelog "首版真实页面"`);
}


// ── 内部源：上传静态构建到平台托管 ─────────────────────────────────────
const IGNORE_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '.idea', '.vscode']);
const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'text/xml; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.wav': 'audio/wav',
  '.wasm': 'application/wasm', '.map': 'application/json',
};

function collectFiles(dir) {
  const out = [];
  const walk = (current, prefix = '') => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.DS_Store') continue;
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        walk(path.join(current, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.isFile()) {
        const full = path.join(current, entry.name);
        const rel = `${prefix}${entry.name}`;
        const ext = path.extname(entry.name).toLowerCase();
        if (!MIME_BY_EXT[ext]) continue;
        out.push({ full, rel, size: fs.statSync(full).size });
      }
    }
  };
  walk(dir);
  return out;
}

async function postRaw(pathname, buffer, contentTypeValue) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': contentTypeValue,
    },
    body: buffer,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!res.ok) throw new Error(`${data?.code || res.status} ${data?.message || '上传失败'}`);
  return data;
}

async function deployInternal(appKey, { dir, submit = false } = {}) {
  if (!TOKEN) throw new Error('内部托管需要登录 token：先执行 mp login');
  const sourceDir = path.resolve(dir || '');
  if (!dir || !fs.existsSync(sourceDir)) throw new Error('缺少 --dir 或目录不存在');
  const files = collectFiles(sourceDir);
  if (!files.some((f) => f.rel === 'index.html')) throw new Error('目录根路径缺少 index.html');
  const total = files.reduce((sum, f) => sum + f.size, 0);
  console.log(`构建文件：${files.length} 个，${(total / 1024 / 1024).toFixed(2)} MB`);
  if (flags['dry-run']) {
    for (const f of files) console.log(`  ${f.rel}  ${f.size}B`);
    return;
  }
  const detail = await request(`/dev/v1/apps/${encodeURIComponent(appKey)}`);
  if (detail.app.status === 'reviewing') throw new Error('应用审核中，不能部署');
  const build = await request(`/dev/v1/apps/${encodeURIComponent(appKey)}/hosting/builds`, { method: 'POST', body: {} });
  console.log(`构建 ID：${build.buildId}`);
  let done = 0;
  for (const file of files) {
    const buffer = fs.readFileSync(file.full);
    await postRaw(
      `/dev/v1/apps/${encodeURIComponent(appKey)}/hosting/builds/${build.buildId}/files?path=${encodeURIComponent(file.rel)}`,
      buffer,
      MIME_BY_EXT[path.extname(file.rel).toLowerCase()] || 'application/octet-stream',
    );
    done += 1;
    if (done % 20 === 0 || done === files.length) console.log(`  已上传 ${done}/${files.length}`);
  }
  const activated = await request(`/dev/v1/apps/${encodeURIComponent(appKey)}/hosting/builds/${build.buildId}/activate`, { method: 'POST', body: {} });
  const masked = String(activated.entryURL).replace(/([?&]source=)[^&]+/, '$1****');
  console.log(`已切换内部源：${masked}`);
  console.log(`（source token 已写入 entryURL；完整值见 mp hosting status ${appKey}）`);
  if (submit) {
    const changelog = flags.changelog || '部署内部托管版本';
    const version = String(flags.version || bumpVersion(detail.app.version));
    await request(`/dev/v1/apps/${encodeURIComponent(appKey)}/submit`, {
      method: 'POST',
      body: {
        version,
        changelog,
        entryURL: activated.entryURL,
        allowedOrigins: [new URL(activated.entryURL).origin],
        scopes: detail.app.scopes,
      },
    });
    console.log(`已提交审核：${version}（等待管理员通过）`);
  } else {
    console.log(`下一步：mp apps submit ${appKey} --version ${bumpVersion(detail.app.version)} --changelog "部署内部托管版本"`);
  }
}

async function deployExternal(appKey, { url, submit = false } = {}) {
  const detail = await request(`/dev/v1/apps/${encodeURIComponent(appKey)}`);
  const app = detail.app;
  const target = String(url || app.entryURL || '');
  if (!target) throw new Error('缺少 --url，或应用尚未配置 entryURL');
  const result = await probeUrl(target);
  console.log(`入口：${target}`);
  console.log(`HTTP ${result.status}  ${result.ms}ms  最终：${result.finalUrl}`);
  if (!result.ok) throw new Error('入口不可用：请先部署 HTTPS 页面');
  const origins = app.allowedOrigins || [];
  const nextOrigins = flags['replace-origins'] ? [result.origin] : [...new Set([...origins, result.origin])];
  if (flags['dry-run']) {
    console.log(JSON.stringify({ entryURL: result.finalUrl, allowedOrigins: nextOrigins }, null, 2));
    return;
  }
  if (app.status === 'reviewing') throw new Error('应用审核中，不能修改入口');
  await request(`/dev/v1/apps/${encodeURIComponent(appKey)}`, {
    method: 'PATCH',
    body: { entryURL: result.finalUrl, allowedOrigins: nextOrigins },
  });
  console.log('已绑定外部入口');
  if (submit) {
    const version = String(flags.version || bumpVersion(app.version));
    await request(`/dev/v1/apps/${encodeURIComponent(appKey)}/submit`, {
      method: 'POST',
      body: {
        version,
        changelog: flags.changelog || '切换外部托管页面',
        entryURL: result.finalUrl,
        allowedOrigins: nextOrigins,
        scopes: app.scopes,
      },
    });
    console.log(`已提交审核：${version}`);
  } else {
    console.log(`下一步：mp apps submit ${appKey} --changelog "切换外部托管页面"`);
  }
}

async function cmdDeploy() {
  const mode = positional[1];
  const appKey = need(positional[2], 'appKey');
  if (mode === 'internal') return deployInternal(appKey, { dir: flags.dir, submit: Boolean(flags.submit) });
  if (mode === 'external') return deployExternal(appKey, { url: flags.url, submit: Boolean(flags.submit) });
  throw new Error('用法：mp deploy internal <appKey> --dir <目录> | mp deploy external <appKey> --url <HTTPS地址>');
}

async function cmdHosting() {
  const sub = positional[1] || 'status';
  const appKey = need(positional[2], 'appKey');
  if (sub === 'status') {
    const data = await request(`/dev/v1/apps/${encodeURIComponent(appKey)}/hosting`);
    console.log(`模式：${data.mode}  构建：${data.build || '—'}  更新时间：${data.updatedAt || '—'}`);
    console.log(`入口：${data.entryURL || '—'}`);
    return;
  }
  if (sub === 'disable') {
    await request(`/dev/v1/apps/${encodeURIComponent(appKey)}/hosting`, { method: 'DELETE' });
    console.log('已关闭平台托管源（页面入口需重新指向外部 URL）');
    return;
  }
  throw new Error(`未知子命令：hosting ${sub}`);
}

// ── 帮助 ────────────────────────────────────────────────────────────────
function help() {
  console.log(`集市小程序平台 CLI v${VERSION}

用法：
  mp <命令> [参数]

账号：
  mp register --email <邮箱> --password <密码> --name <称呼> [--org 团队]
  mp login --email <邮箱> --password <密码> [--admin]
  mp whoami [--admin]
  mp logout

开发：
  mp init <目录> [--app-key novel] [--title 小说] [--base <平台>]
  mp apps list
  mp apps get <appKey>
  mp apps create --name <名称> [--key <appKey>] [--entry <URL>] [--origins <origin,...>] [--scopes <s,...>]
  mp apps update <appKey> [--entry ...] [--origins ...] [--name ...]
  mp apps check <appKey> [--url <URL>]
  mp apps deploy <appKey> --url <URL> [--dry-run] [--replace-origins]   # 外部源
  mp deploy external <appKey> --url <URL> [--submit --changelog ...]
  mp deploy internal <appKey> --dir <目录> [--submit --changelog ...]  # 平台托管，需登录 token
  mp hosting status <appKey>
  mp hosting disable <appKey>
  mp apps submit <appKey> --changelog <说明> [--version 1.0.0]
  mp apps publish <appKey>
  mp apps unpublish <appKey>
  mp apps versions <appKey>
  mp apps stats <appKey> [--days 14]
  mp apps secret <appKey> reveal|rotate
  mp apps delete <appKey> --yes

审核（需要管理员账号）：
  mp admin queue
  mp admin overview
  mp admin create --name <名称> [--key <appKey>] [--entry <占位URL>] [--origins ...]   # 创建官方应用（可内部托管）
  mp admin apps [--status reviewing]
  mp admin developers
  mp admin approve <appKey> [--note "ok"]
  mp admin reject <appKey> --reason "原因"
  mp admin publish <appKey>
  mp admin unpublish <appKey>

全局参数：
  --base <URL>      平台地址（默认 ${DEFAULT_BASE}）
  --token <JWT>     临时使用 token，不写入配置
  --json            输出原始 JSON

配置：${CONFIG_PATH}
`);
}

async function main() {
  const cmd = positional[0];
  if (!cmd || flags.help || cmd === 'help') return help();
  if (cmd === 'login') return cmdLogin();
  if (cmd === 'register') return cmdRegister();
  if (cmd === 'whoami') return cmdWhoami();
  if (cmd === 'logout') return cmdLogout();
  if (cmd === 'init') return cmdInit();
  if (cmd === 'apps') return cmdApps();
  if (cmd === 'deploy') return cmdDeploy();
  if (cmd === 'hosting') return cmdHosting();
  if (cmd === 'admin') return cmdAdmin();
  if (cmd === 'doctor') {
    const health = await request('/healthz', { token: '', allowAnonymous: true });
    console.log('健康检查：', JSON.stringify(health));
    console.log('当前账号：', TOKEN ? (await whoAmI()).email : '未登录');
    return;
  }
  throw new Error(`未知命令：${cmd}（mp help 查看用法）`);
}

main().catch((err) => {
  console.error(`✘ ${err.message}`);
  if (process.env.MP_DEBUG && err.stack) console.error(err.stack);
  process.exit(1);
});