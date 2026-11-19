# 排错手册

> 先拿 `requestId`：所有错误响应体都有 `{ code, message, requestId }`，
> 响应头也有 `X-Request-Id`。日志是单行 JSON，用它检索最准。
> 运维日志：`~/logs/mp-service.log`（或 `LOG_DIR`）；`/metrics` 看请求量与状态码。

---

## 1. 创建 / 配置

| 错误码 / 现象 | 原因 | 处理 |
| --- | --- | --- |
| `INVALID_NAME` | 名称不是 2~32 字 | 修改名称 |
| `EMAIL_TAKEN` | 邮箱已注册 | 直接登录或用其他邮箱 |
| `WEAK_PASSWORD` | 密码 < 8 位 | 至少 8 位（≤128） |
| `APP_LIMIT` | 开发者应用数达到上限 | 删除不用的应用/联系管理员调额 |
| `INVALID_APP_KEY` / 格式错误 | appKey 不满足 `^[a-z][a-z0-9_-]{2,31}$` | 小写字母开头，3~32 位 |
| `INVALID_URL` | entryURL 不是 HTTPS（或含账号密码） | 用 HTTPS；本地可用 `http://localhost` |
| `INVALID_ORIGIN` / `TOO_MANY_ORIGINS` | origin 带路径/格式错/超数量 | 只填 `scheme://host[:port]`，控制在平台上限内 |
| `NO_CHANGES` | PATCH 没有任何可更新字段 | 至少传一个字段 |
| `ACCOUNT_SUSPENDED` | 账号被管理员停用 | 联系管理员 |

---

## 2. 票据与会话

| 错误码 | 原因 | 处理 |
| --- | --- | --- |
| `APP_KEY_REQUIRED` | 请求缺 `appKey` | 补上 |
| `APP_NOT_FOUND` | 应用不存在/不可见（草稿、未发布、白名单） | 先发布；检查 `visibility` 与白名单 |
| `APP_OFFLINE` / `APP_UNAVAILABLE` | 应用已下架/未发布 | 重新发布 |
| `ORIGIN_NOT_ALLOWED` | 票据 origin 不在 `allowedOrigins` | `mp apps update --origins <origin>` |
| `INVALID_ORIGIN` | origin 格式错误 | 用 `new URL(x).origin` 的值 |
| `TICKET_REQUIRED` | 换会话缺 ticket | 从 `launchURL` 读取 |
| `INVALID_TICKET` | ticket 不存在/被篡改 | 重新申请 |
| `TICKET_EXPIRED` | 超过 60 秒 | 重新申请（不要刷新旧 URL） |
| `TICKET_USED` | 已被消费（刷新/重复打开） | 重新申请；SPA 只消费一次 |
| `ORIGIN_MISMATCH` | 换会话的 `Origin` 与票据绑定 origin 不同 | 保证页面 origin 与申请票据时一致；避免跨域重定向 |
| App 报「launchURL 不在允许的 origin 内」 | `entryURL` 的 origin 不在 `allowedOrigins` 中（常见于把入口改到外部域名却没改 origin） | 在开放平台把入口页 origin 加进 `allowedOrigins`；平台会自动放到第一位。排查 SQL：`SELECT app_key,entry_url,allowed_origins FROM mp_apps` |
| `SESSION_REQUIRED` | 没有 Cookie/会话头 | 先换会话；跨站确认 `X-MP-Session` |
| `SESSION_INVALID` / `SESSION_EXPIRED` | 会话不存在/过期 | 重新申请票据 |
| `SESSION_REVOKED` | 已注销 | 重新打开小程序 |
| `SCOPE_REQUIRED` | 应用没有该权限 | 在发布版本里申请对应 scope |

**快速自检**：

```bash
# 1) 用测试 token 申请票据（本地开发）
TOKEN=$(node --no-warnings scripts/mint-token.js --user 561)
curl -sS -X POST "$MP_BASE/v1/launch-tickets" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"appKey":"my-app","deviceID":"dev_1","origin":"https://mp-app.example.com"}'

# 2) 用返回的 ticket 换会话
curl -sS -X POST "$MP_BASE/v1/sessions/exchange" \
  -H 'Content-Type: application/json' -d '{"ticket":"lt_..."}'
```

---

