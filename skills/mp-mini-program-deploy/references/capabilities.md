# 平台能力与接口参考

> 完整契约：`https://applet.ssemarket.cn/openapi.yaml`（OpenAPI 3.1，可直接导入 Postman/Apifox）。
> 本文只列部署/接入时最常用的部分。

---

## 1. 能力矩阵

| 能力 | 提供方 | 说明 | 外部托管可用 | 内部托管可用 |
| --- | --- | --- | --- | --- |
| 小程序目录 / 分类 / 搜索 | 平台 | `/v1/apps`、`/v1/categories`、`/v1/search` | ✅ | ✅ |
| 启动票据 | 平台 | 60s、一次性、绑定用户+应用+设备+origin | ✅ | ✅ |
| app-scoped 会话 | 平台 | `mp_session`，2h 滑动续期，受 scopes 限制 | ✅ | ✅ |
| 最近使用 / 我的小程序 | 平台 | 20 / 50，服务端为跨端真相源 | ✅ | ✅ |
| 授权记录 | 平台 | 用户可查看/撤销 | ✅ | ✅ |
| 设备与推送 token | 平台 | 加密存储、掩码返回 | ✅ | ✅ |
| 订阅 / 静默时段 | 平台 | `new_posts` | ✅ | ✅ |
| 新帖提醒 | 平台 | 站内通知 + 轮询兜底；可配 webhook 网关 | ✅ | ✅ |
| 用户反馈 | 平台 | 后台可处理 | ✅ | ✅ |
| 页面 SDK | 平台 | 自动换会话、偏好、分享桥 | ✅ | ✅ |
| 第三方服务端验签 | 平台 | `/app/v1/sessions/verify` | ✅ | ✅ |
| 语音合成代理 | 平台 | `/v1/tts/*`，Key 只在服务端 | ✅ | ✅ |
| 审核 / 发布 / 下架 | 平台 | 版本快照、审计 | ✅ | ✅ |
| 调用统计 | 平台 | 14/90 天 | ✅ | ✅ |
| 页面托管 + source token | 平台 | 仅内部托管 | ❌ | ✅ |
| 自有域名 / SSR | 开发者 | — | ✅ | ❌ |
| 业务数据（帖子/商城/课程） | 开发者/主站 | 平台不承载 | — | — |
| 真实推送渠道（FCM/HMS/APNs） | 开发者 | 平台默认站内通知；webhook 可接聚合网关 | — | — |
| 邮件服务 | 开发者/主站 | 平台未接邮箱验证/找回密码 | — | — |

---

## 2. 客户端接口（App / 小程序页面）

