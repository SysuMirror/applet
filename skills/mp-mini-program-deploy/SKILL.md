---
name: mp-mini-program-deploy
description: 在「集市小程序开放平台」创建、部署、审核并发布小程序。覆盖两种模式：部署到平台（内部托管，仅官方应用/管理员）与部署到开发者自己的 HTTPS 源（外部托管，第三方默认）。用于回答「怎么创建小程序」「页面放在哪」「现成网站还要接什么」「平台提供哪些能力」，并给出可执行的 CLI / API / SDK 步骤与排错清单。
---

# 集市小程序创建与部署 Skill

平台地址：`https://applet.ssemarket.cn`
控制台：`https://applet.ssemarket.cn/`（开发者） / `https://applet.ssemarket.cn/admin`（管理员）
完整接口契约：`https://applet.ssemarket.cn/openapi.yaml`

---

## 0. 先做这个判断

```
谁是开发者？
├─ 第三方 / 外部团队
│   └─ 路线 B：外部托管（页面放自己的 HTTPS 站点）
└─ 集市官方 / 平台管理员
    ├─ 想由平台统一部署，纯静态页面 → 路线 A：内部托管
    └─ 需要自己的域名 / 服务端渲染 / 独立 Cookie → 路线 B：外部托管
```

**两条路线共用同一套目录、票据、会话、审核发布流程，区别只有「页面从哪来」。**

| | 路线 A：内部托管 | 路线 B：外部托管 |
| --- | --- | --- |
| 谁能用 | 官方应用 / 管理员 | 任意开发者 |
| 页面位置 | `https://applet.ssemarket.cn/mp/<appKey>/` | 开发者自己的 HTTPS 源 |
| 部署方式 | `mp deploy internal --dir <dist>` | 自己部署 + `mp deploy external --url ...` |
| 访问控制 | URL 带 `source` token | 开发者自己控制 |
| 大小限制 | 5MB/文件、25MB/构建、300 文件 | 由开发者托管决定 |
| 平台是否托管页面 | 是 | 否 |

---

## 1. 运行模型（必须先理解）

小程序不是独立 App，也不是把页面嵌进开发者网站；而是 **集市 App 用 WebView 打开的一段网页**。

```
集市 App（已登录）
  │ POST /v1/launch-tickets       Bearer 主站 / UniSSO token
  ▼
launchURL = 页面地址 + ?ticket=lt_...   （60 秒、一次性、绑定用户+小程序+设备+origin）
  │ WebView 打开
  ▼
小程序页面
  │ SDK 自动 POST /v1/sessions/exchange   （消费 ticket）
  ▼
mp_session（HttpOnly，2 小时滑动续期）
  │ 页面之后调用 /v1/*，权限受 scopes 限制
  ▼
第三方服务端（可选）→ POST /app/v1/sessions/verify（AppKey + AppSecret HMAC）
```

职责边界：

| 谁 | 负责 | 不负责 |
| --- | --- | --- |
| 集市 App | 登录、拉目录、申请票据、WebView 容器、设备推送 | 业务页面 |
| 开发者 | 页面（前端）、自己的服务端（可选） | 保存用户密码、接触主站 token、把 AppSecret 放前端 |
| 平台 | 目录、票据、会话、偏好、设备/订阅、事件、审核发布、SDK、统计、审计 | 你的业务数据（帖子/商城/课程等） |

---

## 2. 路线 A：部署在平台（内部托管）

> 适用：官方应用、平台管理员、纯静态前端构建产物。
> 第三方请直接看路线 B；内部托管接口会对非官方应用返回 `INTERNAL_HOSTING_FORBIDDEN`。

### A1. 准备账号与应用

```bash
cd /home/cloud/deploy/mp-service && npm link   # 让 mp 命令进入 PATH（只需一次）

# 管理员登录（初始化管理员密码在 .env 的 MP_ADMIN_PASSWORD）
mp login --email admin@mp.local --password '…' --admin
mp whoami --admin
```

没有官方应用时，先创建（`--entry` 可先填占位 URL，内部托管激活后会覆盖）：

```bash
mp admin create \
  --name "内部工具" \
  --key internal-tool \
  --entry https://applet.ssemarket.cn/ \
  --origins https://applet.ssemarket.cn \
  --scopes profile:read,prefs:read,prefs:write \
  --sort 10
```

也可以直接打开 `/admin` 用 UniSSO 登录后创建。

### A2. 生成页面工程

```bash
mp init ./internal-tool \
  --app-key internal-tool \
  --title "内部工具" \
  --base https://applet.ssemarket.cn
```

