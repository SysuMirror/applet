# 小程序接入方式总览：自带页面，还是平台托管？

> 读者：第一次接入的开发者 / 需要给团队解释架构的同学
> 结论先说：**两种都支持**。第三方开发者默认用「外部托管」（页面放在你自己的 HTTPS 站点）；
> 官方应用可以选「内部托管」（静态构建上传到平台）。

---

## 1. 先理解：小程序到底是什么

小程序不是独立 App，也不是把小程序「嵌进」你自己的网站。它是：

> **集市 App 用 WebView 打开的一段网页。**

```
集市 App（已登录）
  │  POST /v1/launch-tickets          ← Bearer 主站 / UniSSO token
  ▼
launchURL = 你的页面地址 + ?ticket=lt_...
  │  App 用 WebView 打开 launchURL
  ▼
小程序页面（你的 HTTPS 页面，或平台 /mp/<appKey>/ 页面）
  │  SDK 自动 POST /v1/sessions/exchange?ticket=...
  ▼
HttpOnly Cookie: mp_session            ← 页面之后只带 Cookie 调 /v1
```

职责边界：

| 谁 | 负责 | 不负责 |
| --- | --- | --- |
| 集市 App | 登录、拉目录、申请票据、WebView 容器、设备推送 | 不实现小程序的业务页面 |
| 开发者 | 页面（前端）、自己的服务端（可选） | 不保存用户密码、不接触主站 token、不保存 AppSecret 到前端 |
| 平台 mp-service | 目录、启动票据、会话、偏好、设备/订阅、事件、审核发布、SDK | 不承载你的业务数据 |

页面拿到的 `mp_session` 是 **app-scoped** 的：只能访问该小程序被授权的 scopes。
如果页面有自己的服务端，把 `sessionToken` 交给服务端，服务端用 AppKey + AppSecret 的 HMAC
调 `POST /app/v1/sessions/verify` 校验（详见 [api.md](./api.md) 与 [examples.md](./examples.md)）。

---

## 2. 两种页面托管方式

| | 外部托管（[deploy-external.md](./deploy-external.md)） | 内部托管（[deploy-internal.md](./deploy-internal.md)） |
| --- | --- | --- |
| 适用对象 | **任意开发者（第三方默认）** | **仅官方应用 / 平台管理员** |
| 页面放在哪 | 你自己的 HTTPS 站点（现有网站也可以） | 平台域名 `https://applet.ssemarket.cn/mp/<appKey>/` |
| 部署方式 | 你自己部署（nginx / Vercel / OSS / 现有服务） | `mp deploy internal` 上传静态构建 |
| 平台登记什么 | `entryURL` + `allowedOrigins` + scopes | 构建 ID、source token、入口 URL |
| 访问控制 | 由你的网站自己控制 | URL 必须带 `source` token（首次访问后下发 Cookie） |
| 与平台同源 | 否，独立源，隔离更好 | 是，仅限可信代码 |
| 大小限制 | 由你的托管决定 | 单文件 5MB / 构建 25MB / 300 文件 |
| 页面形态 | 任意 HTTPS 页面（静态或动态渲染） | 静态构建产物，根目录必须有 `index.html` |

两种方式是同一套生命周期与 API，只是「页面从哪来」不同：

```
创建草稿 → 配置 entryURL/origin/scopes → 提交审核（版本快照）
        → 管理员审核 → 开发者发布 → 上线 / 下架
```

---

## 3. 我有现成网站，能直接用吗？

**能，走外部托管。** 平台不要求你把网站迁到我们这里，也不要求使用特定框架。步骤：

1. **注册开发者**：`https://applet.ssemarket.cn/#/register`（或 UniSSO 登录自动建号）。
2. **创建小程序**：填写 `entryURL`（现有网站里的入口页）、`allowedOrigins`（页面所在 origin，
   scheme + host + port 必须完全一致）、申请的 scopes。
3. **给入口页加接入代码**（通常只加一个 script 和一次初始化）：

   ```html
   <script src="https://applet.ssemarket.cn/sdk/mp-client.js"></script>
   <script>
     // 自动消费 URL 里的 ticket，建立 mp_session
     const session = await MP.ready;
     // 之后页面用同源 Cookie 方式调用平台接口 / fetch 到你的后端
   </script>
   ```

   不使用 SDK 也可以，手动 `POST /v1/sessions/exchange` 同样可行。
4. **部署并确认 HTTPS 可访问**（`http://localhost` 仅限本地调试；不允许自签证书）。
5. **提交审核 → 审核通过 → 发布**。App 目录里就能看到并打开。

需要注意的硬性要求：

