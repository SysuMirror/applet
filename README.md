# 集市小程序开放平台（mp-service）

按 `~/mini-program-backend.md` 落地的独立小程序平台服务，包含：

1. **小程序平台 API**：目录、分类、搜索、启动票据、app-scoped 会话、偏好同步、设备与订阅、新帖事件、反馈。
2. **开发者开放平台**（`/`）：开发者注册/登录、创建小程序、AppKey/AppSecret、开发配置、版本提交、审核进度、发布/下架、调用数据。
3. **平台管理后台**（`/admin`）：审核队列、小程序与白名单、开发者停用、事件、审计日志、反馈。
4. **小程序页面 SDK**（`/sdk/mp-client.js`）与**容器演示**（`/demo/app`、`/launch`）。
5. **App 侧接入 Skill**（`skills/app-integration/`，同时打包为 `/downloads/mp-skill.zip`）。
6. **创建与部署 Skill**（`skills/mp-mini-program-deploy/`，打包为 `/downloads/mp-deploy-skill.zip`）：
   内部托管 / 外部托管两条路线、CLI/API/SDK 步骤、能力清单、上线检查与排错。

---

## 接入方式：外部页面还是平台托管？

小程序本质上是 **集市 App 用 WebView 打开的一段网页**，不是独立 App，也不是把页面嵌进开发者自己的网站。
页面放哪儿由开发者选择，平台两种都支持：

| | 外部托管（第三方默认） | 内部托管（仅官方应用） |
| --- | --- | --- |
| 页面位置 | 你自己的 HTTPS 站点（现有网站即可） | 平台 `/mp/<appKey>/` |
| 部署 | 你自己部署，平台只登记 entryURL / origin | `mp deploy internal` 上传静态构建 |
| 访问控制 | 你的网站自己控制 | URL 带 `source` token |
| 限制 | 由你的托管决定 | 5MB/文件、25MB/构建、300 文件 |

**已有网站可以直接用**：登记为外部小程序，在入口页加一行 SDK 并处理启动票据即可；
平台不要求迁移站点，也不要求特定框架。完整原理、决策表和接入步骤见
[docs/app-integration/integration-modes.md](docs/app-integration/integration-modes.md)。

---

## 架构

```
App ──Bearer 主站 token──▶ mp-service ──▶ MySQL 8（独立库 ssemarket_mp）
 │                            │  └──────▶ Redis（独立 ACL 用户，前缀 mp:）
 ├─ WebView(launchURL) ──────▶│  └──────▶ MinIO（图标：applet/ssemarket-mp/icons/）
 │     └─ ticket → mp_session │
 │                            ├── 内部签名 API ◀── 主站 outbox（新帖事件）
 │                            └── 第三方服务端签名 API（会话校验）
```

- **控制面独立**：不直接连旧业务库；业务数据仍由旧服务提供（模式 A）。
- **用户身份**：默认用 `MP_MAIN_JWT_SECRET` 校验 HS256；配置 `MP_MAIN_JWKS_URL` 或 `MP_MAIN_INTERNAL_VERIFY_URL` 即可切换为主站 JWKS / 内部校验。
- **启动票据**：Redis `GETDEL` 原子消费；Redis 不可用时自动退化为 MySQL 原子 `UPDATE`。
- **会话**：`mp_session` HttpOnly Cookie，2 小时滑动续期，scope 绑定到小程序。
- **事件**：HMAC 内部签名 + ±5 分钟时间窗 + nonce 防重放；事件去重后按订阅 fanout。
- **推送**：默认只写站内通知（App 轮询兜底）；配置 `MP_PUSH_WEBHOOK` 后转发给聚合推送网关。

## 当前部署

| 项 | 值 |
| --- | --- |
| 进程 | `node server.js`（supervisor 前台托管，`deploy.sh` 为入口） |
| 监听 | `0.0.0.0:8080` |
| 公网地址 | `https://applet.ssemarket.cn`（平台 frps 中继，nginx 终结 TLS） |
| 数据库 | `mysql.platform-infra.svc.cluster.local:3306/ssemarket_mp`（账号 `mp_service`，仅授权该库） |
| Redis | `redis.platform-infra.svc.cluster.local:6379`（ACL 用户 `mp_service`，仅 `mp:*`） |
| 对象存储 | `minio.platform-infra.svc.cluster.local:9000`，桶 `applet`，前缀 `ssemarket-mp/` |
| 持久化 | `/home/cloud/deploy/mp-service/data`（`secrets.json`、上传副本）、MySQL、MinIO |
| 日志 | stdout（supervisor 收集）＋ `~/logs/mp-service.log` |