## 3. 页面 / SDK / 浏览器

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 页面能打开但 `MP.ready` 401 | ticket 丢失/未消费/没有 ticket | 按外部托管 3.2、3.3 检查；首屏不要跳走 |
| SDK 请求打到自己的域名（404） | 旧版 SDK 默认同源 | 升级 SDK；或 `MP.configure({base:'https://applet.ssemarket.cn'})` |
| 控制台 `CORS` / `CORS_FORBIDDEN` | 应用未发布，origin 未放行 | 先发布测试应用；或运维配置 `MP_CORS_ORIGINS` |
| CSP 报错（脚本/接口被拦） | 未放行平台域名 | `script-src`、`connect-src` 加 `https://applet.ssemarket.cn` |
| 刷新后会话失效（跨站域名） | 第三方 Cookie 被浏览器拦 | 升级 SDK（`X-MP-Session` + sessionStorage） |
| 分享无反应 | 容器未实现桥接 | App 侧监听 `postMessage` / `ReactNativeWebView` / `webkit.messageHandlers.mpBridge` |
| 页面样式错乱 | 用了绝对资源路径或未适配移动端 | 相对路径 `./assets`；viewport；响应式 |

---

## 4. 内部托管

| 错误码 / 现象 | 原因 | 处理 |
| --- | --- | --- |
| `INTERNAL_HOSTING_FORBIDDEN` | 非官方/非管理员 | 改用外部托管 |
| `APP_REVIEWING` | 审核中 | 等审核结果 |
| `INDEX_REQUIRED` | 构建根目录缺 `index.html` | 检查 `dist/index.html` |
| `FILE_TOO_LARGE` | 单文件 > 5MB | 拆分/压缩 |
| `BUILD_TOO_LARGE` | > 25MB 或 > 300 文件 | 只传构建产物 |
| `INVALID_FILE_TYPE` | 含不支持扩展名 | 移除 `.ts/.vue/.scss` 等 |
| `INVALID_PATH` / `EMPTY_FILE` | 路径非法或空文件 | 使用正常相对路径 |
| `BUILD_NOT_FOUND` | buildId 不存在/已清理 | 重新创建构建 |
| 页面 403 | 缺少 source token | 用 `mp hosting status` 的完整入口 |
| 资源 404 | 绝对路径 `/assets/...` | Vite `base: './'` 或相对路径 |
| 子路由刷新 404 | 路径带扩展名/资源绝对路径 | 用 hash 路由或相对资源 |

```bash
mp hosting status my-app
mp hosting disable my-app     # 需要轮换 source token 时
```

---

## 5. 审核 / 发布

| 错误码 | 原因 | 处理 |
| --- | --- | --- |
| `CHANGELOG_REQUIRED` | 没填版本说明 | 填 1~2000 字 |
| `ORIGINS_REQUIRED` | 没有 origin | 至少登记一个 |
| `NO_REVIEWING_VERSION` | 管理员审核时没有待审版本 | 开发者先 `mp apps submit` |
| `NO_APPROVED_VERSION` | 发布时没有已通过版本 | 先审核通过 |
| `APP_NOT_PUBLISHED` | 下架一个未发布应用 | 忽略/检查状态 |
| `APP_ACTIVE` | 删除已发布/审核中应用 | 先下架再删 |
| 审核通过后用户仍看旧版 | 还没 `publish` | 开发者执行 `mp apps publish` |

```bash
mp apps versions my-app
mp admin queue
mp admin approve my-app
mp apps publish my-app
```

---

## 6. 服务端签名（第三方）

| 错误码 | 原因 | 处理 |
| --- | --- | --- |
| `INVALID_SIGNATURE` | 密钥/拼接顺序/body 不一致 | `HMAC(secret, appKey\nts\nnonce\nrawBody)`；body 逐字节一致 |
| `SIGNATURE_EXPIRED` | 时间戳超出 ±300s | 校准服务器时钟，用 Unix 秒 |
| `REPLAY_DETECTED` | nonce 重复 | 每次请求生成新的 8~128 字符 nonce |
| `APP_SECRET_MISSING` | 应用没有密钥 | `mp apps secret my-app reveal` |

---

## 7. CLI / 登录

```bash
mp whoami
mp doctor                      # 健康检查 + 当前账号
mp login --email ... --password ... --base https://applet.ssemarket.cn
mp logout
```

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `未登录` | 没有 token 或过期 | 重新 `mp login` |
| `ADMIN_REQUIRED` | 非管理员调用 admin 命令 | 用管理员账号，或加 `--admin` 登录 |
| `无法连接 <base>` | 地址错误/网络不通 | 检查 `--base`、DNS、证书 |
| 命令不在 PATH | 未 `npm link` | `cd /home/cloud/deploy/mp-service && npm link` |

---

## 8. 观测

```bash
curl -sS "$MP_BASE/healthz"     # {"ok":true,...}
curl -sS "$MP_BASE/readyz"      # {"ok":true,"db":"up"}
curl -sS "$MP_BASE/metrics" | head
```

- 日志一行一个 JSON，含 `requestId`、`method`、`path`、`status`、`ms`；
- 用响应头 `X-Request-Id` 直接搜日志定位；
- 管理后台 `/admin` 可看审核队列、事件、审计、反馈；
- 本地可运行 `npm run verify:external`（外部源）和 `npm run verify:ui`（内部全链路）。