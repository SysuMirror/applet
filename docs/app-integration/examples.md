# 联调与代码示例

> 配套：[api.md](./api.md) · [features.md](./features.md)  
> 完整 Flutter 客户端与容器实现见 `skills/app-integration/examples/flutter/`。

---

## 1. cURL 快速联调

```bash
MP_BASE=http://localhost:8080
TOKEN=$(node --no-warnings scripts/mint-token.js --user 561)

# 目录
curl -s "$MP_BASE/v1/apps?limit=20" -H "Authorization: Bearer $TOKEN" | jq

# 分类 / 搜索
curl -s "$MP_BASE/v1/categories"
curl -s "$MP_BASE/v1/search?q=%E5%B0%8F%E8%AF%B4" -H "Authorization: Bearer $TOKEN"

# 申请票据
curl -s -X POST "$MP_BASE/v1/launch-tickets" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"appKey":"novel","deviceID":"dev_demo","origin":"http://localhost:8080"}' | tee /tmp/lt.json

# 换会话（模拟页面；保存 Cookie）
TICKET=$(jq -r .ticket /tmp/lt.json)
curl -s -c /tmp/mp.cookies -X POST "$MP_BASE/v1/sessions/exchange" \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:8080' \
  -d "{\"ticket\":\"$TICKET\"}"

# 页面侧偏好
curl -s -b /tmp/mp.cookies "$MP_BASE/v1/me/prefs"

# App 侧偏好
curl -s "$MP_BASE/v1/me/prefs" -H "Authorization: Bearer $TOKEN"
curl -s -X PUT "$MP_BASE/v1/me/prefs" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"favorites":["novel","ranking"]}'

# 设备注册
curl -s -X POST "$MP_BASE/v1/devices" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"deviceID":"dev_demo","platform":"android","pushProvider":"fcm","pushToken":"token","appVersion":"1.0.0"}'

# 订阅 + 轮询
curl -s -X PUT "$MP_BASE/v1/me/subscriptions" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"topics":[{"topic":"new_posts","enabled":true,"quietHours":{"from":"23:00","to":"07:00"}}]}'
curl -s "$MP_BASE/v1/events/new-posts?limit=10" -H "Authorization: Bearer $TOKEN"
```

---

## 2. Flutter：API 客户端骨架

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

class MpApi {
  MpApi({
    required this.baseUrl,
    required this.tokenProvider,
    required this.deviceId,
    http.Client? client,
  }) : _client = client ?? http.Client();

  final String baseUrl;
  final Future<String> Function() tokenProvider; // 主站 access token
  final String deviceId;
  final http.Client _client;

  Uri _uri(String path, [Map<String, String>? query]) =>
      Uri.parse('$baseUrl$path').replace(queryParameters: query);

  Future<dynamic> _send(String method, String path,
      {Map<String, dynamic>? body, Map<String, String>? query}) async {
    final req = http.Request(method, _uri(path, query))
      ..headers['Authorization'] = 'Bearer ${await tokenProvider()}'
      ..headers['Accept'] = 'application/json';
    if (body != null) req.headers['Content-Type'] = 'application/json';
    if (body != null) req.body = jsonEncode(body);

    final res = await http.Response.fromStream(await _client.send(req));
    final data = res.body.isEmpty ? null : jsonDecode(res.body);
    if (res.statusCode >= 400) {
      throw MpException(
        res.statusCode,
        data is Map ? (data['code'] as String?) : null,
        data is Map ? (data['message'] as String?) : null,
        data is Map ? (data['requestId'] as String?) : null,
      );
    }
    return data;
  }

  Future<List<Map<String, dynamic>>> catalog({String? cursor}) async {
    final data = await _send('GET', '/v1/apps', query: {
      'limit': '20',
      if (cursor != null) 'cursor': cursor,
    });
    return (data['items'] as List).cast<Map<String, dynamic>>();
  }

  Future<Map<String, dynamic>> launchTicket(String appKey, String origin) =>
      _send('POST', '/v1/launch-tickets', body: {
        'appKey': appKey,
        'deviceID': deviceId,
        'origin': origin,
      });

  Future<Map<String, dynamic>> prefs() => _send('GET', '/v1/me/prefs');

  Future<Map<String, dynamic>> updateFavorites(List<String> keys) =>
      _send('PUT', '/v1/me/prefs', body: {'favorites': keys});

  Future<void> registerDevice({
    required String platform,
    required String provider,
    String pushToken = '',
    bool enabled = true,
  }) =>
      _send('POST', '/v1/devices', body: {
        'deviceID': deviceId,
        'platform': platform,
        'pushProvider': provider,
        'pushToken': pushToken,
        'notificationEnabled': enabled,
      });

  Future<Map<String, dynamic>> pollNewPosts(DateTime? since) =>
      _send('GET', '/v1/events/new-posts', query: {
        if (since != null) 'since': since.toUtc().toIso8601String(),
        'limit': '30',
      });
}

