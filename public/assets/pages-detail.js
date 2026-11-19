import { state } from './state.js';
import {
  api, icon, esc, statusPill, visibilityPill, fmtDate, scopeChecks, categoryOptions,
  emptyState, AUDIT_LABELS,
} from './ui.js';
import { shell, setContent, appIconHtml, categoryLabel } from './console-shell.js';
import { errorPanel } from './pages-dashboard.js';

const TABS = [
  ['overview', '概览'],
  ['config', '开发配置'],
  ['versions', '版本管理'],
  ['audit', '审核记录'],
  ['stats', '数据统计'],
];

export async function renderAppDetail(appKey, tab = 'overview') {
  shell('apps', '小程序管理');
  let app;
  try {
    const data = await api(`/dev/v1/apps/${encodeURIComponent(appKey)}`);
    app = data.app;
  } catch (err) {
    setContent(errorPanel(err));
    return;
  }
  state.detail = app;
  let stats = null;
  let audit = null;
  try {
    if (tab === 'stats') stats = await api(`/dev/v1/apps/${encodeURIComponent(appKey)}/stats?days=14`);
    if (tab === 'audit') audit = (await api(`/dev/v1/apps/${encodeURIComponent(appKey)}/audit-logs`)).items;
  } catch (err) {
    setContent(errorPanel(err));
    return;
  }
  state.stats = stats?.items || null;
  state.audit = audit;

  const actions = [];
  if (app.status === 'draft' || app.status === 'rejected' || app.status === 'offline') {
    actions.push(`<button class="btn btn-primary" data-action="submit-app" data-key="${esc(app.appKey)}">${icon('upload', 15)} 提交审核</button>`);
  }
  if (app.status === 'approved') {
    actions.push(`<button class="btn btn-primary" data-action="publish-app" data-key="${esc(app.appKey)}">${icon('check', 15)} 发布上线</button>`);
  }
  if (app.status === 'published') {
    actions.push(`<a class="btn btn-ghost" href="${esc(app.entryURL)}" target="_blank" rel="noreferrer">${icon('external', 15)} 打开</a>`);
    actions.push(`<button class="btn btn-ghost" data-action="unpublish-app" data-key="${esc(app.appKey)}">下架</button>`);
  }
  if (['draft', 'rejected', 'offline'].includes(app.status)) {
    actions.push(`<button class="btn btn-danger" data-action="delete-app" data-key="${esc(app.appKey)}">${icon('trash', 15)} 删除</button>`);
  }

  const tabHtml = TABS.map(([key, label]) => (
    `<a class="tab ${tab === key ? 'on' : ''}" href="#/apps/${encodeURIComponent(app.appKey)}/${key}">${label}</a>`
  )).join('');

  const body = tab === 'config' ? configTab(app)
    : tab === 'versions' ? versionsTab(app)
      : tab === 'audit' ? auditTab(app, audit)
        : tab === 'stats' ? statsTab(app, stats)
          : overviewTab(app);

  setContent(`
    <a class="link small" href="#/apps" style="display:inline-flex;align-items:center;gap:4px;margin-bottom:14px">${icon('arrowLeft', 13)} 返回我的小程序</a>
    <div class="detail-head">
      ${appIconHtml(app)}
      <div class="grow">
        <div class="row wrap" style="gap:9px">
          <h1>${esc(app.name)}</h1>${statusPill(app.status)}
        </div>
        <div class="sub">
          <span class="mono">${esc(app.appKey)}</span>
          <button class="btn btn-icon btn-ghost" style="width:25px;height:25px" data-action="copy" data-copy="${esc(app.appKey)}" title="复制 AppKey">${icon('copy', 13)}</button>
          <span>·</span><span>${esc(categoryLabel(app.category))}</span>
          <span>·</span><span>v${esc(app.version)}</span>
          <span>·</span><span>${esc(app.ownerType === 'official' ? '官方' : '第三方')}</span>
        </div>
      </div>
      <div class="detail-actions">${actions.join('')}</div>
    </div>
    <div class="tabs">${tabHtml}</div>
    ${body}`);
}

