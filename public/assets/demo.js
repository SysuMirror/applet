/* 小程序容器演示：只使用 MP SDK，不接触主站 token */

const view = document.getElementById('mp-view');
const menu = document.getElementById('mp-menu');
const sideTitle = document.getElementById('dp-title');
const sideDesc = document.getElementById('dp-desc');
const favBtn = document.getElementById('dp-fav');

const state = { session: null, app: null, prefs: null, favorite: false };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function toast(message) {
  document.querySelector('.mp-toast')?.remove();
  const el = document.createElement('div');
  el.className = 'mp-toast';
  el.textContent = message;
  document.getElementById('phone').appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

function errorView(title, detail) {
  view.innerHTML = `<div class="mp-error"><div class="big">⚠️</div><b>${esc(title)}</b><p>${esc(detail)}</p>
    <p style="margin-top:16px;font-size:11px">请返回 App，从下拉小程序面板重新打开。</p></div>`;
  sideTitle.textContent = '启动失败';
  sideDesc.textContent = detail;
}

function updateSide() {
  const { session, app } = state;
  sideTitle.textContent = app?.name || '小程序';
  sideDesc.textContent = app?.description || '这个页面运行在模拟的 WebView 容器中。';
  document.getElementById('dp-user').textContent = session?.userId || '—';
  document.getElementById('dp-app').textContent = app ? `${app.name} (${app.appKey})` : '—';
  document.getElementById('dp-exp').textContent = session?.expiresAt
    ? new Date(session.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : '—';
  document.getElementById('dp-scopes').textContent = (session?.scopes || []).join(', ') || '—';
  setFavoriteButton();
}

function setFavoriteButton() {
  const text = state.favorite ? '★ 已添加到我的小程序' : '☆ 添加到我的小程序';
  if (favBtn) favBtn.textContent = text;
  const menuButton = menu.querySelector('[data-mp-action="favorite"]');
  if (menuButton) menuButton.textContent = text;
}

const HERO = {
  novel: ['本周连载 · 编辑精选', '小说', '在故事里，遇见另一种生活。'],
  ranking: ['社区热榜 · 每小时更新', '排行榜', '看看此刻大家都在读什么。'],
  coin: ['金币商城 · 限时兑换', '金币商城', '把社区贡献换成喜欢的周边。'],
  help: ['官方 · 常见问题', '帮助中心', '社区规则、账号安全与反馈入口。'],
  'study-notes': ['效率工具 · 新上线', '学习笔记', '把帖子里的灵感，收进自己的笔记本。'],
  resume: ['求职工具 · 在线简历', '简历', '把经历整理成一份清晰、可投递的简历。'],
  media: ['音乐 / 视频 · 独立小程序', '音乐视频', '帖子里的声音与影像，边逛边听。'],
  shop: ['集市周边 · 会员权益', '商城', '用金币兑换喜欢的周边与权益。'],
  course: ['学习专区 · 课程与讲座', '课程专区', '把好内容留在手边，随时回看。'],
};

function heroHtml(appKey) {
  const [badge, title, desc] = HERO[appKey] || ['小程序 · 演示', state.app?.name || '小程序', state.app?.description || '由开放平台提供的小程序容器。'];
  return `<div class="mp-hero">
    <span class="badge">${esc(badge)}</span>
    <h1>${esc(title)}</h1>
    <p>${esc(desc)}</p>
  </div>`;
}

function contentFor(appKey) {
  if (appKey === 'novel') {
    return `${heroHtml(appKey)}
      <div class="mp-section">
        <h3>继续阅读</h3>
        <div class="mp-card"><div class="mp-row"><div class="mp-cover">📖</div>
          <div><div class="title">《山与海之间的距离》</div><div class="sub">第 42 章 · 读到 78% · 都市</div></div></div></div>
        <div class="mp-card"><div class="mp-row"><div class="mp-cover g2">🌙</div>
          <div><div class="title">《夜行列车》</div><div class="sub">第 12 章 · 悬疑 · 更新于 2 小时前</div></div></div></div>
      </div>
      <div class="mp-section"><h3>今日推荐</h3>
        <div class="mp-card"><div class="mp-row"><div class="mp-cover g3">✨</div>
          <div><div class="title">《把生活写成诗》</div><div class="sub">散文集 · 9.2 分 · 4.8 万人读过</div></div></div></div>
      </div>
      <div class="mp-section"><button class="mp-btn" data-demo="read">开始阅读</button>
        <button class="mp-btn ghost" data-demo="favorite">${state.favorite ? '★ 已添加到我的小程序' : '☆ 添加到我的小程序'}</button></div>
      <div class="mp-footer-note">由集市小程序开放平台提供 · 会话仅限本小程序</div>`;
  }
  if (appKey === 'ranking') {
    const items = [
      ['1', '想分享一件很有爱的事情', '主页 · 561 赞', true],
      ['2', '今天的晚霞像一封未寄出的信', '生活 · 388 赞', true],
      ['3', '写了一个自动整理书单的小工具', '技术 · 207 赞', false],
      ['4', '关于夏天的十个瞬间', '摄影 · 166 赞', false],
      ['5', '实验室摸鱼指南（认真版）', '校园 · 132 赞', false],
    ];
    return `${heroHtml(appKey)}
      <div class="mp-section"><h3>实时热榜</h3><div class="mp-card"><ul class="mp-list">
        ${items.map(([rank, title, meta, top]) => `<li><span class="rank ${top ? 'top' : ''}">${rank}</span>
          <div class="grow"><div class="title">${esc(title)}</div><div class="meta">${esc(meta)}</div></div>
          <span style="color:#cbd5e1">›</span></li>`).join('')}
      </ul></div></div>
      <div class="mp-section"><button class="mp-btn ghost" data-demo="favorite">${state.favorite ? '★ 已添加到我的小程序' : '☆ 添加到我的小程序'}</button></div>
      <div class="mp-footer-note">排行榜每 5 分钟刷新 · 数据来自主站内部接口</div>`;
  }
  if (appKey === 'coin') {
    return `${heroHtml(appKey)}
      <div class="mp-section"><div class="mp-card" style="background:linear-gradient(145deg,#f5f8ff,#eaf1ff);border-color:#dfe9ff">
        <div class="sub" style="color:#245bdb">我的金币</div>
        <div style="font-size:34px;font-weight:800;letter-spacing:-.03em;color:#171717">1,280</div>
        <div class="sub" style="color:#5f6368">今日签到 +10 · 连续 7 天</div></div></div>
      <div class="mp-section"><h3>可兑换</h3>
        <div class="mp-card"><div class="mp-row"><div class="mp-cover g2">🎫</div><div class="grow"><div class="title">会员月卡</div><div class="sub">800 金币 · 剩余 12 份</div></div><button class="mp-btn" style="width:auto;height:32px;padding:0 12px;margin:0;font-size:11px">兑换</button></div></div>
        <div class="mp-card"><div class="mp-row"><div class="mp-cover g3">🧸</div><div class="grow"><div class="title">集市小熊挂件</div><div class="sub">2,000 金币 · 包邮</div></div><button class="mp-btn ghost" style="width:auto;height:32px;padding:0 12px;margin:0;font-size:11px">去看看</button></div></div></div>
      <div class="mp-footer-note">金币与兑换由主站商城服务提供</div>`;
  }
  if (appKey === 'help') {
    const faqs = [
      ['如何修改昵称？', '在 App「我的 → 编辑资料」中修改，24 小时内生效。'],
      ['为什么看不到某些帖子？', '可能被作者设为私密，或触发了社区规则折叠。'],
      ['如何举报违规内容？', '长按帖子选择举报，或在小程序内提交反馈。'],
      ['账号被限制登录怎么办？', '请通过反馈入口提交申诉，附上账号与设备信息。'],
    ];
    return `${heroHtml(appKey)}
      <div class="mp-section"><h3>常见问题</h3>${faqs.map(([q, a]) => `
        <div class="mp-card"><div class="title">${esc(q)}</div><div class="sub">${esc(a)}</div></div>`).join('')}</div>
      <div class="mp-section"><button class="mp-btn" data-demo="feedback">提交反馈</button></div>
      <div class="mp-footer-note">官方小程序 · 由平台运营团队维护</div>`;
  }
  if (appKey === 'resume') {
    return `${heroHtml(appKey)}
      <div class="mp-section"><div class="mp-card">
        <div class="sub">简历完整度</div>
        <div style="font-size:30px;font-weight:800;letter-spacing:-.03em">86 <span style="font-size:12px;color:#9b9a94;font-weight:500">%</span></div>
        <div class="sub">补充项目经历后预计提升到 95%</div></div></div>
      <div class="mp-section"><h3>我的经历</h3>
        <div class="mp-card"><div class="title">教育经历</div><div class="sub">中山大学 · 软件工程 · 2023 - 2027</div></div>
        <div class="mp-card"><div class="title">项目经历</div><div class="sub">集市小程序开放平台 · 客户端接入</div></div>
        <div class="mp-card"><div class="title">技能标签</div><div class="sub">Flutter · TypeScript · Node.js · UI 设计</div></div>
        <button class="mp-btn" data-demo="resume-edit">编辑简历</button>
        <button class="mp-btn ghost" data-demo="resume-preview">预览并导出</button></div>
      <div class="mp-footer-note">简历数据仅保存在你自己的账号下</div>`;
  }
  if (appKey === 'media') {
    return `${heroHtml(appKey)}
      <div class="mp-section"><h3>正在播放</h3>
        <div class="mp-card">
          <div class="mp-row">
            <div class="mp-cover">🎵</div>
            <div class="grow"><div class="title">晚风电台 · Vol.12</div><div class="sub">集市音乐 · 20:00 · 循环播放</div></div>
            <button class="mp-btn" id="audio-toggle" style="width:auto;height:32px;padding:0 13px;margin:0;font-size:11px" data-demo="audio-toggle">播放</button>
          </div>
          <audio id="mp-audio" src="/assets/audio/ambient.wav" loop preload="none"></audio>
          <div class="sub" id="audio-state" style="margin-top:9px">点击播放，切到主站帖子页后音频会继续。</div>
        </div></div>
      <div class="mp-section"><h3>歌单</h3>
        <div class="mp-card"><div class="mp-row"><div class="mp-cover g2">🌙</div><div class="grow"><div class="title">夜行列车</div><div class="sub">环境音乐 · 03:12</div></div><span style="color:#9b9a94">···</span></div></div>
        <div class="mp-card"><div class="mp-row"><div class="mp-cover g3">✨</div><div class="grow"><div class="title">把生活写成诗</div><div class="sub">轻音乐 · 04:08</div></div><span style="color:#9b9a94">···</span></div></div></div>
      <div class="mp-section"><h3>视频</h3>
        <div class="mp-card" data-demo="video"><div class="mp-row"><div class="mp-cover g2">🎬</div><div class="grow"><div class="title">社团宣传片 · 2026</div><div class="sub">02:36 · 视频占位</div></div><span style="color:#9b9a94">▶</span></div></div>
        <button class="mp-btn ghost" data-demo="favorite">${state.favorite ? '★ 已添加到我的小程序' : '☆ 添加到我的小程序'}</button></div>
      <div class="mp-footer-note">音频由小程序页面播放；关闭小程序才会真正停止</div>`;
  }
  if (appKey === 'shop') {
    return `${heroHtml(appKey)}
      <div class="mp-section"><div class="mp-card">
        <div class="sub">我的金币</div>
        <div style="font-size:30px;font-weight:800;letter-spacing:-.03em">1,280</div>
        <div class="sub">签到 +10 / 天 · 连续 7 天</div></div></div>
      <div class="mp-section"><h3>周边兑换</h3>
        <div class="mp-card"><div class="mp-row"><div class="mp-cover g2">🧸</div><div class="grow"><div class="title">集市小熊挂件</div><div class="sub">2,000 金币 · 包邮</div></div><button class="mp-btn ghost" style="width:auto;height:30px;padding:0 10px;margin:0;font-size:10px" data-demo="shop-item">兑换</button></div></div>
        <div class="mp-card"><div class="mp-row"><div class="mp-cover g3">🎫</div><div class="grow"><div class="title">会员月卡</div><div class="sub">800 金币 · 剩余 12 份</div></div><button class="mp-btn ghost" style="width:auto;height:30px;padding:0 10px;margin:0;font-size:10px" data-demo="shop-item">兑换</button></div></div>
        <div class="mp-card"><div class="mp-row"><div class="mp-cover">📓</div><div class="grow"><div class="title">软工集市笔记本</div><div class="sub">600 金币 · 现货</div></div><button class="mp-btn ghost" style="width:auto;height:30px;padding:0 10px;margin:0;font-size:10px" data-demo="shop-item">兑换</button></div></div></div>
      <div class="mp-footer-note">商品与兑换由主站商城服务提供</div>`;
  }
  if (appKey === 'course') {
    return `${heroHtml(appKey)}
      <div class="mp-section"><h3>继续学习</h3>
        <div class="mp-card"><div class="mp-row"><div class="mp-cover g3">📘</div><div class="grow"><div class="title">Flutter 工程化实践</div><div class="sub">第 6 讲 / 共 12 讲 · 已学 62%</div></div></div>
          <div style="height:4px;background:#f0f0f0;border-radius:99px;margin-top:12px"><div style="width:62%;height:100%;background:#3370ff;border-radius:99px"></div></div></div>
        <div class="mp-card"><div class="mp-row"><div class="mp-cover g2">🧪</div><div class="grow"><div class="title">从 0 到 1 做一个小程序</div><div class="sub">第 2 讲 / 共 8 讲 · 已学 25%</div></div></div></div></div>
      <div class="mp-section"><h3>本周讲座</h3>
        <div class="mp-card"><div class="title">AI 时代的人机协同开发</div><div class="sub">周四 19:30 · 线上 · 可回放</div><button class="mp-btn ghost" data-demo="course-join" style="margin-top:10px">预约</button></div></div>
      <div class="mp-footer-note">课程内容由主站课程服务提供</div>`;
  }
  if (appKey === 'study-notes') {
    const notes = [
      ['读《夜行列车》的叙事结构', '悬疑 · 3 条摘录', '今天 09:24'],
      ['Flutter 小程序容器的安全边界', '技术 · 7 条摘录', '昨天'],
      ['关于「安静地努力」的一些想法', '随笔 · 2 条摘录', '11-12'],
    ];
    return `${heroHtml(appKey)}
      <div class="mp-section"><div class="mp-card">
        <div class="sub">本周笔记</div>
        <div style="font-size:30px;font-weight:800;letter-spacing:-.03em">12 <span style="font-size:12px;color:#94a3b8;font-weight:500">篇</span></div>
        <div class="sub">比上周多 4 篇 · 连续记录 9 天</div></div></div>
      <div class="mp-section"><h3>最近笔记</h3>${notes.map(([title, meta, time]) => `
        <div class="mp-card"><div class="title">${esc(title)}</div><div class="sub">${esc(meta)} · ${esc(time)}</div></div>`).join('')}
        <button class="mp-btn" data-demo="new-note">＋ 新建笔记</button></div>
      <div class="mp-footer-note">第三方小程序示例 · 提交审核后即可上线</div>`;
  }
  return `${heroHtml(appKey)}
    <div class="mp-section"><div class="mp-card">
      <div class="title">${esc(state.app?.name || '小程序')}</div>
      <div class="sub">${esc(state.app?.description || '这是一个通过开放平台创建的小程序。')}</div>
      <div class="sub" style="margin-top:8px">AppKey：<span class="mono">${esc(state.app?.appKey || '—')}</span></div>
    </div></div>
    <div class="mp-section"><button class="mp-btn" data-demo="favorite">${state.favorite ? '★ 已添加到我的小程序' : '☆ 添加到我的小程序'}</button></div>
    <div class="mp-footer-note">由集市小程序开放平台提供 · 会话仅限本小程序</div>`;
}

async function toggleFavorite() {
  if (!state.app) return;
  try {
    if (state.favorite) await MP.prefs.removeFavorite(state.app.appKey);
    else await MP.prefs.addFavorite(state.app.appKey);
    state.favorite = !state.favorite;
    setFavoriteButton();
    const fav = document.querySelector('[data-demo="favorite"]');
    if (fav) fav.textContent = state.favorite ? '★ 已添加到我的小程序' : '☆ 添加到我的小程序';
    toast(state.favorite ? '已添加到我的小程序' : '已从我的小程序移除');
  } catch (err) {
    toast(err.message || '操作失败');
  }
}

function bindActions() {
  menu.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-mp-action]');
    if (!btn) return;
    menu.classList.remove('open');
    handle(btn.dataset.mpAction);
  });
  document.getElementById('capsule').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-mp-action]');
    if (!btn) return;
    if (btn.dataset.mpAction === 'menu') menu.classList.toggle('open');
    if (btn.dataset.mpAction === 'close') handle('close');
  });
  document.querySelector('.demo-panel').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-mp-action]');
    if (!btn) return;
    handle(btn.dataset.mpAction);
  });
  view.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-demo]');
    if (!btn) return;
    const kind = btn.dataset.demo;
    if (kind === 'favorite') toggleFavorite();
    else if (kind === 'read') toast('演示：打开阅读器');
    else if (kind === 'feedback') toast('演示：已进入反馈表单');
    else if (kind === 'new-note') toast('演示：新建笔记');
    else if (kind === 'audio-toggle') toggleAudio(btn);
    else if (kind === 'video') toast('演示：视频播放器占位');
    else if (kind === 'resume-edit') toast('演示：进入简历编辑器');
    else if (kind === 'resume-preview') toast('演示：导出 PDF');
    else if (kind === 'shop-item') toast('演示：兑换成功');
    else if (kind === 'course-join') toast('演示：已预约讲座');
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#mp-menu') && !event.target.closest('#capsule')) menu.classList.remove('open');
  });
}

