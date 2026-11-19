---
name: mp-app-integration
description: 接入「集市小程序开放平台」(mp-service)。用于 Flutter/Android/HarmonyOS/iOS/Windows App 打开小程序、同步最近使用/我的小程序、注册推送设备、处理新帖提醒；以及小程序页面统一登录、第三方服务端会话校验。
---

# 集市小程序开放平台接入 Skill

这个 Skill 面向 App 团队和小程序页面团队，包含接入流程、接口说明、示例代码和上线检查清单。

平台地址：`https://applet.ssemarket.cn`

## 先看这里：登录怎么处理

先区分两类小程序，登录链路不同：

**官方内置小程序**（`applet.ssemarket.cn/mp/*`）

- App 已登录时，容器注入短时效 access token，页面无感进入，不弹授权框；
- 独立窗口拿不到注入时，用 `.ssemarket.cn` 共享 SSO Cookie 静默登录；
- 仍未登录时，在小程序自己的窗口内显示统一登录卡片，调用主站
  `POST /mp-api/auth/login`（失败回退 `POST /auth/sso/m2m`）；
- 点「暂不登录」进入游客页，不被路由守卫弹回登录页；
- 登录一次，六个官方小程序共享登录态。

完整注入协议、卡片样式与安全边界见
[app-identity.md](../../docs/app-integration/app-identity.md)。

**第三方小程序**

- 使用平台签发的 `mp_session`，通过 `POST {MP_BASE}/v1/sessions/exchange` 换取；
- 页面不要收集主站密码，也不要读取主站 token；
- 需要登录时使用平台登录页，权限受 scopes 限制。

开发者只需要提供页面地址，并在创建小程序时登记页面域名。

## 先确认这 5 件事

1. `MP_BASE`：平台地址，默认 `https://applet.ssemarket.cn`。
2. `appKey`：要打开的小程序标识（开放平台分配，例如 `novel`）。
3. `deviceID`：设备稳定标识（安装后生成并持久化，不要每次启动变化）。
4. `origin`：小程序页面地址，例如 `https://applet.ssemarket.cn`；必须在该小程序允许的域名中登记。
5. 用户已在集市 App 登录，或愿意使用平台内置的统一身份登录。

## 最短接入路径

### 1. App 打开小程序

```http
POST {MP_BASE}/v1/launch-tickets
Authorization: Bearer {mainAccessToken}
Content-Type: application/json

{"appKey":"novel","deviceID":"dev_xxx","origin":"https://applet.ssemarket.cn"}
```

响应：

```json
{"ticket":"lt_...","launchURL":"https://applet.ssemarket.cn/launch?ticket=lt_...","expiresIn":60,"app":{...}}
```

把 `launchURL` 直接交给 WebView 打开即可。打开链接一次性、60 秒有效。

### 2. 小程序页面自动获得登录态

页面通过平台提供的会话读取用户授权的信息，不要自己实现登录：

```http
GET {MP_BASE}/v1/sessions/me
GET {MP_BASE}/v1/me/prefs
PUT {MP_BASE}/v1/me/prefs
```

也可以引入官方页面 SDK：

```html
<script src="{MP_BASE}/sdk/mp-client.js"></script>
<script type="module">
  const session = await MP.ready;
  const prefs = await MP.prefs.get();
  await MP.prefs.addFavorite('novel');
  MP.share({ title: '分享标题' });
</script>
```

如果页面需要登录但用户还没授权，跳转到 `{MP_BASE}/mp-login?redirect=<原页面路径>`。
平台会显示内置授权卡片；登录成功后自动回到原页面，不需要跳转主站登录页。

### 3. App 同步最近使用 / 我的小程序

```http
GET {MP_BASE}/v1/me/prefs          → {recent:[...], favorites:[...]}
PUT {MP_BASE}/v1/me/prefs          → 提交 recent / favorites 数组
```

本地缓存只作为离线兜底，服务端是跨端同步的准确数据。

### 4. App 注册设备与订阅

