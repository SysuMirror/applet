import { esc } from './ui.js';

function code(text, label = 'cURL') {
  return `<div class="code-box" data-code-block><button class="copy" type="button" data-action="copy-code">复制</button><span class="tiny muted" style="display:block;margin-bottom:6px">${esc(label)}</span><pre class="code-pre" style="margin:0;font:inherit;white-space:pre">${esc(text)}</pre></div>`;
}

export function docsHtml(origin, { compact = false } = {}) {
  const base = origin || 'https://mp-api.example.com';
  const dart = `// Flutter / App 侧：准备打开小程序
final res = await http.post(
  Uri.parse('${base}/v1/launch-tickets'),
  headers: {
    'Authorization': 'Bearer \$mainAccessToken',
    'Content-Type': 'application/json',
  },
  body: jsonEncode({
    'appKey': 'novel',
    'deviceID': deviceId,
    'origin': 'https://mp-app.example.com',
  }),
);

final data = jsonDecode(res.body);
final launchURL = data['launchURL'] as String;
// 打开小程序；登录与授权由平台自动处理`;
  const js = `// 小程序页面：读取平台提供的登录会话
const res = await fetch('${base}/v1/sessions/exchange', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ticket: new URLSearchParams(location.search).get('ticket') }),
});

// 之后的请求只带 Cookie，scope 由平台校验
const prefs = await fetch('${base}/v1/me/prefs', { credentials: 'include' });`;
  const sdk = `<!-- 小程序页面：引入官方轻量 SDK -->
<script src="${base}/sdk/mp-client.js"></script>
<script>
  const session = await MP.ready;       // 自动用 URL 中的 ticket 换会话
  const prefs = await MP.prefs.get();
  await MP.prefs.addFavorite('novel');
  MP.share({ title: '快来看这个帖子' }); // 通过 postMessage 交给 App 容器
</script>`;
  const server = `// 第三方小程序服务端：校验用户会话
import { signAppRequest } from './signature.mjs';

const body = JSON.stringify({ sessionToken });
const { headers } = signAppRequest(appSecret, appKey, body);
const res = await fetch('${base}/app/v1/sessions/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body,
});
// → { valid: true, userId, appKey, scopes, expiresAt }`;
  const inject = `// App 容器：仅对官方 /mp/ 页面注入短时效 access token
final encoded = jsonEncode(mainAccessToken);
await controller.runJavaScript('''
(function(){
  try {
    var t = $encoded;
    window.__SSE_MAIN_TOKEN__ = t;
    if (typeof window.__setSSEAppToken === 'function') window.__setSSEAppToken(t);
    window.dispatchEvent(new Event('sse-main-token'));
  } catch(e) {}
})();
''');`;
  const pageAuth = `// 小程序页面：等待 App 注入 → 共享 SSO 静默 → 页面内登录
const injected = await waitForInjectedToken(1200);   // window.__SSE_MAIN_TOKEN__
if (!injected) {
  const sso = await fetch('/mp-api/auth/sso/try', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  if (!sso.ok) showLoginCard();                      // 卡片留在当前小程序窗口
}`;
  const event = `# 旧服务发帖成功后，用 outbox worker 推送事件（HMAC 签名）
TS=$(date +%s)
NONCE=$(openssl rand -hex 16)
BODY='{"eventID":"evt_123","postID":7726,"title":"新帖标题","partition":"主页","authorUserID":561,"dedupKey":"post:7726"}'
SIG=$(printf '%s\\n%s\\n%s' "$TS" "$NONCE" "$BODY" | openssl dgst -sha256 -hmac "$MP_INTERNAL_SECRET" -hex | awk '{print $2}')

curl -X POST '${base}/internal/v1/events/new-post' \\
  -H 'Content-Type: application/json' \\
  -H "X-Internal-Timestamp: $TS" \\
  -H "X-Internal-Nonce: $NONCE" \\
  -H "X-Internal-Signature: $SIG" \\
  -d "$BODY"`;

  return `
  <div class="doc-layout">
    <nav class="doc-nav">
      <a href="#quickstart">快速开始</a>
      <a href="#modes">接入方式</a>
      <a href="#auth">认证与权限</a>
      <a href="#mp-login">小程序内登录</a>
      <a href="#app-identity">App 身份与登录样式</a>
      <a href="#client-api">客户端 API</a>
      <a href="#ticket">打开小程序与会话</a>
      <a href="#sdk">页面 SDK</a>
      <a href="#server-api">服务端 API</a>
      <a href="#events">内部事件</a>
      <a href="#errors">错误码</a>
      <a href="#downloads">下载</a>
    </nav>
    <div>
      <section class="doc-section" id="quickstart">
        <h2>快速开始</h2>
        <p>在集市 App 里打开小程序时，平台签发一次性启动票据并返回 <span class="mono">launchURL</span>。官方小程序可复用 App 主站登录态；第三方小程序用票据换 <span class="mono">mp_session</span>。开发者只需要提供一个 HTTPS 页面，并在创建小程序时登记页面域名。</p>
        <div class="alert alert-info" style="margin-bottom:14px">登录方式可选：官方小程序可复用 App 注入的短时效 token，第三方可使用平台会话，也可以继续使用自有登录体系。</div>
        <h3>1. App 打开小程序</h3>
        ${code(dart, 'Flutter / Dart')}
        <h3>2. 页面换取会话</h3>
        ${code(js, '浏览器 / 小程序页面')}
        <h3>3. 使用会话读取偏好</h3>
        ${code(sdk, 'HTML + SDK')}
      </section>

      <section class="doc-section" id="modes">
        <h2>接入方式：外部页面还是平台托管？</h2>
        <p>小程序本质上是 <b>集市 App 用 WebView 打开的一段网页</b>，不是独立 App，也不是把页面嵌进开发者自己的网站。页面放在哪里由开发者选择，平台两种都支持：</p>
        <div class="grid grid-2" style="margin-bottom:16px">
          <div class="card card-pad">
            <div class="row" style="justify-content:space-between"><b>外部托管</b><span class="pill draft">第三方默认</span></div>
            <p class="muted small" style="margin-top:8px;line-height:1.8">页面放在你自己的 HTTPS 站点（现有网站即可）。平台只登记 entryURL / allowedOrigins；你在入口页引入 SDK、处理启动票据后即可提交审核。</p>
            <a class="link small" href="/app-docs/deploy-external.md" target="_blank" rel="noreferrer">查看外部部署指南 →</a>
          </div>
          <div class="card card-pad">
            <div class="row" style="justify-content:space-between"><b>内部托管</b><span class="pill approved">仅官方应用</span></div>
            <p class="muted small" style="margin-top:8px;line-height:1.8">静态构建上传到平台，入口为 <span class="mono">/mp/&lt;appKey&gt;/</span>，URL 带 source token。单文件 5MB、构建 25MB / 300 文件。</p>
            <a class="link small" href="/app-docs/deploy-internal.md" target="_blank" rel="noreferrer">查看内部部署指南 →</a>
          </div>
        </div>
        <h3>我有现成网站，能直接用吗？</h3>
        <p>能，走<b>外部托管</b>：注册开发者 → 创建小程序并登记现有入口页与 origin → 在入口页加入</p>
        ${code(`<script src="${base}/sdk/mp-client.js"></script>
<script>
  // SDK 从自身 src 自动识别平台地址，外部页面无需配置 base
  const session = await MP.ready; // 消费 URL 中的 ticket，建立 mp_session
  // 之后用 MP.request / MP.prefs 调平台接口，或调用你自己的后端
</script>`, 'HTML + SDK')}
        <p>然后照常部署、提交审核、发布。硬性要求：页面必须 HTTPS（本地调试可用 localhost）、origin 与登记值完全一致、按移动端视口适配。平台<b>不托管</b>外部页面，证书与 CDN 由你自己负责。</p>
        <p class="muted small">只填 entryURL 而不接入 SDK 也能打开页面，但不会建立平台会话，收藏/最近使用/通知等能力不可用。另外平台 CORS 只放行<b>已发布</b>小程序的 origin，联调前需要先发布测试应用（或由运维加白）。</p>
        <p class="muted small"><b>可以继续用自己的登录。</b>平台不会给第三方弹登录框；<span class="mono">mp_session</span> 是静默交换的。保留自己的登录体系即可，需要平台能力时把静默拿到的平台 <span class="mono">userId</span> 绑定到自己的账号（服务端用 <span class="mono">/app/v1/sessions/verify</span> 验签，不要直接相信前端）。完全不接 SDK 也能用，但偏好、设备、订阅、通知等平台能力不可用。</p>
        <div class="alert alert-info" style="margin-bottom:14px">完整原理、两种方式的对比与决策表：<a href="/app-docs/integration-modes.md" target="_blank" rel="noreferrer">小程序接入方式总览</a>。</div>
      </section>

      <section class="doc-section" id="auth">
        <h2>认证与权限</h2>
        <ul>
          <li><b>用户登录</b>：使用学校统一身份。已登录时无感进入；未登录时显示平台内置的授权页。</li>
          <li><b>官方小程序页面</b>：App 内复用主站 access token；独立窗口使用共享 SSO 或页面内登录卡片，页面不保存密码。</li>
          <li><b>第三方小程序页面</b>：使用平台签发的 <span class="mono">mp_session</span>，权限受 scopes 限制，不接触主站 token。</li>
          <li><b>第三方服务端</b>：用 AppKey + 时间戳 + nonce + HMAC 签名校验会话；AppSecret 只放在服务端。</li>
          <li><b>内部事件</b>：主站推送新帖事件时使用内部签名，普通开发者无需关心。</li>
        </ul>
        <h3>开放平台账号</h3>
        <p>开发者控制台同样使用学校统一身份登录，已登录时可直接进入。详见 <a href="/app-docs/unissso-integration.md" target="_blank" rel="noreferrer">统一身份接入说明</a>。</p>
        <h3>默认 scopes</h3>
        <p><span class="mono">profile:read</span>、<span class="mono">prefs:read</span>、<span class="mono">prefs:write</span>、<span class="mono">notifications:read</span>、<span class="mono">notifications:write</span>、<span class="mono">posts:read</span>。按最小权限申请。</p>
      </section>

      <section class="doc-section" id="mp-login">
        <h2>小程序内登录</h2>
        <p>官方内置小程序按「App 身份 → 共享 SSO → 页面内登录 → 游客页」的顺序解析用户，登录过程始终发生在小程序自己的窗口里，不跳回主 App：</p>
        <ul>
          <li><b>App 已登录</b>：容器注入短时效 access token，页面无感进入，不显示登录框；</li>
          <li><b>独立窗口</b>：拿不到注入时，用 <span class="mono">.ssemarket.cn</span> 共享 SSO Cookie 静默登录；</li>
          <li><b>仍未登录</b>：在小程序页面内显示统一登录卡片，直接调用主站登录接口；</li>
          <li><b>暂不登录</b>：进入游客页，不再被路由守卫弹回登录页。</li>
        </ul>
        <p>登录一次后，小说、排行榜、简历、音乐视频、商城、课程专区共享同一登录态。第三方外部小程序仍使用平台 <span class="mono">mp_session</span>，不适用主站 token 注入。登录方式不是强制的：页面也可以继续使用自有登录或其他身份方案。</p>
        <div class="alert alert-info" style="margin-bottom:14px">完整接口、注入代码、卡片尺寸与安全边界见 <a href="/app-docs/app-identity.md" target="_blank" rel="noreferrer">官方小程序身份与登录样式</a>。</div>
      </section>

      <section class="doc-section" id="app-identity">
        <h2>App 身份复用与内置登录样式</h2>
        <p>App 已登录时，官方小程序不弹任何授权框，直接复用主站身份。页面按下面的优先级取 token：</p>
        <ol>
          <li><span class="mono">window.__SSE_MAIN_TOKEN__</span>（App WebView 注入，仅内存）</li>
          <li><span class="mono">POST /mp-api/auth/sso/try</span>（共享 SSO Cookie）</li>
          <li><span class="mono">POST /mp-api/auth/login</span>（页面内登录卡片）</li>
          <li>游客页（点「暂不登录」）</li>
        </ol>
        <div class="alert alert-info" style="margin:0 0 14px">这是平台<b>提供</b>的登录能力，不是强制方式。你可以继续使用自有账号体系、学校统一身份、验证码或其他登录；平台不接管页面会话。使用平台登录卡片时，登录成功必须回到用户原本要访问的页面。</div>
        <h3>登录后回跳</h3>
        <p>未登录访问 <span class="mono">/mp/media/novel/123</span> 时，路由守卫跳到 <span class="mono">/mp-login?redirect=%2Fnovel%2F123</span>。注入、SSO 或卡片登录成功后，用 <span class="mono">router.replace(target)</span> 回到原路径，登录页不留在历史里。</p>
        ${code(`const raw = String(route.query.redirect || '')
const target = raw.startsWith('/') && !raw.startsWith('//')
  ? raw                 // 只接受站内绝对路径，拒绝 //evil.com
  : '/media'            // 没有 redirect 时回小程序首页

await router.replace(target)`, 'Vue Router')}
        <p>错误做法：登录成功后再跳主站首页、跳回 App 主窗口、或让登录页留在返回栈。第三方自有登录页也应保留 <span class="mono">redirect</span> 参数并在成功后回跳。</p>
        <h3>App 注入约定</h3>
        ${code(inject, 'Flutter / Dart')}
        <p>Android 独立 Activity 在 <span class="mono">onPageStarted</span> 和 <span class="mono">onPageFinished</span> 各注入一次；只注入短时效 access token，不注入 refresh token，不写入 Cookie / localStorage。</p>
        <h3>页面初始化</h3>
        ${code(pageAuth, '浏览器 / 小程序页面')}
        <h3>登录卡片样式</h3>
        <p>六个官方小程序共用同一张卡片，只在标题和说明文案上区分。视觉预览：</p>
        <div style="padding:22px 16px;border-radius:16px;background:#f6f7f9;display:flex;justify-content:center;margin-bottom:16px">
          <div style="width:100%;max-width:320px;background:#fff;border:1px solid rgba(15,23,42,.06);border-radius:20px;padding:26px 20px 16px;box-shadow:0 18px 50px rgba(15,23,42,.09);text-align:center;font-family:inherit">
            <div style="width:56px;height:56px;margin:0 auto 12px;border-radius:16px;background:linear-gradient(145deg,#5b7cfa,#3d5be0);color:#fff;font-size:24px;font-weight:800;display:flex;align-items:center;justify-content:center">音</div>
            <div style="font-size:19px;font-weight:700;color:#111827;margin-bottom:6px">音乐视频</div>
            <div style="font-size:12.5px;line-height:1.7;color:#6b7280;margin-bottom:16px">登录并授权使用集市账号<br>一次登录，全部小程序通用</div>
            <div style="text-align:left;margin-bottom:10px"><div style="font-size:11.5px;color:#6b7280;margin:0 0 5px 2px">邮箱 / 统一身份账号</div><div style="height:40px;border:1px solid rgba(15,23,42,.1);border-radius:10px;padding:0 11px;display:flex;align-items:center;color:#9ca3af;font-size:13px">集市邮箱 / 学号邮箱</div></div>
            <div style="text-align:left;margin-bottom:10px"><div style="font-size:11.5px;color:#6b7280;margin:0 0 5px 2px">密码</div><div style="height:40px;border:1px solid rgba(15,23,42,.1);border-radius:10px;padding:0 11px;display:flex;align-items:center;color:#9ca3af;font-size:13px">密码</div></div>
            <div style="height:42px;border-radius:11px;background:#3d5be0;color:#fff;font-size:15px;font-weight:600;display:flex;align-items:center;justify-content:center">登录并授权</div>
            <div style="font-size:11px;line-height:1.5;color:#9ca3af;margin:10px 0 6px">密码只用于本次登录，不会保存到小程序页面</div>
            <div style="font-size:13px;color:#6b7280;padding:6px 0">暂不登录</div>
          </div>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>项目</th><th>规范</th></tr></thead>
          <tbody>
            <tr><td>卡片</td><td class="muted">最大宽度 360px、圆角 20px、阴影 0 18px 50px rgba(15,23,42,.09)</td></tr>
            <tr><td>主色</td><td class="muted">#3d5be0（渐变 #5b7cfa → #3d5be0）</td></tr>
            <tr><td>输入框</td><td class="muted">高 40px、圆角 10px、聚焦边框 #3d5be0</td></tr>
            <tr><td>主按钮</td><td class="muted">高 42px、圆角 11px、15px/600</td></tr>
            <tr><td>文案</td><td class="muted">标题为小程序名；主按钮「登录并授权」；次按钮「暂不登录」</td></tr>
          </tbody>
        </table></div>
        <p style="margin-top:12px">完整说明：<a href="/app-docs/app-identity.md" target="_blank" rel="noreferrer">app-identity.md</a></p>
      </section>

      <section class="doc-section" id="client-api">
        <h2>客户端 API</h2>
        <p>Base URL：<span class="mono">${esc(base)}/v1</span>。错误统一为 <span class="mono">{ code, message, requestId }</span>。</p>
        ${[
          ['GET', '/v1/apps', '小程序目录'],
          ['GET', '/v1/apps/{appKey}', '小程序详情'],
          ['GET', '/v1/categories', '分类'],
          ['GET', '/v1/search?q=', '搜索'],
          ['POST', '/v1/launch-tickets', '申请启动票据'],
          ['POST', '/v1/sessions/exchange', '票据换会话'],
          ['GET', '/v1/sessions/me', '当前会话'],
          ['GET', '/v1/me/prefs', '最近使用 / 我的小程序'],
          ['PUT', '/v1/me/prefs', '同步偏好'],
          ['POST', '/v1/devices', '注册设备推送 token'],
          ['PUT', '/v1/me/subscriptions', '订阅与静默时段'],
          ['GET', '/v1/events/new-posts', '推送兜底轮询'],
          ['POST', '/v1/feedback', '反馈'],
        ].map(([m, p, d]) => `<div class="endpoint"><span class="method ${m.toLowerCase()}">${m}</span><code>${esc(p)}</code><span class="desc">${esc(d)}</span></div>`).join('')}
      </section>

      <section class="doc-section" id="ticket">
        <h2>打开小程序与会话</h2>
        <p>App 打开小程序时会生成一次性打开链接，60 秒内有效，并且只能使用一次。页面校验通过后获得仅限该小程序的登录会话。</p>
        <pre class="code-box">App                     mp-service                 小程序页面
 │  POST /v1/launch-tickets                         │
 │────────────────────────▶│                        │
 │◀────────────────────────│ ticket(60s) + launchURL│
 │  App 内打开小程序                                 │
 │─────────────────────────────────────────────────▶│
 │                         │◀─ POST /sessions/exchange {ticket}
 │                         │   校验并签发 HttpOnly Cookie
 │                         │───────────────────────▶│
 │                         │      之后只带 Cookie 调 /v1</pre>
        <p>小程序会话默认 2 小时，剩余不足一半时滑动续期。用户可在 App 内撤销授权，撤销后该小程序的全部会话立即失效。</p>
      </section>

      <section class="doc-section" id="sdk">
        <h2>页面 SDK</h2>
        <p>SDK 会自动从 URL 读取 <span class="mono">ticket</span> 并换取会话，提供偏好、通知与容器通信的薄封装。</p>
        <div class="endpoint"><span class="method">GET</span><code>/sdk/mp-client.js</code><span class="desc">约 4KB，无依赖</span></div>
        ${code(sdk, '页面内联示例')}
        <h3>容器桥消息</h3>
        <p>页面调用 <span class="mono">MP.share(payload)</span> 会向父容器发送 <span class="mono">{"type":"mp.event","event":"share","payload":{...}}</span>。App 必须校验消息来源在 allowedOrigins 内。</p>
      </section>

      <section class="doc-section" id="server-api">
        <h2>第三方服务端 API</h2>
        ${code(server, 'Node.js 示例')}
        <p>签名串：<span class="mono">appKey + "\\n" + timestamp + "\\n" + nonce + "\\n" + rawBody</span>，HMAC-SHA256 后转十六进制。时间窗 ±5 分钟，nonce 在窗口内只能使用一次。</p>
      </section>

      <section class="doc-section" id="events">
        <h2>内部事件</h2>
        <p>旧服务在新帖事务提交后写入 outbox，由 worker 异步推送到本平台；平台按 eventID / dedupKey 去重，再匹配订阅、按静默时段分发。</p>
        ${code(event, 'Shell')}
      </section>

      <section class="doc-section" id="errors">
        <h2>错误码</h2>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>code</th><th>HTTP</th><th>说明</th></tr></thead>
          <tbody>
            ${[
              ['INVALID_TICKET', '401', '票据不存在'],
              ['TICKET_USED', '401', '票据已被使用（一次性）'],
              ['TICKET_EXPIRED', '401', '票据超过 60 秒'],
              ['ORIGIN_MISMATCH', '401', '票据与页面 origin 不匹配'],
              ['SESSION_REQUIRED', '401', '缺少小程序会话'],
              ['SCOPE_REQUIRED', '403', '缺少所需权限'],
              ['APP_UNAVAILABLE', '403', '小程序未发布或已下线'],
              ['APP_REVIEWING', '409', '审核中不能修改'],
              ['NO_APPROVED_VERSION', '409', '没有可发布版本'],
              ['RATE_LIMITED', '429', '请求过于频繁'],
              ['INVALID_SIGNATURE', '401', '签名校验失败'],
              ['REPLAY_DETECTED', '401', 'nonce 重放'],
            ].map(([c, h, d]) => `<tr><td class="mono">${c}</td><td>${h}</td><td class="muted">${d}</td></tr>`).join('')}
          </tbody>
        </table></div>
      </section>

      <section class="doc-section" id="downloads">
        <h2>小程序部署</h2>
        <div class="alert alert-info" style="margin-bottom:14px">
          平台管理员请从 <a href="/admin" target="_blank" rel="noreferrer">/admin</a> 使用学校统一身份登录；管理员指南见 <a href="/app-docs/admin-guide.md" target="_blank" rel="noreferrer">这里</a>。
        </div>
        <div class="grid grid-2" style="margin-bottom:26px">
          <a class="card card-pad" href="/app-docs/deploy-internal.md" target="_blank" rel="noreferrer" style="color:inherit">
            <div class="row" style="justify-content:space-between"><b>内部托管部署</b><span class="pill approved">官方应用</span></div>
            <p class="muted small" style="margin-top:8px">CLI 上传到平台，URL 带 source token；仅官方应用/管理员可用。</p>
          </a>
          <a class="card card-pad" href="/app-docs/deploy-external.md" target="_blank" rel="noreferrer" style="color:inherit">
            <div class="row" style="justify-content:space-between"><b>外部托管部署</b><span class="pill draft">第三方</span></div>
            <p class="muted small" style="margin-top:8px">部署到自己的 HTTPS 源，平台只登记 entryURL / origin。</p>
          </a>
        </div>

        <h2>下载</h2>
        <div class="grid grid-2">
          <a class="card card-pad" href="/openapi.yaml" style="color:inherit">
            <div class="row" style="justify-content:space-between"><b>OpenAPI 3.1</b><span class="pill published">YAML</span></div>
            <p class="muted small" style="margin-top:8px">完整接口契约，可导入 Postman / Apifox 生成 SDK。</p>
          </a>
          <a class="card card-pad" href="/downloads/mp-skill.zip" style="color:inherit">
            <div class="row" style="justify-content:space-between"><b>App 接入 Skill</b><span class="pill approved">ZIP</span></div>
            <p class="muted small" style="margin-top:8px">给 App 团队的 Claude Code Skill：流程、示例、排错清单。</p>
          </a>
          <a class="card card-pad" href="/downloads/mp-deploy-skill.zip" style="color:inherit">
            <div class="row" style="justify-content:space-between"><b>创建与部署 Skill</b><span class="pill published">ZIP</span></div>
            <p class="muted small" style="margin-top:8px">内部托管 / 外部托管两条路线：CLI、API、SDK、能力清单、上线检查与预检脚本。</p>
          </a>
          <div class="card card-pad">
            <div class="row" style="justify-content:space-between"><b>App 接入文档</b><span class="pill approved">MD / ZIP</span></div>
            <p class="muted small" style="margin-top:8px">接口文档 + 功能文档 + 示例 + OpenAPI，可直接发给客户端团队。</p>
            <div class="row" style="margin-top:10px">
              <a class="btn btn-soft btn-sm" href="/app-docs/README.md" target="_blank" rel="noreferrer">在线查看</a>
              <a class="btn btn-ghost btn-sm" href="/downloads/app-integration-docs.zip">下载 ZIP</a>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>`;
}