# UniSSO 接入与平台联调说明

> 版本：v1.0 · 2026-11-15  
> 平台：集市小程序开放平台（`https://applet.ssemarket.cn`）  
> 身份提供方：UniSSO（`https://sso.ssemarket.cn`）  
> 接入类型：外部应用（OAuth2 授权码 + PKCE S256），并支持基于共享会话的无感登录  
> 本文不包含任何 client_secret 明文；密钥只存在 `.env`（0600）。

---

## 1. 已创建 / 使用的 UniSSO 应用

| 项 | 值 |
| --- | --- |
| 应用名称 | `SSE_Applet`（集市小程序开放平台） |
| client_id | `app_282881e7684a52bf` |
| 应用类型 | 对外（external） |
| 状态 | 已生效（approved） |
| 回调地址 | `https://applet.ssemarket.cn/callback` |
| 申请 scopes | `openid profile:username profile:name profile:avatar email roles sse_identity` |
| client_secret | 仅存于 `MP_SSO_CLIENT_SECRET`（`.env`，0600），未写入代码/文档 |

> 另一个对接过程中误创建的外部应用已删除；当前只使用上述应用。

---

## 2. 实现范围

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 跳转授权 + PKCE(S256) | ✅ | `/auth/sso/start` → SSO `/authorize` → `/callback` |
| state 校验 | ✅ | HMAC-SHA256 签名的 HttpOnly Cookie，10 分钟 TTL |
| 后端 code 换 token | ✅ | `POST /api/oauth/token`，client_secret 只在服务端 |
| userinfo 建立本地会话 | ✅ | 首次登录自动创建开发者账号，已有邮箱账号自动绑定 |
| 共享会话无感登录 | ✅ | 读取 `unisso_sid` / `sse_sso` → `/api/oauth/session/verify` → 直接本地登录 |
| SSO Token 调平台 API | ✅ | `/v1` 接受 UniSSO access_token（userinfo 校验） |
| App 用 SSO 换平台 token | ✅ | `POST /auth/sso/verify` |
| 邮箱密码 M2M 无感 | ✅ 可用（当前实例已验证） | 登录表单本地密码失败后自动调用 `password/verify`；若管理员关闭该能力会返回 403，页面提示改用跳转授权 |
| 登出 | ✅ | 清本地 Cookie + 尽力调用 `/api/oauth/session/revoke`，清共享 Cookie |

---

## 3. 登录流程

### 3.1 首次登录（跳转授权）

```
浏览器
  │ GET /auth/sso/start?next=/#/dashboard
  ▼
小程序平台
  │ 生成 state + code_verifier/code_challenge(S256)
  │ 写 mp_sso_state（HttpOnly, Secure, SameSite=Lax, 10min）
  │ 302 https://sso.ssemarket.cn/authorize?...
  ▼
UniSSO
  │ 已登录 → 同意页；未登录 → 先登录
  │ 用户点「允许」
  │ 302 https://applet.ssemarket.cn/callback?code=...&state=...
  ▼
小程序平台 /callback
  │ 校验 state Cookie + 签名 + 时效
  │ POST /api/oauth/token（code + verifier + client_id/secret + 精确 redirect_uri）
  │ GET  /api/oauth/userinfo（Bearer access_token）
  │ 按 sso_sub / email 查找或创建 mp_developers
  │ 签发本地 mp_dev（HttpOnly Cookie）
  │ 302 /#/dashboard
  ▼
开放平台控制台
```

### 3.2 无感登录（共享会话）

```
浏览器携带 .ssemarket.cn 域下的 unisso_sid / sse_sso
  │ GET /auth/sso/start
  ▼
小程序平台
  │ POST https://sso.ssemarket.cn/api/oauth/session/verify
  │   {client_id, client_secret, session: <cookie 值>}
  │ 200 → user + 新的 sso_session / cookie 名 / domain / max_age
  │ 建立本地 mp_dev，写回共享 sso cookie
  │ 302 /#/dashboard（不跳转 SSO，无同意页）
```

实测：浏览器只带 `unisso_sid` 访问 `/auth/sso/start`，直接进入控制台，链路中没有任何 `sso.ssemarket.cn` 页面跳转。

### 3.3 未登录且无共享会话

