# 平台托管（内部托管）完整参考

> 适用：集市官方应用 / 平台管理员。第三方请使用外部托管。
> 入口页面：`https://applet.ssemarket.cn/mp/<appKey>/?source=src_...`

---

## 1. 权限与前置

- 账号：`mp_developers.role = 'admin'`，或应用 `owner_type = 'official'`；
- 非官方应用调用托管接口会返回 `403 INTERNAL_HOSTING_FORBIDDEN`；
- 应用不能处于 `reviewing` 状态（审核中不能部署/切换构建）。

```bash
mp login --email admin@mp.local --password '…' --admin
mp whoami --admin
mp admin create --name "内部工具" --key internal-tool \
  --entry https://applet.ssemarket.cn/ \
  --origins https://applet.ssemarket.cn \
  --scopes profile:read,prefs:read,prefs:write
```

---

## 2. 页面工程要求

| 项 | 要求 |
| --- | --- |
| 入口 | 构建根目录必须有 `index.html` |
| 资源路径 | 用相对路径 `./assets/...`；平台挂在 `/mp/<appKey>/` 下，绝对路径 `/assets` 会 404 |
| 构建类型 | 纯静态（HTML/JS/CSS/图片/字体/音视频/wasm），不支持 SSR / Node 运行时 |
| 单文件 | ≤ 5MB |
| 总大小 | ≤ 25MB |
| 文件数 | ≤ 300 |
| 扩展名 | html/htm/js/mjs/css/json/txt/xml/map、png/jpg/jpeg/gif/webp/svg/ico、woff/woff2/ttf/otf、mp3/mp4/webm/wav、wasm |
| 路由 | 无扩展名的路径会回退到 `index.html`（history 路由可用）；hash 路由最稳妥 |
| 缓存 | HTML `no-cache`；带指纹的资源可长期缓存 |

构建示例（Vite）：

```bash
npm run build            # 产物在 dist/
ls dist/index.html       # 必须存在
```

如果 `vite.config` 设置了 `base: '/assets/'` 或 `base: '/'`，改成 `base: './'`。

---

## 3. CLI 流程（推荐）

```bash
# 1) 生成或准备页面
mp init ./internal-tool --app-key internal-tool --base https://applet.ssemarket.cn
# 或使用已有工程：npm run build

# 2) 上传 + 激活
mp deploy internal internal-tool --dir ./internal-tool/dist

# 3) 查看托管状态（含完整 source token）
mp hosting status internal-tool

# 4) 提交审核
mp apps submit internal-tool --version 1.0.0 --changelog "首版"

# 5) 管理员审核
mp admin queue
mp admin approve internal-tool --note "ok"

# 6) 发布
mp apps publish internal-tool
```

`mp deploy internal` 的实际动作：

1. 收集目录文件（过滤 `node_modules/.git` 等）；
2. `POST /dev/v1/apps/:appKey/hosting/builds` 创建构建；
3. 逐文件 `PUT .../builds/:buildId/files?path=<相对路径>`；
4. `POST .../builds/:buildId/activate` 激活；
5. 更新应用的 `entryURL` 与 `allowedOrigins`；
6. 输出脱敏后的入口 URL。

可选参数：

```bash
mp deploy internal internal-tool --dir dist --dry-run      # 只列文件，不上传
mp deploy internal internal-tool --dir dist --submit --version 1.0.1 --changelog "修复"
```

---

## 4. 不用 CLI 时的 API 流程

认证：开发者 Cookie `mp_dev`，或 `Authorization: Bearer <dev token>`。

```http
POST /dev/v1/apps/internal-tool/hosting/builds
→ 201 {"buildId":"<32位hex>","appKey":"internal-tool"}

PUT /dev/v1/apps/internal-tool/hosting/builds/<buildId>/files?path=index.html
Content-Type: application/octet-stream
<文件二进制>
→ 201 {"path":"index.html","size":1234,"files":n,"bytes":m}

PUT /dev/v1/apps/internal-tool/hosting/builds/<buildId>/files?path=assets/app.js
...

POST /dev/v1/apps/internal-tool/hosting/builds/<buildId>/activate
→ 200 {
  "appKey":"internal-tool",
  "mode":"internal",
  "build":"<buildId>",
  "entryURL":"https://applet.ssemarket.cn/mp/internal-tool/?source=src_...",
  "sourceToken":"src_...",
  "files":n,
  "bytes":m
}
```

其它：

```http
GET    /dev/v1/apps/:appKey/hosting     → {mode,build,entryURL,updatedAt}
DELETE /dev/v1/apps/:appKey/hosting     → 切回 external，清空托管构建与 token
```

---

## 5. source token 机制

- 激活时生成/复用 `src_...` token，哈希存库，密文存库；
- 访问 `/mp/<appKey>/?source=<token>` 时：
  - 校验 token；
  - 下发 `mp_src_<appKey>` Cookie（`Path=/mp/<appKey>`，7 天，SameSite=Lax）；
  - 后续 HTML/CSS/JS/图片请求自动带 Cookie；
- 无 token / token 不匹配 → 403，页面提示“请从 App 内打开”；
- `source` token **不是用户身份**：用户身份仍来自启动票据换到的 `mp_session`；
- `DELETE hosting` 后再部署会生成新的 token，旧链接立即失效。

入口 URL 同时包含在 App 目录返回的 `entryURL` 中，App 原样加载即可。

---

## 6. 服务器如何提供文件

- 路径：`<dataDir>/miniapps/<appKey>/<buildId>/...`；
- 结尾为 `/` 或空路径 → `index.html`；
- 无扩展名的未知路径 → 回退 `index.html`（SPA history 路由可用）；
- 带扩展名但文件不存在 → 404；
- 拒绝 `..`、`\0`、越界路径；
- HTML 返回 `Cache-Control: no-cache`。

---

## 7. 构建保留与回滚

激活新构建后，平台只保留：

- 当前激活的构建；
- 最近一个旧构建（用于应急）。

更早的目录会被清理。回滚方式：重新上传旧构建并激活（或保留下来的那个 build 重新 activate）。

---

## 8. 更新发布流程

```
修改代码 → npm run build → mp deploy internal（新 build 激活）
        → mp apps submit --version x.y.z --changelog "..."（生成版本快照）
        → 管理员审核通过 → mp apps publish
```

注意：

- 审核中不能部署；
- 审核通过但未发布时，用户仍看到旧版本；
- 发布后 `entryURL`/origin/scopes 以该版本的快照为准。

---

## 9. 检查与排错

```bash
URL=$(mp hosting status internal-tool | sed -n 's/.*入口：//p')
curl -I "$URL"                 # 200
curl -I "${URL%%\?*}"          # 403（无 source）
```

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `INTERNAL_HOSTING_FORBIDDEN` | 非官方/非管理员 | 换外部托管 |
| `INDEX_REQUIRED` | 构建根目录缺 `index.html` | 检查 `dist/index.html` |
| 资源 404 | 使用了 `/assets/...` 绝对路径 | 改 `base: './'` 或用相对路径 |
| 页面 403 | 缺少/错误 source token | 用 `mp hosting status` 的完整入口 |
| `BUILD_TOO_LARGE` | >25MB 或 >300 文件 | 只传构建产物，排除 source map/源文件 |
| `INVALID_FILE_TYPE` | 含不支持的扩展名 | 移除 `.ts/.vue/.scss` 等源文件 |
| `APP_REVIEWING` | 审核中 | 等审核结果后再部署 |
| 刷新子路由 404 | 路径带扩展名或资源绝对路径 | 用 hash 路由 / 相对资源 |