/* 共享 UI 工具：图标、API、弹窗、Toast、格式化 */

import { state } from './state.js';

const modalRoot = () => document.getElementById('modal-root');
const toastRoot = () => document.getElementById('toast-root');

export const CATEGORY_NAMES = {
  content: '内容', tool: '工具', life: '生活', official: '官方',
  game: '游戏', shopping: '购物', other: '其他',
};

export const STATUS_META = {
  draft: ['草稿', 'draft'],
  reviewing: ['审核中', 'reviewing'],
  approved: ['待发布', 'approved'],
  rejected: ['已驳回', 'rejected'],
  published: ['已发布', 'published'],
  offline: ['已下架', 'offline'],
  superseded: ['已被替换', 'draft'],
};

export const SCOPE_META = {
  'profile:read': ['读取用户资料', '昵称、头像等基础资料'],
  'prefs:read': ['读取使用偏好', '最近使用与我的小程序'],
  'prefs:write': ['写入使用偏好', '添加 / 移除我的小程序'],
  'notifications:read': ['读取通知', '站内新帖通知与未读数'],
  'notifications:write': ['订阅通知', '开启新帖提醒与静默时段'],
  'posts:read': ['读取帖子', '通过主站内部接口读取业务数据'],
};

export const AUDIT_LABELS = {
  'app.create': '创建小程序',
  'app.update': '更新开发配置',
  'app.submit': '提交审核',
  'app.publish': '发布上线',
  'app.unpublish': '下架小程序',
  'app.delete': '删除小程序',
  'app.version.create': '创建版本',
  'app.secret.reveal': '查看 AppSecret',
  'app.secret.rotate': '重置 AppSecret',
  'admin.app.create': '管理员创建应用',
  'admin.app.update': '管理员更新配置',
  'admin.app.approve': '审核通过',
  'admin.app.reject': '审核驳回',
  'admin.app.publish': '管理员发布',
  'admin.app.unpublish': '管理员下架',
  'admin.app.allowlist': '更新可见名单',
  'developer.register': '注册开发者账号',
  'developer.password_change': '修改密码',
};

const ICONS = {
  logo: '<path d="M9 5h20v6H15v6h11v6H9z" fill="currentColor" stroke="none"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22z"/><path d="M4 17.5h16"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h10M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  logout: '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 8.3-8.3M15 8l3 3M17 6l3 3"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15 15.5a5 5 0 0 1 6 4.5"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  external: '<path d="M14 3h7v7M21 3l-9 9"/><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
  refresh: '<path d="M20 11A8 8 0 0 0 5 6L3 8M4 13a8 8 0 0 0 15 5l2-2"/><path d="M3 3v5h5M21 21v-5h-5"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13 4l-2 16"/>',
  sparkles: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 21h16"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M9 9l3 3 3-3M12 12v4M9.5 13.5h5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-.9.7-1.5 1.2-1.5 2.5M12 17h.01"/>',
  notes: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5z"/>',
  coffee: '<path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 9h2a2 2 0 0 1 0 4h-2M7 3v2M11 3v2"/>',
  badge: '<circle cx="12" cy="9" r="5"/><path d="m9 13-1 8 4-2 4 2-1-8"/>',
  gamepad: '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M8 10v4M6 12h4M16 11h.01M18 13h.01"/>',
  bag: '<path d="M5 8h14l1 12H4z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  alert: '<path d="M12 3 2 21h20z"/><path d="M12 9v5M12 17h.01"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  building: '<path d="M4 21V4h10v17M14 9h6v12M2 21h20"/><path d="M8 8h2M8 12h2M8 16h2M17 13h1M17 17h1"/>',
  phone: '<path d="M5 3h4l2 5-3 2a13 13 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  dots: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  music: '<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>',
  school: '<path d="m3 9 9-5 9 5-9 5z"/><path d="M7 11v5c3 2 7 2 10 0v-5M21 9v6"/>',
};