function rejectAlert(app) {
  if (app.status !== 'rejected' || !app.rejectReason) return '';
  return `<div class="alert alert-danger">${icon('alert', 16)}<div><b>审核未通过</b><div style="margin-top:3px">${esc(app.rejectReason)}</div></div></div>`;
}

function reviewAlert(app) {
  if (app.status !== 'reviewing') return '';
  return `<div class="alert alert-warn">${icon('clock', 16)}<div><b>审核中</b><div style="margin-top:3px">审核期间不能修改配置。审核通过后需要你手动点击「发布上线」。</div></div></div>`;
}

function overviewTab(app) {
  const scopes = app.scopes || [];
  return `
  <div class="grid" style="grid-template-columns:1.5fr 1fr;align-items:start">
    <div class="stack">
      ${rejectAlert(app)}
      ${reviewAlert(app)}
      <div class="card card-pad">
        <h3 style="font-size:15px;margin-bottom:8px">简介</h3>
        <p class="muted" style="font-size:13px;line-height:1.8">${esc(app.description || '还没有填写简介。可在「开发配置」中补充。')}</p>
        <div class="divider"></div>
        <div class="kv"><span class="k">入口地址</span><span class="v mono">${esc(app.entryURL || '未配置')}</span></div>
        <div class="kv"><span class="k">允许 origin</span><span class="v mono">${esc((app.allowedOrigins || []).join('、') || '未配置')}</span></div>
        <div class="kv"><span class="k">可见范围</span><span class="v">${visibilityPill(app.visibility)}</span></div>
        <div class="kv"><span class="k">当前版本</span><span class="v">${esc(app.version)}</span></div>
        <div class="kv"><span class="k">创建时间</span><span class="v">${fmtDate(app.createdAt)}</span></div>
        <div class="kv"><span class="k">更新时间</span><span class="v">${fmtDate(app.updatedAt)}</span></div>
      </div>

      <div class="card card-pad">
        <div class="between" style="margin-bottom:12px"><h3 style="font-size:15px">在 App 内打开</h3>
          <a class="link small" href="#/docs">完整文档 ${icon('chevron', 12)}</a></div>
        <p class="muted small" style="line-height:1.8">发布后，用户可以在集市 App 首页下拉的小程序面板中找到「${esc(app.name)}」。</p>
        <p class="muted small" style="line-height:1.8;margin-top:8px">登录、授权和会话由平台自动处理，开发者只需要提供页面。</p>
      </div>
    </div>

    <aside class="stack">
      <div class="card card-pad">
        <h3 style="font-size:14px;margin-bottom:10px">申请的权限</h3>
        ${scopes.length ? scopes.map((s) => `<div class="row" style="padding:7px 0;border-bottom:1px dashed var(--line)">
          <span class="pill approved">${esc(s)}</span></div>`).join('') : '<p class="muted small">暂未申请权限。</p>'}
        <p class="muted tiny" style="margin-top:10px;line-height:1.6">最小权限原则：只申请功能实际需要的 scope。</p>
      </div>
      <div class="card card-pad">
        <h3 style="font-size:14px;margin-bottom:10px">下一步</h3>
        <div class="stack" style="gap:8px">
          <a class="btn btn-ghost btn-sm" href="#/apps/${encodeURIComponent(app.appKey)}/config">${icon('sliders', 14)} 检查开发配置</a>
          <a class="btn btn-ghost btn-sm" href="#/apps/${encodeURIComponent(app.appKey)}/versions">${icon('file', 14)} 版本与审核</a>
          <a class="btn btn-ghost btn-sm" href="#/apps/${encodeURIComponent(app.appKey)}/stats">${icon('chart', 14)} 查看调用数据</a>
        </div>
      </div>
    </aside>
  </div>`;
}

