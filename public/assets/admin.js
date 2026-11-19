import {
  api, esc, icon, toast, fmtDate, timeAgo, statusPill, visibilityPill, copyText,
  toast as notify, openFormModal, formError, setBusy,
} from './ui.js';

const state = { me: null, route: 'overview', appsFilter: { q: '', status: '' } };

const NAV = [
  { key: 'overview', label: '概览', icon: 'home', href: '#/' },
  { key: 'reviews', label: '审核队列', icon: 'clock', href: '#/reviews' },
  { key: 'apps', label: '小程序', icon: 'grid', href: '#/apps' },
  { key: 'developers', label: '开发者', icon: 'users', href: '#/developers' },
  { key: 'events', label: '事件', icon: 'bolt', href: '#/events' },
  { key: 'audit', label: '审计日志', icon: 'shield', href: '#/audit' },
  { key: 'feedback', label: '用户反馈', icon: 'mail', href: '#/feedback' },
];

const TITLES = {
  overview: '平台概览', reviews: '审核队列', apps: '小程序管理', developers: '开发者',
  events: '事件中心', audit: '审计日志', feedback: '用户反馈',
};

async function adminApi(path, opts) {
  try {
    return await api(path, opts);
  } catch (err) {
    if (err.status === 401) {
      state.me = null;
      renderLogin();
    }
    throw err;
  }
}

// ── 登录 ────────────────────────────────────────────────────────────────
function renderLogin() {
  document.getElementById('app').innerHTML = `
  <div class="admin-login">
    <div class="card card-pad">
      <a class="brand" href="/">
        <img class="brand-logo" src="/assets/logo.png" alt="" /><span>集市小程序开放平台</span>
      </a>
      <h1>平台管理后台</h1>
      <p class="sub">审核小程序、管理开发者与查看平台审计。</p>
      <a class="btn btn-ghost" style="width:100%" href="/auth/sso/start?next=%2Fadmin">
        <span class="sso-dot"></span> 使用 UniSSO 登录管理后台
      </a>
      <p class="muted tiny" style="text-align:center;margin:8px 0 2px">内部管理员账号直接使用统一身份登录</p>
      <div class="auth-divider"><span>或使用平台管理员密码</span></div>
      <form class="form-grid" data-form="admin-login" novalidate>
        <div class="field"><label>管理员邮箱</label>
          <input class="input" type="email" name="email" placeholder="admin@example.com" autocomplete="username" required /></div>
        <div class="field"><label>密码</label>
          <input class="input" type="password" name="password" autocomplete="current-password" required /></div>
        <button class="btn btn-primary" type="submit" style="width:100%">登录管理后台</button>
        <div class="form-note">初始化管理员：<span class="mono">admin@mp.local</span>（密码见平台 <span class="mono">.env</span>）。<br />内部管理员（如 3238499590@qq.com）请用上方 UniSSO 登录。<br /><a href="/app-docs/admin-guide.md" target="_blank" rel="noreferrer">管理员使用指南</a></div>
      </form>
    </div>
  </div>`;
}