`/auth/sso/start` 自动落到 `/authorize`；如果 UniSSO 自身未登录，会先显示登录页，再进入同意页。

---

## 4. 平台新增接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/auth/sso/status` | `{provider, enabled, m2m, loginUrl}`，前端判断是否展示按钮 |
| GET | `/auth/sso/start?next=/#/dashboard` | 发起无感 / 跳转授权 |
| GET | `/callback` | UniSSO 回调（必须与登记值逐字符一致） |
| POST | `/auth/sso/m2m` | 邮箱密码无感登录（M2M；已验证可用） |
| POST | `/auth/sso/logout` | 清本地/共享 Cookie，尽力撤销 SSO 会话 |
| POST | `/auth/sso/verify` | App 用 UniSSO access_token 换平台 access_token |

### `POST /auth/sso/verify`

请求：

```json
{"accessToken": "<UniSSO access_token>"}
```

处理：`/api/oauth/introspect` 确认 active → `/api/oauth/userinfo` → 用平台 `mainJwtSecret` 签一个 2 小时平台 token（`sub = SSO sub`）。

响应：

```json
{
  "accessToken": "<platform jwt>",
  "tokenType": "Bearer",
  "expiresIn": 7200,
  "user": {
    "userId": "80b8e21b-37a4-41a3-80b3-f3d12bf8e65d",
    "name": "音乐E2E测试",
    "email": "music-e2e-test@ssemarket.cn",
    "avatar": "",
    "sseSub": "1314"
  }
}
```

该平台 token 可直接用于 `/v1/*`（目录、启动票据、偏好等）。

> 也可以直接把 UniSSO access_token 作为 `Authorization: Bearer` 调 `/v1`；平台会用 userinfo 校验并缓存 30 秒。两种方式都已实测 200。

---

## 5. 本地账号映射

表：`mp_developers`

| 列 | 说明 |
| --- | --- |
| `sso_sub` | UniSSO `sub` / `sso_sub`，唯一；用于稳定关联 |
| `auth_source` | `password` / `sso` |
| `avatar_url` | UniSSO 头像 |
| `email` | 优先使用 SSO email；无 email 时生成 `<sub>@sso.local` |
| `role` | 默认 `developer`；`MP_SSO_ADMIN_EMAILS` 中的邮箱提升为 admin |
| `password_hash` | SSO 账号写随机不可用哈希，禁止密码登录 |

规则：

1. 先按 `sso_sub` 查找；
2. 找不到再按 email 查找（已有本地账号自动绑定；若已绑定其他 sso_sub 则 409）；
3. 都没有则创建新开发者账号；
4. 停用账号（`status != active`）拒绝登录；
5. 记录 `sso.login` / `sso.m2m_login` 审计与 `last_login_at`。

---

## 6. 配置

`.env`（0600，不进仓库）：

```bash
MP_SSO_ENABLED=1
MP_SSO_BASE=https://sso.ssemarket.cn
MP_SSO_CLIENT_ID=app_282881e7684a52bf
MP_SSO_CLIENT_SECRET=<在 .env 中，不在此文档>
MP_SSO_REDIRECT_URI=https://applet.ssemarket.cn/callback
MP_SSO_SCOPES=openid profile:username profile:name profile:avatar email roles sse_identity
MP_SSO_ADMIN_EMAILS=
MP_SSO_M2M_CLIENT_ID=
MP_SSO_M2M_CLIENT_SECRET=
```

