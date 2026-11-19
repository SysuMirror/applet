/*!
 * 集市小程序页面 SDK v1.1
 * 用法：<script src="https://applet.ssemarket.cn/sdk/mp-client.js"></script>
 *       const session = await MP.ready;
 * 说明：SDK 只持有 app-scoped 的 mp_session，永远不接触主站 token。
 *       - 平台地址默认从本脚本的 src 自动识别，外部页面无需手动配置；
 *       - 跨站页面（例如 mp-app.example.com）浏览器可能拦截第三方 Cookie，
 *         SDK 会把 exchange 返回的 sessionToken 以 X-MP-Session 头发送，
 *         并仅在跨站时暂存到 sessionStorage（随标签页关闭而失效）。
 */
(function () {
  'use strict';

  function detectBase() {
    try {
      var el = document.currentScript;
      if (!el) {
        var all = document.querySelectorAll('script[src*="/sdk/mp-client.js"]');
        el = all[all.length - 1];
      }
      if (el && el.src) return el.src.replace(/\/sdk\/mp-client\.js(?:\?.*)?$/, '');
    } catch (e) { /* ignore */ }
    return '';
  }

  function siteOf(hostname) {
    var parts = String(hostname || '').split('.');
    if (parts.length <= 2 || /^\d+$/.test(parts[parts.length - 1])) return hostname;
    return parts.slice(-2).join('.');
  }

  var config = { base: detectBase(), autoExchange: true };
  var sessionPromise = null;
  var appInfo = null;
  var serverToken = '';
  var TOKEN_KEY = 'mp_session_token';

  function crossSite() {
    try {
      var base = new URL(config.base || location.href, location.href);
      return siteOf(base.hostname) !== siteOf(location.hostname);
    } catch (e) {
      return false;
    }
  }

  function readStoredToken() {
    if (!crossSite()) return '';
    try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function storeToken(token) {
    serverToken = token || '';
    try {
      if (token && crossSite()) sessionStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* ignore */ }
  }

  serverToken = readStoredToken();

  function url(path) {
    return (config.base || '') + path;
  }

  async function request(path, options) {
    options = options || {};
    var init = {
      method: options.method || 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    };
    // 跨站页面 Cookie 可能被浏览器拦截；带会话头同时兼容同站场景
    if (serverToken) init.headers['X-MP-Session'] = serverToken;
    if (options.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    var res = await fetch(url(path), init);
    var type = res.headers.get('content-type') || '';
    var data = type.indexOf('json') >= 0 ? await res.json() : await res.text();
    if (!res.ok) {
      var err = new Error((data && data.message) || ('请求失败 ' + res.status));
      err.status = res.status;
      err.code = data && data.code;
      err.requestId = data && data.requestId;
      throw err;
    }
    return data;
  }

  function ticketFromLocation() {
    try {
      return new URLSearchParams(location.search).get('ticket') || '';
    } catch (e) {
      return '';
    }
  }

  async function exchange(ticket) {
    var data = await request('/v1/sessions/exchange', { method: 'POST', body: { ticket: ticket } });
    appInfo = data.app;
    storeToken(data.sessionToken || '');
    return data.session;
  }

  async function boot() {
    var ticket = ticketFromLocation();
    if (ticket && config.autoExchange) {
      var session = await exchange(ticket);
      // 从地址栏移除一次性票据，避免被复制或进入历史记录
      try {
        var next = new URL(location.href);
        next.searchParams.delete('ticket');
        history.replaceState(null, '', next.pathname + next.search + next.hash);
      } catch (e) { /* ignore */ }
      return session;
    }
    var me;
    try {
      me = await request('/v1/sessions/me');
    } catch (err) {
      if (err.status === 401) storeToken('');
      throw err;
    }
    appInfo = me.app;
    return me.session;
  }

  function ready() {
    if (!sessionPromise) {
      sessionPromise = boot().catch(function (err) {
        sessionPromise = null;
        throw err;
      });
    }
    return sessionPromise;
  }

  var prefs = {
    get: function () { return request('/v1/me/prefs'); },
    put: function (data) { return request('/v1/me/prefs', { method: 'PUT', body: data }); },
    addFavorite: function (appKey) {
      return prefs.get().then(function (data) {
        var keys = (data.favorites || []).map(function (item) { return item.appKey; });
        if (keys.indexOf(appKey) < 0) keys.push(appKey);
        return prefs.put({ favorites: keys });
      });
    },
    removeFavorite: function (appKey) {
      return prefs.get().then(function (data) {
        var keys = (data.favorites || [])
          .map(function (item) { return item.appKey; })
          .filter(function (key) { return key !== appKey; });
        return prefs.put({ favorites: keys });
      });
    },
  };

  function share(payload) {
    var message = { type: 'mp.event', event: 'share', payload: payload || {} };
    try {
      if (window.parent && window.parent !== window) window.parent.postMessage(message, '*');
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mpBridge) {
        window.webkit.messageHandlers.mpBridge.postMessage(message);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function emit(event, payload) {
    try {
      window.dispatchEvent(new CustomEvent('mp:' + event, { detail: payload }));
    } catch (e) { /* ignore */ }
  }

  window.MP = {
    version: '1.0.0',
    configure: function (options) {
      Object.assign(config, options || {});
      return window.MP;
    },
    ready: null,
    request: request,
    get: function (path) { return request(path); },
    post: function (path, body) { return request(path, { method: 'POST', body: body }); },
    put: function (path, body) { return request(path, { method: 'PUT', body: body }); },
    del: function (path) { return request(path, { method: 'DELETE' }); },
    session: function () { return ready(); },
    app: function () { return appInfo; },
    // 交给小程序自己的服务端校验；仅在本次 ticket 交换后可用
    serverToken: function () { return serverToken; },
    prefs: prefs,
    share: share,
    emit: emit,
    on: function (event, handler) {
      window.addEventListener('mp:' + event, function (e) { handler(e.detail); });
    },
    exchange: exchange,
  };

  Object.defineProperty(window.MP, 'ready', {
    get: function () { return ready(); },
    configurable: true,
  });

  // 带平台票据（lt_...）打开时自动换会话：
  // 页面只需要引入本脚本，不必额外写初始化代码；失败只告警，不影响页面自身启动。
  var initialTicket = ticketFromLocation();
  if (config.autoExchange && initialTicket.indexOf('lt_') === 0) {
    ready().catch(function (err) {
      try {
        console.warn('[mp-sdk] session exchange failed:', (err && (err.code || err.message)) || err);
      } catch (e) { /* ignore */ }
    });
  }
})();