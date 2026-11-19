# 接口文档（App 端）

> 文档版本：v1.0 · 2026-11-15  
> API 版本：`/v1`  
> Base URL：`{MP_BASE}`（本地 `http://localhost:8080`，当前公网 `https://applet.ssemarket.cn`）  
> 传输：HTTPS；请求/响应均为 `application/json; charset=utf-8`

---

## 1. 认证

### 1.1 App → 平台

除「票据换会话」外，所有 App 接口都带：

```http
Authorization: Bearer <main_access_token>
```

- `main_access_token` 是 App 主站登录后获得的 **access token**。
- 平台只验签（或调用主站内部校验接口），**不保存密码、不保存 refreshToken**。
- token 过期时返回 `401`，由 App 走主站原有的刷新流程，然后重试本次请求。
- 只传 access token；refreshToken 留在 App 内，不要发给平台或页面。

### 1.2 小程序页面 → 平台

页面通过启动票据换取会话：

```http
POST {MP_BASE}/v1/sessions/exchange
Content-Type: application/json
Origin: https://mp-app.example.com

{"ticket":"lt_..."}
```

响应 `200`，并下发：

```http
Set-Cookie: mp_session=mps_...; HttpOnly; SameSite=Lax; Path=/; Max-Age=7200
```

页面之后的请求带 Cookie 即可（浏览器 `fetch` 需要 `credentials: 'include'`）。  
页面权限由小程序申请的 scopes 决定（`profile:read`、`prefs:read`、`prefs:write`、`notifications:read`、`notifications:write`、`posts:read`）。

### 1.3 认证矩阵

| 接口 | 主站 Bearer | 小程序 Cookie | 说明 |
| --- | :---: | :---: | --- |
| `GET /v1/apps`、`/search` | 可选 | — | 不带 token 只返回 `visibility=public` |
| `GET /v1/apps/{appKey}` | 可选 | — | 同上 |
| `GET /v1/categories` | 不需要 | — | 公开 |
| `POST /v1/launch-tickets` | 必须 | — | App 调用 |
| `POST /v1/sessions/exchange` | 不需要 | — | 页面调用，凭 ticket |
| `GET/DELETE /v1/sessions/me` | — | 必须 | 页面调用 |
| `GET/PUT /v1/me/prefs` | 或 | 或 | 页面需要 `prefs:read/write` |
| `POST /v1/me/prefs/import` | 或 | 或 | 页面需要 `prefs:write` |
| `GET /v1/me/grants`、`DELETE .../{appKey}` | 必须 | — | App 调用 |
| `/v1/devices` | 必须 | — | App 调用 |
| `/v1/me/subscriptions` | 必须 | — | App 调用 |
| `/v1/events/new-posts` | 必须 | — | App 轮询 |
| `POST /v1/me/notifications/read` | 必须 | — | App 调用 |
| `POST /v1/feedback` | 或 | 或 | App 或页面 |

---

## 2. 通用约定