其他可选项：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MP_SSO_AUTO_LOGIN` | `1` | 是否尝试共享 Cookie 无感登录 |
| `MP_SSO_SESSION_COOKIES` | `unisso_sid,sse_sso,unisso_session` | 读取顺序 |
| `MP_SSO_STATE_TTL` | `600` | state Cookie 有效期 |
| `MP_SSO_TIMEOUT_MS` | `8000` | SSO 请求超时 |
| `MP_SSO_APP_TOKEN_TTL` | `7200` | App 换取的平台 token 有效期 |

`client_secret` 只在后端使用；前端只拿到 `client_id` 对应的跳转 URL，不接触 secret。

---

## 7. App 401 的排查与修复

### 7.1 根因

平台此前只用自己的随机 HS256 密钥验签；主站 token 使用另一套 `JWT_KEY`，`iss=loginTest`，因此：

```
GET /v1/apps  Authorization: Bearer <主站 token>
→ 401 INVALID_TOKEN（Token 签名校验失败）
```

### 7.2 修复

平台改为**用主站现成鉴权接口校验**，不再依赖共享密钥：

```bash
MP_MAIN_VERIFY_URL=https://ssemarket.cn/api/auth/info
```

校验策略（按顺序）：

1. 本地 HS256（仅本地调试 mint token）；
2. `MP_MAIN_JWKS_URL`（RS256 等非对称 token，已配置 SSO JWKS）；
3. `MP_MAIN_VERIFY_URL`：`GET /api/auth/info` + `Authorization: Bearer`；
   - 主站返回 `{code:200,data:{user:{userID,...}}}`；
   - 平台兼容 `code=0` / `code=200`，取 `data.user.userID`；
4. 内部签名校验接口（如配置）；
5. UniSSO userinfo（SSO access_token 也可直接访问 `/v1`）；
6. 仍失败返回 401，响应 `details` 带 `alg/iss/strategies`，服务端日志记为 `auth.token_rejected`。

### 7.3 实测（真实主站 token）

使用真实 `iss=loginTest`、`UserID=1314` 的主站 token：

| 请求 | 结果 |
| --- | --- |
| `GET /v1/apps` | `200`，返回 novel/ranking/resume/media/shop/course |
| `POST /v1/launch-tickets` | `201`，返回 `launchURL` |
| 打开 `media` 小程序 | 页面正常，音频 `paused=false` |

**结论：这批 APK 无需重新打包，主站 token 已可直接走通目录 → 票据 → 会话 → 小程序。**

---

## 8. 已发布的小程序

| appKey | 名称 | 分类 | 排序 | 状态 | 入口（当前） |
| --- | --- | --- | --- | --- | --- |
| novel | 小说 | content | 100 | published | `/demo/app?app=novel` |
| ranking | 排行榜 | content | 95 | published | `/demo/app?app=ranking` |
| resume | 简历 | tool | 90 | published | `/demo/app?app=resume` |
| media | 音乐视频 | content | 85 | published | `/demo/app?app=media` |
| shop | 商城 | shopping | 80 | published | `/demo/app?app=shop` |
| course | 课程专区 | content | 75 | published | `/demo/app?app=course` |

- 入口完整 URL：`https://applet.ssemarket.cn/demo/app?app=<appKey>`
- allowedOrigins：`https://applet.ssemarket.cn`
- 可见范围：登录可见（App 带主站 token）
- 旧的 coin/help 演示应用已软删除，不再出现在目录

> 入口现在指向平台内置的演示容器页，满足“与主站不同源”并可立即联调。  
> 等 `mp-app.ssemarket.cn` 的真实小程序页面部署后，在管理后台或
> `PATCH /admin/v1/apps/<appKey>` 更新 `entryURL` / `allowedOrigins` 即可，无需改代码。
>
> 示例：
> ```bash
> PATCH /admin/v1/apps/media
> {"entryURL":"https://mp-app.ssemarket.cn/media","allowedOrigins":["https://mp-app.ssemarket.cn"]}
> ```

---

## 9. App 侧如何使用

### 9.1 现有主站登录（推荐，不改 APK）

1. App 登录主站，拿 access token；
2. `GET /v1/apps`；
3. `POST /v1/launch-tickets`；
4. WebView 打开 `launchURL`；
5. 页面用 ticket 换 `mp_session`。

已实测主站 token 全链路通过。

### 9.2 使用 UniSSO 身份

- 直接：`Authorization: Bearer <UniSSO access_token>` 调 `/v1/*`；
- 或先换平台 token：

```http
POST https://applet.ssemarket.cn/auth/sso/verify
Content-Type: application/json

{"accessToken":"<UniSSO access_token>"}
```

返回的 `accessToken` 用作 `/v1/*` 的 Bearer，有效期 2 小时。

适用于 App 想直接用 UniSSO 登录、而不依赖主站 token 的场景。

---

## 10. 安全设计