function configTab(app) {
  const locked = app.status === 'reviewing';
  return `
  <div class="stack">
    ${reviewAlert(app)}
    <div class="card card-pad">
      <div class="between" style="margin-bottom:14px">
        <div><h3 style="font-size:15px">开发者凭证</h3><p class="muted tiny" style="margin-top:3px">AppSecret 仅用于服务端签名，切勿放入前端。</p></div>
        <span class="pill approved">${icon('lock', 11)} 服务端专用</span>
      </div>
      <div class="field" style="margin-bottom:12px">
        <label>AppKey</label>
        <div class="copy-field">
          <input class="input mono" readonly value="${esc(app.appKey)}" />
          <button class="btn btn-ghost" type="button" data-action="copy" data-copy="${esc(app.appKey)}">${icon('copy', 15)}</button>
        </div>
      </div>
      <div class="field">
        <label>AppSecret</label>
        <div class="secret-box">
          <code id="secret-value" data-secret="${app.appKey}">••••••••••••••••••••••••••••</code>
          <button class="btn btn-ghost btn-sm" type="button" data-action="reveal-secret" data-key="${esc(app.appKey)}">${icon('eye', 14)} 查看</button>
          <button class="btn btn-ghost btn-sm" type="button" data-action="rotate-secret" data-key="${esc(app.appKey)}">${icon('refresh', 14)} 重置</button>
        </div>
        <span class="hint">重置后旧密钥立即失效，请同步更新你的服务端。</span>
      </div>
    </div>

    <form class="card card-pad form-grid" data-form="app-config" data-key="${esc(app.appKey)}" novalidate>
      <h3 style="font-size:15px">基本信息</h3>
      <div class="grid grid-2">
        <div class="field"><label>名称</label><input class="input" name="name" value="${esc(app.name)}" maxlength="32" ${locked ? 'disabled' : ''} /></div>
        <div class="field"><label>分类</label><select class="select" name="category" ${locked ? 'disabled' : ''}>${categoryOptions(app.category)}</select></div>
      </div>
      <div class="field"><label>简介</label><textarea class="textarea" name="description" maxlength="200" ${locked ? 'disabled' : ''}>${esc(app.description)}</textarea></div>

      <div class="divider"></div>
      <h3 style="font-size:15px">开发配置</h3>
      <div class="field">
        <label>入口地址</label>
        <input class="input mono" name="entryURL" value="${esc(app.entryURL)}" placeholder="https://mp-app.example.com/your-app" ${locked ? 'disabled' : ''} />
      </div>
      <div class="field">
        <label>允许的 origin <span class="muted tiny">（一行一个）</span></label>
        <textarea class="textarea mono" name="allowedOrigins" ${locked ? 'disabled' : ''}>${esc((app.allowedOrigins || []).join('\n'))}</textarea>
      </div>
      <div class="grid grid-2">
        <div class="field"><label>可见范围</label>
          <select class="select" name="visibility" ${locked ? 'disabled' : ''}>
            <option value="public" ${app.visibility === 'public' ? 'selected' : ''}>公开</option>
            <option value="logged_in" ${app.visibility === 'logged_in' ? 'selected' : ''}>登录可见</option>
            <option value="allowlist" ${app.visibility === 'allowlist' ? 'selected' : ''}>白名单</option>
          </select>
        </div>
        <div class="field"><label>Webhook <span class="muted tiny">（预留）</span></label><input class="input mono" name="webhookUrl" value="${esc(app.webhookUrl || '')}" placeholder="https://…" ${locked ? 'disabled' : ''} /></div>
      </div>
      <div class="field"><label>权限</label>${scopeChecks(app.scopes || []).replace(/<input type="checkbox"/g, locked ? '<input type="checkbox" disabled' : '<input type="checkbox"')}</div>
      <div class="row" style="justify-content:flex-end">
        <button class="btn btn-primary" type="submit" ${locked ? 'disabled' : ''}>保存修改</button>
      </div>
    </form>
  </div>`;
}