export function icon(name, size = 18, cls = '') {
  const path = ICONS[name] || ICONS.grid;
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

const TABLER_MAP = {
  'book-2': 'book', book: 'book', trophy: 'trophy', coin: 'coin', 'help-circle': 'help',
  notes: 'notes', wrench: 'wrench', coffee: 'coffee', badge: 'badge', gamepad: 'gamepad',
  bag: 'bag', 'shopping-bag': 'bag', grid: 'grid', sparkles: 'sparkles', bell: 'bell', chart: 'chart',
  file: 'file', 'file-text': 'file', music: 'music', video: 'video', school: 'school',
};

export function appIcon(app, size = 22) {
  const raw = String(app?.icon || '');
  if (raw.startsWith('/media/') || /^https?:\/\//.test(raw)) {
    return `<div class="app-icon"><img src="${esc(raw)}" alt="" loading="lazy" /></div>`;
  }
  const name = raw.startsWith('tabler:') ? TABLER_MAP[raw.slice(7)] || 'grid' : 'grid';
  return `<div class="app-icon">${icon(name, size)}</div>`;
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

export function statusPill(status) {
  const [label, cls] = STATUS_META[status] || [status || '未知', 'draft'];
  return `<span class="pill ${cls}"><span class="pill-dot"></span>${esc(label)}</span>`;
}

export function visibilityPill(visibility) {
  const map = { public: '公开', logged_in: '登录可见', allowlist: '白名单' };
  return `<span class="pill ${visibility}">${map[visibility] || visibility}</span>`;
}

export function fmtDate(value, withTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  const base = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return withTime ? `${base} ${pad(date.getHours())}:${pad(date.getMinutes())}` : base;
}

export function timeAgo(value) {
  const t = Date.parse(value || '');
  if (!Number.isFinite(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 30 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`;
  return fmtDate(value, false);
}

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const init = {
    method,
    credentials: 'same-origin',
    headers: { ...headers },
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const type = res.headers.get('content-type') || '';
  let data = null;
  if (type.includes('json')) data = await res.json().catch(() => null);
  else data = await res.text().catch(() => '');
  if (!res.ok) {
    if (res.status === 401 && path.startsWith('/dev/v1') && !path.includes('/auth/login') && !path.includes('/auth/register') && !path.includes('/auth/me')) {
      state.me = null;
      if (!location.hash.startsWith('#/login')) location.hash = '#/login';
    }
    const error = new Error(data?.message || `请求失败（${res.status}）`);
    error.status = res.status;
    error.code = data?.code;
    error.requestId = data?.requestId;
    throw error;
  }
  return data;
}

export function toast(message, kind = 'ok') {
  const root = toastRoot();
  const el = document.createElement('div');
  el.className = `toast ${kind === 'err' ? 'err' : 'ok'}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(12px)';
    el.style.transition = '.25s';
    setTimeout(() => el.remove(), 260);
  }, 3200);
}

export function formError(form, err) {
  let el = form.querySelector('.form-error');
  if (!el) {
    el = document.createElement('div');
    el.className = 'form-error';
    form.prepend(el);
  }
  el.textContent = err?.message || '操作失败，请稍后再试';
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export function setBusy(form, busy) {
  const btn = form.querySelector('button[type="submit"]');
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '处理中…';
  } else {
    btn.disabled = false;
    if (btn.dataset.label) btn.textContent = btn.dataset.label;
  }
}

export function skeleton(rows = 3, height = 16) {
  return `<div>${Array.from({ length: rows }, () => `<div class="skeleton loading-line" style="height:${height}px"></div>`).join('')}</div>`;
}

export function emptyState(iconName, title, desc, action = '') {
  return `<div class="empty">
    <div class="ei">${icon(iconName, 24)}</div>
    <h3>${esc(title)}</h3>
    <p>${esc(desc)}</p>
    ${action}
  </div>`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制到剪贴板');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('已复制到剪贴板'); } catch { toast('复制失败，请手动选择', 'err'); }
    ta.remove();
  }
}

export function openFormModal({ title, body, submitText = '确定', danger = false, onSubmit }) {
  const root = modalRoot();
  root.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop>
      <form class="modal" data-modal-form novalidate>
        <div class="modal-head">
          <h3>${esc(title)}</h3>
          <button type="button" class="icon-close" data-modal-close aria-label="关闭">${icon('x', 18)}</button>
        </div>
        <div class="modal-body">${body}</div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" data-modal-close>取消</button>
          <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(submitText)}</button>
        </div>
      </form>
    </div>`;
  const form = root.querySelector('[data-modal-form]');
  const backdrop = root.querySelector('[data-modal-backdrop]');
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  root.querySelectorAll('[data-modal-close]').forEach((btn) => btn.addEventListener('click', close));
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setBusy(form, true);
    try {
      await onSubmit(form, close);
    } catch (err) {
      formError(form, err);
    } finally {
      setBusy(form, false);
    }
  });
  setTimeout(() => form.querySelector('input, textarea, select')?.focus(), 30);
  return { form, close };
}

export function confirmModal({ title, message, confirmText = '确定', danger = true }) {
  return new Promise((resolve) => {
    const root = modalRoot();
    root.innerHTML = `
      <div class="modal-backdrop" data-modal-backdrop>
        <div class="modal" style="max-width:430px">
          <div class="modal-head"><h3>${esc(title)}</h3>
            <button type="button" class="icon-close" data-modal-close>${icon('x', 18)}</button></div>
          <div class="modal-body"><p class="muted" style="font-size:13px;line-height:1.75">${esc(message)}</p></div>
          <div class="modal-foot">
            <button type="button" class="btn btn-ghost" data-modal-close>取消</button>
            <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-modal-confirm>${esc(confirmText)}</button>
          </div>
        </div>
      </div>`;
    const backdrop = root.querySelector('[data-modal-backdrop]');
    const close = (value) => { root.innerHTML = ''; resolve(value); };
    root.querySelectorAll('[data-modal-close]').forEach((btn) => btn.addEventListener('click', () => close(false)));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(false); });
    root.querySelector('[data-modal-confirm]').addEventListener('click', () => close(true));
  });
}

export function scopeChecks(selected = []) {
  return `<div class="grid grid-2" style="gap:9px">${Object.entries(SCOPE_META).map(([key, [title, desc]]) => `
    <label class="check ${selected.includes(key) ? 'on' : ''}">
      <input type="checkbox" name="scopes" value="${key}" ${selected.includes(key) ? 'checked' : ''} />
      <span><span class="ci-title">${title}</span><br /><span class="ci-desc">${key}</span></span>
    </label>`).join('')}</div>`;
}

export function categoryOptions(selected = 'content') {
  return Object.entries(CATEGORY_NAMES).map(([key, name]) => (
    `<option value="${key}" ${selected === key ? 'selected' : ''}>${name}</option>`
  )).join('');
}