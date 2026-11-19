import { state } from './state.js';
import {
  api, icon, esc, emptyState, categoryOptions, scopeChecks,
} from './ui.js';
import {
  shell, setContent, pageHead, appCard, categoryLabel,
} from './console-shell.js';
import { errorPanel } from './pages-dashboard.js';

const FILTERS = [
  ['all', '全部'], ['published', '已发布'], ['reviewing', '审核中'],
  ['draft', '草稿'], ['rejected', '已驳回'], ['offline', '已下架'],
];

export async function renderApps() {
  shell('apps', '我的小程序');
  try {
    const data = await api('/dev/v1/apps');
    state.apps = data.items || [];
  } catch (err) {
    setContent(errorPanel(err));
    return;
  }
  setContent(`
    ${pageHead('我的小程序', '管理小程序的开发配置、版本与审核状态。',
      '<a class="btn btn-primary" href="#/apps/new">' + icon('plus', 15) + ' 新建小程序</a>')}
    <div class="toolbar">
      <div class="search">${icon('search', 16)}
        <input class="input" placeholder="搜索名称或 appKey" data-search="apps" value="${esc(state.filter.q)}" />
      </div>
      <div class="seg" id="status-seg">
        ${FILTERS.map(([key, label]) => `<button type="button" class="${state.filter.status === key ? 'on' : ''}" data-action="filter-status" data-status="${key}">${label}</button>`).join('')}
      </div>
      <div class="grow"></div>
      <span class="muted small" id="apps-count"></span>
    </div>
    <div id="apps-list"></div>`);
  renderAppsList();
}

export function renderAppsList() {
  const holder = document.getElementById('apps-list');
  if (!holder) return;
  const { status, q } = state.filter;
  const term = q.trim().toLowerCase();
  const list = state.apps.filter((app) => {
    if (status !== 'all' && app.status !== status) return false;
    if (!term) return true;
    return app.name.toLowerCase().includes(term) || app.appKey.toLowerCase().includes(term);
  });
  document.querySelectorAll('#status-seg button').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.status === status);
  });
  const count = document.getElementById('apps-count');
  const filtered = status !== 'all' || Boolean(term);
  if (count) {
    count.textContent = filtered
      ? `筛选出 ${list.length} 个 · 共 ${state.apps.length} 个`
      : `共 ${state.apps.length} 个`;
  }

  if (!state.apps.length) {
    holder.innerHTML = `<div class="card">${emptyState('grid', '还没有小程序', '点击右上角「新建小程序」，填写入口地址与允许的 origin，即可提交审核。', '')}</div>`;
    return;
  }
  if (!list.length) {
    holder.innerHTML = `<div class="card">${emptyState('search', '没有匹配的小程序', '尝试切换筛选条件或更换关键词。')}</div>`;
    return;
  }
  holder.innerHTML = `<div class="app-grid">${list.map(appCard).join('')}</div>`;
}