function toggleAudio(btn) {
  const audio = document.getElementById('mp-audio');
  if (!audio) return;
  const stateEl = document.getElementById('audio-state');
  if (audio.paused) {
    audio.play().then(() => {
      if (btn) btn.textContent = '暂停';
      if (stateEl) stateEl.textContent = '正在播放 · 切到主站帖子页后音频继续';
    }).catch(() => toast('播放失败，请检查浏览器音频权限'));
  } else {
    audio.pause();
    if (btn) btn.textContent = '播放';
    if (stateEl) stateEl.textContent = '已暂停 · 点击继续播放';
  }
}

function handle(action) {
  if (action === 'favorite') toggleFavorite();
  if (action === 'share') {
    MP.share({ title: state.app?.name || '小程序', path: location.pathname, appKey: state.app?.appKey });
    toast('已调起分享（postMessage → App 容器）');
  }
  if (action === 'refresh') location.reload();
  if (action === 'copy') {
    navigator.clipboard?.writeText(location.href).then(() => toast('链接已复制'), () => toast('复制失败'));
  }
  if (action === 'close') {
    try {
      if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'mp.event', event: 'close' }, '*');
      else toast('演示：关闭小程序');
    } catch (e) { toast('演示：关闭小程序'); }
  }
}

async function boot() {
  bindActions();
  try {
    const session = await MP.ready;
    const app = MP.app();
    if (!session || !app) throw new Error('没有可用的会话');
    const wanted = new URLSearchParams(location.search).get('app');
    if (wanted && wanted !== session.appKey) {
      throw new Error(`当前会话属于 ${session.appKey}，与请求的 ${wanted} 不一致`);
    }
    state.session = session;
    state.app = app;
    state.prefs = await MP.prefs.get();
    state.favorite = (state.prefs.favorites || []).some((item) => item.appKey === session.appKey);
    document.title = `${app.name} · 小程序演示`;
    updateSide();
    view.innerHTML = contentFor(session.appKey);
  } catch (err) {
    errorView('无法打开小程序', err.message || '会话建立失败');
  }
}

boot();