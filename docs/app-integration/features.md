# 功能文档（App 端）

> 文档版本：v1.0 · 2026-11-15  
> 读者：App 产品、客户端开发、QA、运维  
> 配套接口文档：[api.md](./api.md)

---

## 1. 目标与范围

App 侧要交付的是「小程序入口 + 容器 + 偏好同步 + 通知」四件事：

1. 登录后从平台拉取用户可见的小程序目录，渲染下拉面板；
2. 打开小程序页面；登录与授权由平台统一处理（已登录统一身份时自动登录，未登录时展示内置登录页）；
3. 跨端同步「最近使用 / 我的小程序」；
4. 注册设备推送 token、接收/轮询新帖提醒，「我的小程序」可管理与撤销授权。

**不包含**：帖子/评论/小说/商城等业务读写（仍由主站业务接口提供）、小程序页面的前端实现、平台运营后台。

### 1.1 职责边界

| 能力 | App | mp-service | 小程序页面 |
| --- | :---: | :---: | :---: |
| 主站登录 / 刷新 token | ✅ | — | — |
| 小程序目录 | 展示 / 缓存 | 提供 | — |
| 启动票据 | 申请 / 打开 WebView | 签发 / 校验 | — |
| 小程序会话 | — | 票据换会话 | 使用 Cookie |
| 最近使用 / 收藏 | 展示 / 本地缓存 | 跨端真相源 | 可读写偏好 |
| 设备推送 token | 获取 / 上报 | 存储 / 分发 | — |
| 新帖通知 | 展示 / 轮询兜底 | 去重 / fanout | — |
| 业务数据 | 主站业务接口 | 不承载 | 按需调用主站内部接口 |

---

## 2. 用户与数据

- **用户身份**：沿用学校统一身份 / 集市账号；App 不需要在小程序平台单独注册用户。
- **小程序登录**：官方内置小程序优先复用 App 主站身份（容器注入短时效 access token），没有注入条件时用共享 SSO Cookie 静默登录；仍未登录则在小程序自己的窗口内显示登录卡片，不跳回主 App。登录一次，全部官方小程序通用。详见 [app-identity.md](./app-identity.md)。
- **跨端数据**：`recent`、`favorites`、订阅、设备、通知都以 `main user id` 为键存在平台侧。
- **小程序数据**：`appKey` 稳定；名称、图标、入口、origin、scopes 由开放平台配置。
- **最近使用上限 20，我的小程序上限 50**；超出由服务端截断，App 不需要自行截断。

---

## 3. 功能清单

| 优先级 | 功能 | 依赖接口 |
| --- | --- | --- |
| P0 | 小程序目录 / 分类 / 搜索 | `GET /v1/apps`、`/categories`、`/search` |
| P0 | 打开小程序（启动票据 + WebView） | `POST /v1/launch-tickets`、页面 `exchange` |
| P0 | 最近使用 / 我的小程序同步 | `GET/PUT /v1/me/prefs` |
| P1 | 设备注册与推送 token 上报 | `POST/DELETE /v1/devices` |
| P1 | 新帖提醒订阅 + 轮询兜底 | `PUT /v1/me/subscriptions`、`GET /v1/events/new-posts` |
| P1 | 通知已读 | `POST /v1/me/notifications/read` |
| P2 | 撤销小程序授权 | `DELETE /v1/me/grants/{appKey}` |
| P2 | 反馈 | `POST /v1/feedback` |

---

## 4. 详细功能

### 4.1 登录态

- App 使用主站登录态；小程序接口统一带 `Authorization: Bearer <access_token>`。
- access token 过期时按主站既有逻辑刷新，刷新后重试原请求；不要把 refreshToken 发送给平台。
- 切换账号后：清空目录缓存、偏好缓存、通知游标、WebView Cookie，重新拉取。

### 4.2 小程序下拉面板

**进入面板时**

1. 立即展示本地缓存（如有），标记「缓存」状态；
2. 并行请求 `GET /v1/me/prefs` 与 `GET /v1/apps?limit=20`；
3. 成功后有变化则无感刷新；失败保留缓存并显示轻量错误提示 + 重试；
4. 下拉刷新重新请求两者。

**面板内容**

