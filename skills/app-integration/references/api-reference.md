# API 参考（v1）

Base URL：`{MP_BASE}`。除特别说明外均为 JSON，时间为 ISO-8601 UTC。
错误统一格式：

```json
{"code":"INVALID_TICKET","message":"启动票据无效","requestId":"..."}
```

## 认证

| 调用方 | 凭证 |
| --- | --- |
| App → 平台 | `Authorization: Bearer <main_access_token>` |
| 页面 → 平台 | `mp_session` HttpOnly Cookie（票据交换后获得） |
| 第三方服务端 | `X-App-Key` + `X-App-Timestamp` + `X-App-Nonce` + `X-App-Signature` |
| 主站内部 | `X-Internal-Timestamp` + `X-Internal-Nonce` + `X-Internal-Signature` |

---

## 1. 目录

### `GET /v1/apps`

参数：`category`、`cursor`、`limit`（默认 20，最大 50）。

```json
{
  "items": [{
    "appKey": "novel",
    "name": "小说",
    "description": "长篇连载与书架，随时续读。",
    "icon": "tabler:book-2",
    "category": "content",
    "entryURL": "https://applet.ssemarket.cn/mp/novel/",
    "scopes": ["profile:read","prefs:read"],
    "allowedOrigins": ["https://applet.ssemarket.cn"],
    "visibility": "logged_in",
    "version": "1.0.0",
    "ownerType": "official",
    "sort": 100,
    "badge": null,
    "publishedAt": "2026-11-14T08:00:00.000Z"
  }],
  "nextCursor": null
}
```

未带 token 时只返回 `visibility=public` 的小程序；带 token 时同时返回 `logged_in` 与命中白名单的 `allowlist` 小程序。

### `GET /v1/apps/{appKey}`

返回 `{ "app": PublicApp }`；不可见或未发布返回 404。

### `GET /v1/categories`

```json
{"items":[{"key":"content","name":"内容","icon":"book"}]}
```

### `GET /v1/search?q=小说&limit=20`

按名称、appKey、拼音、关键词模糊匹配。返回 `{items, nextCursor}`。

---

## 2. 启动票据与会话

### `POST /v1/launch-tickets`

请求：

```json
{"appKey":"novel","deviceID":"dev_xxx","origin":"https://applet.ssemarket.cn"}
```

- `deviceID` 选填但强烈建议传，用于票据绑定。
- `origin` 必须在 `allowedOrigins` 内；未传时取第一个允许的 origin。

响应 `201`：

```json
{
  "ticket":"lt_...",
  "launchURL":"https://applet.ssemarket.cn/mp/novel/?ticket=lt_...",
  "expiresIn":60,
  "expiresAt":"2026-11-14T08:01:00.000Z",
  "app":{...}
}
```

注意：`launchURL` 由小程序 `entryURL` 拼接 `ticket` 参数生成；网关模式（`MP_LAUNCH_MODE=gateway`）下为 `/launch?ticket=...&app=...`。

### `POST /v1/sessions/exchange`

请求：`{"ticket":"lt_..."}`。成功 `200` 并 `Set-Cookie: mp_session=...; HttpOnly; SameSite=Lax; Path=/`。

```json
{
  "session":{"userId":"561","appKey":"novel","deviceId":"dev_xxx","scopes":["profile:read"],"expiresAt":"..."},
  "sessionToken":"mps_...",
  "app":{...},
  "expiresIn":7200
}
```

`sessionToken` 与 HttpOnly Cookie 等价，仅用于一次性交给**自己的服务端**调用 `/app/v1/sessions/verify`；不要写入 localStorage、不要打日志、不要持久化。页面刷新后不会再返回该值，服务端应在此前建立自己的会话。

票据一次性：重复使用返回 `401 TICKET_USED`。

### `GET /v1/sessions/me`（Cookie）

返回当前会话与小程序信息。响应：

```json
{"session":{...},"app":{...}}
```

### `DELETE /v1/sessions/me`（Cookie）

注销当前会话并清除 Cookie。

---

## 3. 偏好

### `GET /v1/me/prefs`

可用主站 Bearer 或小程序会话（需 `prefs:read`）。

```json
{
  "recent":[{"appKey":"novel","openedAt":"...","app":{...}}],
  "favorites":[{"appKey":"ranking","addedAt":"...","app":{...}}],
  "limits":{"recent":20,"favorites":50}
}
```

### `PUT /v1/me/prefs`

```json
{"recent":["novel","ranking"],"favorites":["coin","novel"]}
```

- `recent` 按新→旧排列，服务端去重并截断到 20。
- `favorites` 为全量覆盖，截断到 50。
- 返回规范化后的完整偏好。

### `POST /v1/me/prefs/import`

一次性导入本地旧数据，字段同上；兼容 `["appKey"]` 与 `[{"appKey":"..."}]` 两种形态。

### `GET /v1/me/grants` / `DELETE /v1/me/grants/{appKey}`

查看 / 撤销用户对小程序的授权；撤销后该小程序所有会话立即失效。

---

## 4. 设备与订阅

### `POST /v1/devices`

```json
{
  "deviceID":"dev_xxx",
  "platform":"android",
  "appVersion":"0.6.7+18",
  "pushProvider":"fcm",
  "pushToken":"...",
  "notificationEnabled":true,
  "locale":"zh-CN"
}
```

- `platform`：`android | ohos | windows | ios | web`
- `pushProvider`：`fcm | hms | apns | wns | local`
- pushToken 只存哈希与 AES-GCM 密文，响应中打码。

