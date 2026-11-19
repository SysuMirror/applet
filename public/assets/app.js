import { state } from './state.js';
import {
  api, toast, esc, icon, copyText, openFormModal, confirmModal, formError, setBusy,
  scopeChecks, categoryOptions, statusPill,
} from './ui.js';
import { renderLanding, renderAuth } from './pages-public.js';
import { renderDashboard } from './pages-dashboard.js';
import { renderApps, renderAppsList, renderNewApp } from './pages-apps.js';
import { renderAppDetail } from './pages-detail.js';
import { renderAccount } from './pages-account.js';
import { renderDocs, renderDocsPublic } from './pages-docs.js';

// ── 路由 ────────────────────────────────────────────────────────────────
function parseRoute() {
  const raw = location.hash.slice(1) || '/';
  const qIndex = raw.indexOf('?');
  const path = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const query = new URLSearchParams(qIndex >= 0 ? raw.slice(qIndex + 1) : '');
  return { parts: path.split('/').filter(Boolean), query, raw };
}

async function route() {
  const rawHash = location.hash.slice(1);
  if (rawHash && !rawHash.startsWith('/')) {
    if (!document.querySelector('.landing') && !document.querySelector('.console') && !state.me) renderLanding();
    const target = document.getElementById(rawHash);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const { parts, query } = parseRoute();
  const [root, second, third] = parts;

  if (root === 'login' || root === 'register') {
    if (state.me) { location.hash = '#/dashboard'; return; }
    renderAuth(root, query);
    return;
  }
  if (!root) { renderLanding(); return; }
  if (root === 'docs') {
    if (state.me) renderDocs(); else renderDocsPublic();
    return;
  }
  if (!state.me) {
    const next = `/${parts.join('/')}${location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : ''}`;
    location.hash = `#/login?next=${encodeURIComponent(next)}`;
    return;
  }
  if (root === 'dashboard') { await renderDashboard(); return; }
  if (root === 'apps') {
    if (second === 'new') { renderNewApp(); return; }
    if (second) {
      await renderAppDetail(decodeURIComponent(second), third || 'overview');
      return;
    }
    await renderApps();
    return;
  }
  if (root === 'account') { renderAccount(); return; }
  location.hash = '#/dashboard';
}

function safeNext(value) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '#/dashboard';
  return `#${value}`;
}

function handleApiError(err) {
  if (err?.status === 401) return;
  toast(err?.message || '操作失败，请稍后再试', 'err');
}

// ── 行为 ────────────────────────────────────────────────────────────────
document.addEventListener('click', async (event) => {
  const actionEl = event.target.closest('[data-action]');
  if (actionEl) {
    event.preventDefault();
    try {
      await handleAction(actionEl);
    } catch (err) {
      handleApiError(err);
    }
    return;
  }
  const navEl = event.target.closest('[data-nav]');
  if (navEl) {
    event.preventDefault();
    location.hash = navEl.dataset.nav;
  }
});