`mp init` 生成静态页面（`index.html` + `app.js` + 样式），已包含 `MP.ready` 示例。
如果已有 Vite / React / Vue 工程，直接使用构建产物 `dist/`，无需重新生成。

### A3. 构建约束

- 根目录必须有 `index.html`；
- 资源使用**相对路径**（`./assets/...`），不要写 `/assets/...`（平台会挂在 `/mp/<appKey>/` 下）；
- 单文件 ≤ 5MB，构建总计 ≤ 25MB，文件数 ≤ 300；
- 允许的扩展名：html/htm/js/mjs/css/json/txt/xml/map、png/jpg/jpeg/gif/webp/svg/ico、
  woff/woff2/ttf/otf、mp3/mp4/webm/wav、wasm；
- 只支持静态构建，**不支持服务端渲染 / Node 运行时**；
- 无扩展名的路径会回退到 `index.html`，history 路由可用；hash 路由最稳妥。
- 带扩展名的资源必须真实存在，且使用相对路径。

### A4. 上传并激活

```bash
mp deploy internal internal-tool --dir ./internal-tool/dist
```

CLI 会：创建构建 ID → 逐文件上传 → 激活 → 把 `entryURL` 更新为
`https://applet.ssemarket.cn/mp/internal-tool/?source=src_...`，并把平台 origin 加入 `allowedOrigins`。

`source` token 只保护静态资源，不是用户身份：

- 首次带 `?source=` 打开 HTML 后，平台下发 `mp_src_<appKey>` Cookie，后续资源自动携带；
- 不带 token 访问 `/mp/<appKey>/` 返回 403（这是预期行为）；
- 重新执行 `mp hosting disable` 再部署可轮换 token。

查看与停用：

```bash
mp hosting status internal-tool
mp hosting disable internal-tool
```

### A5. 提交审核、发布

```bash
mp apps submit internal-tool --version 1.0.0 --changelog "内部托管首版"
# 管理员：mp admin queue → mp admin approve internal-tool
mp apps publish internal-tool
```

上线后的更新流程：重新 `mp deploy internal` → `mp apps submit`（新版本）→ 管理员审核 → `mp apps publish`。

深页：`references/platform-hosted.md`

---

## 3. 路线 B：部署在开发者自己的机器（外部托管）

> 适用：第三方开发者；已有网站的团队；需要独立域名/服务端渲染/独立 Cookie 的官方应用。
> 平台只登记入口和授权，**不托管页面**。

### B1. 注册开发者并创建小程序

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

或在 `https://applet.ssemarket.cn/#/apps/new` 创建。注意 `origins` 是 **origin**：
`scheme + host + port`，不带路径和末尾斜杠。

### B2. 已有网页 / App 之外，还必须加什么

只把现有网页填成 entryURL，App 能打开它，但**不会建立平台会话**。要成为平台小程序，还差这些：

| 必须补的 | 原因 | 怎么做 |
| --- | --- | --- |
| **HTTPS** | App WebView 不接受明文页 | 有效证书；`http://localhost` 仅限本地调试 |
| **移动端适配** | 页面在 WebView 中打开 | viewport + 响应式布局 |
| **SDK / 票据消费** | 平台要知道“谁在用” | 引入一行 `<script>`，SDK 自动换 `mp_session` |
| **origin 登记** | 票据申请会校验 origin | 创建/更新时填 `allowedOrigins` |
| **CSP 放行**（如站点有 CSP） | 否则 SDK 与接口被浏览器拦 | `script-src` / `connect-src` 加 `https://applet.ssemarket.cn` |
| **SPA 启动顺序** | 路由/登录守卫可能丢掉 `?ticket=` | 启动最早期执行 SDK，首屏不要整页跳 `/login` |
| **自有服务端（可选）** | 需要在自己的后端识别用户 | 用 `sessionToken` + AppKey/AppSecret HMAC 调 `/app/v1/sessions/verify` |
| **CORS 联调**（开发期） | 平台只放行**已发布**小程序的 origin | 先发布测试应用，或运维加 `MP_CORS_ORIGINS` |

**最小接入代码**（放在 `index.html` 的 `<head>`，业务脚本之前）：

```html
<script src="https://applet.ssemarket.cn/sdk/mp-client.js"></script>
```

SDK 会：

- 从自身 `src` 自动识别平台地址（不需要写 base）；
- 页面带 `?ticket=lt_...` 打开时**自动换会话**，不需要额外初始化代码；
- 换完会话后从地址栏移除 ticket；
- 提供 `MP.ready` / `MP.request` / `MP.prefs` / `MP.share`。

需要读用户或收藏时：