- **HTTPS**：入口页和所有资源都要 HTTPS；App 的 WebView 不会接受明文页面。
- **origin 精确匹配**：页面的真实 origin 必须登记在 `allowedOrigins` 里，否则票据申请会被拒绝。
- **移动端适配**：页面在 App 的 WebView 里打开，按移动端视口设计。
- **CORS**：如果页面直接请求你自己的后端，后端要允许小程序页面的 origin；
  如果你把业务保留在现有站点，也可以让小程序页面只做薄入口，业务仍调你的 API。
- **不要在前端保存 AppSecret**；AppSecret 只用于你自己的服务端签名。

### 现有网站是桌面站 / 不想改主站怎么办？

三种常见做法：

1. **薄入口页**（推荐）：新写一个移动端入口页，加载 SDK 换会话，业务请求转调你现有后端的 API；
   对你的主站改动最小。
2. **直接把现有站点当入口**：只要它能在移动端 WebView 里正常使用，并能加载 SDK / 处理 ticket，
   就可以登记为外部托管。
3. **页面内嵌现有站点的某个功能**：技术上可在你的入口页用 iframe 嵌入，但不推荐——
   需要处理 `X-Frame-Options` / CSP，且两级页面的会话与尺寸适配更麻烦。

> 注意：外部托管下平台**不托管你的页面**，只登记入口和授权信息；
> 页面可用性、HTTPS 证书、CDN 都归你负责。

### 例子：直接接 `https://tts.ssemarket.cn/`

可以填，但「能打开」和「已接入平台」是两件事：

| 你做了什么 | 结果 |
| --- | --- |
| 只把 `https://tts.ssemarket.cn/` 填成 entryURL，页面不动 | App 能打开页面；页面照常使用它自己的登录。**没有平台会话**，收藏/最近使用/通知等平台能力不可用 |
| 在页面入口加 SDK 初始化 | 打开小程序时自动 `ticket → mp_session`，平台能力可用 |

完整做法：

1. 创建小程序时填：
   - `entryURL`: `https://tts.ssemarket.cn/`
   - `allowedOrigins`: `https://tts.ssemarket.cn`（origin 不带末尾斜杠）
2. 在 `index.html` 里、业务脚本之前引入 SDK：

   ```html
   <script src="https://applet.ssemarket.cn/sdk/mp-client.js"></script>
   <script>
     // SDK 会从自己的 src 自动识别平台地址，不需要手写 base
     MP.ready.then((session) => {
       // session.appKey / session.userId；之后 MP.request / MP.prefs 均可用
     }).catch((err) => {
       // 页面可以继续用自有登录；不要在这里阻塞整个应用启动
       console.warn('mp session unavailable:', err.code || err.message);
     });
   </script>
   ```

   如果 SDK 被代理到别的路径，或想显式指定平台地址，可以在 `MP.ready` 之前调用
   `MP.configure({ base: 'https://applet.ssemarket.cn' })`。
3. 确认页面不会在 `ticket` 被消费前跳走：
   - SPA 的路由 / 登录守卫通常会把 `?ticket=` 丢掉；请在应用启动最早期执行 SDK，
     或至少保证首屏不整页重定向到 `/login`；
   - SDK 换完会话后会主动从地址栏移除 `ticket`。
4. 部署后 `mp deploy external <appKey> --url https://tts.ssemarket.cn/` 绑定并提交审核。

这个站点的检查结果（2026-11-17）：

- HTTPS 正常（nginx，HTTP/2 200），已有移动端 viewport；
- **没有设置 CSP**，所以引入 SDK 不会被拦；如果以后加 CSP，需要放行
  `script-src https://applet.ssemarket.cn` 和 `connect-src https://applet.ssemarket.cn`；
- 它是纯前端 SPA（`<div id="app">` + `/assets/index-*.js`），本身没有平台 SDK，
  所以第 2 步是必须的。

两个容易踩的坑：

- **CORS 只放行“已发布”小程序的 origin**。审核通过前，从 `tts.ssemarket.cn`
  跨源调用平台接口会被浏览器拦（`CORS_FORBIDDEN`）。本地联调可以让管理员先发布一个测试应用，
  或把 origin 加到 `MP_CORS_ORIGINS`（运维配置）。
- **Cookie 的边界**：`tts.ssemarket.cn` 与 `applet.ssemarket.cn` 同属 `ssemarket.cn`，
  属于 same-site，`mp_session`（SameSite=Lax）可以正常跨源携带。如果是完全不同的域名
  （如 `mp-app.example.com`），浏览器可能把它当第三方 Cookie 拦截；新版 SDK 会自动把
  `sessionToken` 以 `X-MP-Session` 头发送，并在 `sessionStorage` 暂存，刷新后仍可复用。

---

## 3.1 有自己的登录体系，可以不用平台登录吗？