- 「最近使用」：按平台返回顺序，最多 20 个；
- 「我的小程序」：收藏，最多 50 个；
- 「全部小程序」：分类筛选 + 分页（`nextCursor`）；
- 搜索：输入 300ms 防抖后调用 `GET /v1/search`，清空输入恢复面板；
- 小程序卡片：图标、名称、简介、分类、角标（预留）；
- 状态：加载骨架、空态、错误态、离线态。

**排序与去重**

- 完全使用平台返回顺序，App 不重排。
- 同一个小程序可能同时出现在最近与收藏，允许两处展示；收藏列表内不重复。

**不可见处理**

- 目录接口只返回用户可见且已发布的小程序；从面板打开时若返回 `404/403`，提示「小程序已下线」并刷新面板。

### 4.3 打开小程序

```
点击小程序
  → 校验 appKey / allowedOrigins
  → POST /v1/launch-tickets {appKey, deviceID, origin}
  → 展示启动 loading
  → WebView.loadUrl(launchURL)
  → 页面 POST /v1/sessions/exchange {ticket}
  → 页面拿到 mp_session，进入小程序
```

**要求**

- `deviceID`：安装内稳定；没有则不传，但建议生成并持久化。
- `origin`：传 WebView 实际页面的源，必须与小程序 `allowedOrigins` 一致。
- `launchURL` 原样加载；校验 HTTPS、host 属于 `allowedOrigins`/`entryURL`。
- **禁止注入**主站 access/refresh token 到 localStorage、cookie 或 JS 桥。唯一例外：官方内部小程序（`applet.ssemarket.cn/mp/*`）允许容器向页面注入**短时效 access token**（内存变量 `__SSE_MAIN_TOKEN__`，不注入 refresh token、不写 localStorage），见 [app-identity.md](./app-identity.md)；第三方小程序不得要求注入。
- 票据 60 秒；加载前超时或失败，重新申请，不复用旧 ticket。
- WebView 刷新：页面内的 Cookie 会保留（2 小时滑动），刷新本身不需要新票据；如果 Cookie 失效，页面提示用户从 App 重开。
- 关闭小程序：清理 WebView；按需刷新最近使用（平台在 exchange 时已自动记录）。
- 多设备：同一用户可同时打开同一小程序，各自独立会话。

**失败态**

| 场景 | 提示 | 动作 |
| --- | --- | --- |
| 小程序未发布 / 下线 | 小程序暂不可用 | 关闭 loading，刷新面板 |
| origin 未登记 | 配置错误，请联系开发者 | 关闭，上报埋点 |
| 票据过期 / 已使用 | 启动超时，请重试 | 重新申请一次 |
| 网络错误 | 网络异常，请重试 | 保留面板 |
| 平台 5xx | 服务暂时不可用 | 重试 + 记录 requestId |

### 4.4 最近使用与我的小程序

**最近使用**

- 由平台在会话交换成功时自动写入，App 不需要额外上报。
- 顺序：最新打开在前；打开已存在的小程序会把它移到最前。
- 上限 20；只显示仍发布的小程序。

**我的小程序**

- 用户点击「添加到我的小程序 / 移除」：
  1. 本地乐观更新 UI；
  2. 读取当前完整收藏集合（或使用本地缓存）；
  3. `PUT /v1/me/prefs {favorites:[...]}`；
  4. 失败回滚并提示。
- 服务端返回的规范化列表为准；跨端登录后自动同步。
- 上限 50；达到上限提示先移除。

**导入旧数据**

- 首次升级时可将旧原型本地 recent/favorites 通过 `POST /v1/me/prefs/import` 导入一次。
- 成功后清除本地「待导入」标记，避免重复导入。

### 4.5 设备与推送

**注册时机**

- 登录成功后；
- 每次 App 启动（更新 `lastSeenAt`）；
- 推送 token 轮换时；
- 通知开关变化时。

**字段映射**

| App 平台 | `platform` | `pushProvider` |
| --- | --- | --- |
| Android（FCM） | `android` | `fcm` |
| Android（厂商通道） | `android` | 目前枚举仅支持 `fcm`；如需小米/OPPO/vivo 等通道，需平台先扩展 provider 枚举 |
| HarmonyOS | `ohos` | `hms` |
| iOS | `ios` | `apns` |
| Windows | `windows` | `wns` 或 `local` |
| 无推送能力 | 对应平台 | `local` |

