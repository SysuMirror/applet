// 集市小程序开放平台 · Flutter 客户端示例
// 依赖：http ^1.x
//
// 设计要点：
// 1. App 使用主站 access token 申请打开小程序；小程序内的登录由平台处理。
// 2. 所有请求失败都抛出带 code / requestId 的异常，便于埋点与排错。
// 3. 偏好接口支持增量提交（只传 recent 或只传 favorites）。

import 'dart:convert';

import 'package:http/http.dart' as http;

class MiniProgramException implements Exception {
  MiniProgramException(this.status, this.code, this.message, this.requestId);

  final int status;
  final String code;
  final String message;
  final String? requestId;

  @override
  String toString() => 'MiniProgramException($status $code): $message'
      '${requestId == null ? '' : ' [requestId=$requestId]'}';
}

class LaunchTicket {
  LaunchTicket({required this.ticket, required this.launchUrl, required this.expiresIn});

  final String ticket;
  final String launchUrl;
  final int expiresIn;
}

class MiniProgramSummary {
  MiniProgramSummary(this.raw);

  final Map<String, dynamic> raw;

  String get appKey => raw['appKey'] as String;
  String get name => raw['name'] as String;
  String get icon => (raw['icon'] as String?) ?? '';
  String get entryUrl => (raw['entryURL'] as String?) ?? '';
  String get category => (raw['category'] as String?) ?? '';
  List<String> get allowedOrigins =>
      ((raw['allowedOrigins'] as List?) ?? const []).cast<String>();
}

class MiniProgramApi {
  MiniProgramApi({
    required this.baseUrl,
    required this.accessTokenProvider,
    http.Client? client,
    this.deviceId = '',
  }) : _client = client ?? http.Client();

  final String baseUrl;
  final Future<String> Function() accessTokenProvider;
  final http.Client _client;
  final String deviceId;

  Uri _uri(String path, [Map<String, String>? query]) =>
      Uri.parse('${baseUrl.replaceAll(RegExp(r'/+$'), '')}$path')
          .replace(queryParameters: query);

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? body,
    bool auth = true,
  }) async {
    final headers = <String, String>{'Accept': 'application/json'};
    if (auth) headers['Authorization'] = 'Bearer ${await accessTokenProvider()}';
    if (body != null) headers['Content-Type'] = 'application/json';

    final request = http.Request(method, _uri(path, query))..headers.addAll(headers);
    if (body != null) request.body = jsonEncode(body);

    final streamed = await _client.send(request);
    final response = await http.Response.fromStream(streamed);
    final dynamic decoded = response.body.isEmpty ? null : jsonDecode(response.body);
    if (response.statusCode >= 400) {
      final map = decoded is Map<String, dynamic> ? decoded : const <String, dynamic>{};
      throw MiniProgramException(
        response.statusCode,
        (map['code'] as String?) ?? 'HTTP_ERROR',
        (map['message'] as String?) ?? '请求失败',
        map['requestId'] as String?,
      );
    }
    return decoded is Map<String, dynamic> ? decoded : <String, dynamic>{};
  }

  /// 小程序目录（App 下拉面板）。
  Future<List<MiniProgramSummary>> catalog({String? category, String? cursor, int limit = 20}) async {
    final data = await _request('GET', '/v1/apps', query: {
      if (category != null) 'category': category,
      if (cursor != null) 'cursor': cursor,
      'limit': '$limit',
    });
    return ((data['items'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(MiniProgramSummary.new)
        .toList();
  }

  Future<List<MiniProgramSummary>> search(String query, {int limit = 20}) async {
    final data = await _request('GET', '/v1/search', query: {'q': query, 'limit': '$limit'});
    return ((data['items'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(MiniProgramSummary.new)
        .toList();
  }

  /// 申请一次性启动票据，返回的 launchUrl 交给 WebView。
  Future<LaunchTicket> launchTicket({
    required String appKey,
    String? device,
    String? origin,
  }) async {
    final data = await _request('POST', '/v1/launch-tickets', body: {
      'appKey': appKey,
      if ((device ?? deviceId).isNotEmpty) 'deviceID': device ?? deviceId,
      if (origin != null) 'origin': origin,
    });
    return LaunchTicket(
      ticket: data['ticket'] as String,
      launchUrl: data['launchURL'] as String,
      expiresIn: (data['expiresIn'] as num?)?.toInt() ?? 60,
    );
  }

  Future<Map<String, dynamic>> prefs() => _request('GET', '/v1/me/prefs');

  /// 只传需要修改的字段；recent 为新→旧顺序。
  Future<Map<String, dynamic>> updatePrefs({
    List<String>? recent,
    List<String>? favorites,
  }) =>
      _request('PUT', '/v1/me/prefs', body: {
        if (recent != null) 'recent': recent,
        if (favorites != null) 'favorites': favorites,
      });

  Future<void> registerDevice({
    required String deviceId,
    required String platform,
    required String pushProvider,
    String pushToken = '',
    String appVersion = '',
    bool notificationEnabled = true,
    String locale = 'zh-CN',
  }) =>
      _request('POST', '/v1/devices', body: {
        'deviceID': deviceId,
        'platform': platform,
        'pushProvider': pushProvider,
        'pushToken': pushToken,
        'appVersion': appVersion,
        'notificationEnabled': notificationEnabled,
        'locale': locale,
      });

  Future<void> deleteDevice(String deviceId) =>
      _request('DELETE', '/v1/devices/${Uri.encodeComponent(deviceId)}');

  Future<void> updateSubscriptions({
    bool enabled = true,
    String? quietFrom,
    String? quietTo,
  }) =>
      _request('PUT', '/v1/me/subscriptions', body: {
        'topics': [
          {
            'topic': 'new_posts',
            'enabled': enabled,
            'quietHours': quietFrom != null && quietTo != null
                ? {'from': quietFrom, 'to': quietTo}
                : null,
          }
        ]
      });

  /// 推送不可用时的兜底轮询；建议 60 秒一次。
  Future<Map<String, dynamic>> pollNewPosts({DateTime? since, int limit = 30}) =>
      _request('GET', '/v1/events/new-posts', query: {
        if (since != null) 'since': since.toUtc().toIso8601String(),
        'limit': '$limit',
      });

  Future<void> feedback(String content, {String? appKey, String? contact}) =>
      _request('POST', '/v1/feedback', body: {
        'content': content,
        if (appKey != null) 'appKey': appKey,
        if (contact != null) 'contact': contact,
      });

  void dispose() => _client.close();
}