可以。平台**没有**面向第三方小程序的登录页；`mp_session` 是静默交换的，不弹框、不需要用户输入。
按需要选一种：

| 目标 | 是否引 SDK | 用户体验 | 平台能力 |
| --- | --- | --- | --- |
| 完全独立登录 | 不引，或引了不 exchange | 只看到自己的登录页 | 目录/审核/发布可用；偏好、设备、订阅、通知不可用 |
| **静默桥接（推荐）** | 引 SDK | 无平台 UI；平台 userId 绑定自己的账号 | 全部可用 |
| 平台票据免密登录自己的系统 | 引 SDK + 后端验签 | 用户无感进入自己的账号 | 全部可用 |

**页面侧**：照旧走自己的登录，只是额外静默拿一个平台用户标识：

```html
<script src="https://applet.ssemarket.cn/sdk/mp-client.js"></script>
<script>
  let sessionToken = '';
  try {
    const session = await MP.ready;     // 静默消费 ticket，不弹登录
    sessionToken = MP.serverToken();    // 交给自己的后端验签
  } catch (e) { /* 没有票据也允许走自己的登录 */ }

  const ownSession = await yourOwnLogin();  // 你自己的登录流程不变

  if (sessionToken) {
    await fetch('https://your-backend.example.com/account/bind-platform', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionToken }),
    });
  }
</script>
```

**服务端**：用 AppSecret 调 `POST /app/v1/sessions/verify` 校验 `sessionToken`，拿到可信的
`userId` 后，在自己的系统里查找/创建/绑定账号。不要直接相信前端传来的 userId。

> 完全不引 SDK 时：App 仍能打开页面，目录、审核、发布也正常；但偏好同步、设备推送、
> 订阅通知、授权记录、带身份的反馈都无法使用，平台也不会给该用户推送。
>
> 注意：启动票据来自 App 当前登录态（`POST /v1/launch-tickets` 需要主站 token）。
> “不用平台登录”不等于“App 用户不用登录”。

---

## 4. 什么时候用平台托管（内部托管）

适合：

- 集市官方小程序（小说、排行榜、简历、音乐视频、商城、课程专区这类）；
- 纯静态前端构建产物，希望「少一套部署、少一个域名」；
- 能接受与平台同源（页面会继承平台域名下的 Cookie 与安全边界）。

不适合：

- 第三方开发者（接口会返回 `INTERNAL_HOSTING_FORBIDDEN`）；
- 需要自己的域名 / Cookie / 服务端渲染的页面；
- 上传体积超过 25MB 或文件数超过 300 的构建。

命令：

```bash
mp init ./my-app --app-key my-app --base https://applet.ssemarket.cn
mp deploy internal my-app --dir ./my-app   # 上传并激活，返回带 source token 的入口
mp apps submit my-app --version 1.0.0 --changelog "首版"
```

平台托管的入口长这样：`https://applet.ssemarket.cn/mp/<appKey>/?source=src_...`。
`source` token 只保护静态资源，不代表用户身份；用户身份始终来自启动票据换到的 `mp_session`。

---

## 5. 怎么选：一张决策表

| 你的情况 | 建议 |
| --- | --- |
| 第三方开发者 / 外部团队 | **外部托管**（内部托管会直接拒绝） |
| 已有 HTTPS 网站或 Web 应用 | **外部托管**，登记现有入口页并接入 SDK |
| 只有后端、没有前端页面 | 写一个薄入口页（可用 `mp init` 生成），走**外部托管** |
| 官方应用，想由平台统一部署 | **内部托管** |
| 官方应用，但需要独立域名/服务端渲染 | **外部托管** |
| 页面需要收集用户密码 | 两种都不行：登录交给平台或你自己的后端，页面不存密码 |

无论选哪种，App 侧接入方式完全相同（见 [README.md](./README.md)、[api.md](./api.md)）：

```bash
# App 申请票据
curl -X POST https://applet.ssemarket.cn/v1/launch-tickets \
  -H "Authorization: Bearer $MAIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"appKey":"my-app","deviceID":"dev_1","origin":"https://mp-app.example.com"}'
# → { "launchURL": "https://mp-app.example.com/my-app?ticket=lt_...", ... }
```

---

## 6. 相关文档

- [deploy-external.md](./deploy-external.md)：自有 HTTPS 源的完整步骤、nginx 示例
- [deploy-internal.md](./deploy-internal.md)：CLI 上传、source token、大小限制
- [api.md](./api.md)：全部 App 接口、错误码、限流、幂等
- [features.md](./features.md)：功能范围、页面与状态、验收清单
- [examples.md](./examples.md)：cURL / Flutter / WebView 示例
- [admin-guide.md](./admin-guide.md)：审核、发布、内部托管的管理员视角