### `GET /v1/devices` / `DELETE /v1/devices/{deviceID}`

列出 / 注销当前用户的设备。

### `GET/PUT /v1/me/subscriptions`

```json
{"topics":[{"topic":"new_posts","enabled":true,"quietHours":{"from":"23:00","to":"07:00"}}]}
```

`quietHours` 为空或 `null` 表示不静默；静默时段内只写站内通知，不触发系统推送。

### `GET /v1/events/new-posts?since=ISO&limit=30`

推送兜底轮询。返回：

```json
{
  "items":[{"id":1,"eventId":"evt_...","title":"新帖：...","body":"主页 · 新帖","status":"in_app","createdAt":"...","readAt":null,"event":{...}}],
  "unread":3,
  "nextCursor":null
}
```

### `POST /v1/me/notifications/read`

`{"ids":[1,2]}` 或 `{"all":true}`，返回 `{"updated":n}`。

---

## 5. 反馈

### `POST /v1/feedback`

```json
{"content":"反馈内容","appKey":"novel","contact":"可选"}
```

内容 2~1000 字；每用户每小时最多 5 条。

---

## 6. 第三方小程序服务端

### `POST /app/v1/sessions/verify`

请求头：

```
X-App-Key: <appKey>
X-App-Timestamp: <unix 秒>
X-App-Nonce: <随机串，≥8 位>
X-App-Signature: HMAC_SHA256(appSecret, appKey + "\n" + timestamp + "\n" + nonce + "\n" + rawBody) 的 hex
```

请求体：`{"sessionToken":"mps_..."}`（也可用 `X-MP-Session` 头）。

响应：

```json
{"valid":true,"userId":"561","appKey":"novel","scopes":["prefs:read"],"deviceId":"dev_xxx","expiresAt":"..."}
```

会话不属于该 appKey、过期或已撤销时返回 `{"valid":false}`。

### `GET /app/v1/apps/self`

同样签名（body 为空串），返回自身小程序配置。

---

## 7. 主站内部接口

### `POST /internal/v1/events/new-post`

签名串：`timestamp + "\n" + nonce + "\n" + rawBody`，HMAC-SHA256 后 hex；时间窗 ±5 分钟，nonce 5 分钟内不可复用。

```json
{
  "eventID":"evt_...",
  "postID":7726,
  "title":"想分享一件很有爱的事情",
  "partition":"主页",
  "authorUserID":561,
  "createdAt":"2026-11-14T08:00:00Z",
  "dedupKey":"post:7726"
}
```

响应 `202`：

```json
{"accepted":true,"duplicate":false,"eventId":"evt_...","notified":1,"stats":{"subscribers":1,"notified":1,"quiet":0,"suppressed":0}}
```

重复 eventID / dedupKey 返回 `200` 且 `duplicate:true`。

### `POST /internal/v1/token/verify`

同样签名，请求 `{"token":"..."}`，返回 `{"valid":true,"userID":"561","expiresAt":"..."}`。

---

## 8. UniSSO 身份（可选）

### `POST /auth/sso/verify`

用 UniSSO access_token 换平台 access_token（2 小时），可直接用于 `/v1/*`。

```json
{"accessToken":"<UniSSO access_token>"}
```

响应：

```json
{"accessToken":"<platform jwt>","tokenType":"Bearer","expiresIn":7200,
 "user":{"userId":"...","name":"...","email":"...","avatar":"","sseSub":"..."}}
```

也可以直接把 UniSSO access_token 作为 `Authorization: Bearer` 调 `/v1`，平台会用 SSO userinfo 校验。

### `GET /auth/sso/status`

返回 `{provider:"UniSSO",enabled,m2m,loginUrl}`，用于页面决定是否展示统一身份登录按钮。

> 平台控制台登录使用 `/auth/sso/start`；共享会话存在时可无感进入。详细见平台文档 `unissso-integration.md`。

## 9. 错误码

| code | HTTP | 含义 |
| --- | --- | --- |
| `INVALID_TICKET` | 401 | 票据不存在 |
| `TICKET_USED` | 401 | 票据已消费 |
| `TICKET_EXPIRED` | 401 | 超过 60 秒 |
| `ORIGIN_MISMATCH` | 401 | 票据与请求 origin 不一致 |
| `SESSION_REQUIRED` / `SESSION_INVALID` | 401 | 缺少 / 无效会话 |
| `SESSION_EXPIRED` / `SESSION_REVOKED` | 401 | 会话过期 / 已撤销 |
| `SCOPE_REQUIRED` | 403 | 缺少权限 |
| `APP_UNAVAILABLE` | 403 | 小程序未发布 / 已下线 |
| `APP_REVIEWING` | 409 | 审核中禁止修改 |
| `APP_LIMIT` | 403 | 开发者应用数量超限 |
| `INVALID_ORIGIN` / `ORIGINS_REQUIRED` | 400 | origin 不合法或未配置 |
| `NO_APPROVED_VERSION` | 409 | 无审核通过版本可发布 |
| `INVALID_SIGNATURE` | 401 | HMAC 校验失败 |
| `SIGNATURE_EXPIRED` | 401 | 时间戳超出 ±5 分钟 |
| `REPLAY_DETECTED` | 401 | nonce 已使用 |
| `RATE_LIMITED` | 429 | 触发限流，带 `Retry-After` |
| `INTERNAL_ERROR` | 500 | 服务异常，附带 `requestId` |

所有响应带 `X-Request-Id`，与日志中的 `requestId` 一致。