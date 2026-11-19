import { state } from './state.js';
import { icon, esc } from './ui.js';

function siteHeader() {
  const nav = state.me
    ? `<a href="#features">平台能力</a>
       <a href="#flow">接入流程</a>
       <a href="#/docs">开发文档</a>
       <a class="btn btn-primary btn-sm" href="#/dashboard">进入控制台</a>`
    : `<a href="#features">平台能力</a>
       <a href="#flow">接入流程</a>
       <a href="#/docs">开发文档</a>
       <a class="btn btn-ghost btn-sm" href="#/login">登录</a>
       <a class="btn btn-primary btn-sm" href="#/register">注册</a>`;
  return `<header class="site-header">
    <div class="header-inner">
      <a class="brand" href="#/">
        <img class="brand-logo" src="/assets/logo.png" alt="集市小程序开放平台" />
        <span>集市小程序开放平台</span>
      </a>
      <nav class="nav-links">${nav}</nav>
    </div>
  </header>`;
}

export function renderLanding() {
  document.getElementById('app').innerHTML = `
  <div class="landing">
    ${siteHeader()}

    <section class="hero">
      <div>
        <div class="eyebrow"><span class="eyebrow-line"></span>面向开发者的轻量小程序平台</div>
        <h1>把好想法，<br />装进<span class="grad">小程序的入口</span></h1>
        <p class="lead">
          从注册开发者、创建小程序，到提交审核、发布上线，全流程在线完成。
          官方小程序直接复用集市 App 登录态；独立窗口也能在小程序内完成登录，不跳回主 App。
        </p>
        <div class="hero-actions">
          ${state.me
            ? `<a class="btn btn-primary btn-lg" href="#/apps">查看我的小程序 ${icon('arrowRight', 16)}</a>`
            : `<a class="btn btn-primary btn-lg" href="#/register">立即注册开发者 ${icon('arrowRight', 16)}</a>`}
          <a class="btn btn-ghost btn-lg" href="#flow">了解接入流程 ${icon('arrowRight', 14)}</a>
        </div>
        <div class="hero-meta">
          <div><div class="num">无感</div><div class="lab">复用 App 登录态</div></div>
          <div><div class="num">全端</div><div class="lab">Android / 鸿蒙 / 桌面</div></div>
          <div><div class="num">在线</div><div class="lab">创建 · 审核 · 发布</div></div>
        </div>
      </div>
      <div class="hero-visual">
        <div class="hero-art">
          <span class="hero-sweep"></span>
          <span class="hero-ring r1"></span>
          <span class="hero-ring r2"></span>
          <span class="hero-ring r3"></span>
          <img class="hero-logo" src="/assets/logo.png" alt="" />
          <span class="orbit-dot a"></span>
          <span class="orbit-dot b"></span>
          <span class="orbit-label tl">MP / 01</span>
          <span class="orbit-label br">AUTH / 02</span>
        </div>
      </div>
    </section>

    <section class="section section-lined" id="features">
      <div class="section-head">
        <h2>平台能力</h2>
        <p>平台负责小程序的展示、启动票据、登录态衔接、审核发布与消息提醒，开发者只需要提供页面。</p>
      </div>
      <div class="feature-grid">
        ${[
          ['一次开发，多端运行', 'Android、HarmonyOS、Windows、iOS 共用同一套小程序目录，用户在哪里都能打开。'],
          ['App 登录态复用', '官方小程序在 App 内无感复用当前账号；独立窗口没有 App 登录态时，登录卡片直接显示在小程序页面内，不跳回主 App。'],
          ['审核与发布流程', '草稿、提交审核、驳回原因、发布、下架全流程在线完成，支持版本回滚。'],
          ['新帖提醒与订阅', '用户订阅后，新帖会出现在系统通知里；平台负责去重、免打扰时段和频率控制。'],
          ['调用与用户数据', '按小程序查看近 14 天调用量、活跃用户与审核记录，方便了解使用情况。'],
          ['开放 API 与接入 Skill', '提供接口文档、页面 SDK、Flutter 示例，以及可直接交给 AI 助手的接入 Skill。'],
        ].map(([title, desc]) => `
          <article class="feature">
            <h3>${title}</h3>
            <p>${desc}</p>
          </article>`).join('')}
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>一个入口，四个工作面</h2>
        <p>开发者、运营、App 与小程序页面共享同一套契约，各自从独立入口进入。</p>
      </div>
      <div class="ecosystem">
        <a class="eco-card" href="#/register">
          <span class="eco-icon"><img src="/assets/logo.png" alt="" /></span>
          <span><b>开发者开放平台</b><span>注册、创建、提交审核与发布</span></span>
        </a>
        <a class="eco-card" href="/admin">
          <span class="eco-icon">${icon('shield', 18)}</span>
          <span><b>运营管理后台</b><span>审核队列、白名单与审计</span></span>
        </a>
        <a class="eco-card" href="#/docs">
          <span class="eco-icon">${icon('book', 18)}</span>
          <span><b>开发文档</b><span>接口、容器协议与错误码</span></span>
        </a>
        <a class="eco-card" href="/downloads/app-integration-docs.zip">
          <span class="eco-icon">${icon('download', 18)}</span>
          <span><b>App 接入包</b><span>接口文档、功能文档与示例</span></span>
        </a>
      </div>
    </section>

    <section class="section section-lined" id="flow">
      <div class="section-head">
        <h2>四步上线</h2>
        <p>不需要自己维护下载渠道，也不需要自建账号体系；登录态由 App 与平台衔接。</p>
      </div>
      <div class="steps">
        <div class="step"><h4>注册开发者</h4><p>使用学校统一身份登录，填写称呼即可创建开发者身份。</p></div>
        <div class="step"><h4>创建小程序</h4><p>填写名称、页面地址和需要的用户权限。</p></div>
        <div class="step"><h4>提交审核</h4><p>补充版本说明，等待平台审核。</p></div>
        <div class="step"><h4>发布上线</h4><p>审核通过后一键发布，用户在 App 下拉面板即可打开。</p></div>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>登录，不必离开小程序</h2>
        <p>登录是平台提供的能力，不是强制方式。官方小程序可以复用集市 App 当前账号；也可以继续使用自有账号、学校统一身份或其他登录。拿不到 App 登录态时，平台统一登录卡片会留在小程序自己的窗口里。</p>
      </div>
      <div class="feature-grid">
        ${[
          ['App 内无感', '已登录集市 App 时，容器注入短时效 access token，打开小程序直接进入，不弹授权框。'],
          ['窗口内登录', 'Windows / 桌面独立窗口没有 App 注入时，登录卡片留在当前小程序窗口，不跳回主 App。'],
          ['按小程序隔离', '第三方小程序使用独立 mp_session 与 scopes，只能读取用户授权的信息，用户可随时撤销。'],
        ].map(([title, desc]) => `
          <article class="feature">
            <div class="feature-icon">${icon('shield', 20)}</div>
            <h3>${title}</h3>
            <p>${desc}</p>
          </article>`).join('')}
      </div>
      <div class="row" style="margin-top:22px">
        <a class="btn btn-primary" href="#/docs">阅读开发文档</a>
        <a class="btn btn-ghost" href="/downloads/mp-skill.zip">下载接入 Skill</a>
      </div>
    </section>

    ${state.me ? '' : `
    <section class="section" style="padding-top:10px">
      <div class="cta-band">
        <div>
          <h2>准备好发布你的第一个小程序了吗？</h2>
          <p>五分钟完成注册与创建，审核通过后即可在 App 内被用户打开。</p>
        </div>
        <div class="row" style="position:relative;z-index:1">
          <a class="btn btn-lg" href="#/register">免费注册</a>
        </div>
      </div>
    </section>`}

    <footer class="footer">
      <div class="brand" style="font-size:12.5px">
        <img class="brand-logo" style="width:22px;height:22px" src="/assets/logo.png" alt="" />
        <span>集市小程序开放平台</span>
      </div>
      <div class="row" style="gap:18px">
        <a href="/openapi.yaml">OpenAPI</a>
        <a href="/downloads/mp-skill.zip">接入 Skill</a>
        <a href="/app-docs/README.md">App 文档</a>
        <a href="/admin">管理后台</a>
      </div>
      <div>© ${new Date().getFullYear()} SSE Market · 开放平台</div>
    </footer>
  </div>`;
}