function versionsTab(app) {
  const versions = app.versions || [];
  const rows = versions.map((v) => `
    <tr>
      <td><b class="mono">${esc(v.version)}</b></td>
      <td>${statusPill(v.status)}</td>
      <td class="muted" style="max-width:340px">${esc(v.changelog || '—')}</td>
      <td class="muted">${v.submittedAt ? fmtDate(v.submittedAt) : '—'}</td>
      <td style="text-align:right">${v.status === 'approved'
        ? `<button class="btn btn-primary btn-sm" data-action="publish-version" data-key="${esc(app.appKey)}" data-version-id="${v.id}">发布此版本</button>`
        : ''}</td>
    </tr>`).join('');
  return `
  <div class="stack">
    ${rejectAlert(app)}
    ${reviewAlert(app)}
    <div class="between">
      <div><h3 style="font-size:15px">版本记录</h3><p class="muted tiny" style="margin-top:3px">提交审核时会生成版本快照，发布后入口与权限以该版本为准。</p></div>
      <button class="btn btn-primary" data-action="version-modal" data-key="${esc(app.appKey)}" ${app.status === 'reviewing' ? 'disabled' : ''}>${icon('plus', 15)} 提交新版本</button>
    </div>
    <div class="table-wrap">
      ${versions.length ? `<table class="table">
        <thead><tr><th>版本</th><th>状态</th><th>版本说明</th><th>提交时间</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>` : emptyState('file', '还没有版本记录', '提交审核时会自动创建第一个版本。')}
    </div>
  </div>`;
}

function auditTab(app, items = []) {
  if (!items || !items.length) {
    return `<div class="card">${emptyState('clock', '暂无审核记录', '创建、提交、审核、发布等操作都会记录在这里。')}</div>`;
  }
  return `<div class="card card-pad">
    <div class="timeline">
      ${items.map((item) => `
        <div class="tl-item">
          <div class="tl-time">${fmtDate(item.createdAt)}</div>
          <div class="tl-title">${esc(AUDIT_LABELS[item.action] || item.action)}</div>
          <div class="tl-desc">
            ${item.actorType === 'admin' ? '平台管理员' : item.actorType === 'system' ? '系统' : '开发者'}
            ${item.after?.reason ? ` · ${esc(item.after.reason)}` : ''}
            ${item.after?.version ? ` · v${esc(item.after.version)}` : ''}
            ${item.after?.status ? ` · ${esc(item.after.status)}` : ''}
          </div>
        </div>`).join('')}
    </div>
  </div>`;
}

function statsTab(app, stats) {
  if (!stats) {
    return `<div class="card">${emptyState('chart', '暂无统计数据', '小程序发布并开始使用后，这里会展示近 14 天的调用量。')}</div>`;
  }
  const items = stats.items || [];
  const max = Math.max(1, ...items.map((i) => i.calls));
  const totalCalls = items.reduce((sum, i) => sum + i.calls, 0);
  const totalUsers = items.reduce((sum, i) => sum + i.users, 0);
  const peak = items.reduce((best, i) => (i.calls > best.calls ? i : best), { calls: 0, date: '—' });
  return `
  <div class="stack">
    <div class="stat-grid">
      <div class="stat"><div class="lab">${icon('chart', 14)} 近 14 天调用</div><div class="val">${totalCalls.toLocaleString()}</div><div class="sub">打开次数与接口调用</div></div>
      <div class="stat"><div class="lab">${icon('users', 14)} 活跃用户（近似）</div><div class="val">${totalUsers.toLocaleString()}</div><div class="sub">按每天去重后累加</div></div>
      <div class="stat"><div class="lab">${icon('bolt', 14)} 峰值单日</div><div class="val">${peak.calls.toLocaleString()}</div><div class="sub">${peak.date}</div></div>
      <div class="stat"><div class="lab">${icon('clock', 14)} 会话有效期</div><div class="val">2<small>小时</small></div><div class="sub">滑动续期</div></div>
    </div>
    <div class="card card-pad">
      <div class="between" style="margin-bottom:10px"><h3 style="font-size:15px">调用趋势</h3><span class="muted tiny">最近 14 天</span></div>
      <div class="barchart">
        ${items.map((item) => `<div class="bar" style="height:${Math.max(2, Math.round((item.calls / max) * 100))}%">
          <span class="tip">${item.date.slice(5)} · ${item.calls} 次 / ${item.users} 人</span></div>`).join('')}
      </div>
      <div class="chart-labels">${items.map((item, i) => `<span>${i % 2 === 0 ? item.date.slice(5) : ''}</span>`).join('')}</div>
    </div>
    <div class="card card-pad">
      <h3 style="font-size:14px;margin-bottom:8px">说明</h3>
      <p class="muted small" style="line-height:1.8">统计由平台聚合，用于趋势观察；不包含被限流拒绝的请求。如需精确计费数据，请以网关日志为准。</p>
    </div>
  </div>`;
}