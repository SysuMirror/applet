# App 接入文档索引

> 面向：手机 App 客户端（Flutter / Android / HarmonyOS / iOS / Windows）与小程序页面团队
> 后端：集市小程序开放平台（mp-service）
> 文档版本：v1.0（2026-11-15）
> API 版本：`/v1`（稳定）

## 文档地图

| 文档 | 读者 | 内容 |
| --- | --- | --- |
| [integration-modes.md](./integration-modes.md) | 产品 / 开发 / 决策者 | **先读**：小程序运行原理、外部托管 vs 平台托管、现成网站怎么接 |
| [api.md](./api.md) | 客户端开发 | 全部 App 接口：认证、字段、错误码、限流、幂等 |
| [features.md](./features.md) | 产品 / 客户端 / QA | 功能范围、页面与状态、交互策略、缓存、验收清单 |
| [examples.md](./examples.md) | 客户端开发 | cURL 与 Flutter 代码示例、WebView 容器要点 |
| [app-identity.md](./app-identity.md) | App / 官方小程序页面 | App 身份注入、内置登录卡片样式、无感登录与游客页 |
| [unissso-integration.md](./unissso-integration.md) | 平台 / App | 统一身份登录、无感会话、App 身份兑换与 401 排查 |
| [admin-guide.md](./admin-guide.md) | 内部管理员 | 管理员账号、UniSSO 登录、审核/发布/内部托管、CLI |
| [deploy-internal.md](./deploy-internal.md) | 内部团队 | 平台托管源：登录 token 上传、source token、审核发布 |
| [deploy-external.md](./deploy-external.md) | 第三方开发者 | 自有 HTTPS 源、origin/CORS、审核发布 |
| [../../skills/app-integration/SKILL.md](../../skills/app-integration/SKILL.md) | 客户端 / Agent | App 接入 Skill（流程、示例、排错） |
| [../../skills/mp-mini-program-deploy/SKILL.md](../../skills/mp-mini-program-deploy/SKILL.md) | 开发者 / Agent | 创建与部署 Skill（内部托管、外部托管、检查清单、预检脚本） |

## 先拿到三样东西

1. **API 地址** `MP_BASE`
   - 本地：`http://localhost:8080`
   - 当前公网：`https://applet.ssemarket.cn`
   - 其他环境由平台提供；**不要硬编码在代码里**，走构建配置。
2. **主站 access token**
   - App 已有登录体系，登录成功后拿到的 access token（JWT）。
   - 刷新逻辑仍由 App 负责；官方小程序可复用 App 登录态，页面不保存用户密码或刷新凭证。登录是平台提供的能力，不强制；也可以继续使用自有登录体系。
3. **小程序 `appKey`**
   - 由开放平台创建并发布后提供，例如 `novel`、`ranking`。

## 五分钟跑通

```bash
MP_BASE=http://localhost:8080
TOKEN=$(node --no-warnings scripts/mint-token.js --user 561)   # 仅本地开发

# 1. 拉目录
curl -s "$MP_BASE/v1/apps?limit=20" -H "Authorization: Bearer $TOKEN"

# 2. 申请启动票据
curl -s -X POST "$MP_BASE/v1/launch-tickets" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"appKey":"novel","deviceID":"dev_demo","origin":"http://localhost:8080"}'

# 3. 打开返回的 launchURL；页面用 ticket 换会话
curl -s -X POST "$MP_BASE/v1/sessions/exchange" \
  -H 'Content-Type: application/json' \
  -d '{"ticket":"lt_..."}'
```

生产环境使用真实 App 登录 token；本地可用 `scripts/mint-token.js`。

## 小程序登录

官方内置小程序（`applet.ssemarket.cn/mp/*`）使用「App 身份复用 + 页面内登录」：

- App 已登录时，容器向页面注入短时效 access token，小程序无感进入，不弹登录框；
- 独立窗口没有注入条件时，页面用 `.ssemarket.cn` 共享 SSO Cookie 静默登录；
- 没有会话时，登录卡片显示在**小程序自己的窗口内**，直接调用主站登录接口，不跳回主 App；
- 点「暂不登录」进入游客页，不会在路由守卫里反复重定向；
- 登录一次，六个官方小程序共享登录态。

这是一套**可选**的登录能力，不是强制方式：页面可以继续使用自有账号、学校统一身份、验证码或其他登录；使用统一登录时必须保留 `redirect` 并在成功后回到原页面。完整身份顺序、注入代码、卡片样式、回跳与安全边界见 [app-identity.md](./app-identity.md)。第三方小程序继续使用平台 `mp_session` / OAuth，不使用主站 token 注入。

## 角色与边界

| 组件 | 负责 | 不负责 |
| --- | --- | --- |
| App | 主站登录、拉目录、申请票据、WebView 容器、设备推送、偏好缓存 | 不需要自己实现小程序登录；不保存用户密码 |
| 小程序页面 | 使用平台会话调用 `/v1` 页面接口、通过 SDK 与容器通信 | 不保存用户密码 / AppSecret |
| mp-service | 目录、统一登录、小程序会话、偏好、设备、事件、审核 | 不保存用户密码、不承载帖子/商城业务数据 |

## 术语

- **启动票据（ticket）**：一次性、60 秒、绑定用户 + 小程序 + 设备 + origin，只能换会话。
- **小程序会话**：`mp_session` HttpOnly Cookie，2 小时滑动续期，权限由小程序的 scopes 限定。
- **recent / favorites**：最近使用（最多 20）/ 我的小程序（最多 50），服务端为跨端真相源。
- **launchURL**：平台生成的启动地址，App 应原样交给 WebView，不要自行拼接参数。

## 联调问题排查顺序

1. 401：主站 access token 是否过期 / 是否用了 refreshToken。
2. 403 `ORIGIN_NOT_ALLOWED`：启动票据的 `origin` 是否在该小程序 `allowedOrigins` 中。
3. 403 `APP_UNAVAILABLE`：小程序是否已发布（开放平台状态需为「已发布」）。
4. `TICKET_EXPIRED`：申请票据到打开页面是否超过 60 秒；网络慢时重试整个流程。
5. `TICKET_USED`：是否重复使用了同一 ticket；WebView 刷新不能复用旧 ticket。
6. 429：按 `Retry-After` 退避，检查 App 是否多处并发轮询。
7. 5xx：记录响应头 `X-Request-Id` 与错误体 `requestId`，交给平台排查。

## 变更记录

| 日期 | 版本 | 变更 |
| --- | --- | --- |
| 2026-11-15 | v1.0 | 首版：目录、启动票据、会话、偏好、设备、订阅、通知、反馈 |