# 上线前安全检查

## App / 容器

- [ ] WebView **不再注入**主站 access/refresh token。
- [ ] `launchURL` 只来自平台响应，不拼接用户输入。
- [ ] 加载前校验协议为 HTTPS、host 属于 `entryURL` / `allowedOrigins`。
- [ ] 禁止任意 URL 输入框；分享链接也走小程序路由白名单。
- [ ] 校验 `postMessage` 的 `event.origin`，仅处理白名单事件。
- [ ] 不把 `appSecret`、内部签名密钥打进 App 包。
- [ ] 退出登录 / 切换账号时：注销会话、撤销授权、清理本地缓存。
- [ ] 卸载 / 关闭通知时调用 `DELETE /v1/devices/{deviceID}`。

## 小程序页面

- [ ] 页面与主站不同源（至少不同子域）。
- [ ] 页面不直接调用主站 `/api/auth/*`。
- [ ] 只申请功能实际需要的 scopes。
- [ ] 不把 `ticket` 写入日志、埋点或分享链接。
- [ ] 页面 CSP 限制 `script-src` / `frame-ancestors`。
- [ ] 用户在页面内提交的敏感信息不落到 `localStorage` 长存。

## 第三方服务端

- [ ] `appSecret` 仅存于服务端密钥管理，不提交到仓库。
- [ ] 签名串固定为 `appKey\ntimestamp\nnonce\nrawBody`，使用**原始请求体**。
- [ ] 时间戳校验 ±5 分钟；nonce 在窗口内去重。
- [ ] 校验失败返回 401，不泄露内部错误细节。
- [ ] 重置 AppSecret 后同步更新，并观察旧密钥调用失败告警。

## 主站内部接入

- [ ] 事件推送走 outbox，不在请求链路同步调用平台。
- [ ] 失败重试 + 死信；`eventID` / `dedupKey` 全局唯一。
- [ ] 内部签名密钥只部署在服务端，轮换时先双密钥并行。
- [ ] 事件只包含渲染通知所需的最小字段，不放用户隐私数据。

## 平台侧（运维）

- [ ] MySQL / Redis / MinIO 使用独立账号与独立库/桶前缀。
- [ ] `MP_ADMIN_PASSWORD`、`MP_INTERNAL_SECRET` 已从默认值修改。
- [ ] 数据库每日备份；MinIO 桶版本化。
- [ ] `/metrics` 仅内网可达或设置 `MP_METRICS_TOKEN`。
- [ ] 管理员账号不用于日常开发登录。
- [ ] 审计日志保留至少 30 天，定期抽查密钥查看/重置记录。