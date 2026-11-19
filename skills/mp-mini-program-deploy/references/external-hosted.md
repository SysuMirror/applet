# 外部托管完整参考（页面在开发者自己的机器上）

> 适用：第三方开发者、已有网站/Web 应用的团队、需要独立域名或服务端渲染的官方应用。
> 平台只登记 `entryURL / allowedOrigins / scopes`，**不托管页面**。

---

## 1. 接入前后到底差什么

| 维度 | 只有自己的网页 | 成为平台小程序后 |
| --- | --- | --- |
| 打开方式 | 普通浏览器/WebView | 集市 App 通过 `launchURL` 打开 |
| 用户身份 | 你自己的登录体系 | 可选：平台 `mp_session`（无需收集密码） |
| 平台能力 | 无 | 目录、票据、偏好、设备、订阅、通知、反馈、审核发布 |
| 页面部署 | 你自己 | 仍然是你自己（外部托管） |
| 需要新增的代码 | — | 一行 SDK + 可选的服务端验签 |

**结论：页面和你的 App 适配照旧；额外要补的是 HTTPS、origin 登记、票据消费（SDK）、
CSP/CORS，以及可选的 backend 会话校验。**

---

## 2. 注册与创建

```bash
mp register --email you@example.com --password '至少8位' --name "你的称呼"

mp apps create \
  --name "我的小程序" \
  --key my-app \
  --category tool \
  --description "一句话简介" \
  --entry https://mp-app.example.com/my-app \
  --origins https://mp-app.example.com \
  --scopes profile:read,prefs:read,prefs:write \
  --visibility logged_in
```

或在 `https://applet.ssemarket.cn/#/apps/new` 创建。

字段规则：

- `entryURL`：HTTPS；本地调试可用 `http://localhost`；最多 512 字符；不能含账号密码。
- `allowedOrigins`：**origin**，如 `https://mp-app.example.com`（不带路径、不带末尾斜杠）；
  默认端口可省略；最多 10 个（以平台配置为准）。
- `scopes`：`profile:read`、`prefs:read`、`prefs:write`、`notifications:read`、
  `notifications:write`、`posts:read`；按最小权限申请。
- `visibility`：`public` / `logged_in` / `allowlist`。

更新配置：

```bash
mp apps update my-app --entry https://mp-app.example.com/my-app --origins https://mp-app.example.com
```

---

## 3. 页面侧必须做的事

### 3.1 HTTPS 与移动端

- 有效证书（App WebView 不接受明文；`localhost` 仅调试）；
- viewport：`<meta name="viewport" content="width=device-width, initial-scale=1">`；
- 页面在移动端 WebView 中可用，不依赖桌面 hover。

### 3.2 消费启动票据（核心）

平台打开页面时 URL 形如：

```
https://mp-app.example.com/my-app?ticket=lt_xxxxxxxx
```

票票据特征：`lt_` 前缀、60 秒有效、一次性、绑定 `用户 + appKey + deviceID + origin`。

**推荐：一行 SDK**

```html
<script src="https://applet.ssemarket.cn/sdk/mp-client.js"></script>
```

SDK 行为（v1.1+）：

- 从脚本 `src` 自动识别平台地址；
- 检测到 `?ticket=lt_...` **自动** `POST /v1/sessions/exchange`；
- 成功后从地址栏移除 ticket；
- 同站场景依赖 HttpOnly `mp_session` Cookie；
- 跨站场景（如 `mp-app.example.com` → `applet.ssemarket.cn`）浏览器可能拦第三方 Cookie，
  SDK 自动改用 `X-MP-Session` 头，并在 `sessionStorage` 暂存（仅跨站）；
- 失败只 `console.warn`，不阻塞页面自身启动。

需要数据时：

```js
const session = await MP.ready;       // {appKey,userId,scopes,expiresAt}
const prefs = await MP.prefs.get();   // {recent,favorites}
await MP.prefs.put({ favorites: [...], recent: [...] });
MP.share({ title: '...', path: location.pathname });
```

**手动接入（不用 SDK）**

```js
const ticket = new URLSearchParams(location.search).get('ticket');
const res = await fetch('https://applet.ssemarket.cn/v1/sessions/exchange', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ticket }),
});
const { session, sessionToken, app } = await res.json();
// 后续请求带 credentials:'include'，或 Authorization: Bearer sessionToken
// 把 sessionToken 交给自己的服务端校验
history.replaceState(null, '', location.pathname); // 移除 ticket
```

### 3.3 SPA / 路由注意事项