- `client_secret` 只在后端 `.env`，不下发前端、不写日志；
- `redirect_uri` 严格等于登记值；
- state：32 字节随机 + HMAC-SHA256 签名 + 10 分钟 TTL，存 HttpOnly Cookie；
- PKCE：verifier 64 字符随机，challenge = base64url(SHA256(verifier))，43 字符；
- code 一次性，重复使用返回 `invalid_grant`；
- 本地 `mp_dev` HttpOnly/Secure/SameSite=Lax；
- `auth/token/rejected` 日志只记录 `alg/iss/kid/策略`，不记录 token；
- 开放重定向：`next` 只允许以 `/` 开头且不以 `//` 开头，统一转成 hash 路由；
- 撤销：登出尽力调用 SSO `session/revoke`，并清除 `unisso_sid` / `sse_sso`；
- SSO 用户 local password 为随机不可用哈希，必须走 SSO；
- 管理员角色仅由 `MP_SSO_ADMIN_EMAILS` 或本地已有 admin 账号决定，SSO 普通用户默认 developer。

---

## 11. 验收记录

| 验收项 | 结果 |
| --- | --- |
| `/authorize` 未登录跳登录、登录后同意页 | ✅ 实测 |
| 同意 → 回调带 code+state | ✅ 实测 |
| 后端换 token → userinfo | ✅ 实测 |
| 首次 SSO 登录自动创建本地账号并进入控制台 | ✅ 实测（`音乐E2E测试`） |
| state 篡改 / 缺失 | 代码校验，失败回登录页并提示 |
| 拒绝授权 | 回调 `error=access_denied`，平台友好提示 |
| 未登记 redirect_uri | 规范要求 SSO 侧拒绝；当前登记值已生效 |
| 共享 Cookie 无感登录 | ✅ 实测，无 SSO 页面跳转 |
| SSO access_token 调 `/v1/apps` | ✅ 200 |
| `/auth/sso/verify` 换平台 token | ✅ 200，token 可用于 `/v1` |
| 主站 token（iss=loginTest）调 `/v1` | ✅ 200，票据 201，media 打开并播放音频 |
| `npm test` | ✅ 7/7 |
| 前端 UI 验收 | ✅ 无 console/page 错误 |

未覆盖 / 受限：

- **邮箱密码 M2M 无感**：当前实例已验证可用（用不存在的账号测试，SSO 返回 401 而不是 403），
  登录表单会在本地密码失败后自动调用 `POST /api/oauth/password/verify`。
  `MP_SSO_M2M_*` 为空时会回退到主 client；如需独立内接应用，填上这两个变量即可。
  如果管理员关闭无感登录，SSO 会返回 403，页面会提示改用跳转授权。
- 共享会话无感依赖浏览器已持有 `.ssemarket.cn` 的 `unisso_sid`；首次使用仍需跳转授权一次。
- 规范未提供 RP-initiated logout；本地登出会清 Cookie 并尽力撤销会话，不保证注销所有 SSO 端。

---

## 12. 文件与运维

| 文件 | 内容 |
| --- | --- |
| `src/sso.js` | PKCE、state 签名、token/userinfo/session 客户端 |
| `src/routes/sso.js` | start/callback/m2m/logout/verify 路由 |
| `src/auth.js` | 主站 token 多策略校验、SSO token 兜底 |
| `src/services/catalog.js` | 应用目录 |
| `src/seed.js` | six 个官方应用种子 |
| `public/assets/pages-public.js` | 登录页 SSO 按钮与错误提示 |
| `docs/app-integration/unissso-integration.md` | 本文 |

运维：

```bash
# 修改 SSO 配置后重启
cd /home/cloud/deploy/mp-service
./deploy.sh

# 检查状态
curl -s https://applet.ssemarket.cn/auth/sso/status
curl -s https://applet.ssemarket.cn/healthz
```

日志关键字：

- `sso.callback_failed`：回调换 token/userinfo 失败；
- `sso.session_verify_failed`：共享 Cookie 校验失败；
- `auth.token_rejected`：主站/SSO token 被拒（含 alg/iss/策略）。

如 SSO 返回 403，先检查：client_id 是否对上、应用是否对外且已生效、redirect_uri 是否逐字符一致、scope 是否在登记范围。

---

## 13. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-15 | 接入 UniSSO 外部应用 OAuth2+PKCE；支持共享会话无感登录、SSO token 校验与 App 换 token |
| 2026-11-15 | 主站 token 改为 `/api/auth/info` 校验，修复 401；发布 novel/ranking/resume/media/shop/course 六个小程序 |