class MpException implements Exception {
  MpException(this.status, this.code, this.message, this.requestId);
  final int status;
  final String? code;
  final String? message;
  final String? requestId;
  @override
  String toString() => 'MpException($status $code): $message [$requestId]';
}
```

---

## 3. 打开小程序（Flutter）

```dart
Future<void> openMiniProgram(MpApi api, Map<String, dynamic> app) async {
  // 1) 申请票据
  String originOf(Uri u) =>
      '${u.scheme}://${u.host}${u.hasPort ? ':${u.port}' : ''}';

  final ticket = await api.launchTicket(
    app['appKey'] as String,
    originOf(Uri.parse(app['entryURL'] as String)),
  );

  final launchUrl = Uri.parse(ticket['launchURL'] as String);

  // 2) 校验 URL：HTTPS + allowedOrigins
  final allowed = (app['allowedOrigins'] as List)
      .map((e) => Uri.parse(e as String))
      .map(originOf)
      .toSet();
  final origin = originOf(launchUrl);
  if (launchUrl.scheme != 'https' && launchUrl.host != 'localhost') {
    throw Exception('launchURL 必须为 HTTPS');
  }
  if (allowed.isNotEmpty && !allowed.contains(origin)) {
    throw Exception('launchURL 不在 allowedOrigins 内');
  }

  // 3) 打开小程序页面
  // 官方 /mp/ 页面：容器注入短时效 access token（__SSE_MAIN_TOKEN__），无感复用 App 登录态。
  // 第三方页面：用 ticket 调 /v1/sessions/exchange 换 HttpOnly Cookie。
  // controller.loadRequest(launchUrl);
}
```

**容器注意**

- 在 `onNavigationRequest` 中拦截并校验 origin，未登记外链交给系统浏览器。
- 官方小程序复用 App 注入 token；第三方小程序使用平台会话与内置登录页。页面都不要自行保存主站密码。
- JS 桥只处理 `share` / `close` / `open-url`，并校验来源页面。

完整容器见 `skills/app-integration/examples/flutter/mini_program_container.dart`。

---

## 4. 偏好：收藏切换（乐观更新 + 回滚）

```dart
Future<void> toggleFavorite(
  MpApi api,
  Map<String, dynamic> app,
  List<String> currentKeys,
  void Function(List<String>) apply,
) async {
  final key = app['appKey'] as String;
  final next = currentKeys.contains(key)
      ? (currentKeys..remove(key))
      : ([...currentKeys, key]);

  apply(next); // 先更新 UI
  try {
    final data = await api.updateFavorites(next);
    apply((data['favorites'] as List)
        .map((e) => e['appKey'] as String)
        .toList()); // 以服务端为准
  } catch (e) {
    apply(currentKeys); // 回滚
    rethrow;
  }
}
```

---

## 5. 推送 token 上报

```dart
Future<void> onPushToken(String token, String platform, String provider, bool enabled) async {
  await api.registerDevice(
    platform: platform,       // android / ohos / ios / windows
    provider: provider,       // fcm / hms / apns / wns / local
    pushToken: token,
    enabled: enabled,
  );
}
```

- token 轮换、登录、启动、通知开关变化时调用。
- 登出时：

```dart
await api.deleteDevice(deviceId); // DELETE /v1/devices/{deviceID}
```

---

## 6. 新帖兜底轮询

```dart
Timer? _pollTimer;
DateTime? _lastSeen;

void startPolling() {
  _pollTimer?.cancel();
  _pollTimer = Timer.periodic(const Duration(seconds: 60), (_) async {
    try {
      final data = await api.pollNewPosts(_lastSeen);
      final items = (data['items'] as List).cast<Map<String, dynamic>>();
      if (items.isNotEmpty) {
        _lastSeen = DateTime.parse(items.first['createdAt'] as String);
        showInAppNotifications(items); // 按 eventId 去重
      }
      updateBadge(data['unread'] as int? ?? 0);
    } on MpException catch (e) {
      if (e.status == 429) {
        // 读取 Retry-After，暂停更久
      }
    } catch (_) {
      // 网络错误：下一轮再试
    }
  });
}

void stopPolling() => _pollTimer?.cancel();
```

---

## 7. 错误处理建议

```dart
Future<T> guard<T>(Future<T> Function() action) async {
  try {
    return await action();
  } on MpException catch (e) {
    switch (e.code) {
      case 'UNAUTHORIZED':
      case 'TOKEN_EXPIRED':
      case 'INVALID_TOKEN':
        await refreshMainToken();
        return await action(); // 只重试一次
      case 'TICKET_EXPIRED':
      case 'TICKET_USED':
        throw MiniProgramLaunchError('启动超时，请重试');
      case 'APP_UNAVAILABLE':
        throw MiniProgramLaunchError('小程序已下线');
      case 'RATE_LIMITED':
        throw MiniProgramLaunchError('操作过于频繁，请稍后再试');
      default:
        throw MiniProgramLaunchError(e.message ?? '服务异常');
    }
  }
}
```

---

## 8. 本地演示

- 目录：`http://localhost:8080/v1/apps`（需 token）
- 演示小程序：`/demo/app?app=novel`
- 启动页：`/launch?ticket=...`
- 页面 SDK：`/sdk/mp-client.js`
- 本地 token：`node --no-warnings scripts/mint-token.js --user 561 --ttl 86400`
- 冒烟脚本：`MP_BASE=... MP_TOKEN=... node skills/app-integration/scripts/smoke.mjs`