# 外部小程序部署指南（自有 HTTPS 源）

> 不确定该选哪种接入方式？先读 [integration-modes.md](./integration-modes.md)。

> 适用：第三方开发者 / 任何非官方团队  
> 源类型：**外部托管**（`https://mp-app.example.com/<appKey>` 或任意 HTTPS 源）  
> 平台负责：应用注册、审核、启动票据、会话、目录  
> 页面部署：你自己负责（nginx / 对象存储 / Vercel / Cloudflare Pages / 自有服务器）

---

## 1. 和内部托管的区别

| | 外部（本文） | 内部（[deploy-internal.md](./deploy-internal.md)） |
| --- | --- | --- |
| 谁能用 | 任意开发者 | 官方应用 / 管理员 |
| 页面位置 | 你自己的 HTTPS 源 | 平台 `/mp/<appKey>/` |
| 上传 | 自己部署 | CLI 上传到平台 |
| 平台 source token | 不需要 | 必须 |
| 同源风险 | 与主站/平台隔离 | 与平台同源，仅限可信代码 |
| 大小限制 | 由你的托管决定 | 5MB/文件、25MB/构建 |

---

## 2. 注册开发者 & 创建应用

### 2.1 注册

网页：https://applet.ssemarket.cn/#/register（或 UniSSO 登录自动创建账号）

CLI：

```bash
cd /home/cloud/deploy/mp-service
npm link
mp register --email you@example.com --password '至少8位' --name "你的称呼"
```

### 2.2 创建应用

```bash
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

也可以在开放平台控制台创建：https://applet.ssemarket.cn/#/apps/new

---

## 3. 创建页面工程

```bash
mp init ./my-app \
  --app-key my-app \
  --title "我的小程序" \
  --base https://applet.ssemarket.cn
```

生成静态页面，使用平台 SDK：

```html
<script src="https://applet.ssemarket.cn/sdk/mp-client.js"></script>
<script>
  // SDK 从自己的 src 自动识别平台地址；外部页面无需配置 base
  MP.ready.then((session) => {
    // session.appKey / session.userId
    // 之后可调用 MP.request / MP.prefs / MP.share
  }).catch((err) => {
    console.warn('mp session unavailable:', err.code || err.message);
  });
</script>
```

`MP.ready` 会自动用 URL 的 `ticket` 换 `mp_session`；页面不接触主站 access/refresh token。
如果脚本被代理到自定义路径，可在 `MP.ready` 之前调用
`MP.configure({ base: 'https://applet.ssemarket.cn' })` 显式指定平台地址。

> **只填 entryURL、不改页面会怎样？** App 仍能打开页面，页面可以继续用自己的登录；
> 但不会建立 `mp_session`，偏好、最近使用、通知等平台能力不可用。
> 需要平台能力时，必须按上面的方式接入 SDK（或手动调 `/v1/sessions/exchange`）。
>
> **审核通过前跨源接口会被 CORS 拦。** 平台只放行已发布小程序的 origin；
> 联调阶段可先发布一个测试应用，或用运维配置 `MP_CORS_ORIGINS` 临时放行。
>
> **SPA 注意**：登录守卫/路由重定向可能会在 SDK 消费 `ticket` 前把它丢掉。
> 请在应用启动最早期执行 `MP.ready`，或确保首屏不会整页跳转到 `/login`。
>
> **可以继续用自己的登录**：平台没有给第三方小程序的登录页，`mp_session` 是静默交换的。
> 保留自己的账号体系即可；需要平台能力时，把静默拿到的平台 `userId` 绑定到自己的账号
> （服务端用 `/app/v1/sessions/verify` 验签）。完全不接 SDK 也能打开页面，但偏好、设备、
> 订阅、通知等平台能力不可用。详见
> [integration-modes.md](./integration-modes.md) 的「有自己的登录体系」一节。

### 部署到自己的源

任选一种：

- **nginx**：把 `dist/` 放到 `/var/www/my-app`，配置 HTTPS 与 SPA fallback；
- **对象存储**：OSS/COS/S3 + CDN，开启 HTTPS，入口指向 `index.html`；
- **Vercel / Cloudflare Pages**：直接部署静态站点。

`index.html` 中的资源使用相对路径（`./assets/...`），避免部署到子路径后 404。

#### nginx 示例

```nginx
server {
  listen 443 ssl http2;
  server_name mp-app.example.com;

  ssl_certificate     /etc/letsencrypt/live/mp-app.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/mp-app.example.com/privkey.pem;

  root /var/www/my-app;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  # 推荐：限制脚本与连接目标
  add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://applet.ssemarket.cn; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://applet.ssemarket.cn; frame-ancestors 'self';" always;
}
```

> 页面必须 HTTPS；`http://localhost` 仅用于本地调试。
> 页面 origin 必须与 `allowedOrigins` 完全一致（scheme + host + port）。
> 只要 `entryURL` 指向该页面，平台会自动把它的 origin 补到 `allowedOrigins` 第一位，
> 避免 App 报 `launchURL 不在允许的 origin 内 / ORIGIN_MISMATCH`。

