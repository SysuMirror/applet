# App 接入指南

## 1. 容器启动时序

```
用户点击小程序
   │
   ├─ App: POST /v1/launch-tickets  (Bearer main access token)
   │       {appKey, deviceID, origin}
   │       ← {ticket, launchURL, expiresIn:60}
   │
   ├─ App: WebView.loadUrl(launchURL)
   │       —— 禁止注入 main access/refresh token
   │
   ├─ 页面: POST /v1/sessions/exchange {ticket}
   │       ← Set-Cookie: mp_session (HttpOnly, 2h, 滑动续期)
   │
   ├─ 页面: GET /v1/sessions/me, /v1/me/prefs ...
   │
   └─ App: 记录最近使用（也可由平台在 exchange 时自动记录）
```

App 侧的 `launchURL` 校验：

1. 解析 URL，协议必须是 `https`（本地开发除外）。
2. origin 必须等于该小程序的 `entryURL` origin，并且出现在 `allowedOrigins`。
3. 只允许加载该 URL 或其同源子路径；禁止任意外链。
4. 官方小程序可复用 App 注入 token；第三方使用平台会话或自有登录，页面不保存主站密码。

## 2. WebView ↔ App 桥

页面通过 SDK 发消息：

```json
{"type":"mp.event","event":"share","payload":{"title":"...","path":"/novel"}}
```

App 必须：

- 校验 `message` 来源页面的 URL 在 `allowedOrigins` 内；
- 只处理白名单事件（`share`、`close`、`open-url`）；
- 不要把任意事件映射到原生能力；
- 不把消息内容直接当 JS 执行。

页面侧：

```js
MP.share({ title: '分享标题', path: location.pathname });
```

## 3. 最近使用与我的小程序

- 平台在每次 `sessions/exchange` 时自动把该小程序写入 `recent`。
- App 打开下拉面板时先渲染本地缓存，再调用 `GET /v1/me/prefs` 校正。
- 用户「添加到我的小程序 / 移除」调用 `PUT /v1/me/prefs`：
  - 只改 favorites 时，传 `{favorites:[...]}` 即可（recent 不变）。
  - 只调顺序时，传 `{recent:[...]}`。
- 建议做 300~500ms 防抖，避免频繁写。

## 4. 推送与兜底

```
新帖 → 旧服务 outbox → /internal/v1/events/new-post
                         ├─ 去重（eventID / dedupKey，7 天）
                         ├─ 订阅匹配 + 静默时段
                         ├─ 写站内通知（轮询可见）
                         └─ 异步推送（FCM/HMS/APNs/WNS）
```

- 设备上送：`POST /v1/devices`，token 变化时覆盖同一 `deviceID`。
- 通知开关关闭时，服务端不会向该设备推送，但站内通知仍会写入。
- 未拿到推送权限 / 推送失败：前台每 60 秒 `GET /v1/events/new-posts?since=<上次时间>`。
- 静默时段（`quietHours`）只抑制系统推送，不丢失站内通知。
- 单用户每小时系统推送有条数上限，超出会标记 `suppressed`，仍可在站内查看。

## 5. 从旧原型迁移

旧实现中需要替换的点：

| 旧行为 | 新行为 |
| --- | --- |
| `/api/auth/workbench/apps` 取目录 | `GET /v1/apps` |
| 页面自行保存用户密码 | 官方页面复用 App 注入 + 统一登录卡片；第三方使用平台会话或自有登录 |
| 本地 SharedPreferences 作为唯一偏好源 | 服务端 `GET/PUT /v1/me/prefs`，本地只缓存 |
| 每 60s 轮询主站 `/auth/browse` | 推送为主，`/v1/events/new-posts` 兜底 |
| 本地通知 | `POST /v1/devices` 上报 token + 本地通知兜底 |

迁移期间可保留旧代码作为 fallback。新服务上线后，第三方小程序必须关闭主站 token 注入；官方内部小程序仅保留文档约定的短时效 access token 注入。

## 6. 多端一致性

- `deviceID` 在同一安装内稳定；重装生成新 ID 即可。
- 最近使用 / 我的小程序以服务端为准，跨端登录同一账号自动同步。
- 小程序会话按「用户 + 小程序 + 设备」隔离，换端不会互相顶掉。
- 撤销授权（`DELETE /v1/me/grants/{appKey}`）会让该小程序所有端会话失效。

## 7. 本地联调

本地平台默认地址 `http://localhost:8080`：

1. 用管理员账号登录开放平台，创建小程序。
2. 入口地址填 `http://localhost:8080/demo/app?app=<appKey>`。
3. allowedOrigins 填 `http://localhost:8080`。
4. 用 `scripts/mint-token.js --user 561` 生成主站测试 token。
5. App 用该 token 申请票据，打开 `/launch` 或直接打开 demo 页面。

演示页面 `/demo/app?app=novel` 展示了胶囊菜单、添加到我的小程序、分享桥消息与会话信息。

## 8. 可观测性

- 每个响应带 `X-Request-Id`；错误体也带 `requestId`。
- 平台 `/metrics` 暴露 Prometheus 指标（请求量、票据、会话、事件、通知）。
- `/healthz`、`/readyz` 用于探针；`/readyz` 会检查 MySQL。
- 若遇到 5xx，请把 `requestId` 与服务端日志一起反馈。