export function renderNewApp() {
  shell('new', '创建小程序');
  const defaultOrigin = location.origin;
  setContent(`
    ${pageHead('创建小程序', '先创建草稿，补齐入口与权限后提交审核。')}
    <div class="grid" style="grid-template-columns:1.5fr 1fr;align-items:start">
      <form class="card card-pad form-grid" data-form="create-app" novalidate>
        <h3 style="font-size:15px">基本信息</h3>
        <div class="grid grid-2">
          <div class="field">
            <label>小程序名称 <span style="color:var(--danger)">*</span></label>
            <input class="input" name="name" placeholder="例如：学习笔记" maxlength="32" required />
          </div>
          <div class="field">
            <label>AppKey <span class="muted tiny">（选填）</span></label>
            <input class="input mono" name="appKey" placeholder="留空自动生成" pattern="[a-z][a-z0-9_-]{2,31}" />
            <span class="hint">小写字母开头，3~32 位；创建后不可修改。</span>
          </div>
        </div>
        <div class="grid grid-2">
          <div class="field">
            <label>分类</label>
            <select class="select" name="category">${categoryOptions('content')}</select>
          </div>
          <div class="field">
            <label>可见范围</label>
            <select class="select" name="visibility">
              <option value="public">公开 —— 未登录也可浏览</option>
              <option value="logged_in" selected>登录可见 —— 默认</option>
              <option value="allowlist">白名单 —— 指定用户</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>一句话简介</label>
          <textarea class="textarea" name="description" maxlength="200" placeholder="用 1~2 句话说明小程序提供的能力"></textarea>
        </div>
        <div class="field">
          <label>图标</label>
          <div class="row">
            <div class="app-icon" id="icon-preview">${icon('grid', 22)}</div>
            <div class="grow">
              <button type="button" class="btn btn-ghost btn-sm" data-action="pick-icon">${icon('upload', 15)} 上传图标</button>
              <div class="hint">PNG / JPEG / WebP / GIF，2MB 以内。也可以使用平台图标库。</div>
            </div>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-upload-icon hidden />
            <input type="hidden" name="icon" value="" />
          </div>
        </div>

        <div class="divider"></div>
        <h3 style="font-size:15px">开发配置</h3>
        <div class="field">
          <label>小程序入口地址 <span class="muted tiny">（可稍后填写）</span></label>
          <input class="input mono" name="entryURL" placeholder="https://mp-app.example.com/your-app" />
          <span class="hint">必须是 HTTPS；本地调试可填 <span class="mono">http://localhost:8080/demo/app</span>。</span>
        </div>
        <div class="field">
          <label>允许的 origin <span class="muted tiny">（一行一个）</span></label>
          <textarea class="textarea mono" name="allowedOrigins" placeholder="${esc(defaultOrigin)}">${esc(defaultOrigin)}</textarea>
          <span class="hint">填写小程序页面所在的 HTTPS 域名；提交审核时至少填写一个。入口地址的 origin 会自动补到第一位。</span>
        </div>
        <div class="field">
          <label>申请的权限</label>
          ${scopeChecks(['profile:read', 'prefs:read', 'prefs:write'])}
        </div>
        <div class="field">
          <label>Webhook 地址 <span class="muted tiny">（预留，暂未投递）</span></label>
          <input class="input mono" name="webhookUrl" placeholder="https://your-server.com/mp/events" />
          <span class="hint">预留字段：后续用于接收平台事件，需要 HTTPS。</span>
        </div>
        <div class="row" style="justify-content:flex-end;margin-top:6px">
          <a class="btn btn-ghost" href="#/apps">取消</a>
          <button class="btn btn-primary" type="submit">${icon('check', 16)} 创建小程序</button>
        </div>
      </form>

      <aside class="stack">
        <div class="card card-pad">
          <h3 style="font-size:14px;margin-bottom:10px">创建后会发生什么</h3>
          <ol class="muted small" style="padding-left:18px;line-height:1.9;margin:0">
            <li>生成 <b>AppKey</b> 与 <b>AppSecret</b>（密钥只显示一次，可重置）</li>
            <li>草稿状态下可随时修改入口、origin 与权限</li>
            <li>提交审核时平台会校验 HTTPS、origin 与权限范围</li>
            <li>审核通过后由你点击「发布」正式上线</li>
          </ol>
        </div>
        <div class="card card-pad">
          <h3 style="font-size:14px;margin-bottom:10px">安全建议</h3>
          <p class="muted small" style="line-height:1.8">官方小程序在 App 内复用主站登录态；独立窗口或第三方小程序使用平台登录页与会话。页面不需要收集主站密码，业务数据请通过平台会话或你自己的服务端获取。</p>
          <a class="btn btn-soft btn-sm" style="width:100%;margin-top:12px" href="#/docs">${icon('book', 15)} 查看接入流程</a>
        </div>
      </aside>
    </div>`);
}

export function categories() {
  return state.categories.map((c) => ({ ...c, label: categoryLabel(c.key) }));
}