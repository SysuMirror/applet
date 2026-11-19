# 内部管理员使用指南

> 适用：平台初始化管理员、内部管理员（如 `3238499590@qq.com`）  
> 后台：`https://applet.ssemarket.cn/admin`  
> 关联文档：[内部小程序部署](./deploy-internal.md) · [UniSSO 接入](./unissso-integration.md)

---

## 1. 先把三个“账号”分清

| 名称 | 值 | 用途 |
| --- | --- | --- |
| **内部管理员账号** | `3238499590@qq.com` | 登录开放平台/管理后台；已加入 `MP_SSO_ADMIN_EMAILS`，首次 UniSSO 登录自动成为平台管理员 |
| **管理员关联 ID** | `561`（oauthid561） | SSO 返回的 `sse_sub`；已加入 `MP_SSO_ADMIN_IDS`，即使邮箱别名变化也能识别为管理员 |
| **主站用户 ID** | `oauthid561` / `561` | App 主站身份，用于 `/v1` 主站 token、启动票据、偏好；**不是后台登录账号** |
| **初始化管理员** | `admin@mp.local` | 平台首次启动生成的兜底管理员，密码在 `.env` 的 `MP_ADMIN_PASSWORD`；用于初始化和 CLI |

> 三个账号是不同层面的身份：`3238499590@qq.com` 通过 UniSSO 登录平台后台；`561` 是 App 侧主站用户 ID；`admin@mp.local` 是平台本地兜底管理员。

---

## 2. 内部管理员怎么登录

### 方式 A：UniSSO（推荐，不需要额外密码）

1. 打开 https://applet.ssemarket.cn/admin
2. 点击「使用 UniSSO 登录管理后台」
3. 用 `3238499590@qq.com` 完成 UniSSO 登录
4. 回调后进入 `/admin`，如果邮箱已在 `MP_SSO_ADMIN_EMAILS`，账号角色为 `admin`

当前配置：

```bash
MP_SSO_ADMIN_EMAILS=3238499590@qq.com
MP_SSO_ADMIN_IDS=561
```

第一次 SSO 登录会：

- 在 `mp_developers` 自动创建或绑定该邮箱的账号；
- `auth_source=sso`，角色 `admin`；
- 签发平台后台登录 Cookie。

如果登录后仍提示需要管理员密码或 `/admin/v1/me` 403：

- 确认 SSO 返回的邮箱是 `3238499590@qq.com` 或 `sse_sub` 为 `561`；
- 确认改完 `.env` 后重启过服务；
- 查看 `/admin/v1/me` 与日志。

### 方式 A2：邮箱表单直接验证统一身份（M2M 无感）

登录页的「邮箱 + 密码」表单现在会：

1. 先校验平台本地密码（注册密码 / 初始化管理员密码）；
2. 本地失败后自动用 **学校统一身份 M2M** 校验同一组邮箱密码；
3. 校验通过则自动创建/绑定开发者账号并登录，不需要跳转。

所以统一身份创建的账号（如 `3238499590@qq.com`）可以直接在邮箱表单里输入**学校密码**登录。
如果 M2M 未开通或返回不可用，页面会提示改用上方「使用学校统一身份登录」完成跳转授权。

> 前提：`MP_SSO_ENABLED=1` 且 SSO 应用允许调用 `POST /api/oauth/password/verify`
> （内接应用 + 无感开关）。当前实例已验证可用。

### 方式 B：初始化管理员密码

用于首次部署或 SSO 未配置时：

- 地址：`https://applet.ssemarket.cn/admin`
- 账号：`admin@mp.local`
- 密码：`.env` 中的 `MP_ADMIN_PASSWORD`

> 不要把 `.env` 密码写进文档或提交到仓库。

### 方式 C：CLI

CLI 的 `--admin` 登录需要邮箱 + 密码（不能直接走 SSO 浏览器跳转）。
如果 M2M 可用，可以直接用学校密码登录；否则先给账号设置平台密码：

```bash
mp login --email admin@mp.local --password '…' --admin
mp whoami --admin
```

如果希望用 `3238499590@qq.com` 跑 CLI：

1. 先完成一次 UniSSO 登录（方式 A），确保本地账号已存在；
2. 给它设置一个 CLI 密码：

```bash
cd /home/cloud/deploy/mp-service
node --no-warnings scripts/set-admin-password.js \
  --email 3238499590@qq.com \
  --password '你的新密码' \
  --name '内部管理员'
```

如果账号还不存在，可以加 `--create` 直接创建管理员：

```bash
node --no-warnings scripts/set-admin-password.js \
  --email 3238499590@qq.com \
  --password '你的新密码' \
  --create --name '内部管理员'
```

之后：

```bash
mp login --email 3238499590@qq.com --password '你的新密码' --admin
```

> 密码登录与 SSO 登录会绑定到同一个邮箱账号；SSO 仍可直接登录，不需要每次用密码。

---

## 3. 后台能做什么

登录 `/admin` 后：

