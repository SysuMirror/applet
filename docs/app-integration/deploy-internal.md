# 内部小程序部署指南（平台托管源）

> 不确定该选哪种接入方式？先读 [integration-modes.md](./integration-modes.md)。

> 适用：集市内部团队 / 官方小程序  
> 源类型：**平台托管**（`https://applet.ssemarket.cn/mp/<appKey>/`）  
> 访问方式：页面 URL 带 `source` token；上传接口要求登录 token  
> 配套 CLI：`mp deploy internal`
> 管理员账号与登录方式：[admin-guide.md](./admin-guide.md)

---

## 1. 和外部部署的区别

| | 内部（本文） | 外部（[deploy-external.md](./deploy-external.md)） |
| --- | --- | --- |
| 谁能用 | 官方应用 / 平台管理员 | 任意开发者 |
| 页面放在哪 | 平台 `data/miniapps`，平台域名 | 你自己的 HTTPS 源（如 `mp-app.ssemarket.cn`） |
| 上传方式 | CLI 调平台接口，需登录 token | 自己部署，CLI 只登记 URL |
| 源访问控制 | URL 必须带 `source` token | 由你的服务器控制 |
| 同源风险 | 与开放平台同源（仅限官方/可信代码） | 独立源，隔离更好 |
| 大小限制 | 单文件 5MB / 构建 25MB / 300 文件 | 由你的托管决定 |

> 第三方开发者请使用外部部署。内部托管会拒绝非官方应用。

---

## 2. 前置

1. 一个可用的官方小程序应用（`ownerType=official`），或平台管理员账号；
   - **内部管理员**：`3238499590@qq.com` / `oauthid561`（SSO 的 `sse_sub=561` 已在管理员 ID 列表；UniSSO 登录 `/admin`）；
   - 初始化管理员：`admin@mp.local`（密码在 `.env`）；
   - 详见 [admin-guide.md](./admin-guide.md)。
2. 已登录 CLI（登录 token 只存在 `~/.mp-cli.json`，0600）：

```bash
cd /home/cloud/deploy/mp-service
npm link                    # 让 mp 命令进入 PATH（只需一次）
# SSO-only 账号先按 admin-guide 设置 CLI 密码，或使用初始化管理员
mp login --email admin@mp.local --password '…' --admin
mp whoami --admin
```

3. 没有官方应用时，由管理员创建：

```bash
mp admin create \
  --name "内部工具" \
  --key internal-tool \
  --entry https://applet.ssemarket.cn/ \
  --origins https://applet.ssemarket.cn \
  --scopes profile:read,prefs:read \
  --sort 10
```

或打开 https://applet.ssemarket.cn/admin 创建官方小程序。

---

## 3. 创建页面工程

```bash
mp init ./internal-tool \
  --app-key internal-tool \
  --title "内部工具" \
  --base https://applet.ssemarket.cn
```

生成：

```
internal-tool/
├── index.html
├── app.js          # MP.ready / prefs / share 示例
├── styles.css
├── nginx.conf.example
└── README.md
```

页面加载 `https://applet.ssemarket.cn/sdk/mp-client.js`，自动用 URL 的 ticket 换 `mp_session`；页面里不出现主站 token。

也可以放入任何静态构建产物（Vite/React/Vue 的 `dist/`），只要根目录有 `index.html`，且脚本/样式使用相对路径（`./assets/...`）。

---

## 4. 部署到平台

```bash
mp deploy internal internal-tool --dir ./internal-tool
```

CLI 会：

1. 读取目录并过滤 `node_modules/.git` 等；
2. 创建构建 ID；
3. 逐个文件 `PUT` 到平台（需登录 token）；
4. 激活构建；
5. 把应用 `entryURL` 更新为：

```
https://applet.ssemarket.cn/mp/internal-tool/?source=src_...
```

6. 把 `allowedOrigins` 加上 `https://applet.ssemarket.cn`。

查看状态：

```bash
mp hosting status internal-tool
```

**source token 的作用**

