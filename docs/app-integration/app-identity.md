# 官方小程序：App 身份复用与内置登录样式

> 适用对象：平台内部托管、路径为 `https://applet.ssemarket.cn/mp/<appKey>/` 的官方小程序
> 目标：用户在 App 里已登录时，小程序无感复用 App 身份；未登录时可以在小程序自己的窗口里登录，不跳回主 App。
> **平台提供的是登录能力，不是强制登录方式**：开发者可以继续使用自己的账号体系、学校统一身份或其他登录方式，只要遵守本文的安全边界。
> 第三方外部小程序不适用主站 token 注入约定，请使用平台 `mp_session` / OAuth 或自有登录。

## 1. 身份解析顺序

官方小程序页面按下面的顺序解析当前用户，任意一步成功就停止：

| 顺序 | 来源 | 适用场景 | 页面要做的事 |
| --- | --- | --- | --- |
| 1 | App 注入的主站 access token | Android / iOS / HarmonyOS 的 App 内 WebView、独立 Activity | 读取 `window.__SSE_MAIN_TOKEN__`，或监听 `sse-main-token` 事件 |
| 2 | `.ssemarket.cn` 共享 SSO Cookie | Windows / Linux / Web 的独立浏览器窗口，或 App 注入失败 | `POST /mp-api/auth/sso/try`，`credentials: 'include'` |
| 3 | 小程序页面内账号密码登录 | 前两步都没有会话 | `POST /mp-api/auth/login`，失败再回退 `POST /auth/sso/m2m` |
| 4 | 游客页 | 用户点「暂不登录」 | 显示完整可读的说明页，不进入受保护路由，避免反复重定向 |

关键点：

- 登录卡片渲染在**小程序自己的页面/窗口里**，不是 App 主窗口的弹窗；
- 点击小程序图标后，App 立即打开独立 Activity / 独立窗口，不等待登录；
- 没登录也能看到页面（登录卡片或游客页），不会白屏或一直转圈；
- 登录一次后，同一 `applet.ssemarket.cn` 源下的六个小程序共享登录态。

### 1.1 登录方式是可选的

上面的顺序是**平台推荐的无感体验**，不是强制要求：

- 开发者可以继续用自己的账号体系、学校统一身份、邮箱验证码或其他登录方式；
- 使用自有登录时，页面自己维护会话，不要依赖 `__SSE_MAIN_TOKEN__`，也不要把主站密码交给第三方服务；
- 平台只提供三类能力：App 身份注入、共享 SSO Cookie 探测、小程序会话 `mp_session`；
- 官方页面建议使用统一的登录卡片样式，第三方页面可以使用平台登录页或自有登录页；
- 无论用哪种方式，登录成功后都必须回到用户原来要访问的页面（见 1.2）。

### 1.2 登录后如何回到原页面

登录页只做一件事：记住用户原本要去的路径，登录成功后 `replace` 回去，不留在登录页、不跳主站。

```text
用户打开 /mp/media/novel/123
        │
        ├─ 已登录 → 直接进入 /mp/media/novel/123
        │
        └─ 未登录 → /mp-login?redirect=%2Fnovel%2F123
                          │
                          ├─ App 注入 token 成功 → replace('/novel/123')
                          ├─ 共享 SSO 成功      → replace('/novel/123')
                          └─ 卡片登录成功       → replace('/novel/123')
```

页面实现要点：

```js
// 1) 路由守卫：只接受站内绝对路径，避免开放重定向
const raw = String(route.query.redirect || '')
const target = raw.startsWith('/') && !raw.startsWith('//')
  ? raw
  : '/media'                         // 没有 redirect 时回小程序首页

// 2) 登录成功后替换当前历史，用户按返回不会回到登录页
await router.replace(target)
```

- `redirect` 必须限制为同源绝对路径；`//evil.com`、`https://evil.com` 一律丢弃；
- 用 `replace` 而不是 `push`，避免登录页留在返回栈；
- 游客页不执行跳转；用户点「登录并授权」后再走上面的流程；
- 第三方自有登录页同样应保留 `redirect` 参数并在成功后回跳；
- 从 App 直接注入 token 时不会经过 `/mp-login`，路由守卫看到已登录会直接放行原路径。

