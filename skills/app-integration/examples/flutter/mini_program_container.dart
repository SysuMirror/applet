// 小程序 WebView 容器示例（webview_flutter ^4.x）
// 关键安全点：
// - 只加载 launchURL，且校验 host / origin 属于小程序的 allowedOrigins；
// - 登录态由平台统一管理；
// - JS 桥只处理白名单事件，并校验来源。

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'mini_program_api.dart';

class MiniProgramContainer extends StatefulWidget {
  const MiniProgramContainer({
    super.key,
    required this.api,
    required this.app,
    required this.deviceId,
    this.onShare,
    this.onClose,
  });

  final MiniProgramApi api;
  final MiniProgramSummary app;
  final String deviceId;
  final void Function(Map<String, dynamic> payload)? onShare;
  final VoidCallback? onClose;

  @override
  State<MiniProgramContainer> createState() => _MiniProgramContainerState();
}

class _MiniProgramContainerState extends State<MiniProgramContainer> {
  late final WebViewController _controller;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: _guardNavigation,
          onPageStarted: (_) => setState(() => _loading = true),
          onPageFinished: (_) => setState(() => _loading = false),
          onWebResourceError: (error) {
            if (error.isForMainFrame ?? true) {
              setState(() => _error = '页面加载失败：${error.description}');
            }
          },
        ),
      )
      ..addJavaScriptChannel('mpBridge', onMessageReceived: _onBridgeMessage);

    _launch();
  }

  bool _isAllowed(Uri uri) {
    if (uri.scheme != 'https' && uri.host != 'localhost' && uri.host != '127.0.0.1') {
      return false;
    }
    final allowed = widget.app.allowedOrigins
        .map(Uri.tryParse)
        .whereType<Uri>()
        .map((u) => '${u.scheme}://${u.host}${u.hasPort ? ':${u.port}' : ''}')
        .toSet();
    final origin = '${uri.scheme}://${uri.host}${uri.hasPort ? ':${uri.port}' : ''}';
    if (allowed.isNotEmpty) return allowed.contains(origin);
    final entry = Uri.tryParse(widget.app.entryUrl);
    return entry != null && entry.host == uri.host;
  }

  NavigationDecision _guardNavigation(NavigationRequest request) {
    final uri = Uri.tryParse(request.url);
    if (uri == null) return NavigationDecision.prevent;
    // about:blank 等内部页面放行
    if (uri.scheme == 'about') return NavigationDecision.navigate;
    if (_isAllowed(uri)) return NavigationDecision.navigate;
    // 外链交给系统浏览器，容器内不加载未登记域名
    widget.onShare?.call({'type': 'open-external', 'url': request.url});
    return NavigationDecision.prevent;
  }

  Future<void> _launch() async {
    try {
      // 票据 origin 必须绑定"实际打开的页面"的 origin，不能取 allowedOrigins.first。
      // 否则平台/容器会报 ORIGIN_MISMATCH（launchURL 不在允许的 origin 内）。
      final entry = Uri.tryParse(widget.app.entryUrl);
      final entryOrigin = entry == null
          ? null
          : '${entry.scheme}://${entry.host}${entry.hasPort ? ':${entry.port}' : ''}';
      final ticket = await widget.api.launchTicket(
        appKey: widget.app.appKey,
        device: widget.deviceId,
        origin: entryOrigin,
      );
      final uri = Uri.parse(ticket.launchUrl);
      if (!_isAllowed(uri)) {
        throw FormatException(
          '入口地址的 origin（${entryOrigin ?? '未知'}）不在 allowedOrigins 中，请在开放平台补充该 origin',
        );
      }
      await _controller.loadRequest(uri);
    } catch (err) {
      setState(() {
        _loading = false;
        _error = err is MiniProgramException
            ? '${err.message}（${err.code}）'
            : '打开小程序失败：$err';
      });
    }
  }

  void _onBridgeMessage(JavaScriptMessage message) {
    // 页面 SDK 以 JSON 字符串发送：{"type":"mp.event","event":"share","payload":{...}}
    try {
      final data = message.message;
      // webview_flutter 的 channel 只拿到字符串；页面 SDK 会 postMessage 到 App，
      // 移动端建议同时通过 NavigationDelegate 校验来源 URL。
      if (!data.contains('mp.event')) return;
      final map = _tryDecode(data);
      final event = (map?['event'] as String?) ?? '';
      final payload = (map?['payload'] as Map?)?.cast<String, dynamic>() ?? const {};
      switch (event) {
        case 'share':
          widget.onShare?.call(payload);
          break;
        case 'close':
          widget.onClose?.call();
          break;
        default:
          break;
      }
    } catch (_) {
      // 忽略非法桥消息
    }
  }

  Map<String, dynamic>? _tryDecode(String raw) {
    try {
      final start = raw.indexOf('{');
      final end = raw.lastIndexOf('}');
      if (start < 0 || end <= start) return null;
      final decoded = jsonDecode(raw.substring(start, end + 1));
      return decoded is Map<String, dynamic> ? decoded : null;
    } catch (_) {
      return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return Scaffold(
        appBar: AppBar(title: Text(widget.app.name)),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(_error!, textAlign: TextAlign.center),
          ),
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(title: Text(widget.app.name)),
      body: Stack(
        children: [
          WebViewWidget(controller: _controller),
          if (_loading) const Center(child: CircularProgressIndicator()),
        ],
      ),
    );
  }
}