> MinIO 这组平台密钥只授权 `applet` 桶，因此使用 `applet/ssemarket-mp/` 前缀而不是独立桶。
> 若管理员下发独立桶，改 `MP_MINIO_BUCKET` 即可，代码无需改动。

### 账号

| 角色 | 账号 | 说明 |
| --- | --- | --- |
| 平台管理员 | `admin@mp.local` | 密码见 `.env` 的 `MP_ADMIN_PASSWORD`（**上线前请修改**） |
| 演示开发者 | `demo@mp.local` / `demo123456` | 内置「学习笔记」小程序处于审核中，便于体验后台 |

管理员登录入口：`/admin`。开发者登录入口：`/`。

> 修改管理员密码：登录开放平台 `/#/account` 修改，或执行
> `node --no-warnings scripts/set-admin-password.js --email admin@mp.local --password '新密码'`。
> 注意：`.env` 里的 `MP_ADMIN_PASSWORD` 只在**首次初始化**时生效，之后修改需用上述方式。

> 当前实例已配置 `MP_PUBLIC_BASE=https://applet.ssemarket.cn`，公网可直接访问；本地调试仍可用
> `http://localhost:8080`。由平台 supervisor 拉起时也会注入 `PUBLIC_URL`，演示应用入口会在启动时自动校正。

---

## 本地 / Pod 内运行

```bash
cd /home/cloud/deploy/mp-service
node --no-warnings server.js          # 前台启动（读取 .env）
# 或
./deploy.sh
```

部署到 supervisor 时，把 `supervisor.mp-service.conf` 里的 program 片段合并到平台维护的
`~/deploy/supervisord.conf`（**不要直接覆盖平台文件**），再 reload supervisor。

### 环境变量

基础配置都集中在 `.env`（0600）。常用项：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` / `MP_HOST` | `8080` / `0.0.0.0` | 监听端口与地址 |
| `MP_PUBLIC_BASE` | `PUBLIC_URL` 或 `http://localhost:8080` | 对外 base URL，用于 launchURL / 上传回显 |
| `MP_DB_HOST/PORT/USER/PASSWORD/NAME` | — | MySQL 独立库 |
| `MP_REDIS_URL` / `MP_REDIS_PREFIX` | — / `mp:` | Redis ACL 连接串与键前缀 |
| `MP_MINIO_*` | — | 端点、密钥、桶、前缀 |
| `MP_MAIN_JWT_SECRET` | 自动生成 | 本地验签主站 HS256 token |
| `MP_MAIN_JWKS_URL` | 空 | 主站 JWKS（优先于 HS256） |
| `MP_MAIN_INTERNAL_VERIFY_URL` | 空 | 主站内部 token 校验接口 |
| `MP_INTERNAL_SECRET` | 自动生成 | 主站 outbox → 平台的事件签名密钥 |
| `MP_ADMIN_EMAIL/PASSWORD` | `admin@mp.local` / — | 管理员种子账号 |
| `MP_DEMO_MODE` | `1` | 是否创建演示开发者与待审应用 |
| `MP_PUSH_WEBHOOK` | 空 | 聚合推送网关注入地址 |
| `MP_METRICS_TOKEN` | 空 | 设置后 `/metrics` 需要 Bearer |
| `MP_MAIN_VERIFY_URL` | 空 | 主站 token 校验接口（当前 `https://ssemarket.cn/api/auth/info`） |
| `MP_SSO_CLIENT_ID` / `MP_SSO_CLIENT_SECRET` | — | UniSSO 外部应用凭据（secret 只在 `.env`） |
| `MP_SSO_REDIRECT_URI` | `${MP_PUBLIC_BASE}/callback` | 必须与 UniSSO 登记值逐字符一致 |
| `MP_SSO_M2M_CLIENT_ID` / `SECRET` | 空 | 内接应用 M2M；不配置则只能走跳转/共享会话登录 |
| `MP_SESSION_TTL` | `7200` | 小程序会话有效期（秒） |
| `MP_TICKET_TTL` | `60` | 启动票据有效期（秒） |
| `MP_LAUNCH_MODE` | `direct` | `direct`：entryURL?ticket=…；`gateway`：`/launch?ticket=…` |

> **`.env` 与 `data/secrets.json` 都要备份。** `secrets.json` 丢失会导致已加密的 AppSecret
> 无法解密、已签发 token/会话失效。`.env` 含基础设施凭证，权限必须保持 `0600`，不要提交到仓库。

已通过平台提供的凭证创建了隔离账号：

