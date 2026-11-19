# 集市小程序开放平台 · App 接入 Skill

把本目录整体复制到你的工程即可被 Claude Code 识别：

```bash
mkdir -p .claude/skills
cp -r mp-app-integration .claude/skills/
```

然后在对话里说「按 mp-app-integration 接入小程序平台」即可。

## 包含内容

| 文件 | 用途 |
| --- | --- |
| `SKILL.md` | 入口：最短接入路径、硬性约束、错误码 |
| `references/api-reference.md` | 全部接口字段与响应 |
| `references/integration-guide.md` | 容器时序、桥消息、推送兜底、迁移 |
| `references/security-checklist.md` | 上线前检查清单 |
| `examples/flutter/mini_program_api.dart` | Flutter API 客户端 |
| `examples/flutter/mini_program_container.dart` | WebView 容器（origin 白名单、无 token 注入） |
| `examples/web/mp-client.js` | 页面 SDK（同平台 `/sdk/mp-client.js`） |
| `examples/server/signature.mjs` | 第三方服务端 HMAC 签名 |
| `examples/server/new-post-outbox.mjs` | 主站 outbox 事件推送 worker |
| `scripts/smoke.mjs` | 真实 token 冒烟测试 |

## 先跑通冒烟

```bash
MP_BASE=https://applet.ssemarket.cn \
MP_TOKEN=<主站 access token> \
MP_APP_KEY=novel \
node scripts/smoke.mjs
```

依次验证：目录 → 打开小程序 → 登录会话 → 偏好 → 重复打开被拒绝。

## 约定

- 平台地址不要硬编码，通过构建配置注入。
- 小程序登录由平台统一处理：已登录统一身份时自动登录，未登录时展示内置授权页。
- 用户授权一次后，所有小程序通用；页面不要自己实现邮箱/密码登录。
- 接口契约以 `references/api-reference.md` 与平台 `/openapi.yaml` 为准。