## 2. App 容器注入 token（官方内部小程序）

App 在页面开始加载和加载完成时各注入一次。只注入 access token，**不注入 refresh token**，页面只放在内存里，不写 `localStorage`。

### 2.1 注入约定

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `window.__SSE_MAIN_TOKEN__` | `string` | 当前主站 access token |
| `window.__setSSEAppToken(token)` | `function` | 页面已加载后再注入时调用 |
| `sse-main-token` | `Event` | 注入完成后派发，页面据此结束等待 |

### 2.2 Android（独立 Activity 的 WebView）

```kotlin
private fun injectMainToken(url: String) {
    if (!url.contains("applet.ssemarket.cn/mp/") || token.isEmpty()) return
    val encoded = JSONObject.quote(token)
    val js = """
        (function(){
          try {
            var t = $encoded;
            window.__SSE_MAIN_TOKEN__ = t;
            if (typeof window.__setSSEAppToken === 'function') window.__setSSEAppToken(t);
            window.dispatchEvent(new Event('sse-main-token'));
          } catch(e) {}
        })();
    """.trimIndent()
    webView.evaluateJavascript(js, null)
}
```

调用时机：`WebViewClient.onPageStarted` 与 `onPageFinished` 各一次。

### 2.3 Flutter（内嵌 WebView）

```dart
Future<void> injectMainToken(WebViewController controller, String url, String token) async {
  if (!url.startsWith('https://applet.ssemarket.cn/mp/') || token.isEmpty) return;
  final encoded = jsonEncode(token);
  await controller.runJavaScript('''
(function(){
  try {
    var t = $encoded;
    window.__SSE_MAIN_TOKEN__ = t;
    if (typeof window.__setSSEAppToken === 'function') window.__setSSEAppToken(t);
    window.dispatchEvent(new Event('sse-main-token'));
  } catch(e) {}
})();
''');
}
```

### 2.4 桌面端独立窗口

Windows / Linux 使用 Edge/Chrome 的 `--app=<launchURL>` 打开独立窗口，无法直接执行注入脚本。页面会自动进入第 2 步（共享 SSO Cookie），没有 Cookie 时显示第 3 步的登录卡片。

## 3. 页面侧初始化

```js
const isMiniApp = /^\/mp\//.test(location.pathname)

async function waitForInjectedToken(ms = 1200) {
  if (window.__SSE_MAIN_TOKEN__) return window.__SSE_MAIN_TOKEN__
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.removeEventListener('sse-main-token', finish)
      resolve(window.__SSE_MAIN_TOKEN__ || '')
    }
    window.addEventListener('sse-main-token', finish)
    setTimeout(finish, ms)
  })
}

async function silentSso() {
  const res = await fetch('/mp-api/auth/sso/try', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!res.ok) return null
  const json = await res.json()
  return json?.data?.token ? json.data : null
}
```

注意：

- `/mp-api` 是 applet 域名到主站 API 的同源反代前缀，页面里不要写死 `https://ssemarket.cn/api`；
- 注入 token 只保存在内存，刷新页面后由 App 容器重新注入；
- 页面内账号登录成功后，access token 同样只放内存，refresh token 是否持久化由主站 `rememberMe` 策略决定。

## 4. 内置登录卡片样式

参考实现：官方小程序共享的 `MiniProgramLoginView`。六个官方小程序使用同一张卡片，只在标题和说明文案上区分。

### 4.1 视觉规范

| 项目 | 值 |
| --- | --- |
| 页面背景 | `#f6f7f9` + 顶部 `rgba(79,110,247,.10)` 径向渐变 |
| 卡片宽度 | 最大 `360px`，左右留白至少 `24px` |
| 卡片圆角 | `20px` |
| 卡片阴影 | `0 18px 50px rgba(15,23,42,.09)` |
| 主色 | `#3d5be0`，渐变 `#5b7cfa → #3d5be0` |
| 输入框 | 高 `40px`，圆角 `10px`，聚焦边框 `#3d5be0` |
| 主按钮 | 高 `42px`，圆角 `11px`，字号 `15px`，字重 `600` |
| 辅助文字 | `11–12.5px`，颜色 `#6b7280` / `#9ca3af` |
| Logo | `62 × 62`，圆角 `18px`，显示小程序名首字 |