认证：`Authorization: Bearer <main_token>`，或小程序会话 `mp_session`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/apps` | 目录（category/cursor/limit） |
| GET | `/v1/apps/{appKey}` | 详情 |
| GET | `/v1/categories` | 分类 |
| GET | `/v1/search?q=` | 搜索名称/拼音/关键词 |
| POST | `/v1/launch-tickets` | 申请票据（Bearer 必填） |
| POST | `/v1/sessions/exchange` | 票据换会话（Set-Cookie） |
| GET/DELETE | `/v1/sessions/me` | 当前会话 / 注销 |
| GET/PUT | `/v1/me/prefs` | 最近使用、我的小程序 |
| POST | `/v1/me/prefs/import` | 导入旧本地数据（5 次/小时） |
| GET | `/v1/me/grants` | 已授权小程序 |
| DELETE | `/v1/me/grants/{appKey}` | 撤销授权 |
| POST/GET | `/v1/devices` | 注册 / 列出设备 |
| DELETE | `/v1/devices/{deviceID}` | 注销设备 |
| GET/PUT | `/v1/me/subscriptions` | 订阅与静默时段 |
| GET | `/v1/events/new-posts` | 新帖提醒轮询（默认最近 24h） |
| POST | `/v1/me/notifications/read` | 标记已读（ids / all） |
| POST | `/v1/feedback` | 反馈（5 次/小时） |
| * | `/v1/tts/*` | 语音合成代理（音色、任务、翻唱） |

---

## 3. 开发者接口（`/dev/v1`）

认证：Cookie `mp_dev`，或 `Authorization: Bearer <dev_token>`（登录/注册响应返回）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/register` | 注册 |
| POST | `/auth/login` | 登录 |
| POST | `/auth/logout` | 退出 |
| GET/PATCH | `/auth/me` | 当前开发者 / 改资料 |
| POST | `/auth/password` | 改密码（其他设备失效） |
| GET | `/overview` | 工作台概览 |
| GET/POST | `/apps` | 我的小程序 / 创建 |
| GET/PATCH/DELETE | `/apps/{appKey}` | 详情 / 更新 / 删除 |
| POST | `/apps/{appKey}/secret/reveal` | 查看 AppSecret（审计） |
| POST | `/apps/{appKey}/secret/rotate` | 重置 AppSecret |
| GET/POST | `/apps/{appKey}/versions` | 版本列表 / 创建草稿 |
| POST | `/apps/{appKey}/submit` | 提交审核 |
| POST | `/apps/{appKey}/publish` | 发布已通过版本 |
| POST | `/apps/{appKey}/unpublish` | 下架 |
| GET | `/apps/{appKey}/stats?days=` | 调用统计 |
| GET | `/apps/{appKey}/audit-logs` | 审计记录 |
| POST | `/uploads` | 图标上传（≤2MB） |
| GET/DELETE | `/apps/{appKey}/hosting` | 托管状态 / 停用 |
| POST | `/apps/{appKey}/hosting/builds` | 创建构建（仅官方） |
| PUT | `.../builds/{buildId}/files?path=` | 上传文件 |
| POST | `.../builds/{buildId}/activate` | 激活构建 |
| GET | `/categories` | 分类与可选 scopes |

---

## 4. 管理接口（`/admin/v1`，需 admin）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/me` | 当前管理员 |
| GET | `/overview` | 平台概览 + 待审队列 |
| GET/POST | `/apps` | 全部小程序 / 新建官方应用 |
| GET/PATCH | `/apps/{appKey}` | 详情 / 更新 |
| POST | `/apps/{appKey}/approve` | 审核通过 |
| POST | `/apps/{appKey}/reject` | 驳回（reason 2~500 字） |
| POST | `/apps/{appKey}/publish` | 发布 |
| POST | `/apps/{appKey}/unpublish` | 强制下架 |
| PUT | `/apps/{appKey}/allowlist` | 设置白名单 |
| GET | `/developers` | 开发者列表 |
| PATCH | `/developers/{id}` | 停用/启用 |
| GET | `/audit-logs` | 审计 |
| GET | `/events` | 内部事件 |
| GET | `/feedback`、PATCH `/feedback/{id}` | 反馈处理 |

---

## 5. 第三方服务端接口（`/app/v1`，HMAC）

请求头：`X-App-Key`、`X-App-Timestamp`、`X-App-Nonce`、`X-App-Signature`。

```
signature = HMAC-SHA256(appSecret, [appKey, timestamp, nonce, rawBody].join("\n"))
```

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/sessions/verify` | 校验小程序会话 |
| GET | `/apps/self` | 当前小程序公开信息（空 body） |
| GET | `/apps/me` | 当前小程序完整配置（空 body） |

---

## 6. 内部与运维

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/internal/v1/events/new-post` | 主站新帖事件（`X-Internal-*` HMAC） |
| POST | `/internal/v1/token/verify` | 主站 token 校验（HMAC） |
| GET | `/healthz` | 进程存活 |
| GET | `/readyz` | MySQL 就绪 |
| GET | `/metrics` | Prometheus（可配 `MP_METRICS_TOKEN`） |
| GET | `/openapi.yaml` | 本契约 |
| GET | `/sdk/mp-client.js` | 页面 SDK |

---

## 7. 数据与限制

| 项 | 值 |
| --- | --- |
| 票据 TTL | 60 秒，一次性 |
| 会话 TTL | 7200 秒，滑动续期 |
| 会话 Cookie | `mp_session`，HttpOnly，SameSite=Lax |
| 最近使用 / 我的小程序 | 20 / 50 |
| 图标上传 | ≤2MB，PNG/JPEG/WebP/GIF |
| 内部托管 | 5MB/文件、25MB/构建、300 文件 |
| 开发者应用数 | 平台配置 `MP_MAX_DEV_APPS`（默认 20） |
| AppSecret | 加密存储；可重置，旧密钥立即失效 |
| 审计保留 | 默认 30 天（`MP_RETENTION_DAYS`） |
| 限流 | 按 IP/用户/动作，Redis 优先；429 + `Retry-After` |

---

## 8. scopes 与可见性

**scopes**：`profile:read`、`prefs:read`、`prefs:write`、`notifications:read`、
`notifications:write`、`posts:read`。

**visibility**：

- `public`：未登录也可浏览；
- `logged_in`：需要登录（默认）；
- `allowlist`：仅管理员配置的用户 ID 可见。

会话的 scopes 来自应用当前发布版本的快照；页面调用超出范围的接口返回
`403 SCOPE_REQUIRED`。

---

## 9. 平台明确的边界

- 不保存用户密码、refresh token；
- 不承载帖子/商城/课程等业务数据；
- 外部托管不提供页面托管、证书、CDN；
- 推送默认只写站内通知 + 轮询兜底，未内置 FCM/HMS/APNs SDK；
- 未接邮件服务（邮箱验证、找回密码）；
- `posts:read` 目前是授权声明，实际帖子数据仍由主站提供。