- MySQL：库 `ssemarket_mp` + 用户 `mp_service`（仅该库权限）；
- Redis：ACL 用户 `mp_service`，仅允许 `mp:*` 键；
- MinIO：使用平台密钥可见的 `applet` 桶 + `ssemarket-mp/` 前缀。

---

## 主要页面

| 路径 | 说明 |
| --- | --- |
| `/` | 开放平台落地页 / 登录注册 |
| `/#/dashboard` | 开发者工作台 |
| `/#/apps` | 我的小程序 |
| `/#/apps/{key}/config` | AppKey / AppSecret、入口、origin、权限 |
| `/#/apps/{key}/versions` | 版本与提交审核 |
| `/#/docs` | 接入文档（含 SDK、错误码、下载） |
| `/admin` | 平台管理后台（审核、开发者、事件、审计、反馈） |
| `/demo/app?app=novel` | 小程序容器演示（票据换会话、胶囊菜单） |
| `/launch?ticket=…` | 网关模式启动页 |
| `/openapi.yaml` | OpenAPI 3.1 契约 |
| `/downloads/mp-skill.zip` | App 接入 Skill 打包 |
| `/downloads/mp-deploy-skill.zip` | 小程序创建与部署 Skill 打包 |
| `/metrics` | Prometheus 指标（可配 token） |

## API 一览

- 客户端：`/v1/apps`、`/v1/search`、`/v1/launch-tickets`、`/v1/sessions/exchange`、
  `/v1/me/prefs`、`/v1/devices`、`/v1/me/subscriptions`、`/v1/events/new-posts`、`/v1/feedback`
- 开发者：`/dev/v1/auth/*`、`/dev/v1/apps/*`、上传、统计、审计
- 管理：`/admin/v1/*`
- 内部：`/internal/v1/events/new-post`、`/internal/v1/token/verify`
- 第三方服务端：`/app/v1/sessions/verify`

完整字段见 `skills/app-integration/references/api-reference.md` 或 `/openapi.yaml`。

---

## 小程序部署（CLI）

平台内置了两种源码来源：

- **内部托管**（官方应用/管理员）：CLI 上传静态构建到平台，入口为 `/mp/<appKey>/?source=<source token>`；上传需登录 token，访问需 source token。
- **外部托管**（第三方）：页面部署在自己的 HTTPS 源，平台只登记 entryURL / allowedOrigins。

```bash
cd /home/cloud/deploy/mp-service && npm link
mp login --email ... --password ...
mp init my-app --app-key my-app
mp deploy internal my-app --dir ./my-app     # 内部
mp deploy external my-app --url https://mp-app.example.com/my-app  # 外部
mp apps submit my-app --changelog "首版"
```

文档：[内部托管](docs/app-integration/deploy-internal.md) · [外部托管](docs/app-integration/deploy-external.md) · [管理员指南](docs/app-integration/admin-guide.md)

> 内部管理员账号：`3238499590@qq.com`（`oauthid561` 对应 SSO `sse_sub=561`，已加入管理员 ID 列表），在 `/admin` 点「使用 UniSSO 登录」。

## 统一身份登录（UniSSO）

- 视觉与登录：`https://applet.ssemarket.cn/#/login` →「使用 UniSSO 统一身份登录」
- 外部应用（OAuth2 授权码 + PKCE S256）：`app_282881e7684a52bf`，回调 `https://applet.ssemarket.cn/callback`
- 共享会话无感：浏览器已有 `.ssemarket.cn` 的 `unisso_sid` / `sse_sso` 时，`/auth/sso/start` 直接建立本地会话，不跳转 SSO
- App 可用 SSO access_token 直接调 `/v1`，或 `POST /auth/sso/verify` 换平台 token
- 邮箱 + 密码表单会自动回退到统一身份 **M2M** 校验（`POST /api/oauth/password/verify`）：
  统一身份账号可直接输入学校密码登录，不需要跳转；M2M 不可用时页面会提示改用跳转授权
- 完整说明：[docs/app-integration/unissso-integration.md](docs/app-integration/unissso-integration.md)

## 主站 Token 校验

平台默认通过主站 `https://ssemarket.cn/api/auth/info` 校验 App 的主站 access token（兼容主站 `code=200` / `user.userID`），
不再需要共享 `JWT_KEY`；同时支持 SSO JWKS、内部校验接口与 UniSSO userinfo 兜底。

## 前端设计

- 视觉参考 `https://sso.ssemarket.cn/` 与 `https://join.ssemarket.cn/`：网格纸背景、黑白灰基调、蓝色强调、黑胶囊主按钮、细边框与留白。
- Logo 使用指定的 `https://image.ssemarket.cn/.../cef96c21-...png`，已下载并自托管为 `public/assets/logo.png`（避免外链与 CSP 依赖）。
- Inter 字体自托管于 `public/assets/fonts/inter-var.woff2`，不依赖运行时外网。
- 页面截图见 `screenshots/`（桌面、移动端、登录、控制台、管理后台、演示容器）。