| 模块 | 功能 |
| --- | --- |
| 概览 | 小程序总数/已发布/待审核、开发者、24h 事件/通知/启动、待处理反馈 |
| 审核队列 | 查看提交版本、通过 / 驳回（原因会展示给开发者） |
| 小程序 | 全部应用、版本、白名单、入口/分类/排序、发布/下架 |
| 开发者 | 查看账号、应用数、停用/启用 |
| 事件 | 主站新帖事件、处理状态 |
| 审计日志 | 审核、密钥查看/重置、应用变更等 |
| 用户反馈 | 查看、标记已处理 |

管理员还可以：

- 创建**官方应用**（可内部托管）；
- 维护 allowlist；
- 审批第三方应用提交；
- 通过 CLI 批量操作。

CLI 管理命令：

```bash
mp admin queue
mp admin overview
mp admin apps --status reviewing
mp admin developers
mp admin approve <appKey> [--note "ok"]
mp admin reject <appKey> --reason "入口无法访问"
mp admin publish <appKey>
mp admin unpublish <appKey>
mp admin create --name "内部工具" --key internal-tool \
  --entry https://applet.ssemarket.cn/ \
  --origins https://applet.ssemarket.cn
```

---

## 4. 内部小程序（平台托管）要管理员做什么

内部托管只允许**官方应用或管理员**：

1. 管理员创建官方应用：

```bash
mp admin create --name "内部工具" --key internal-tool \
  --entry https://applet.ssemarket.cn/ \
  --origins https://applet.ssemarket.cn \
  --scopes profile:read,prefs:read
```

2. 用管理员登录 token 上传构建：

```bash
mp deploy internal internal-tool --dir ./internal-tool
```

3. 提交审核（可管理员自审）：

```bash
mp apps submit internal-tool --changelog "首版"
mp admin approve internal-tool
mp admin publish internal-tool
```

4. 入口形如：

```
https://applet.ssemarket.cn/mp/internal-tool/?source=src_...
```

- 上传接口需要登录 Bearer token（401 未登录）；
- 页面访问需要 `source` token（403 无 token）；
- 用户身份仍由启动 ticket 换 `mp_session`；
- 只允许官方/可信代码，因为与开放平台同源。

完整步骤：[deploy-internal.md](./deploy-internal.md)

---

## 5. 账号管理与安全

### 增加/移除管理员

- **SSO 管理员**：编辑 `.env`：

```bash
MP_SSO_ADMIN_EMAILS=3238499590@qq.com,another@example.com
MP_SSO_ADMIN_IDS=561,another-main-id
```

重启服务后，该邮箱首次 SSO 登录即为 admin；移除后新登录不再提升，但已存在的 admin 角色不会自动降级（需在后台/数据库调整）。

- **本地管理员**：使用 `set-admin-password.js --create` 或已有账号重置密码。

### 停用开发者

后台「开发者」→ 停用；会递增 `token_version`，该账号现有登录立即失效。

### 审计

- 查看 `/admin` → 审计日志；
- 或 `mp admin audit` 暂未提供，直接用后台；
- 关键动作：`admin.app.approve/reject/publish/unpublish`、`app.secret.reveal/rotate`、`app.hosting.activate`。

### 安全建议

- `.env` 与 `data/secrets.json` 权限 0600，单独备份；
- 初始化管理员密码尽早修改；
- 内部托管只给官方/可信应用；
- 不要把 `client_secret`、AppSecret、管理员密码写进前端或文档；
- 审核驳回必须写清原因。

---

## 6. 常见问题

| 现象 | 处理 |
| --- | --- |
| `/admin` 只有密码登录 | 确认新版前端已部署；页面上应有「使用 UniSSO 登录管理后台」 |
| SSO 登录成功但 `/admin` 仍要求登录 | 邮箱不在 `MP_SSO_ADMIN_EMAILS`，或 SSO 返回邮箱与配置不一致；改 `.env` 后重启 |
| CLI `mp login --admin` 401 | 该账号没有本地密码；用初始化管理员，或先 `set-admin-password --create` |
| `mp deploy internal` 403 `INTERNAL_HOSTING_FORBIDDEN` | 应用不是官方应用且当前账号不是管理员；用 `mp admin create` 创建官方应用，或用管理员登录 |
| 上传 401 | CLI 未登录/ token 失效；重新 `mp login` |
| 页面 403 | 缺少/错误 `source` token；从 `mp hosting status` 获取完整 entryURL |
| 审核后 App 看不到 | 应用需处于 published；检查目录接口/可见范围 |
| 管理员账号被停用 | 后台开发者列表启用，或数据库调整；建议保留初始化管理员兜底 |

---

## 7. 账号速查

| 场景 | 用什么 |
| --- | --- |
| 浏览器进管理后台 | `https://applet.ssemarket.cn/admin` → UniSSO（`3238499590@qq.com`） |
| 浏览器兜底登录 | `admin@mp.local` + `.env` 密码 |
| CLI 管理员 | `admin@mp.local` + `.env` 密码，或给 `3238499590@qq.com` 设置密码后使用 |
| App 主站身份 | `oauthid561`（主站 userID 561）；由 App 登录 token 提供 |
| 开发者门户 | `https://applet.ssemarket.cn/#/login`（UniSSO 或邮箱） |

> 本文只写账号标识，不写任何密码。密码位置：`.env`（`MP_ADMIN_PASSWORD`）与 UniSSO。