**行为**

- 通知权限关闭：`notificationEnabled=false`，平台不再向该设备推送，但站内通知仍会记录。
- token 变化：同一 `deviceID` 重新 `POST /v1/devices` 覆盖。
- 登出 / 卸载前：`DELETE /v1/devices/{deviceID}`。
- 推送点击：按 `eventId/postID` 跳转到对应帖子；同一 `eventId` 只提示一次。

**推送兜底**

- 无推送权限、推送失败或未配置渠道：前台每 60 秒 `GET /v1/events/new-posts?since=...`。
- 页面不可见时暂停轮询；回到前台立即拉一次。
- 轮询失败指数退避，429 读取 `Retry-After`。

### 4.6 新帖提醒订阅

- 默认订阅 `new_posts`；用户可关闭。
- 静默时段 `quietHours`：按平台时区（默认 UTC+8）解释；跨零点支持（如 23:00–07:00）。
- 静默时段内不弹系统通知，但站内通知仍可轮询到。
- 平台每用户每小时系统推送有条数上限；超出的通知标记 `suppressed`，仍可在站内查看。

### 4.7 通知已读

- 进入通知页或点击通知时，调用 `POST /v1/me/notifications/read`：
  - 单条：`{ids:[...]}`；
  - 全部：`{all:true}`。
- 本地保留已读游标，服务端返回 `unread` 作为角标。

### 4.8 反馈

- 入口：小程序胶囊菜单「反馈」或 App 内反馈页。
- 提交 `content`（2~1000 字）、可选 `appKey`/`contact`。
- 每用户每小时最多 5 条；超限提示稍后再试。

### 4.9 授权与账号生命周期

| 场景 | 动作 |
| --- | --- |
| 用户在小程序内撤销授权 | `DELETE /v1/me/grants/{appKey}`；该小程序所有会话失效 |
| 切换账号 | 清空本地目录/偏好/通知游标/WebView Cookie；重新拉取 |
| 退出登录 | 删除设备 token；清空本地缓存；可选撤销活跃小程序授权 |
| 卸载 | 无法调用接口；服务端设备记录保留，推送可能失败（不影响其他端） |
| 主站停用 / 注销用户 | 主站 token 校验失败（401）；App 按登录失效处理 |

---

## 5. 关键流程

### 5.1 冷启动

```
App start
 ├─ 读取本地目录/偏好缓存 → 立即渲染
 ├─ GET /v1/apps + GET /v1/me/prefs（并行）
 ├─ POST /v1/devices（token/开关有变化时）
 ├─ PUT /v1/me/subscriptions（如本地有变更）
 └─ 前台恢复：GET /v1/events/new-posts?since=lastSeen
```

### 5.2 打开小程序

```
用户点击
  │
  ├─ loading
  ├─ POST /launch-tickets ── 401 → 刷新主站 token 后重试
  │                         └─ 403/404 → 提示不可用
  ├─ WebView.load(launchURL)
  │     │
  │     ├─ 页面 exchange ── 401 → 关闭并提示重新打开
  │     └─ 页面进入业务
  └─ 关闭：清 WebView，无 token 注入
```

### 5.3 推送新帖

```
主站发帖 → 平台事件去重/订阅匹配
        ├─ 写站内通知（轮询可见）
        └─ 推送（FCM/HMS/APNs，经平台 webhook）
App 收到推送 → 展示 → 点击 → 按 postID 打开 → 标记已读
```

---

## 6. 缓存与离线

| 数据 | 本地存储 | TTL | 策略 |
| --- | --- | --- | --- |
| 目录 | SharedPreferences / 文件 | 5 分钟 | stale-while-revalidate |
| 最近使用 / 收藏 | SharedPreferences | 5 分钟 | 服务端优先，本地仅兜底 |
| 通知游标 `lastSeenAt` | SharedPreferences | 永久 | 成功后更新 |
| `deviceID` | 安全存储 | 安装周期 | 首次生成 UUID |
| 主站 access token | 主站既有安全存储 | 主站决定 | 不写入小程序平台缓存 |
| `mp_session` | WebView Cookie（HttpOnly） | 2 小时 | 不落 App 存储 |