- SDK 必须在应用启动最早期执行；
- 登录守卫/路由重定向可能在 ticket 被消费前整页跳走（例如跳到 `/login`）：
  - 让 SDK 在 `index.html` 的 `<head>` 加载，并尽早访问 `MP.ready`；或
  - 首屏允许渲染，不要立即 `location.replace('/login')`。
- ticket 被消费后再跳转是安全的（会话在 Cookie/内存里）。
- 页面有多级路由时，资源使用相对路径或带指纹的绝对路径，避免 404。

### 3.4 CSP（如果站点设置了）

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self' https://applet.ssemarket.cn;
  connect-src 'self' https://applet.ssemarket.cn;
  img-src 'self' data: https://applet.ssemarket.cn;
```

没有 CSP 的站点（例如 `https://tts.ssemarket.cn/`）不需要额外配置。

---

### 3.5 使用自己的登录体系（不用平台登录）

平台**没有**面向第三方小程序的登录页。`mp_session` 是静默交换的，不弹框、不需要用户输入。
第三方可以完全保留自己的账号与登录流程，按需要选择下面三种接法：

| 目标 | 是否引 SDK | 用户体验 | 平台能力 |
| --- | --- | --- | --- |
| 完全独立 | 不引，或引了不调用 exchange | 只看到自己的登录页 | 目录/审核/发布可用；偏好、设备、订阅、通知不可用 |
| **静默桥接（推荐）** | 引 SDK，静默换会话 | 无平台登录 UI；平台 userId 绑定自己的账号 | 全部可用 |
| 平台票据免密登录自己的系统 | 引 SDK + 自己后端验签 | 用户无感进入自己的账号 | 全部可用 |

**页面侧（保留自己的登录）**

```html
<script src="https://applet.ssemarket.cn/sdk/mp-client.js"></script>
<script>
  let platformUserId = '';
  let sessionToken = '';
  try {
    const session = await MP.ready;   // 静默消费 ticket，无 UI
    platformUserId = session.userId;
    sessionToken = MP.serverToken();  // app-scoped，交给自己的后端
  } catch (e) {
    // 没有票据/已过期：继续走自己的登录即可
  }

  // 你自己的登录流程照旧
  const ownSession = await yourOwnLogin();

  // 可选：登录成功后把平台身份绑定到自己的账号
  if (sessionToken) {
    await fetch('https://your-backend.example.com/account/bind-platform', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionToken }),
    });
  }
</script>
```

**服务端侧（信任边界）**

不要直接相信前端传来的 `userId`；用 AppSecret 验签后再使用：

```http
POST https://applet.ssemarket.cn/app/v1/sessions/verify
X-App-Key / X-App-Timestamp / X-App-Nonce / X-App-Signature

{"sessionToken":"mps_..."}
→ {"valid":true,"userId":"561","appKey":"your-app","scopes":[...]}
```

拿到可信 `userId` 后，在自己的系统里可以：

- 按 `userId` 查找已有账号并直接登录；
- 自动注册并绑定；
- 或要求用户先登录自己的账号，再确认绑定。

**完全独立模式**：不引 SDK、不调用 exchange。页面只用自己的登录。
平台仍负责目录、审核、发布，但下列能力不可用：偏好同步、设备/推送、
订阅与新站通知、授权记录、带用户身份的反馈、按用户统计。
平台也无法给该用户推送消息。

> 注意：启动票据来自 App 当前登录态（`POST /v1/launch-tickets` 需要主站 token）。
> “不用平台登录”不等于“App 用户不用登录”；没有票据时页面只能作为普通 URL 打开。

---

## 4. CORS 与跨域联调

平台 CORS 放行规则：

1. 平台自身 origin；
2. `MP_CORS_ORIGINS` 配置的额外 origin（运维设置，逗号分隔）；
3. 本地 `http://localhost[:port]`（开发模式）；
4. **所有已发布（`status=published`）小程序登记的 `allowedOrigins`**。

因此：

- **审核通过前**，从你的域名跨源调用平台接口会被浏览器拦（`CORS_FORBIDDEN`）；
- 联调推荐先发布一个测试应用，或让运维把测试 origin 加到 `MP_CORS_ORIGINS`；
- 响应会带 `Access-Control-Allow-Credentials: true`，请求必须 `credentials: 'include'`；
- 允许的请求头包含 `Authorization, Content-Type, Idempotency-Key, X-MP-Session, X-Requested-With, X-MP-Dev-Token`。

---

## 5. 自有服务端：校验小程序会话（可选）

页面把 `sessionToken` 交给自己的后端（HTTPS），后端用 AppKey/AppSecret 签名调用平台：