async function submitLogin(form) {
  const fd = new FormData(form);
  const login = await api('/dev/v1/auth/login', {
    method: 'POST',
    body: { email: fd.get('email'), password: fd.get('password') },
  });
  try {
    const me = await api('/admin/v1/me');
    state.me = me.admin;
    toast(`欢迎，${state.me.displayName || state.me.email}`);
    location.hash = '#/';
    renderRoute();
  } catch (err) {
    await api('/dev/v1/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    throw new Error('该账号不是平台管理员');
  }
}

// ── 外壳 ────────────────────────────────────────────────────────────────
function shell(active, content) {
  const me = state.me || {};
  const initial = (me.displayName || me.email || 'A').slice(0, 1).toUpperCase();
  const avatarInner = me.avatarUrl
    ? `<img src="${esc(me.avatarUrl)}" alt="" referrerpolicy="no-referrer" />`
    : esc(initial);
  const avatarClass = me.avatarUrl ? 'avatar has-img' : 'avatar';
  document.getElementById('app').innerHTML = `
  <div class="console">
    <aside class="sidebar" id="sidebar">
      <a class="brand" href="#/">
        <img class="brand-logo" src="/assets/logo.png" alt="" />
        <span>平台管理后台<small>ADMIN CONSOLE</small></span>
      </a>
      <div style="padding:0 10px 10px"><span class="admin-badge">${icon('lock', 10)} 管理员</span></div>
      ${NAV.map((n) => `<a class="nav-item ${active === n.key ? 'on' : ''}" href="${n.href}">${icon(n.icon, 17)}<span>${n.label}</span></a>`).join('')}
      <div class="sidebar-foot">
        <div class="user-chip">
          <div class="${avatarClass}" data-initial="${esc(initial)}">${avatarInner}</div>
          <div class="grow"><div class="un">${esc(me.displayName || '管理员')}</div><div class="ue">${esc(me.email || '')}</div></div>
          <button class="icon-btn" data-action="admin-logout" title="退出">${icon('logout', 16)}</button>
        </div>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="btn btn-icon btn-ghost mobile-menu" data-action="toggle-sidebar">${icon('menu', 18)}</button>
        <div><h2>管理后台</h2><div class="crumb">${TITLES[active] || '运营管理'}</div></div>
        <div class="grow"></div>
        <a class="btn btn-ghost btn-sm" href="/" target="_blank" rel="noreferrer">${icon('external', 14)} 开放平台</a>
        <button class="btn btn-sm btn-ghost" data-action="admin-refresh">${icon('refresh', 14)} 刷新</button>
      </header>
      <main class="content" id="page-content">${content || '<div class="skeleton loading-block"></div>'}</main>
    </div>
  </div>`;
  document.getElementById('sidebar')?.classList.remove('open');
}

function setContent(html) {
  const el = document.getElementById('page-content');
  if (el) el.innerHTML = html;
}

// ── 路由 ────────────────────────────────────────────────────────────────
function currentRoute() {
  const path = location.hash.replace(/^#\/?/, '');
  return path.split('/')[0] || 'overview';
}

async function renderRoute() {
  if (!state.me) { renderLogin(); return; }
  state.route = currentRoute();
  if (!TITLES[state.route]) state.route = 'overview';
  try {
    if (state.route === 'overview') await pageOverview();
    else if (state.route === 'reviews') await pageReviews();
    else if (state.route === 'apps') await pageApps();
    else if (state.route === 'developers') await pageDevelopers();
    else if (state.route === 'events') await pageEvents();
    else if (state.route === 'audit') await pageAudit();
    else if (state.route === 'feedback') await pageFeedback();
  } catch (err) {
    if (err.status === 401) return;
    shell(state.route, `<div class="alert alert-danger">${icon('alert', 16)} ${esc(err.message || '加载失败')}</div>`);
  }
}

// ── 概览 ────────────────────────────────────────────────────────────────
async function pageOverview() {
  shell('overview', '<div class="skeleton loading-block"></div>');
  const data = await adminApi('/admin/v1/overview');
  const c = data.counts || {};
  setContent(`
    <div class="page-head">
      <div><h1>平台概览</h1><p>审核、发布与平台运行数据一览。</p></div>
    </div>
    <div class="stat-grid">
      ${stat('小程序总数', c.apps)}${stat('已发布', c.published)}${stat('待审核', c.reviewing)}
      ${stat('开发者', c.developers)}
    </div>
    <div class="stat-grid">
      ${stat('24h 事件', c.events24h)}${stat('24h 通知', c.notifications24h)}
      ${stat('24h 启动', c.launches24h)}${stat('待处理反馈', c.openFeedback)}
    </div>
    <div class="grid" style="grid-template-columns:1.5fr 1fr;align-items:start">
      <div class="card card-pad">
        <div class="between" style="margin-bottom:14px">
          <h3 style="font-size:15px">待审核小程序</h3>
          <a class="link small" href="#/reviews">全部 ${icon('chevron', 12)}</a>
        </div>
        ${(data.pending || []).length ? data.pending.map((p) => `
          <div class="list-row" style="padding-left:0;padding-right:0">
            <div class="app-icon">${icon('grid', 20)}</div>
            <div class="grow"><div class="t">${esc(p.name)} <span class="mono tiny muted">${esc(p.appKey)}</span></div>
              <div class="d">${esc(p.version ? `v${p.version}` : '')} ${esc((p.changelog || '').slice(0, 50))}</div></div>
            <button class="btn btn-primary btn-sm" data-action="open-review" data-key="${esc(p.appKey)}">审核</button>
          </div>`).join('') : '<div class="admin-empty">审核队列为空，所有提交都已处理。</div>'}
      </div>
      <aside class="stack">
        <div class="card card-pad">
          <h3 style="font-size:14px;margin-bottom:8px">审核清单</h3>
          <ul class="muted small" style="padding-left:18px;line-height:1.9;margin:0">
            <li>入口为 HTTPS，且 origin 与 allowedOrigins 一致</li>
            <li>权限与实际功能匹配，无过度申请</li>
            <li>官方小程序复用 App 登录态，第三方小程序使用平台会话</li>
            <li>名称与简介不侵权、不误导</li>
          </ul>
        </div>
      </aside>
    </div>`);
}

function stat(label, value) {
  return `<div class="stat"><div class="lab">${label}</div><div class="val">${Number(value || 0).toLocaleString()}</div></div>`;
}

// ── 审核队列 ────────────────────────────────────────────────────────────
async function pageReviews() {
  shell('reviews', '<div class="skeleton loading-block"></div>');
  const data = await adminApi('/admin/v1/overview');
  const list = data.pending || [];
  setContent(`
    <div class="page-head"><div><h1>审核队列</h1><p>审核通过后由开发者手动发布；驳回需填写原因。</p></div>
      <span class="pill reviewing">${list.length} 个待处理</span></div>
    ${list.length ? `<div class="grid grid-2">${list.map((p) => `
      <article class="review-card">
        <div class="rc-head">
          <div class="app-icon">${icon('grid', 22)}</div>
          <div class="grow"><h3>${esc(p.name)}</h3>
            <div class="rc-meta"><span class="mono">${esc(p.appKey)}</span><span>v${esc(p.version || '—')}</span>
              <span>开发者 #${p.developerId ?? '—'}</span></div></div>
          ${statusPill('reviewing')}
        </div>
        <div class="rc-log">${esc(p.changelog || '未填写版本说明')}</div>
        <div class="between"><span class="muted tiny">提交于 ${p.submittedAt ? timeAgo(p.submittedAt) : '—'}</span>
          <div class="row"><button class="btn btn-ghost btn-sm" data-action="open-review" data-key="${esc(p.appKey)}">查看详情</button>
          <button class="btn btn-primary btn-sm" data-action="open-review" data-key="${esc(p.appKey)}">审核</button></div></div>
      </article>`).join('')}</div>` : '<div class="card"><div class="admin-empty">暂无待审核的小程序。</div></div>'}
  `);
}

// ── 小程序 ──────────────────────────────────────────────────────────────
async function pageApps() {
  shell('apps');
  await loadApps();
}

async function loadApps() {
  const { q, status } = state.appsFilter;
  const qs = new URLSearchParams({ limit: '50' });
  if (q) qs.set('q', q);
  if (status) qs.set('status', status);
  const data = await adminApi(`/admin/v1/apps?${qs}`);
  const wasSearching = document.activeElement?.matches?.('[data-admin-search]');
  setContent(`
    <div class="page-head"><div><h1>小程序管理</h1><p>查看全部小程序、版本、可见名单与上线状态。</p></div>
      <button class="btn btn-primary" data-action="new-official">${icon('plus', 15)} 新建官方小程序</button></div>
    <div class="admin-toolbar">
      <div class="search" style="max-width:320px">${icon('search', 16)}
        <input class="input" placeholder="搜索名称 / appKey / 简介" data-admin-search value="${esc(q)}" /></div>
      <select class="select" style="width:150px" data-admin-status>
        ${['', 'draft', 'reviewing', 'approved', 'rejected', 'published', 'offline'].map((s) => `<option value="${s}" ${status === s ? 'selected' : ''}>${s ? labelOf(s) : '全部状态'}</option>`).join('')}
      </select>
      <span class="muted small">${data.items.length} 个结果</span>
    </div>
    <div class="admin-table-wrap">
      <table class="table">
        <thead><tr><th>小程序</th><th>AppKey</th><th>状态</th><th>可见范围</th><th>版本</th><th>开发者</th><th>更新时间</th></tr></thead>
        <tbody>
          ${data.items.map((app) => `<tr class="clickable" data-action="open-app" data-key="${esc(app.appKey)}">
            <td><div class="row" style="gap:9px">${appIconSmall(app)}<b>${esc(app.name)}</b></div></td>
            <td class="mono tiny">${esc(app.appKey)}</td>
            <td>${statusPill(app.status)}</td>
            <td>${visibilityPill(app.visibility)}</td>
            <td class="mono tiny">v${esc(app.version)}</td>
            <td class="muted small">${esc(app.developer?.email || '官方')}</td>
            <td class="muted small">${timeAgo(app.updatedAt)}</td>
          </tr>`).join('') || '<tr><td colspan="7" class="admin-empty">没有匹配的小程序</td></tr>'}
        </tbody>
      </table>
    </div>`);
  if (wasSearching) {
    const input = document.querySelector('[data-admin-search]');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
}

function labelOf(status) {
  return { draft: '草稿', reviewing: '审核中', approved: '待发布', rejected: '已驳回', published: '已发布', offline: '已下架' }[status] || status;
}

function appIconSmall(app) {
  const raw = String(app.icon || '');
  if (raw.startsWith('/media/')) return `<span class="app-icon" style="width:30px;height:30px;border-radius:8px"><img src="${esc(raw)}" alt="" /></span>`;
  return `<span class="app-icon" style="width:30px;height:30px;border-radius:8px">${icon('grid', 16)}</span>`;
}

// ── 开发者 ──────────────────────────────────────────────────────────────
async function pageDevelopers() {
  shell('developers');
  const data = await adminApi('/admin/v1/developers?limit=100');
  setContent(`
    <div class="page-head"><div><h1>开发者</h1><p>查看注册账号与小程序数量，可停用违规账号。</p></div></div>
    <div class="admin-table-wrap">
      <table class="table">
        <thead><tr><th>账号</th><th>团队</th><th>角色</th><th>小程序</th><th>状态</th><th>注册时间</th><th></th></tr></thead>
        <tbody>${data.items.map((d) => `<tr>
          <td><b>${esc(d.displayName || '—')}</b><div class="muted tiny mono">${esc(d.email)}</div></td>
          <td class="muted small">${esc(d.orgName || '—')}</td>
          <td>${d.role === 'admin' ? '<span class="pill approved">管理员</span>' : '<span class="pill draft">开发者</span>'}</td>
          <td>${d.appCount}</td>
          <td>${d.status === 'active' ? '<span class="pill published">正常</span>' : '<span class="pill rejected">已停用</span>'}</td>
          <td class="muted small">${fmtDate(d.createdAt, false)}</td>
          <td style="text-align:right">${d.role === 'admin' ? '' : `<button class="btn btn-ghost btn-sm" data-action="toggle-dev" data-id="${d.id}" data-status="${d.status}">${d.status === 'active' ? '停用' : '启用'}</button>`}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`);
}

// ── 事件 / 审计 / 反馈 ──────────────────────────────────────────────────
async function pageEvents() {
  shell('events');
  const data = await adminApi('/admin/v1/events?limit=50');
  setContent(`
    <div class="page-head"><div><h1>事件中心</h1><p>主站推送的新帖事件与处理状态。</p></div></div>
    <div class="admin-table-wrap"><table class="table">
      <thead><tr><th>事件 ID</th><th>类型</th><th>标题</th><th>去重键</th><th>状态</th><th>接收时间</th></tr></thead>
      <tbody>${data.items.map((e) => `<tr>
        <td class="mono tiny">${esc(e.eventId)}</td>
        <td><span class="pill draft">${esc(e.type)}</span></td>
        <td>${esc(e.payload?.title || '—')}</td>
        <td class="mono tiny muted">${esc(e.dedupKey || '—')}</td>
        <td>${e.status === 'processed' ? '<span class="pill published">已处理</span>' : `<span class="pill reviewing">${esc(e.status)}</span>`}</td>
        <td class="muted small">${fmtDate(e.receivedAt)}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="admin-empty">还没有收到事件</td></tr>'}</tbody>
    </table></div>`);
}

async function pageAudit() {
  shell('audit');
  const data = await adminApi('/admin/v1/audit-logs?limit=100');
  setContent(`
    <div class="page-head"><div><h1>审计日志</h1><p>开发者与管理员的关键操作记录。</p></div></div>
    <div class="admin-table-wrap"><table class="table">
      <thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>对象</th><th>IP</th></tr></thead>
      <tbody>${data.items.map((a) => `<tr>
        <td class="muted small">${fmtDate(a.createdAt)}</td>
        <td>${a.actorType === 'admin' ? '<span class="pill approved">管理员</span>' : '<span class="pill draft">开发者</span>'} <span class="mono tiny">${esc(a.actorId)}</span></td>
        <td class="mono tiny">${esc(a.action)}</td>
        <td class="mono tiny">${esc(a.targetKey || '—')}</td>
        <td class="mono tiny muted">${esc(a.ip || '—')}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="admin-empty">暂无审计记录</td></tr>'}</tbody>
    </table></div>`);
}

async function pageFeedback() {
  shell('feedback');
  const data = await adminApi('/admin/v1/feedback');
  setContent(`
    <div class="page-head"><div><h1>用户反馈</h1><p>来自小程序与 App 的反馈。</p></div></div>
    ${data.items.length ? `<div class="grid grid-2">${data.items.map((f) => `
      <div class="card card-pad">
        <div class="between" style="margin-bottom:8px">
          <span class="pill ${f.status === 'open' ? 'reviewing' : 'published'}">${f.status === 'open' ? '待处理' : '已处理'}</span>
          <span class="muted tiny">${timeAgo(f.createdAt)}</span></div>
        <p style="font-size:13px;line-height:1.7">${esc(f.content)}</p>
        <div class="muted tiny" style="margin-top:9px">用户 ${esc(f.userId || '—')} · ${esc(f.appKey || '通用')} ${f.contact ? `· ${esc(f.contact)}` : ''}</div>
        ${f.status === 'open' ? `<button class="btn btn-ghost btn-sm" style="margin-top:12px" data-action="resolve-feedback" data-id="${f.id}">标记已处理</button>` : ''}
      </div>`).join('')}</div>` : '<div class="card"><div class="admin-empty">暂无反馈。</div></div>'}
  `);
}

// ── 审核 / 应用详情 ─────────────────────────────────────────────────────
async function openReview(appKey) {
  const { app } = await adminApi(`/admin/v1/apps/${encodeURIComponent(appKey)}`);
  const reviewing = (app.versions || []).find((v) => v.status === 'reviewing');
  const approved = (app.versions || []).find((v) => v.status === 'approved');
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" data-backdrop>
      <div class="modal" style="max-width:680px">
        <div class="modal-head"><h3>审核 · ${esc(app.name)}</h3>
          <button class="icon-close" data-close>${icon('x', 18)}</button></div>
        <div class="modal-body">
          <div class="row" style="gap:12px;margin-bottom:14px">
            <div class="app-icon">${icon('grid', 22)}</div>
            <div class="grow"><div class="mono tiny muted">${esc(app.appKey)}</div>
              <div class="row" style="gap:7px;margin-top:4px">${statusPill(app.status)}</div></div>
          </div>
          <div class="admin-kv"><span class="k">开发者</span><span class="v">${esc(app.developer?.email || '官方')} ${app.developer?.orgName ? `· ${esc(app.developer.orgName)}` : ''}</span></div>
          <div class="admin-kv"><span class="k">入口地址</span><span class="v mono">${esc(app.entryURL || '未配置')}</span></div>
          <div class="admin-kv"><span class="k">允许 origin</span><span class="v mono">${esc((app.allowedOrigins || []).join('、') || '—')}</span></div>
          <div class="admin-kv"><span class="k">可见范围</span><span class="v">${visibilityPill(app.visibility)}</span></div>
          <div class="admin-kv"><span class="k">权限</span><span class="v">${(app.scopes || []).map((s) => `<span class="scope-pill">${esc(s)}</span>`).join('') || '—'}</span></div>
          <div class="admin-kv"><span class="k">简介</span><span class="v">${esc(app.description || '—')}</span></div>
          ${reviewing ? `<div class="alert alert-info" style="margin-top:14px">${icon('file', 15)}<div><b>待审版本 v${esc(reviewing.version)}</b>
            <div style="margin-top:4px">${esc(reviewing.changelog || '未填写版本说明')}</div>
            <div class="tiny" style="margin-top:6px">提交时间：${fmtDate(reviewing.submittedAt)}</div></div></div>` : ''}
          ${(app.versions || []).length ? `<h4 style="margin:18px 0 8px;font-size:13px">版本记录</h4>
            <div class="table-wrap"><table class="table"><thead><tr><th>版本</th><th>状态</th><th>说明</th><th>提交</th></tr></thead>
            <tbody>${app.versions.map((v) => `<tr><td class="mono">${esc(v.version)}</td><td>${statusPill(v.status)}</td>
              <td class="muted small">${esc((v.changelog || '').slice(0, 80))}</td><td class="muted small">${v.submittedAt ? fmtDate(v.submittedAt) : '—'}</td></tr>`).join('')}</tbody></table></div>` : ''}
          ${app.visibility === 'allowlist' ? `<div style="margin-top:14px"><h4 style="font-size:13px;margin-bottom:6px">白名单</h4>
            <div class="muted small mono">${esc((app.allowlist || []).join(', ') || '空')}</div>
            <button class="btn btn-ghost btn-sm" style="margin-top:8px" data-action="edit-allowlist" data-key="${esc(app.appKey)}">编辑白名单</button></div>` : ''}
        </div>
        <div class="modal-foot" style="justify-content:space-between">
          <div class="row">
            ${app.status === 'published' ? `<button class="btn btn-danger btn-sm" data-action="admin-unpublish" data-key="${esc(app.appKey)}">下架</button>` : ''}
            ${approved ? `<button class="btn btn-ghost btn-sm" data-action="admin-publish" data-key="${esc(app.appKey)}" data-version-id="${approved.id}">发布 v${esc(approved.version)}</button>` : ''}
          </div>
          <div class="row">
            ${reviewing ? `<button class="btn btn-danger btn-sm" data-action="admin-reject" data-key="${esc(app.appKey)}" data-version-id="${reviewing.id}">驳回</button>
            <button class="btn btn-primary btn-sm" data-action="admin-approve" data-key="${esc(app.appKey)}" data-version-id="${reviewing.id}">通过审核</button>` : '<button class="btn btn-ghost btn-sm" data-close>关闭</button>'}
          </div>
        </div>
      </div>
    </div>`;
  const close = () => { root.innerHTML = ''; };
  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  root.querySelector('[data-backdrop]').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) close();
  });
  return close;
}

async function openApp(appKey) {
  await openReview(appKey);
}

async function openNewOfficial() {
  openFormModal({
    title: '新建官方小程序',
    submitText: '创建并发布',
    body: `
      <div class="stack">
        <div class="grid grid-2">
          <div class="field"><label>名称</label><input class="input" name="name" required maxlength="32" /></div>
          <div class="field"><label>AppKey</label><input class="input mono" name="appKey" placeholder="留空自动生成" /></div>
        </div>
        <div class="field"><label>入口地址</label><input class="input mono" name="entryURL" placeholder="https://…" required />
          <span class="hint">小程序实际打开页面的地址；它的 origin 必须允许被加载。</span></div>
        <div class="field"><label>允许 origin（一行一个）</label><textarea class="textarea mono" name="allowedOrigins" placeholder="留空会自动使用入口地址的 origin"></textarea>
          <span class="hint">可以留空。入口地址的 origin 会自动补到第一位（旧版 App 用它申请票据）。</span></div>
        <div class="grid grid-2">
          <div class="field"><label>分类</label><select class="select" name="category">
            ${[['content','内容'],['tool','工具'],['life','生活'],['official','官方'],['game','游戏'],['shopping','购物'],['other','其他']].map(([k, v]) => `<option value="${k}" ${k === 'official' ? 'selected' : ''}>${v}</option>`).join('')}
          </select></div>
          <div class="field"><label>排序（越大越靠前）</label><input class="input" name="sort" type="number" value="50" /></div>
        </div>
        <div class="field"><label>简介</label><textarea class="textarea" name="description" maxlength="200"></textarea></div>
      </div>`,
    onSubmit: async (form, close) => {
      const fd = new FormData(form);
      const origins = String(fd.get('allowedOrigins') || '').split('\n').map((v) => v.trim()).filter(Boolean);
      await adminApi('/admin/v1/apps', {
        method: 'POST',
        body: {
          name: fd.get('name'),
          appKey: String(fd.get('appKey') || '').trim() || undefined,
          entryURL: String(fd.get('entryURL') || '').trim(),
          allowedOrigins: origins,
          category: fd.get('category'),
          description: fd.get('description') || '',
          sort: Number(fd.get('sort') || 0),
          visibility: 'public',
          scopes: ['profile:read'],
        },
      });
      close();
      toast('官方小程序已创建并发布');
      await renderRoute();
    },
  });
}

async function openReject(appKey, versionId) {
  openFormModal({
    title: '驳回提交',
    submitText: '确认驳回',
    danger: true,
    body: `<div class="field"><label>驳回原因</label>
      <textarea class="textarea" name="reason" required maxlength="500" placeholder="请说明需要修改的内容，开发者会在控制台看到"></textarea></div>`,
    onSubmit: async (form, close) => {
      const reason = String(new FormData(form).get('reason') || '').trim();
      await adminApi(`/admin/v1/apps/${encodeURIComponent(appKey)}/reject`, {
        method: 'POST', body: { reason, versionId: Number(versionId) },
      });
      close();
      document.getElementById('modal-root').innerHTML = '';
      toast('已驳回');
      await renderRoute();
    },
  });
}

async function openAllowlist(appKey) {
  const { app } = await adminApi(`/admin/v1/apps/${encodeURIComponent(appKey)}`);
  openFormModal({
    title: '编辑可见白名单',
    submitText: '保存',
    body: `<div class="field"><label>用户 ID（一行一个）</label>
      <textarea class="textarea mono" name="userIds" style="min-height:160px">${esc((app.allowlist || []).join('\n'))}</textarea>
      <span class="hint">仅当可见范围为「白名单」时生效。</span></div>`,
    onSubmit: async (form, close) => {
      const ids = String(new FormData(form).get('userIds') || '').split('\n').map((v) => v.trim()).filter(Boolean);
      await adminApi(`/admin/v1/apps/${encodeURIComponent(appKey)}/allowlist`, { method: 'PUT', body: { userIds: ids } });
      close();
      document.getElementById('modal-root').innerHTML = '';
      toast('白名单已保存');
      await renderRoute();
    },
  });
}

// ── 事件绑定 ────────────────────────────────────────────────────────────
document.addEventListener('click', async (event) => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  event.preventDefault();
  const action = el.dataset.action;
  try {
    switch (action) {
      case 'admin-logout':
        await api('/dev/v1/auth/logout', { method: 'POST', body: {} }).catch(() => {});
        await fetch('/auth/sso/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
        state.me = null;
        renderLogin();
        return;
      case 'toggle-sidebar':
        document.getElementById('sidebar')?.classList.toggle('open');
        return;
      case 'admin-refresh':
        await renderRoute();
        return;
      case 'open-review':
      case 'open-app':
        await openReview(el.dataset.key);
        return;
      case 'admin-approve': {
        await adminApi(`/admin/v1/apps/${encodeURIComponent(el.dataset.key)}/approve`, {
          method: 'POST', body: { versionId: Number(el.dataset.versionId), note: '' },
        });
        document.getElementById('modal-root').innerHTML = '';
        toast('已通过审核');
        await renderRoute();
        return;
      }
      case 'admin-reject':
        await openReject(el.dataset.key, el.dataset.versionId);
        return;
      case 'admin-publish': {
        await adminApi(`/admin/v1/apps/${encodeURIComponent(el.dataset.key)}/publish`, {
          method: 'POST', body: { versionId: Number(el.dataset.versionId) },
        });
        document.getElementById('modal-root').innerHTML = '';
        toast('已发布');
        await renderRoute();
        return;
      }
      case 'admin-unpublish':
        await adminApi(`/admin/v1/apps/${encodeURIComponent(el.dataset.key)}/unpublish`, { method: 'POST', body: {} });
        document.getElementById('modal-root').innerHTML = '';
        toast('已下架');
        await renderRoute();
        return;
      case 'edit-allowlist':
        document.getElementById('modal-root').innerHTML = '';
        await openAllowlist(el.dataset.key);
        return;
      case 'new-official':
        await openNewOfficial();
        return;
      case 'toggle-dev': {
        const next = el.dataset.status === 'active' ? 'suspended' : 'active';
        await adminApi(`/admin/v1/developers/${el.dataset.id}`, { method: 'PATCH', body: { status: next } });
        toast(next === 'active' ? '账号已启用' : '账号已停用');
        await renderRoute();
        return;
      }
      case 'resolve-feedback':
        await adminApi(`/admin/v1/feedback/${el.dataset.id}`, { method: 'PATCH', body: { status: 'resolved' } });
        toast('已标记处理');
        await renderRoute();
        return;
      default:
        return;
    }
  } catch (err) {
    if (err.status !== 401) toast(err.message || '操作失败', 'err');
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-form="admin-login"]');
  if (!form) return;
  event.preventDefault();
  setBusy(form, true);
  try {
    await submitLogin(form);
  } catch (err) {
    formError(form, err);
  } finally {
    setBusy(form, false);
  }
});

document.addEventListener('input', (event) => {
  if (event.target.matches('[data-admin-search]')) {
    state.appsFilter.q = event.target.value;
    clearTimeout(window.__adminSearchTimer);
    window.__adminSearchTimer = setTimeout(() => { loadApps().catch(() => {}); }, 300);
  }
});

document.addEventListener('change', (event) => {
  if (event.target.matches('[data-admin-status]')) {
    state.appsFilter.status = event.target.value;
    loadApps().catch(() => {});
  }
});

window.addEventListener('hashchange', () => { renderRoute(); });

document.addEventListener('error', (event) => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || !img.closest('.avatar')) return;
  const holder = img.closest('.avatar');
  img.remove();
  holder.textContent = holder.dataset.initial || '';
}, true);

(async function boot() {
  try {
    const me = await api('/admin/v1/me');
    state.me = me.admin;
  } catch {
    state.me = null;
  }
  if (state.me) await renderRoute(); else renderLogin();
})();