async function handleAction(el) {
  const action = el.dataset.action;
  switch (action) {
    case 'auth-tab': {
      const params = parseRoute().query;
      location.hash = `#/${el.dataset.mode}${params.get('next') ? `?next=${encodeURIComponent(params.get('next'))}` : ''}`;
      return;
    }
    case 'toggle-sidebar':
      document.getElementById('sidebar')?.classList.toggle('open');
      return;
    case 'logout': {
      await Promise.allSettled([
        api('/dev/v1/auth/logout', { method: 'POST', body: {} }),
        fetch('/auth/sso/logout', { method: 'POST', credentials: 'same-origin' }),
      ]);
      state.me = null;
      toast('已退出登录');
      location.hash = '#/';
      return;
    }
    case 'filter-status':
      state.filter.status = el.dataset.status || 'all';
      renderAppsList();
      return;
    case 'copy': {
      const target = el.dataset.copyTarget ? document.querySelector(el.dataset.copyTarget) : null;
      const text = el.dataset.copy || target?.value || target?.textContent || '';
      await copyText(text);
      return;
    }
    case 'copy-code': {
      const box = el.closest('.code-box');
      const pre = box?.querySelector('.code-pre');
      await copyText(pre ? pre.textContent : (box?.textContent || '').replace('复制', '').trim());
      return;
    }
    case 'pick-icon':
      document.querySelector('[data-upload-icon]')?.click();
      return;
    case 'reveal-secret': {
      const code = document.getElementById('secret-value');
      if (code?.dataset.revealed === '1') {
        code.textContent = '••••••••••••••••••••••••••••';
        code.dataset.revealed = '0';
        el.innerHTML = `${icon('eye', 14)} 查看`;
        return;
      }
      const data = await api(`/dev/v1/apps/${encodeURIComponent(el.dataset.key)}/secret/reveal`, { method: 'POST', body: {} });
      if (code) {
        code.textContent = data.secret;
        code.dataset.revealed = '1';
      }
      el.innerHTML = `${icon('eye', 14)} 隐藏`;
      return;
    }
    case 'rotate-secret': {
      const ok = await confirmModal({
        title: '重置 AppSecret',
        message: '重置后旧密钥会立即失效，所有使用旧密钥的服务端调用都会失败。确认继续？',
        confirmText: '确认重置',
      });
      if (!ok) return;
      const data = await api(`/dev/v1/apps/${encodeURIComponent(el.dataset.key)}/secret/rotate`, { method: 'POST', body: {} });
      const code = document.getElementById('secret-value');
      if (code) { code.textContent = data.secret; code.dataset.revealed = '1'; }
      toast('AppSecret 已重置，请更新服务端配置');
      return;
    }
    case 'submit-app':
      await openSubmitModal(el.dataset.key, '提交审核');
      return;
    case 'version-modal':
      await openSubmitModal(el.dataset.key, '提交新版本');
      return;
    case 'publish-app': {
      const ok = await confirmModal({
        title: '发布小程序',
        message: '审核通过的版本将立即对用户可见。发布后如需修改，需要重新提交审核。',
        confirmText: '确认发布',
        danger: false,
      });
      if (!ok) return;
      await api(`/dev/v1/apps/${encodeURIComponent(el.dataset.key)}/publish`, { method: 'POST', body: {} });
      toast('小程序已发布');
      await route();
      return;
    }
    case 'publish-version': {
      const ok = await confirmModal({
        title: '发布此版本',
        message: `确认发布版本？发布后入口地址、origin 与权限将以该版本为准。`,
        confirmText: '确认发布',
        danger: false,
      });
      if (!ok) return;
      await api(`/dev/v1/apps/${encodeURIComponent(el.dataset.key)}/publish`, {
        method: 'POST',
        body: { versionId: Number(el.dataset.versionId) },
      });
      toast('版本已发布');
      await route();
      return;
    }
    case 'unpublish-app': {
      const ok = await confirmModal({
        title: '下架小程序',
        message: '下架后用户将无法再打开这个小程序，已签发的会话仍可能在有效期内继续使用。',
        confirmText: '确认下架',
      });
      if (!ok) return;
      await api(`/dev/v1/apps/${encodeURIComponent(el.dataset.key)}/unpublish`, { method: 'POST', body: {} });
      toast('小程序已下架');
      await route();
      return;
    }
    case 'delete-app': {
      const ok = await confirmModal({
        title: '删除小程序',
        message: '删除后不可恢复，目录与会话将立即失效。建议先下架并保留数据。',
        confirmText: '删除',
      });
      if (!ok) return;
      await api(`/dev/v1/apps/${encodeURIComponent(el.dataset.key)}`, { method: 'DELETE' });
      toast('小程序已删除');
      location.hash = '#/apps';
      return;
    }
    case 'reload':
      await route();
      return;
    default:
      return;
  }
}