```http
POST {MP_BASE}/v1/devices          → 上报 FCM / HMS / APNs token
PUT  {MP_BASE}/v1/me/subscriptions → {"topics":[{"topic":"new_posts","enabled":true}]}
GET  {MP_BASE}/v1/events/new-posts?since=... → 推送失败时的兜底轮询
```

### 5. 第三方小程序服务端：校验会话

服务端保存 `appSecret`，对请求做 HMAC 签名：

```text
signature = HMAC_SHA256(appSecret, appKey + "\n" + timestamp + "\n" + nonce + "\n" + rawBody)
POST {MP_BASE}/app/v1/sessions/verify
X-App-Key / X-App-Timestamp / X-App-Nonce / X-App-Signature
{"sessionToken":"mps_..."}
→ {"valid":true,"userId":"...","scopes":[...],"expiresAt":"..."}
```

## 开发者检查清单

- ✅ 小程序页面使用 HTTPS，并登记到允许的域名。
- ✅ 登录方式可选：官方页面用 App 注入或统一登录卡片；第三方可用平台会话或自有登录。
- ✅ 使用统一登录时保留 `redirect`，登录成功后 `replace` 回原页面，不跳主站、不留在登录页。
- ✅ 自有登录也必须校验来源域名，并自行处理会话安全。
- ✅ `appSecret` 只放在服务端，不写进页面或 App 包。
- ✅ App 打开页面时校验来源域名。
- ✅ 新帖提醒优先使用设备推送；未拿到推送权限时用兜底轮询。
- ❌ 第三方页面不要收集主站邮箱/密码；不要把主站 token 交给第三方。
- ❌ 不要把用户密码、验证码或私密凭证写进页面日志或 URL。

## 可选：UniSSO 身份

如果 App 已经有 UniSSO access token，可以交给平台换取平台会话：

```http
POST {MP_BASE}/auth/sso/verify
{"accessToken":"<UniSSO access_token>"}
```

平台控制台的 UniSSO 登录（OAuth2 + PKCE / 共享会话无感）见 `references/api-reference.md` 和在线文档 `/app-docs/unissso-integration.md`。

## 常见错误码与处理

| code | 处理 |
| --- | --- |
| `INVALID_TICKET` / `TICKET_EXPIRED` | 重新申请打开链接 |
| `TICKET_USED` | 链接已被使用：不要重试同一个链接，重新申请 |
| `ORIGIN_MISMATCH` / 「launchURL 不在允许的 origin 内」 | App 传的 origin 与页面实际域名不一致，或 `entryURL` 的 origin 没登记进 `allowedOrigins`。检查 App 是否传的是入口页 origin，并让管理员把该 origin 加入 `allowedOrigins`（平台会自动放第一位） |
| `APP_UNAVAILABLE` | 小程序未发布或已下架 |
| `SESSION_REQUIRED` / `SESSION_EXPIRED` | 重新打开小程序，或跳转内置登录 |
| `SCOPE_REQUIRED` | 小程序未申请该权限，联系平台管理员 |
| `RATE_LIMITED` | 按 `Retry-After` 退避；检查是否重复轮询 |
| `INVALID_SIGNATURE` / `REPLAY_DETECTED` | 检查签名串顺序、时间窗、nonce 是否复用 |

## 本 Skill 的文件

- `references/api-reference.md` —— 逐接口契约、请求/响应字段、错误码
- `references/integration-guide.md` —— App 容器协议、推送兜底、数据迁移
- `references/security-checklist.md` —— 上线前安全检查
- `examples/flutter/mini_program_api.dart` —— Flutter API 客户端
- `examples/flutter/mini_program_container.dart` —— WebView 容器
- `examples/web/mp-client.js` —— 页面 SDK
- `examples/server/signature.mjs` —— 第三方服务端签名实现
- `examples/server/new-post-outbox.mjs` —— 新帖事件推送
- `scripts/smoke.mjs` —— 跑通「目录 → 打开小程序 → 会话 → 偏好」

## 验证接入

```bash
MP_BASE=https://applet.ssemarket.cn MP_TOKEN=<main access token> \
  node scripts/smoke.mjs
```

脚本会打印每一步状态码和关键字段，任何 4xx 都会给出 `code` / `requestId`，方便与平台日志对齐。