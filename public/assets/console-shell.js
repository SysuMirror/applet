import { state } from './state.js';
import { icon, esc, statusPill } from './ui.js';

const NAV = [
  { group: '工作台' },
  { key: 'dashboard', label: '概览', icon: 'home', href: '#/dashboard' },
  { key: 'apps', label: '我的小程序', icon: 'grid', href: '#/apps' },
  { group: '资源' },
  { key: 'docs', label: '开发文档', icon: 'book', href: '#/docs' },
  { key: 'account', label: '账号设置', icon: 'sliders', href: '#/account' },
  { key: 'home', label: '返回首页', icon: 'arrowLeft', href: '#/' },
];

export function shell(active, title, contentHtml = '', { crumb = '', actions = '' } = {}) {
  const me = state.me || {};
  const initial = (me.displayName || me.email || 'D').slice(0, 1).toUpperCase();
  const avatarInner = me.avatarUrl
    ? `<img src="${esc(me.avatarUrl)}" alt="" referrerpolicy="no-referrer" />`
    : esc(initial);
  const avatarClass = me.avatarUrl ? 'avatar has-img' : 'avatar';
  const nav = NAV.map((item) => {
    if (item.group) return `<div class="nav-group">${item.group}</div>`;
    return `<a class="nav-item ${active === item.key ? 'on' : ''}" href="${item.href}">
      ${icon(item.icon, 17)}<span>${item.label}</span></a>`;
  }).join('');

  document.getElementById('app').innerHTML = `
  <div class="console">
    <aside class="sidebar" id="sidebar">
      <a class="brand" href="#/">
        <img class="brand-logo" src="/assets/logo.png" alt="" />
        <span>集市开放平台<small>OPEN PLATFORM</small></span>
      </a>
      ${nav}
      <div class="sidebar-foot">
        <div class="user-chip">
          <div class="${avatarClass}" data-initial="${esc(initial)}">${avatarInner}</div>
          <div class="grow">
            <div class="un">${esc(me.displayName || '开发者')}</div>
            <div class="ue">${esc(me.email || '')}</div>
          </div>
          <button class="icon-btn" data-action="logout" title="退出登录">${icon('logout', 16)}</button>
        </div>
        ${me.role === 'admin' ? `<a class="nav-item" href="/admin" style="margin-top:6px">${icon('shield', 16)}<span>平台管理后台</span></a>` : ''}
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="btn btn-icon btn-ghost mobile-menu" data-action="toggle-sidebar" aria-label="菜单">${icon('menu', 18)}</button>
        <div>
          <h2>控制台</h2>
          <div class="crumb">${esc(title)}${crumb ? ` · ${crumb}` : ''}</div>
        </div>
        <div class="grow"></div>
        ${actions}
      </header>
      <main class="content" id="page-content">${contentHtml || skeletonBlock()}</main>
    </div>
  </div>`;
  document.getElementById('sidebar')?.classList.remove('open');
}

export function skeletonBlock() {
  return `<div class="skeleton loading-block" style="margin-bottom:16px"></div>
    <div class="grid grid-3">${Array.from({ length: 3 }, () => '<div class="skeleton" style="height:150px;border-radius:16px"></div>').join('')}</div>`;
}

export function setContent(html) {
  const el = document.getElementById('page-content');
  if (el) el.innerHTML = html;
}

export function pageHead(title, desc, actions = '') {
  return `<div class="page-head">
    <div><h1>${esc(title)}</h1>${desc ? `<p>${desc}</p>` : ''}</div>
    ${actions ? `<div class="row">${actions}</div>` : ''}
  </div>`;
}

export function statCard(label, value, sub = '', iconName = 'chart') {
  return `<div class="stat">
    <div class="lab">${icon(iconName, 14)} ${esc(label)}</div>
    <div class="val">${value}</div>
    ${sub ? `<div class="sub">${sub}</div>` : ''}
  </div>`;
}

export function appCard(app) {
  const nextAction = app.status === 'approved'
    ? '<button class="btn btn-primary btn-sm" data-action="publish-app" data-key="' + esc(app.appKey) + '">发布</button>'
    : app.status === 'draft' || app.status === 'rejected'
      ? '<button class="btn btn-soft btn-sm" data-action="submit-app" data-key="' + esc(app.appKey) + '">提交审核</button>'
      : '';
  return `<article class="app-card" data-nav="#/apps/${esc(app.appKey)}">
    <div class="app-card-head">
      ${appIconHtml(app)}
      <div class="grow">
        <h3 class="truncate">${esc(app.name)}</h3>
        <div class="key">${esc(app.appKey)}</div>
      </div>
      ${statusPill(app.status)}
    </div>
    <p class="desc">${esc(app.description || '这个小程序还没有填写简介。')}</p>
    <div class="meta">
      <span>${esc(categoryLabel(app.category))} · v${esc(app.version)}</span>
      <span>${timeAgo(app.updatedAt)}</span>
    </div>
    <div class="actions">
      <button class="btn btn-ghost btn-sm" data-nav="#/apps/${esc(app.appKey)}">管理</button>
      ${nextAction}
    </div>
  </article>`;
}

export function appIconHtml(app) {
  const raw = String(app.icon || '');
  if (raw.startsWith('/media/') || /^https?:\/\//.test(raw)) {
    return `<div class="app-icon"><img src="${esc(raw)}" alt="" /></div>`;
  }
  const map = {
    'tabler:book-2': 'book', 'tabler:trophy': 'trophy', 'tabler:coin': 'coin',
    'tabler:help-circle': 'help', 'tabler:notes': 'notes', 'tabler:wrench': 'wrench',
    'tabler:coffee': 'coffee', 'tabler:badge': 'badge', 'tabler:gamepad': 'gamepad',
    'tabler:bag': 'bag', 'tabler:sparkles': 'sparkles', 'tabler:file': 'file',
    'tabler:file-text': 'file', 'tabler:music': 'music', 'tabler:video': 'video', 'tabler:school': 'school',
  };
  return `<div class="app-icon">${icon(map[raw] || 'grid', 22)}</div>`;
}

export function categoryLabel(key) {
  return { content: '内容', tool: '工具', life: '生活', official: '官方', game: '游戏', shopping: '购物', other: '其他' }[key] || key;
}

export function timeAgo(value) {
  const t = Date.parse(value || '');
  if (!Number.isFinite(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${Math.floor(diff / 86400_000)} 天前`;
}