async function openSubmitModal(appKey, title) {
  const { app } = await api(`/dev/v1/apps/${encodeURIComponent(appKey)}`);
  const nextVersion = bumpVersion(app.version);
  const body = `
    <div class="stack">
      <div class="alert alert-info">${icon('shield', 15)}<span>提交后进入审核，审核期间不能修改配置。审核通过后请手动发布。</span></div>
      <div class="field"><label>版本号</label><input class="input mono" name="version" value="${esc(nextVersion)}" required /></div>
      <div class="field"><label>版本说明</label><textarea class="textarea" name="changelog" maxlength="2000" placeholder="说明本次更新内容，便于审核" required></textarea></div>
      <div class="field"><label>入口地址</label><input class="input mono" name="entryURL" value="${esc(app.entryURL)}" required /></div>
      <div class="field"><label>允许的 origin <span class="muted tiny">（一行一个）</span></label>
        <textarea class="textarea mono" name="allowedOrigins" required>${esc((app.allowedOrigins || []).join('\n'))}</textarea></div>
      <div class="field"><label>权限</label>${scopeChecks(app.scopes || [])}</div>
    </div>`;
  openFormModal({
    title,
    body,
    submitText: '提交审核',
    onSubmit: async (form, close) => {
      const fd = new FormData(form);
      const origins = String(fd.get('allowedOrigins') || '').split('\n').map((v) => v.trim()).filter(Boolean);
      if (!origins.length) throw new Error('请至少配置一个允许的 origin');
      const scopes = [...form.querySelectorAll('input[name="scopes"]:checked')].map((i) => i.value);
      await api(`/dev/v1/apps/${encodeURIComponent(appKey)}/submit`, {
        method: 'POST',
        body: {
          version: String(fd.get('version') || '').trim(),
          changelog: String(fd.get('changelog') || '').trim(),
          entryURL: String(fd.get('entryURL') || '').trim(),
          allowedOrigins: origins,
          scopes,
        },
      });
      close();
      toast('已提交审核');
      await route();
    },
  });
}

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const kind = form.dataset.form;
  setBusy(form, true);
  try {
    if (kind === 'login') await submitLogin(form);
    else if (kind === 'register') await submitRegister(form);
    else if (kind === 'create-app') await submitCreateApp(form);
    else if (kind === 'app-config') await submitAppConfig(form);
    else if (kind === 'account-profile') await submitProfile(form);
    else if (kind === 'account-password') await submitPassword(form);
  } catch (err) {
    // 登录/注册的 401 是凭证错误，必须展示；
    // 其它表单的 401 表示登录态失效，api() 已经会跳登录页，这里不再重复提示。
    if (err?.status === 401 && !['login', 'register'].includes(kind)) return;
    formError(form, err);
    handleApiError(err);
  } finally {
    setBusy(form, false);
  }
});

async function submitLogin(form) {
  const fd = new FormData(form);
  const data = await api('/dev/v1/auth/login', {
    method: 'POST',
    body: { email: fd.get('email'), password: fd.get('password') },
  });
  state.me = data.developer;
  toast(`欢迎回来，${state.me.displayName || state.me.email}`);
  location.hash = safeNext(fd.get('next'));
}

async function submitRegister(form) {
  const fd = new FormData(form);
  const data = await api('/dev/v1/auth/register', {
    method: 'POST',
    body: {
      email: fd.get('email'),
      password: fd.get('password'),
      displayName: fd.get('displayName'),
      orgName: fd.get('orgName') || '',
    },
  });
  state.me = data.developer;
  toast('开发者账号已创建');
  location.hash = safeNext(fd.get('next'));
}

async function submitCreateApp(form) {
  const fd = new FormData(form);
  const origins = String(fd.get('allowedOrigins') || '').split('\n').map((v) => v.trim()).filter(Boolean);
  const scopes = [...form.querySelectorAll('input[name="scopes"]:checked')].map((i) => i.value);
  const data = await api('/dev/v1/apps', {
    method: 'POST',
    body: {
      name: fd.get('name'),
      appKey: String(fd.get('appKey') || '').trim() || undefined,
      category: fd.get('category'),
      description: fd.get('description') || '',
      entryURL: String(fd.get('entryURL') || '').trim(),
      allowedOrigins: origins,
      visibility: fd.get('visibility'),
      scopes,
      webhookUrl: String(fd.get('webhookUrl') || '').trim(),
      icon: String(fd.get('icon') || ''),
    },
  });
  toast('小程序已创建');
  location.hash = `#/apps/${encodeURIComponent(data.app.appKey)}/config`;
}