- 平台托管的源默认 **不公开**：访问 `/mp/<appKey>/...` 必须带 `?source=<token>`，或已持有 `mp_src_<appKey>` Cookie；
- 首次带 token 打开 HTML 后，平台会下发该 Cookie，后续 CSS/JS/图片自动携带；
- 它不是用户身份 token：用户身份仍来自启动 ticket → `mp_session`；
- 重新执行 `mp hosting disable` 再部署可生成新的 source token；
- App 目录返回的 `entryURL` 已包含 source token，App 只需原样加载。

验证：

```bash
URL=$(mp hosting status internal-tool | awk -F'入口：' '/入口/{print $2}')
curl -I "$URL"                       # 200
curl -I "${URL%%\?*}"                # 403（无 token）
```

---

## 5. 提交审核 / 发布

```bash
mp apps submit internal-tool \
  --version 1.0.1 \
  --changelog "内部托管首版"
```

管理员审核：

```bash
mp login --email admin@mp.local --password '…' --admin
mp admin queue
mp admin approve internal-tool
mp admin publish internal-tool
```

也可以一步：

```bash
mp deploy internal internal-tool --dir ./internal-tool --submit --changelog "内部托管首版"
```

> 注意：`deploy internal` 激活时会先更新 `entryURL`；生产流程建议先提交审核，通过后再发布版本。官方内部应用可按团队流程简化。

发布后 App 拉目录即可看到，点击后：

```
App POST /v1/launch-tickets
 → launchURL = entryURL + &ticket=...
 → 页面加载 /mp/internal-tool/?source=...&ticket=...
 → 页面 POST /v1/sessions/exchange
 → mp_session
```

---

## 6. 更新与回滚

```bash
# 重新构建并部署
mp deploy internal internal-tool --dir ./internal-tool

# 查看当前构建
mp hosting status internal-tool

# 关闭平台托管（页面入口会失效，需要改回外部 URL 或重新部署）
mp hosting disable internal-tool
```

平台保留当前构建 + 最近一个旧构建目录，便于排查；`disable` 不会删除源码文件，但会清空 source token 和托管模式。

---

## 7. 限制

| 项 | 限制 |
| --- | --- |
| 单文件 | 5MB |
| 单构建总量 | 25MB |
| 文件数 | 300 |
| 扩展名 | html/js/css/json/常见图片/字体/音视频/wasm 等 |
| 不允许 | 服务端代码、`node_modules`、`.git`、路径穿越 |
| 托管资格 | 官方应用或平台管理员 |

---

## 8. 安全说明

- 上传接口需要 **登录 Bearer token**（开发者/管理员），未登录无法构建或激活；
- 访问托管源需要 **source token**（URL 或 Cookie），否则 403；
- 页面仍通过 ticket 换用户会话，source token 不能代替用户身份；
- 托管源与开放平台同源，因此**只允许官方/可信代码**；第三方请使用外部源；
- 平台对托管页面下发 CSP：脚本/样式限本站、`connect-src` 限本站与 API、`frame-ancestors` 限本站；
- 不允许路径穿越与服务端执行；只做静态文件读取；
- source token 会出现在 `entryURL` 中，平台访问日志已对 `source` 做打码。

---

## 9. 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| `403 INTERNAL_HOSTING_FORBIDDEN` | 不是官方应用且不是管理员；让管理员创建官方应用或改用外部源 |
| `403` 打开 `/mp/...` | 缺少/错误 source token；用 `mp hosting status` 查看完整 entryURL |
| `404` | 构建缺少 `index.html` 或文件路径不对；检查相对路径 |
| `413 / 25MB` | 单文件或整包超限；压缩图片/拆分资源 |
| `409 APP_REVIEWING` | 审核中不能切换托管版本；等待审核 |
| App 打开白屏 | 检查 `index.html` 资源路径是否相对、Console/CSP；用 source URL 直接打开 |
| 旧 source token 失效 | 执行过 disable/重新激活；从 App 重新拉目录 |

---

## 10. CLI 速查

```bash
mp deploy internal <appKey> --dir <目录> [--submit --changelog "说明"]
mp hosting status <appKey>
mp hosting disable <appKey>
mp apps check <appKey>
mp apps submit <appKey> --changelog "说明"
mp admin approve <appKey>
mp apps publish <appKey>
```