规则：

- 离线时展示缓存目录 + 离线提示；打开小程序需网络，直接提示。
- 收藏操作离线时进入待同步队列，联网后重放；冲突以服务端为准。
- 不缓存启动票据、`sessionToken`、AppSecret。
- 清缓存 / 退出登录必须清除目录、偏好、通知游标与 WebView 数据。

---

## 7. 异常与降级

| 场景 | 用户感知 | 客户端行为 |
| --- | --- | --- |
| 目录接口失败 | 保留缓存 + 顶部提示 | 重试按钮；不阻塞打开已缓存小程序 |
| 偏好失败 | 使用缓存 | 稍后重试；收藏操作提示失败并回滚 |
| 启动票据 401 | 登录失效提示 | 刷新主站 token 后最多重试一次 |
| 票据过期 / 已用 | 启动超时 | 重新申请；仍失败则退出 |
| 小程序不可见 | 小程序已下线 | 从面板移除并刷新 |
| 429 | 操作频繁 | 按 Retry-After 退避，禁止并发重试 |
| 5xx | 服务异常 | 展示 requestId，提供重试 |
| 无推送权限 | 不弹系统通知 | 前台轮询兜底 |

---

## 8. UI / 交互建议

**下拉面板**

- 顶部：搜索框 + 分类筛选；
- 区块：最近使用（横向 2 行或网格）/ 我的小程序 / 全部小程序；
- 卡片：44–48px 图标、名称、单行简介；长按或胶囊菜单管理；
- 空态：引导「去全部小程序看看」；
- 加载：骨架屏，避免全屏 spinner。

**小程序容器**

- 顶部胶囊：`•••` 菜单 + 关闭圆点（参考微信）；
- 菜单项：添加到我的小程序 / 移除、分享、刷新、复制链接、反馈；
- 打开/关闭动画自然，加载失败提供重试；
- 分享通过 JS 桥交给 App，App 校验来源后调用系统分享。

**通知**

- 前台通知可做 in-app banner；点击进入帖子/通知页；
- 同一 `eventId` 去重；
- 静默时段不弹系统通知。

---

## 9. 埋点建议

| 事件 | 关键字段 |
| --- | --- |
| `mp_panel_exposure` | source、cached、count |
| `mp_app_click` | appKey、position、section |
| `mp_launch_ticket_request` | appKey、status、code、requestId |
| `mp_launch_ticket_fail` | code、requestId |
| `mp_webview_open` | appKey、duration |
| `mp_prefs_sync` | success、favoritesCount |
| `mp_device_register` | platform、provider、success |
| `mp_push_received` / `mp_push_click` | eventId、postID |
| `mp_poll_new_posts` | since、count、unread |
| `mp_feedback_submit` | appKey、success |

不要采集 token、ticket、pushToken 明文。

---

## 10. 性能与稳定性

- 目录 / 偏好并行请求；首屏以缓存优先。
- 搜索防抖 300ms；同关键词取消前一次请求。
- 通知轮询前台 60 秒；失败退避（60s → 120s → 300s 上限）。
- 启动票据请求超时 5–8 秒；WebView 首屏超时 15 秒。
- 429 / 5xx 不做无上限重试；一次操作最多 2 次自动重试。

---

## 11. 安全要求

- 官方小程序由 App 容器注入短时效 access token（仅内存）；第三方小程序使用平台 `mp_session`。页面不保存主站密码或 refresh token。
- WebView 只加载 `launchURL` 或 `allowedOrigins` 内同源路径。
- JS 桥只处理白名单事件（`share`、`close`、`open-url`），并校验 `event.origin`。
- 不把 `sessionToken` 写入 App 持久化存储；只用于交给自己的服务端。
- 日志与埋点对 `ticket`、`token`、`pushToken` 打码或剔除。
- 退出 / 切换账号时清理 WebView Cookie 与本地缓存。

---

## 12. 验收清单

### 12.1 功能