async function submitAppConfig(form) {
  const fd = new FormData(form);
  const origins = String(fd.get('allowedOrigins') || '').split('\n').map((v) => v.trim()).filter(Boolean);
  const scopes = [...form.querySelectorAll('input[name="scopes"]:checked')].map((i) => i.value);
  await api(`/dev/v1/apps/${encodeURIComponent(form.dataset.key)}`, {
    method: 'PATCH',
    body: {
      name: fd.get('name'),
      category: fd.get('category'),
      description: fd.get('description') || '',
      entryURL: String(fd.get('entryURL') || '').trim(),
      allowedOrigins: origins,
      visibility: fd.get('visibility'),
      webhookUrl: String(fd.get('webhookUrl') || '').trim(),
      scopes,
    },
  });
  toast('配置已保存');
  await route();
}

async function submitProfile(form) {
  const fd = new FormData(form);
  const data = await api('/dev/v1/auth/me', {
    method: 'PATCH',
    body: {
      displayName: fd.get('displayName'),
      orgName: fd.get('orgName') || '',
      phone: fd.get('phone') || '',
    },
  });
  state.me = data.developer;
  toast('资料已更新');
  await route();
}

async function submitPassword(form) {
  const fd = new FormData(form);
  if (fd.get('newPassword') !== fd.get('confirmPassword')) throw new Error('两次输入的新密码不一致');
  await api('/dev/v1/auth/password', {
    method: 'POST',
    body: { currentPassword: fd.get('currentPassword'), newPassword: fd.get('newPassword') },
  });
  form.reset();
  toast('密码已更新，其他设备已退出登录');
}

document.addEventListener('input', (event) => {
  if (event.target.matches('[data-search="apps"]')) {
    state.filter.q = event.target.value;
    renderAppsList();
  }
});

document.addEventListener('change', async (event) => {
  if (event.target.matches('.check input[type="checkbox"]')) {
    event.target.closest('.check')?.classList.toggle('on', event.target.checked);
    return;
  }
  if (!event.target.matches('[data-upload-icon]')) return;
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      throw new Error('仅支持 PNG / JPEG / WebP / GIF');
    }
    if (file.size > 2 * 1024 * 1024) throw new Error('图片不能超过 2MB');
    const res = await fetch('/dev/v1/uploads', {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || '上传失败');
    const input = document.querySelector('form [name="icon"]');
    if (input) input.value = data.path;
    const preview = document.getElementById('icon-preview');
    if (preview) preview.innerHTML = `<img src="${esc(data.path || data.url)}" alt="" />`;
    toast('图标已上传');
  } catch (err) {
    toast(err.message || '上传失败', 'err');
  } finally {
    event.target.value = '';
  }
});

function bumpVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || '1.0.0'));
  if (!m) return '1.0.0';
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

async function boot() {
  try {
    const meta = await api('/dev/v1/categories');
    if (Array.isArray(meta.items) && meta.items.length) state.categories = meta.items;
    if (Array.isArray(meta.scopes) && meta.scopes.length) state.scopes = meta.scopes;
  } catch { /* 使用内置分类 */ }
  try {
    const me = await api('/dev/v1/auth/me');
    state.me = me.developer;
  } catch { state.me = null; }
  window.addEventListener('hashchange', () => {
    route().catch((err) => {
      document.getElementById('page-content')?.insertAdjacentHTML('afterbegin', `<div class="alert alert-danger">${esc(err?.message || '页面加载失败')}</div>`);
    });
  });
  await route();
}

document.addEventListener('error', (event) => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || !img.closest('.avatar')) return;
  const holder = img.closest('.avatar');
  img.remove();
  holder.textContent = holder.dataset.initial || '';
}, true);

boot();