---

## 4. 绑定外部入口

### 4.1 校验 + 绑定

```bash
mp deploy external my-app --url https://mp-app.example.com/my-app
```

CLI 会：

1. 请求该 URL，确认 HTTPS 且返回 2xx/3xx；
2. 校验 origin；
3. `PATCH` 应用的 `entryURL` 与 `allowedOrigins`（默认追加 origin）；
4. 提示下一步提交审核。

只检查不修改：

```bash
mp apps check my-app --url https://mp-app.example.com/my-app
mp deploy external my-app --url ... --dry-run
```

### 4.2 提交审核

```bash
mp apps submit my-app \
  --version 1.0.1 \
  --changelog "首版外部页面"
```

管理员审核通过后：

```bash
mp login --email admin@mp.local --password '…' --admin
mp admin approve my-app
mp apps publish my-app
```

或管理员在 https://applet.ssemarket.cn/admin 操作。

---

## 5. 认证与会话

App 打开小程序时：

```
POST /v1/launch-tickets
 → launchURL = https://mp-app.example.com/my-app?ticket=lt_...
WebView 加载 launchURL
 → 页面 POST https://applet.ssemarket.cn/v1/sessions/exchange {ticket}
 → Set-Cookie: mp_session（HttpOnly）
 → 之后页面只带 Cookie 调 /v1
```

要求：

- 页面与主站不同源；
- 小程序登录使用平台内置授权页；
- 页面跨域请求 SDK/API 时使用 `credentials: 'include'`；
- 你的 origin 已登记在 `allowedOrigins`；
- App 容器只加载 `entryURL` 同源路径。

---

## 6. 更新版本

外部源的更新由你自己发布：

```bash
# 构建并上传到你自己的服务器
rsync -av --delete dist/ user@host:/var/www/my-app/

# 如果入口 URL 不变，无需改平台配置
# 如需改入口/origin：
mp deploy external my-app --url https://mp-app.example.com/my-app
mp apps submit my-app --version 1.0.2 --changelog "更新内容"
```

平台只关心 `entryURL` 是否可达、origin 是否登记；页面内容由你控制。

---

## 7. 安全清单

- HTTPS，证书有效；
- 页面与主站不同源；
- CSP 限制 `script-src` / `connect-src` / `frame-ancestors`；
- 不注入主站 access/refresh token；
- 不把 AppSecret 放进页面；
- 只申请实际需要的 scopes；
- 分享/桥消息只处理白名单事件，并校验来源；
- 静态资源版本化，避免缓存旧页面。

---

## 8. 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| `ORIGIN_NOT_ALLOWED` | 启动票据 origin 不在 `allowedOrigins`；用 `mp apps update --origins` 或 `deploy external` |
| `invalid_redirect_uri`（SSO 无关） | 这里不涉及 SSO 回调；检查入口 URL 是否 HTTPS、可达 |
| 页面 404 | SPA fallback 未配置；nginx `try_files ... /index.html` |
| CORS 错误 | 页面 origin 未登记或不在允许列表；检查 `allowedOrigins` |
| 白屏 | 资源用了绝对根路径；改为相对路径；检查 CSP |
| `APP_UNAVAILABLE` | 应用未发布/已下架；确认管理员已发布 |
| 刷新后会话失效 | `mp_session` 2 小时滑动；过期后从 App 重开 |
| 部署 CLI 报入口不可用 | 页面还未上线/证书错误/返回 5xx；先修好 HTTPS |

---

## 9. CLI 速查

```bash
mp register --email ... --password ... --name ...
mp login --email ... --password ...
mp init <目录> --app-key <key>
mp apps create --name ... --key ... --entry https://... --origins https://...
mp deploy external <appKey> --url https://... [--submit --changelog "说明"]
mp apps check <appKey> --url https://...
mp apps submit <appKey> --changelog "说明"
mp apps publish <appKey>
```

管理员：

```bash
mp login --admin --email admin@mp.local --password '…'
mp admin queue
mp admin approve <appKey>
mp admin reject <appKey> --reason "原因"
```