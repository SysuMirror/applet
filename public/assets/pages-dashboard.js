import { state } from './state.js';
import { api, icon, esc, emptyState } from './ui.js';
import { shell, setContent, statCard, appCard } from './console-shell.js';

function greeting() {
  let h = new Date().getHours();
  try {
    h = Number(new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false,
    }).format(new Date()));
  } catch { /* fallback to local */ }
  if (h < 6) return '夜深了';
  if (h < 12) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

function welcomeBlock() {
  const name = esc(state.me?.displayName || '开发者');
  return `<div class="page-head">
    <div><h1>${greeting()}，${name}</h1>
      <p>这里是你的开放平台工作台，跟踪审核进度与调用数据。</p></div>
    <div class="row"><a class="btn btn-primary" href="#/apps/new">${icon('plus', 16)} 创建小程序</a></div>
  </div>`;
}

function firstAppBanner() {
  const name = esc(state.me?.displayName || '开发者');
  return `<div class="onboarding-card">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap">
      <div>
        <div class="onboarding-eyebrow">WELCOME TO THE OPEN PLATFORM</div>
        <h2>${greeting()}，${name}</h2>
        <p>创建你的第一个小程序，完成配置后提交审核。审核通过即可在 App 内发布。</p>
      </div>
      <a class="btn btn-primary" href="#/apps/new">${icon('plus', 16)} 创建小程序</a>
    </div>
  </div>`;
}

function todoBlock(todo) {
  if (!todo.length) {
    return `<div class="center muted small" style="padding:22px 0">${icon('check', 22)}<div style="margin-top:8px">没有待处理事项</div></div>`;
  }
  return todo.slice(0, 4).map((item) => {
    const cls = item.tone === 'danger' ? 'rejected' : item.tone === 'warn' ? 'reviewing' : 'approved';
    const label = item.tone === 'danger' ? '驳回' : item.tone === 'warn' ? '审核' : '发布';
    return `<a href="${esc(item.href)}" style="display:block;padding:11px 0;border-bottom:1px solid var(--line);color:inherit">
      <div class="row" style="gap:8px"><span class="pill ${cls}">${label}</span>
        <span style="font-size:12.5px;font-weight:600" class="truncate">${esc(item.title)}</span></div>
      <div class="muted tiny" style="margin-top:5px;line-height:1.5">${esc(item.desc)}</div>
    </a>`;
  }).join('');
}

export async function renderDashboard() {
  shell('dashboard', '概览');
  let data;
  try {
    data = await api('/dev/v1/overview');
  } catch (err) {
    setContent(errorPanel(err));
    return;
  }
  const s = data.stats || {};
  const apps = data.recentApps || [];
  const todo = [];
  for (const app of apps) {
    if (app.status === 'rejected') {
      todo.push({
        title: `${app.name} 审核未通过`,
        desc: app.rejectReason || '请根据驳回原因修改后重新提交',
        href: `#/apps/${app.appKey}/overview`,
        tone: 'danger',
      });
    } else if (app.status === 'reviewing') {
      todo.push({ title: `${app.name} 审核中`, desc: '平台正在审核，通常 1 个工作日内完成', href: `#/apps/${app.appKey}/overview`, tone: 'warn' });
    } else if (app.status === 'approved') {
      todo.push({ title: `${app.name} 已通过审核`, desc: '审核通过，等待你发布上线', href: `#/apps/${app.appKey}/versions`, tone: 'info' });
    }
  }
  const recentHtml = apps.length
    ? `<div class="app-grid" style="grid-template-columns:repeat(2,1fr)">${apps.slice(0, 4).map(appCard).join('')}</div>`
    : emptyState('grid', '还没有小程序', '创建第一个小程序，配置入口与权限后即可提交审核。', '');

  setContent(`
    ${s.apps ? welcomeBlock() : firstAppBanner()}
    <div class="stat-grid">
      ${statCard('我的小程序', s.apps ?? 0, '全部状态', 'grid')}
      ${statCard('已发布', s.published ?? 0, '用户可打开', 'check')}
      ${statCard('审核中', s.reviewing ?? 0, '等待平台处理', 'clock')}
      ${statCard('近 14 天调用', (s.calls14d ?? 0).toLocaleString(), '打开与接口调用', 'chart')}
    </div>
    <div class="grid" style="grid-template-columns:1.55fr 1fr;align-items:start">
      <section class="stack">
        <div class="between" style="margin-bottom:2px">
          <h3 style="font-size:15px">最近的小程序</h3>
          <a class="link small" href="#/apps">查看全部 ${icon('chevron', 12)}</a>
        </div>
        ${recentHtml}
      </section>
      <aside class="stack">
        <div class="card card-pad">
          <div class="between" style="margin-bottom:14px"><h3 style="font-size:14px">待办</h3><span class="pill draft">${todo.length}</span></div>
          ${todoBlock(todo)}
        </div>
        <div class="card card-pad">
          <h3 style="font-size:14px;margin-bottom:10px">接入三步</h3>
          <ol class="muted" style="font-size:12px;line-height:1.9;padding-left:18px;margin:0">
            <li>在 <a href="#/apps/new">创建小程序</a> 填写入口与 origin</li>
            <li>用户打开后自动完成登录授权</li>
            <li>提交审核，通过后发布上线</li>
          </ol>
        </div>
        <div class="card card-pad">
          <h3 style="font-size:14px;margin-bottom:10px">安全提示</h3>
          <p class="muted small" style="line-height:1.75">AppSecret 只应保存在你自己的服务端；不要写进前端代码，也不要提交到公开仓库。</p>
        </div>
      </aside>
    </div>`);
}

export function errorPanel(err) {
  const requestLine = err?.requestId
    ? `<br /><span class="mono tiny">requestId: ${esc(err.requestId)}</span>`
    : '';
  return `<div class="card card-pad center" style="padding:50px 24px">
    <div style="width:52px;height:52px;border-radius:15px;background:var(--danger-050);color:#b42318;display:grid;place-items:center;margin:0 auto 14px">${icon('alert', 24)}</div>
    <h3>加载失败</h3>
    <p class="muted small" style="margin:6px 0 18px">${esc(err?.message || '请稍后重试')}${requestLine}</p>
    <button class="btn btn-primary" data-action="reload">${icon('refresh', 15)} 重试</button>
  </div>`;
}