## App 接入

面向客户端团队的完整文档在 `docs/app-integration/`：

- [接口文档](docs/app-integration/api.md)：认证、全部 App 接口、错误码、限流、幂等
- [功能文档](docs/app-integration/features.md)：面板、容器、偏好、推送、缓存、验收清单
- [联调示例](docs/app-integration/examples.md)：cURL / Flutter / WebView
- 在线查看：`/app-docs/README.md`、`/app-docs/api.md`、`/app-docs/features.md`
- 打包下载：`/downloads/app-integration-docs.zip`


**Skill 已同时安装到 `~/.claude/skills/mp-app-integration`**，可直接对 Claude Code 说
「按 mp-app-integration 接入小程序平台」。也可以把 `skills/app-integration/` 复制到 App 工程的
`.claude/skills/`，或下载 `/downloads/mp-skill.zip`。

创建/部署小程序使用另一个已安装的 Skill `mp-mini-program-deploy`
（`~/.claude/skills/mp-mini-program-deploy`）：对 Claude Code 说
「按 mp-mini-program-deploy 创建一个内部托管小程序」或「把现有网站接成外部小程序」。
也可以下载 `/downloads/mp-deploy-skill.zip`。

最短流程：

```bash
# 1. App 申请票据（Bearer 主站 access token）
curl -X POST http://localhost:8080/v1/launch-tickets \
  -H "Authorization: Bearer $MAIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"appKey":"novel","deviceID":"dev_1","origin":"http://localhost:8080"}'

# 2. WebView 打开 launchURL；页面用 ticket 换 Cookie
curl -X POST http://localhost:8080/v1/sessions/exchange \
  -H 'Content-Type: application/json' -d '{"ticket":"lt_..."}'
```

本地测试 token：

```bash
node --no-warnings scripts/mint-token.js --user 561 --ttl 86400
```

> 生产接入主站 JWKS 后，本地签发 token 将不再被接受，请改用真实 App 登录态。

## 测试

```bash
npm test
```

测试使用独立库 `ssemarket_mp_test`（已授权给 `mp_service`），覆盖：
目录 → 注册/创建/提交/审核/发布 → 票据与会话（含重放拒绝）→ 偏好/设备 →
内部事件签名与去重 → 第三方服务端签名 → 错误签名拒绝。

## 运维

- 健康检查：`/healthz`（进程）、`/readyz`（MySQL）。
- 指标：`/metrics`（请求量/时长、票据、会话、事件、通知、DB 计数）。
- 日志：一行一个 JSON，含 `requestId`；响应头 `X-Request-Id` 与错误体一致。
- 清理：每小时清理过期票据/会话/nonce/通知/审计（`MP_RETENTION_DAYS`，默认 30 天）。
- 备份：MySQL 每日全量 + binlog；MinIO `applet` 桶版本化；`data/secrets.json` 单独备份。
- 容量：单 Pod 单进程，MySQL 连接池 12；限流优先走 Redis，多副本时天然共享。

> UI / 接入验收脚本依赖 Playwright：`npm i -D playwright && npx playwright install chromium`，仅开发环境需要，不影响生产运行。
> - `npm run verify:ui`：创建 → 提交审核 → 管理员通过 → 发布 → 容器打开的全链路
> - `npm run verify:responsive`：390×844 移动端横向溢出与 console 错误
> - `npm run verify:external`：模拟第三方外部源（自有 origin）接入 SDK、换会话、刷新复用
> - `scripts/verify-e2e.mjs`、`scripts/verify-public.mjs` 为旧的补充脚本

## 已知边界与后续

- 推送渠道目前是「站内通知 + 可选 webhook 网关」，未内置 FCM/HMS/APNs SDK；接入真实渠道只需在
  `src/services/push.js` 增加 adapter。
- 邮箱验证/找回密码未接邮件服务；管理员可在后台停用账号，密码由开发者自助修改。
- 业务数据（帖子、用户资料）仍由主站提供；`posts:read` 目前只作为授权 scope 声明。
- 图标存储使用平台密钥可访问的 `applet` 桶前缀；拿到独立桶后改环境变量即可。
- 审计日志按 30 天保留；如需更长周期，可导出到 MinIO 后清理。

---

_代码位置：`/home/cloud/deploy/mp-service`；进程入口：`server.js`；部署入口：`deploy.sh`。_