```js
const session = await MP.ready;      // { appKey, userId, scopes, expiresAt }
const prefs = await MP.prefs.get();  // { recent, favorites }
await MP.prefs.addFavorite('my-app');
MP.share({ title: '分享标题' });     // 通过 postMessage 交给 App 容器
```

> SDK 被代理到自定义路径，或需要显式指定平台地址时：
> `MP.configure({ base: 'https://applet.ssemarket.cn' })`（在 `MP.ready` 之前）。

### B3. 部署到自己的源

任选 nginx / OSS / COS / S3 / Vercel / Cloudflare Pages / 现有服务器。要求：

- HTTPS 可访问，入口返回 200/3xx；
- 资源用相对路径或带指纹的绝对路径；
- 页面 origin 与 `allowedOrigins` 完全一致。

自检：

```bash
mp apps check my-app --url https://mp-app.example.com/my-app
# 会打印 HTTP 状态、最终 URL、origin，并提示 origin 是否已登记
```

绑定入口（会自动补 origin）：

```bash
mp deploy external my-app --url https://mp-app.example.com/my-app
mp deploy external my-app --url https://mp-app.example.com/my-app --dry-run   # 只看变更
```

### B4. 提交审核、发布

```bash
mp apps submit my-app --version 1.0.0 --changelog "首版"
# 管理员：mp admin queue → mp admin approve my-app
mp apps publish my-app
```

> 审核期间不能修改配置或部署新构建；审核通过后需要开发者手动 `publish`。
> 状态：`draft` → `reviewing` → `approved` → `published`；驳回为 `rejected`，下架为 `offline`。

深页：`references/external-hosted.md`

---

## 4. App 侧适配（两条路线相同）

App 团队需要：

1. **拿到用户登录态**：主站 access token（或 UniSSO token）。
2. **申请票据**：

   ```http
   POST /v1/launch-tickets
   Authorization: Bearer <main_token>
   Content-Type: application/json

   {"appKey":"my-app","deviceID":"dev_stable_id","origin":"https://mp-app.example.com"}
   ```

   响应里的 `launchURL` 直接交给 WebView 打开（60 秒内、一次性）。
3. **准备容器**：WebView 开启 JS；处理返回/关闭；不要改写或丢弃 `launchURL` 的查询参数。
4. **同步偏好**：`GET/PUT /v1/me/prefs`（最近使用最多 20、我的小程序最多 50，服务端为准）。
5. **注册设备**：`POST /v1/devices`（deviceID 要稳定、持久化）。
6. **订阅与提醒**：`GET/PUT /v1/me/subscriptions`；推送未接入时用 `GET /v1/events/new-posts` 轮询兜底。
7. **官方应用的额外能力**（可选）：App 注入短时效 token、共享 SSO、页面内登录卡片；
   第三方小程序不适用，继续用 `mp_session`。详见现有 Skill `mp-app-integration` 与
   `docs/app-integration/app-identity.md`。

App 侧完整接入直接使用已安装的 `mp-app-integration` skill，不要在本 Skill 里重复实现。

---

## 5. 平台提供什么能力

| 能力 | 接口 / 方式 | 说明 |
| --- | --- | --- |
| 小程序目录 / 分类 / 搜索 | `GET /v1/apps`、`/v1/categories`、`/v1/search` | App 首页与搜索 |
| 一次性启动票据 | `POST /v1/launch-tickets` | 60 秒、绑定用户+应用+设备+origin |
| app-scoped 会话 | `POST /v1/sessions/exchange`、`GET/DELETE /v1/sessions/me` | HttpOnly Cookie，2 小时滑动续期 |
| 最近使用 / 我的小程序 | `GET/PUT /v1/me/prefs`、`POST /v1/me/prefs/import` | 跨端同步，服务端为准 |
| 授权记录 | `GET /v1/me/grants`、`DELETE /v1/me/grants/{appKey}` | 用户可撤销 |
| 设备与推送 token | `POST/GET /v1/devices`、`DELETE /v1/devices/{id}` | token 加密存储、掩码返回 |
| 订阅与新帖提醒 | `/v1/me/subscriptions`、`/v1/events/new-posts`、`/v1/me/notifications/read` | 站内通知 + 轮询兜底 |
| 用户反馈 | `POST /v1/feedback` | 后台可处理 |
| 页面 SDK | `GET /sdk/mp-client.js` | 自动换会话、偏好、分享桥 |
| 第三方服务端验会话 | `POST /app/v1/sessions/verify` | AppKey/AppSecret HMAC |
| 语音合成代理 | `/v1/tts/*` | API Key 只在服务端 |
| 开发者控制台 / 管理后台 | `/`、`/admin` | 创建、配置、审核、发布、审计、统计 |
| 内部事件 | `POST /internal/v1/events/new-post` | 主站 outbox，HMAC 签名 |
| 指标与健康检查 | `/healthz`、`/readyz`、`/metrics` | 运维 |

