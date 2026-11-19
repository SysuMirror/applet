/*!
 * 集市小程序页面 SDK v1.0
 * 用法：<script src="https://mp-api.example.com/sdk/mp-client.js"></script>
 *       const session = await MP.ready;
 * 说明：SDK 使用平台提供的小程序会话，登录由平台统一处理。
 */
(function () {
  'use strict';

  var config = { base: '', autoExchange: true };
  var sessionPromise = null;
  var appInfo = null;
  var serverToken = '';

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
    serverToken = data.sessionToken || '';
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
    var me = await request('/v1/sessions/me');
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
})();