```http
POST https://applet.ssemarket.cn/app/v1/sessions/verify
X-App-Key: my-app
X-App-Timestamp: 1760000000
X-App-Nonce: ap_<32位hex>
X-App-Signature: <hex>
Content-Type: application/json

{"sessionToken":"mps_..."}
```

签名规范：

```
signature = HMAC-SHA256(appSecret, [appKey, timestamp, nonce, rawBody].join("\n"))
```

- `timestamp`：Unix 秒；允许 ±300 秒；
- `nonce`：8~128 字符、全局单次（重放会 `REPLAY_DETECTED`）；
- `rawBody`：与实际发送的请求体逐字节一致。

响应：

```json
{"valid":true,"userId":"561","appKey":"my-app","scopes":["prefs:read"],"deviceId":"dev_1","expiresAt":"..."}
```

其它服务端接口：

- `GET /app/v1/apps/self`：当前小程序公开信息（HMAC，空 body）；
- `GET /app/v1/apps/me`：当前小程序完整配置（HMAC，空 body）。

AppSecret 管理：

```bash
mp apps secret my-app reveal    # 写审计
mp apps secret my-app rotate    # 旧密钥立即失效
```

> AppSecret 只放服务端，永远不要下发到页面或提交到仓库。

---

## 6. 部署与绑定

```bash
# 任意方式部署到自己的 HTTPS 源：nginx / OSS+CDN / Vercel / Cloudflare Pages / 现有服务器

mp apps check my-app --url https://mp-app.example.com/my-app
# HTTP 状态、最终 URL、origin、origin 是否已登记

mp deploy external my-app --url https://mp-app.example.com/my-app
# 绑定 entryURL 并自动把最终 origin 加入 allowedOrigins
```

`mp deploy external` 会跟随重定向，并以**最终 URL 的 origin** 登记；
如果页面会跳到另一个域名（例如统一登录页），请把那个 origin 也登记，或避免首屏跳转。

nginx 示例：

```nginx
server {
  listen 443 ssl http2;
  server_name mp-app.example.com;
  root /var/www/my-app;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://applet.ssemarket.cn; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://applet.ssemarket.cn;" always;
}
```

---

## 7. 审核与发布

```bash
mp apps submit my-app --version 1.0.0 --changelog "首版"
mp admin queue                 # 管理员
mp admin approve my-app
mp apps publish my-app
```

状态机：

```
draft ──submit──▶ reviewing ──approve──▶ approved ──publish──▶ published
                       │                                        │
                       └──reject──▶ rejected                    └──unpublish──▶ offline
```

- 审核中不能修改配置 / 重新部署；
- 驳回后可按 `rejectReason` 修改并重新提交（新版本）；
- 发布后入口、origin、scopes 以该版本快照为准；
- 下架后用户无法再打开，已签发会话在有效期内仍可能可用。

---

## 8. 外部托管检查清单

- [ ] HTTPS 有效，入口返回 200/3xx
- [ ] `allowedOrigins` 与页面真实 origin 完全一致
- [ ] SDK 在业务脚本之前加载，带 ticket 打开能建立会话
- [ ] SPA 首屏不会在会话建立前跳走
- [ ] CSP 放行 `https://applet.ssemarket.cn`（如有 CSP）
- [ ] 页面移动端可用
- [ ] 自有服务端签名/时间窗/nonce 正确，AppSecret 不入前端
- [ ] 应用已发布（否则跨源 CORS 会被拦）
- [ ] 刷新页面后会话仍可用

---

## 9. 排错

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| SDK 请求 404 | 旧版 SDK 默认同源 | 升级 SDK 或 `MP.configure({base})` |
| `ORIGIN_NOT_ALLOWED` | origin 未登记/带路径 | `mp apps update --origins <origin>` |
| 会话 401 | ticket 过期/已消费 | 重新申请票据，勿刷新旧 URL |
| 页面无会话 | 没引 SDK / ticket 丢失 | 按 3.2、3.3 检查 |
| CORS 报错 | 应用未发布或 origin 未放行 | 先发布；或 `MP_CORS_ORIGINS` |
| CSP 阻止 | 未放行平台域名 | 加 `script-src/connect-src` |
| 刷新失效（跨站） | 第三方 Cookie 被拦 | 升级 SDK，确认 `X-MP-Session` |
| 签名失败 | 拼接顺序/body 不一致/时钟漂移 | 检查 canonical string 与 ±300s |
| `REPLAY_DETECTED` | nonce 重复 | 每次请求生成新 nonce |