### 2.1 请求头

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Authorization` | App 接口必填 | `Bearer <main_access_token>` |
| `Content-Type` | 有请求体时 | `application/json` |
| `Idempotency-Key` | 写接口建议 | 建议 UUID，10 分钟内相同 key 重试返回首次结果 |
| `Origin` | 页面跨域请求 | 必须在小程序 `allowedOrigins` 中 |

响应头包含 `X-Request-Id`；排查问题时请提供该值。

### 2.2 数据类型

- 用户 ID、appKey、eventID：**字符串**。即使是数字用户 ID，也请按字符串处理。
- 时间：ISO-8601 UTC，例如 `2026-11-15T08:00:00.000Z`。App 展示时自行转本地时区。
- 布尔值：JSON `true/false`。
- 列表分页：`limit` + `cursor`，响应 `{items, nextCursor}`；`nextCursor` 为 `null` 表示没有更多。

### 2.3 错误格式

```json
{
  "code": "TICKET_EXPIRED",
  "message": "启动票据已过期，请重新打开小程序",
  "requestId": "6f1c...-..."
}
```

HTTP 状态码与 `code` 同时存在；**不要只依据 message 文案做判断**。

### 2.4 限流

默认阈值（平台可按组调整）：

| 维度 | 默认 | 触发响应 |
| --- | --- | --- |
| 单 IP 全局 API | 1200 次/分钟 | `429 RATE_LIMITED` + `Retry-After` |
| 单用户接口 | 240 次/分钟 | 同上 |
| 启动票据 | 30 次/分钟/用户、60 次/分钟/IP | 同上 |
| 票据换会话 | 60 次/分钟/IP | 同上 |
| 新帖轮询 | 120 次/分钟/用户 | 同上 |
| 设备注册 | 60 次/分钟/用户 | 同上 |
| 偏好导入 / 反馈 | 5 次/小时/用户 | 同上 |

处理建议：读取 `Retry-After`，指数退避；不要多线程重复轮询。

### 2.5 幂等

写接口支持 `Idempotency-Key`。相同「登录凭证 + 方法 + 路径 + key」在 10 分钟内成功重试会直接返回首次响应。

- 推荐用于：`POST /v1/devices`、`PUT /v1/me/prefs`、`POST /v1/feedback`。
- `POST /v1/launch-tickets` 也可以用于**秒级网络重试**，但票据本身 60 秒过期；超过 60 秒请换新 key、重新申请。
- 失败的请求不会缓存。

---

## 3. 目录

### 3.1 获取小程序目录

`GET /v1/apps`

| Query | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| category | string | 否 | 分类 key；不传返回全部 |
| cursor | string | 否 | 上一页的 `nextCursor` |
| limit | int | 否 | 默认 20，最大 50 |

响应：

```json
{
  "items": [
    {
      "appKey": "novel",
      "name": "小说",
      "description": "长篇连载与书架，随时续读。",
      "icon": "tabler:book-2",
      "category": "content",
      "entryURL": "https://mp-app.example.com/novel",
      "scopes": ["profile:read", "prefs:read", "prefs:write", "posts:read"],
      "allowedOrigins": ["https://mp-app.example.com"],
      "visibility": "logged_in",
      "version": "1.0.0",
      "ownerType": "official",
      "sort": 100,
      "badge": null,
      "publishedAt": "2026-11-14T08:00:00.000Z"
    }
  ],
  "nextCursor": null
}
```

说明：

- 带有效 Bearer 时返回 `public` + `logged_in` + 命中白名单的 `allowlist` 小程序；不带 token 只返回 `public`。
- 只返回已发布且未删除的小程序。
- 排序：`sort` 降序，其次按创建顺序；客户端不要自行改变平台排序。

### 3.2 获取单个小程序

`GET /v1/apps/{appKey}`

响应：

```json
{"app": { "...": "同上 PublicApp" }}
```

不可见或未发布返回 `404 APP_NOT_FOUND`。

### 3.3 分类

`GET /v1/categories`

```json
{
  "items": [
    {"key":"content","name":"内容","icon":"book"},
    {"key":"tool","name":"工具","icon":"wrench"},
    {"key":"life","name":"生活","icon":"coffee"},
    {"key":"official","name":"官方","icon":"badge"},
    {"key":"game","name":"游戏","icon":"gamepad"},
    {"key":"shopping","name":"购物","icon":"bag"},
    {"key":"other","name":"其他","icon":"grid"}
  ]
}
```

### 3.4 搜索

`GET /v1/search?q={关键词}&limit=20`

- `q` 必填，最大 64 字符；匹配名称、appKey、拼音、关键词。
- 服务端搜索，App 不要缓存全量目录做本地搜索。
- 响应 `{items, nextCursor}`，字段同目录。

---

## 4. 启动票据与会话

### 4.1 申请启动票据

`POST /v1/launch-tickets`  
认证：Bearer  
限流：30 次/分钟/用户

请求：

```json
{
  "appKey": "novel",
  "deviceID": "dev_7f3a...",
  "origin": "https://mp-app.example.com"
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| appKey | 是 | 目标小程序 |
| deviceID | 建议 | 3~128 字符，安装内稳定；用于票据绑定与排查 |
| origin | 建议 | 页面实际源；必须在该小程序 `allowedOrigins` 中；不传则取第一个允许的 origin |

响应 `201`：

```json
{
  "ticket": "lt_XP7OWq...",
  "launchURL": "https://mp-app.example.com/novel?ticket=lt_XP7OWq...",
  "expiresIn": 60,
  "expiresAt": "2026-11-15T08:01:00.000Z",
  "app": { "...": "PublicApp" }
}
```

使用规则：

1. `ticket` 一次性、60 秒；只能换会话，**不能当 API token 用**。
2. `launchURL` 原样交给 WebView；不要自行拼接 / 修改参数。
3. App 加载前校验：HTTPS、host 属于 `app.allowedOrigins` 或 `entryURL` 同源。
4. 页面刷新 / 用户重进必须重新申请，不能复用旧 ticket。
5. 打开失败（过期 / 已用）时重新走整个流程，不要重试旧 URL。

错误：`APP_NOT_FOUND`、`APP_UNAVAILABLE`、`ORIGIN_NOT_ALLOWED`、`RATE_LIMITED`。

### 4.2 票据换会话（页面调用）

`POST /v1/sessions/exchange`  
认证：无（凭 ticket）  
限流：60 次/分钟/IP

请求：

```json
{"ticket":"lt_XP7OWq..."}
```

请求头：

- 页面跨域时带 `Origin`，必须与票据绑定 origin 一致。
- `credentials: 'include'`（浏览器）。

响应 `200`：

```json
{
  "session": {
    "userId": "561",
    "appKey": "novel",
    "deviceId": "dev_7f3a...",
    "scopes": ["profile:read", "prefs:read", "prefs:write", "posts:read"],
    "expiresAt": "2026-11-15T10:00:00.000Z"
  },
  "sessionToken": "mps_...",
  "app": { "...": "PublicApp" },
  "expiresIn": 7200
}
```

并下发 `mp_session` HttpOnly Cookie。

- **`sessionToken`** 仅供页面交给自己的服务端做 `POST /app/v1/sessions/verify`；与 Cookie 等价，不要持久化、不要打日志。
- 页面刷新后不会再次返回 `sessionToken`；服务端应在首次交换时建立自己的会话。
- 同一 ticket 第二次使用返回 `401 TICKET_USED`。

### 4.3 查询 / 注销当前会话（页面调用）

`GET /v1/sessions/me`（Cookie）→ `{session, app}`  
`DELETE /v1/sessions/me`（Cookie）→ `{ok:true}`，同时清除 Cookie。

会话剩余有效期不足一半时，服务端自动滑动续期并重写 Cookie。

---

## 5. 用户偏好

### 5.1 读取偏好

`GET /v1/me/prefs`  
认证：Bearer 或 Cookie（页面需 `prefs:read`）

```json
{
  "recent": [
    {"appKey":"novel","openedAt":"2026-11-15T07:50:00.000Z","app": {"...":"PublicApp"}}
  ],
  "favorites": [
    {"appKey":"ranking","addedAt":"2026-11-14T10:00:00.000Z","app": {"...":"PublicApp"}}
  ],
  "limits": {"recent": 20, "favorites": 50}
}
```

- `recent` 按打开时间倒序；只包含仍处于已发布状态的小程序。
- `favorites` 为「我的小程序」，按加入/更新时间倒序。

### 5.2 更新偏好

`PUT /v1/me/prefs`  
认证：Bearer 或 Cookie（页面需 `prefs:write`）

```json
{
  "recent": ["novel", "ranking"],
  "favorites": ["coin", "novel"]
}
```

语义：

- **增量更新**：只传 `favorites` 不会影响 `recent`，只传 `recent` 不会清空 `favorites`。
- `recent`：按新→旧排列；服务端去重、截断到 20 条，并重写打开时间。
- `favorites`：**全量覆盖**（传了就代表当前完整收藏集合），去重、截断到 50 条。
- 不存在的 / 未发布的小程序会被忽略。
- 响应为规范化后的完整偏好（同 5.1）。

建议：加入/移除「我的小程序」时只提交 `favorites`；打开小程序后无需手动写 `recent`（平台在换会话时自动记录）。

### 5.3 导入旧本地数据

`POST /v1/me/prefs/import`  
认证：Bearer 或 Cookie（`prefs:write`）  
限流：5 次/小时/用户

```json
{
  "recent": ["novel", "ranking"],
  "favorites": [{"appKey":"coin"}, {"appKey":"novel"}]
}
```

兼容字符串数组与 `{appKey}` 对象数组；返回 `{imported:true, recent, favorites, limits}`。用于从旧原型迁移。

### 5.4 授权记录

`GET /v1/me/grants`（Bearer）

```json
{
  "items": [
    {"appKey":"novel","scopes":["profile:read","prefs:read"],"grantedAt":"2026-11-15T07:50:00.000Z"}
  ]
}
```

`DELETE /v1/me/grants/{appKey}`（Bearer）撤销授权，并让该小程序的所有会话立即失效。

---

## 6. 设备与推送

### 6.1 注册 / 更新设备

`POST /v1/devices`  
认证：Bearer  
限流：60 次/分钟/用户

```json
{
  "deviceID": "dev_7f3a...",
  "platform": "android",
  "appVersion": "0.6.7+18",
  "pushProvider": "fcm",
  "pushToken": "fcm-token...",
  "notificationEnabled": true,
  "locale": "zh-CN"
}
```

| 字段 | 必填 | 枚举 / 限制 |
| --- | --- | --- |
| deviceID | 是 | 3~128 字符；同一安装内稳定 |
| platform | 是 | `android` / `ohos` / `windows` / `ios` / `web` |
| appVersion | 否 | ≤32 字符 |
| pushProvider | 否 | `fcm` / `hms` / `apns` / `wns` / `local`，默认 `local` |
| pushToken | 否 | ≤2048 字符；敏感数据，服务端加密存储 |
| notificationEnabled | 否 | 默认 `true` |
| locale | 否 | 例如 `zh-CN` |

响应 `201`：

```json
{
  "device": {
    "deviceID":"dev_7f3a...",
    "platform":"android",
    "appVersion":"0.6.7+18",
    "pushProvider":"fcm",
    "pushToken":"fcm-****...",
    "notificationEnabled":true,
    "lastSeenAt":"2026-11-15T08:00:00.000Z"
  }
}
```

同一 `deviceID` 重复注册会覆盖并刷新 `lastSeenAt`；token 轮换时直接重新提交即可。

### 6.2 查看 / 注销设备

`GET /v1/devices`（Bearer）→ 设备列表（不含明文 token）  
`DELETE /v1/devices/{deviceID}`（Bearer）→ 注销；登出 / 卸载时调用。

---

## 7. 订阅与新帖通知

### 7.1 订阅设置

`GET /v1/me/subscriptions`（Bearer）

```json
{
  "topics": [
    {"topic":"new_posts","enabled":true,"quietHours":{"from":"23:00","to":"07:00"}}
  ]
}
```

`PUT /v1/me/subscriptions`（Bearer）

```json
{
  "topics": [
    {"topic":"new_posts","enabled":true,"quietHours":{"from":"23:00","to":"07:00"}}
  ]
}
```

- 目前仅支持 `new_posts`。
- `quietHours` 为 `HH:MM`，支持跨零点；**按平台时区解释（默认 UTC+8）**，不是设备本地时区。
- 静默时段只抑制系统推送，站内通知仍会写入，可通过轮询看到。

### 7.2 新帖提醒轮询（推送兜底）

`GET /v1/events/new-posts?since={ISO时间}&limit=30`  
认证：Bearer  
限流：120 次/分钟/用户

| Query | 说明 |
| --- | --- |
| since | 上次成功拉取的最新 `createdAt`；不传默认最近 24 小时 |
| limit | 默认 30，最大 100 |

```json
{
  "items": [
    {
      "id": 128,
      "eventId": "evt_...",
      "appKey": "new_posts",
      "title": "新帖：想分享一件很有爱的事情",
      "body": "主页 · 新帖",
      "status": "in_app",
      "createdAt": "2026-11-15T08:00:00.000Z",
      "readAt": null,
      "event": {
        "eventID":"evt_...",
        "postID":7726,
        "title":"想分享一件很有爱的事情",
        "partition":"主页",
        "authorUserID":561,
        "createdAt":"2026-11-15T08:00:00.000Z"
      }
    }
  ],
  "unread": 3,
  "nextCursor": null
}
```

- `status`：`in_app`（仅站内）/ `sent`（已推送）/ `quiet`（静默）/ `suppressed`（超过每小时推送上限）/ `pending` / `failed`。
- 推送不可用或未授权时，建议前台每 60 秒轮询一次；页面不可见时暂停。
- 用 `since` 只取增量；首次可拉最近 24 小时。

### 7.3 标记已读

`POST /v1/me/notifications/read`（Bearer）

```json
{"ids":[128,129]}
```

或：

```json
{"all":true}
```

响应 `{"updated":2}`。

---

## 8. 反馈

`POST /v1/feedback`  
认证：Bearer 或 Cookie  
限流：5 次/小时/用户

```json
{
  "content": "打开小说小程序后白屏",
  "appKey": "novel",
  "contact": "user@example.com"
}
```

- `content` 2~1000 字；`appKey` 选填；`contact` 选填。
- 响应 `201 {"ok":true}`。

---

## 9. 数据结构

### PublicApp

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| appKey | string | 稳定标识 |
| name | string | 展示名 |
| description | string | 简介 |
| icon | string | `tabler:*` 图标名，或图片图标的**绝对 URL**（如 `https://applet.ssemarket.cn/media/....png`） |
| category | string | 分类 key |
| entryURL | string | 小程序入口（HTTPS） |
| scopes | string[] | 该小程序获得的权限 |
| allowedOrigins | string[] | 允许的页面源 |
| visibility | string | `public` / `logged_in` / `allowlist` |
| version | string | 当前版本 |
| ownerType | string | `official` / `partner` |
| sort | int | 平台排序值 |
| badge | string\|null | 角标（预留） |
| publishedAt | string\|null | 发布时间 |

### Session

| 字段 | 类型 |
| --- | --- |
| userId | string |
| appKey | string |
| deviceId | string |
| scopes | string[] |
| expiresAt | ISO string |

### Preferences

| 字段 | 类型 |
| --- | --- |
| recent | `{appKey, openedAt, app}[]` |
| favorites | `{appKey, addedAt, app}[]` |
| limits | `{recent:20, favorites:50}` |

### Subscription

| 字段 | 类型 |
| --- | --- |
| topic | `new_posts` |
| enabled | boolean |
| quietHours | `{from,to}` \| null |

---

## 10. 错误码

| HTTP | code | 含义 | App 处理 |
| --- | --- | --- | --- |
| 401 | `UNAUTHORIZED` | 缺少主站凭证 | 触发登录 / 刷新 token |
| 401 | `TOKEN_EXPIRED` | 主站 token 过期 | 刷新后重试 |
| 401 | `INVALID_TOKEN` | token 无效 | 重新登录 |
| 401 | `INVALID_TICKET` | 票据不存在 | 重新申请 |
| 401 | `TICKET_USED` | 票据已使用 | 重新申请 |
| 401 | `TICKET_EXPIRED` | 超过 60 秒 | 重新申请 |
| 401 | `ORIGIN_MISMATCH` | 页面 origin 与票据不一致 | 修正容器 origin |
| 401 | `SESSION_REQUIRED` | 页面缺少会话 | 重新走启动流程 |
| 401 | `SESSION_EXPIRED` | 会话过期 | 重新走启动流程 |
| 401 | `SESSION_REVOKED` | 用户撤销授权 | 提示重新授权 |
| 403 | `SCOPE_REQUIRED` | 页面缺少权限 | 功能降级 |
| 403 | `APP_UNAVAILABLE` | 小程序未发布 / 下线 | 从面板隐藏 |
| 404 | `APP_NOT_FOUND` | 小程序不存在 / 不可见 | 刷新目录 |
| 400 | `ORIGIN_NOT_ALLOWED` | origin 未登记 | 检查开放平台配置 |
| 400 | `APP_KEY_REQUIRED` | 缺少 appKey | 客户端参数错误 |
| 400 | `INVALID_*` | 参数不合法 | 按 message 修正 |
| 429 | `RATE_LIMITED` | 限流 | 按 `Retry-After` 退避 |
| 500 | `INTERNAL_ERROR` | 服务异常 | 展示重试，并记录 `requestId` |

---

## 11. 变更策略

- `/v1` 内只做向后兼容的**新增字段**；客户端必须忽略未知字段。
- 枚举新增值（如新平台、新通知状态）时，客户端应有默认分支，不要直接崩溃。
- 破坏性变更会提供新版本前缀（`/v2`）并保留旧版本过渡期。
- 接口字段以本文档与 `/openapi.yaml` 为准。