**平台不提供**：

- 外部托管页面的托管、HTTPS 证书、CDN（由开发者负责）；
- 业务数据（帖子、商城、课程等仍由主站/开发者服务提供）；
- 真实推送渠道 SDK（默认站内通知 + 可选 webhook 网关）；
- 邮件服务（邮箱验证/找回密码未接）；
- 用户密码托管（登录由主站/UniSSO 或开发者自有体系负责）。

---

## 6. 上线前检查清单

**通用**

- [ ] 小程序已创建，`appKey` 正确，`allowedOrigins` 与真实 origin 完全一致
- [ ] 页面 HTTPS 可访问，移动端布局正常
- [ ] ticket → 会话链路可用（打开 `launchURL` 后 `GET /v1/sessions/me` 返回 200）
- [ ] 申请的 scopes 与实际功能匹配（最小权限）
- [ ] AppSecret 只在服务端；仓库/前端无密钥
- [ ] 已提交审核并通过，且已执行 `publish`

**内部托管额外**

- [ ] 根目录有 `index.html`，资源为相对路径
- [ ] 构建 ≤ 25MB / 300 文件，单文件 ≤ 5MB
- [ ] 不带 `source` token 访问返回 403，带 token 返回 200
- [ ] 重新部署后重新提交版本并发布

**外部托管额外**

- [ ] CSP 放行 `https://applet.ssemarket.cn`（script + connect）
- [ ] SPA 不会在会话建立前丢掉 `?ticket=`
- [ ] 跨站域名场景：确认 `X-MP-Session` 兜底可用（新版 SDK 自动处理）
- [ ] 自有服务端：`/app/v1/sessions/verify` 签名与时间窗正确

---

## 7. 常见问题速查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `APP_NOT_FOUND` / 目录里看不到 | 应用未发布、已下架、白名单不可见 | 先审核发布；检查 visibility |
| `ORIGIN_NOT_ALLOWED` | 页面 origin 不在 `allowedOrigins` | 用 `mp apps update` 补 origin（不带路径） |
| 票据换会话 401 / 已使用 | ticket 过期（60s）或重复消费 | 重新申请票据；不要刷新旧 URL |
| 页面打开了但没有会话 | 没引 SDK / SPA 把 ticket 丢了 / 未在启动早期执行 | 按 B2 接入；检查首屏重定向 |
| 外部页面 SDK 请求 404 | 旧版 SDK 默认同源；或 base 错误 | 升级 SDK（自动识别 base）或 `MP.configure` |
| 浏览器报 CORS / `CORS_FORBIDDEN` | 应用未发布，origin 未被放行 | 先发布测试应用；或 `MP_CORS_ORIGINS` |
| SDK 被 CSP 拦 | 站点 CSP 未放行平台域名 | 加 `script-src` / `connect-src` |
| `INTERNAL_HOSTING_FORBIDDEN` | 非官方应用尝试内部托管 | 改用外部托管 |
| `INDEX_REQUIRED` | 构建根目录缺 `index.html` | 构建产物根目录放 `index.html` |
| `BUILD_TOO_LARGE` / `INVALID_FILE_TYPE` | 超出限制或含不支持的文件 | 清理 source map / 源文件，只传构建产物 |
| 刷新后 404（内部托管） | 子路径带扩展名，或资源用了绝对路径 | 用 hash 路由 / 相对资源；确认文件已上传 |
| `NO_APPROVED_VERSION` | 没有审核通过的版本就发布 | 先提交审核并通过 |
| 刷新后会话失效（外部跨站） | 浏览器拦截第三方 Cookie | 升级 SDK；确认 `X-MP-Session` 已发送 |

深页：`references/troubleshooting.md`

---

## 8. 参考文件

- `references/platform-hosted.md`：内部托管完整流程、API 细节、source token、限制
- `references/external-hosted.md`：外部托管完整流程、SDK、CORS/CSP、自有服务端验签
- `references/capabilities.md`：平台能力矩阵、接口清单、数据模型
- `references/troubleshooting.md`：错误码与排错
- `scripts/preflight.mjs`：入口 URL 预检（HTTPS、重定向、viewport、SDK、CSP、origin 登记）
- 平台文档：`https://applet.ssemarket.cn/app-docs/integration-modes.md`
- 接口契约：`https://applet.ssemarket.cn/openapi.yaml`
- App 侧接入：已有 skill `mp-app-integration`