export function renderAuth(mode, params = new URLSearchParams()) {
  const isLogin = mode !== 'register';
  const next = params.get('next') || '';
  const ssoError = params.get('sso_error') || '';
  const hiddenNext = next ? `<input type="hidden" name="next" value="${esc(next)}" />` : '';

  document.getElementById('app').innerHTML = `
  <div class="auth-page">
    <a class="auth-brand" href="#/">
      <img src="/assets/logo.png" alt="" />
      <span>集市小程序开放平台</span>
    </a>

    <div class="auth-left">
      <div class="auth-quote">
        <div class="eyebrow"><span class="eyebrow-line"></span>开发者入口</div>
        <h1>让每一个小想法，<br />都有被打开的机会。</h1>
        <cite>集市小程序开放平台 · OPEN PLATFORM</cite>
      </div>
      <div class="auth-art">
        <span class="hero-sweep"></span>
        <span class="hero-ring r1"></span>
        <span class="hero-ring r2"></span>
        <span class="hero-ring r3"></span>
        <img src="/assets/logo.png" alt="" />
        <span class="orbit-label tl">IDENTITY / 01</span>
        <span class="orbit-label br">AUTH / 02</span>
      </div>
    </div>

    <div class="auth-panel">
      <div class="eyebrow"><span class="eyebrow-line"></span>${isLogin ? '登录开放平台' : '创建开发者账号'}</div>
      <h2>${isLogin ? '欢迎回来' : '开始构建'}</h2>
      <p class="sub">${isLogin ? '使用统一身份或邮箱登录，管理你的小程序、审核与调用数据。' : '注册后即可创建小程序、配置入口并提交审核。'}</p>
      ${ssoError ? `<div class="alert alert-danger" style="margin-bottom:16px">${esc(ssoError)}</div>` : ''}
      <a class="btn btn-ghost auth-sso" href="/auth/sso/start?next=${encodeURIComponent(next || '/#/dashboard')}">
        <span class="sso-dot"></span>
        ${isLogin ? '使用学校统一身份登录' : '使用学校统一身份登录并创建账号'}
      </a>
      <div class="auth-divider"><span>或使用邮箱</span></div>

      <div class="auth-tabs">
        <button type="button" class="${isLogin ? 'on' : ''}" data-action="auth-tab" data-mode="login">登录</button>
        <button type="button" class="${isLogin ? '' : 'on'}" data-action="auth-tab" data-mode="register">注册</button>
      </div>

      ${isLogin ? `
      <form class="form-grid" data-form="login" novalidate>
        ${hiddenNext}
        <div class="field"><label>邮箱</label>
          <input class="input" type="email" name="email" placeholder="you@example.com" autocomplete="username" required />
        </div>
        <div class="field"><label>密码</label>
          <input class="input" type="password" name="password" placeholder="请输入密码" autocomplete="current-password" required />
        </div>
        <button class="btn btn-primary" type="submit">登录</button>
        <div class="form-note">邮箱密码登录会同时校验学校统一身份：统一身份账号可直接输入学校密码。<br />也可以点击上方「使用学校统一身份登录」跳转授权。</div>
      </form>` : `
      <form class="form-grid" data-form="register" novalidate>
        ${hiddenNext}
        <div class="field"><label>邮箱</label>
          <input class="input" type="email" name="email" placeholder="you@example.com" autocomplete="email" required />
        </div>
        <div class="field"><label>称呼</label>
          <input class="input" name="displayName" placeholder="你的昵称或姓名" maxlength="32" required />
        </div>
        <div class="field"><label>团队 / 组织（选填）</label>
          <input class="input" name="orgName" placeholder="工作室或公司名称" maxlength="64" />
        </div>
        <div class="field"><label>密码</label>
          <input class="input" type="password" name="password" placeholder="至少 8 位" minlength="8" autocomplete="new-password" required />
          <span class="hint">密码至少 8 位；请勿与其他网站使用相同密码。</span>
        </div>
        <button class="btn btn-primary" type="submit">创建账号</button>
        <div class="auth-foot">注册即表示你同意平台的小程序审核规范：入口地址必须为 HTTPS，页面不得收集与功能无关的用户信息。</div>
      </form>`}
    </div>
  </div>`;
}