### 4.2 结构

```html
<div class="mp-login">
  <div class="mp-login__card">
    <div class="mp-login__logo"><span>音</span></div>
    <h1>音乐视频</h1>
    <p class="mp-login__desc">登录并授权使用集市账号<br>一次登录，全部小程序通用</p>

    <label class="mp-login__field">
      <span>邮箱 / 统一身份账号</span>
      <input type="email" autocomplete="username" placeholder="集市邮箱 / 学号邮箱">
    </label>
    <label class="mp-login__field">
      <span>密码</span>
      <input type="password" autocomplete="current-password" placeholder="密码">
    </label>

    <button class="mp-login__primary">登录并授权</button>
    <p class="mp-login__hint">密码只用于本次登录，不会保存到小程序页面</p>
    <button class="mp-login__ghost">暂不登录</button>
  </div>
  <p class="mp-login__brand">软工集市 · 小程序</p>
</div>
```

### 4.3 状态

| 状态 | 展示 |
| --- | --- |
| 检测登录中 | 卡片内显示 14px 旋转指示器 + 「正在检查登录状态…」 |
| App 注入成功 | 不显示卡片，直接进入目标页 |
| SSO 静默成功 | 不显示卡片，直接进入目标页 |
| 未登录 | 显示登录卡片 |
| 登录失败 | 卡片顶部红色提示条，保留输入内容 |
| 暂不登录 | 切换为游客说明页，提供「登录并授权」返回按钮 |

### 4.4 文案要求

- 标题使用小程序名称，不写「登录」；
- 说明固定为「登录并授权使用集市账号 / 一次登录，全部小程序通用」；
- 主按钮「登录并授权」，次按钮「暂不登录」；
- 不出现「跳转主站」「打开 App」等让用户离开当前窗口的措辞。

## 5. 接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/mp-api/auth/login` | 主站邮箱密码登录，返回 access token + refresh token |
| `POST` | `/mp-api/auth/sso/try` | 共享 SSO Cookie 静默登录 |
| `POST` | `/auth/sso/m2m` | 统一身份邮箱密码 M2M 登录（主站登录失败时回退） |
| `GET` | `/mp-api/info` | 用 access token 拉当前用户资料 |

密码字段按主站既有规则使用 AES 加密后提交，页面不要自行发明加密方式。

这些接口是平台提供的可选登录方式；使用自有登录的页面不需要调用。只要登录成功后的页面能自行维护身份，平台不会强制接管。

## 6. 安全边界

- 只对 `https://applet.ssemarket.cn/mp/` 官方路径注入 token；
- 只注入短时效 access token，不注入 refresh token；
- 不把注入的 token 写入 Cookie / `localStorage` / URL；
- 页面关闭或切换账号后，App 重新注入或清空 WebView；
- 第三方小程序仍使用平台 `mp_session`，不得要求 App 注入主站 token；
- `allowedOrigins` 必须包含 `https://applet.ssemarket.cn`，否则票据校验会返回 `ORIGIN_MISMATCH`。

## 7. 排错

| 现象 | 检查 |
| --- | --- |
| 已登录 App，小程序仍显示登录卡片 | App 是否在 `onPageStarted` 注入；URL 是否以 `/mp/` 开头；token 是否为空 |
| 页面一直「正在检查登录状态」 | `/mp-api/auth/sso/try` 是否超时；页面是否等待注入事件超过 1.2s |
| 登录成功但接口 401 | token 是否写入页面状态；请求是否带 `Authorization: Bearer` |
| Windows 独立窗口没有登录态 | 浏览器是否有 `.ssemarket.cn` Cookie；没有则显示登录卡片属预期 |
| 跳回主 App 登录页 | 页面路由守卫是否把小程序误判为主站页面 |