- [ ] 登录后 3 秒内展示面板（有缓存时立即展示）。
- [ ] 目录、分类、搜索与平台一致；分页可继续加载。
- [ ] 打开 3 个不同小程序，均能正常换会话并展示页面。
- [ ] 打开后「最近使用」顺序正确，重启 App / 换设备后一致。
- [ ] 添加/移除「我的小程序」，另一台设备登录同账号后同步。
- [ ] 达到 20 条最近 / 50 条收藏时按平台规则截断。
- [ ] 设备注册成功；关闭通知后平台不再推送。
- [ ] 推送失败时前台轮询能在 60 秒内看到新帖。
- [ ] 静默时段内无系统通知，但站内可查看。
- [ ] 通知标记已读后角标清零。
- [ ] 反馈提交成功，超频提示正确。

### 12.2 异常

- [ ] 飞行模式：面板展示缓存 + 离线提示；打开小程序给出网络提示。
- [ ] access token 过期：自动刷新后重试成功。
- [ ] 小程序下线：打开时提示不可用并刷新面板。
- [ ] 重复使用旧 ticket：提示重新打开，不白屏。
- [ ] 429：按 Retry-After 退避，无请求风暴。
- [ ] 5xx：展示可重试错误并记录 requestId。

### 12.3 安全

- [ ] 小程序页面没有保存用户密码；官方页面复用 App 注入 token，第三方页面使用平台会话。
- [ ] WebView 无法加载未登记外链。
- [ ] 分享消息来源校验通过；伪造来源被拒绝。
- [ ] 日志无 ticket / token / pushToken 明文。
- [ ] AppSecret 不在 App 包内。

### 12.4 多端

- [ ] Android + HarmonyOS 同账号：最近使用 / 收藏一致。
- [ ] 同一小程序两台设备同时打开互不影响。
- [ ] 撤销授权后该小程序所有端会话失效。

---

## 13. 旧原型迁移清单

| 当前实现 | 迁移到 |
| --- | --- |
| `/api/auth/workbench/apps` 取目录 | `GET /v1/apps` |
| 页面自行保存用户密码 | 删除；官方页面改用 App 注入 + 内置登录卡片，第三方使用平台会话 |
| 本地 SharedPreferences 作为唯一偏好源 | `GET/PUT /v1/me/prefs`，本地只缓存 |
| 每 60s 轮询主站 `/auth/browse` | 推送为主，`GET /v1/events/new-posts` 兜底 |
| 本地通知 | `POST /v1/devices` 上报 token |
| WebView 加载主站路由 | 加载平台返回的 `launchURL` |
| 小程序列表硬编码 | 平台目录 + 分类 + 搜索 |

迁移期间可保留旧实现作为 fallback；新服务上线后必须关闭 token 注入路径。

---

## 14. 非目标 / 后续

- 小程序内支付、登录态共享、主站业务数据直连：不在本期范围。
- 推送渠道 SDK 集成（FCM/HMS/APNs）由 App 侧完成；平台负责存储 token 与分发事件。
- 灰度发布、按用户比例放量：平台已预留版本机制，App 侧暂不需要感知。
- 桌面端快捷键、窗口管理：按各平台容器能力实现。

---

## 15. FAQ

**Q：App 需要单独注册小程序平台账号吗？**  
不需要。普通用户沿用主站账号；只有开发者发布小程序才需要开放平台账号。

**Q：小程序页面需要自己实现登录吗？**  
分两种情况：官方小程序不需要。App 已登录时由容器注入短时效 access token，页面无感进入；没有 App 注入时，登录卡片显示在小程序自己的窗口里，调用主站登录接口。第三方小程序使用平台 `mp_session`，也不需要自己维护账号体系，但必须走平台会话，不能读取主站 token。

**Q：WebView 刷新后会话还在吗？**  
在，`mp_session` Cookie 有 2 小时滑动有效期；超过或用户撤销授权后需要重新从 App 打开。

**Q：最近使用为什么要等页面换会话成功才记录？**  
避免用户点了但因票据/网络失败没真正打开，污染最近使用。

**Q：推送和轮询会重复吗？**  
会，但同一 `eventId` 只应提示一次；App 按 `eventId` 去重。

**Q：静默时段用的是手机时区吗？**  
不是，平台默认按 UTC+8（可在部署配置中调整）。如产品需要按设备时区，需要在平台侧扩展用户时区字段。