#!/usr/bin/env node
/**
 * 小程序入口预检（外部托管用，无第三方依赖，Node 22+）。
 *
 * 用法：
 *   node preflight.mjs https://mp-app.example.com/my-app
 *   node preflight.mjs https://mp-app.example.com/my-app --app my-app --token <devToken>
 *   MP_BASE=https://applet.ssemarket.cn node preflight.mjs <url>
 *
 * 检查：HTTPS、状态码、重定向后的 origin、HTML、viewport、SDK 引用、CSP、
 *       以及与平台登记配置（entryURL / allowedOrigins / 发布状态）的一致性。
 * 注意：SDK 缺失、CSP 未放行只算 WARN（页面可能手动换会话）；
 *       不可访问、非 HTTPS、origin 与登记不一致算 FAIL（退出码 1）。
 */
import process from 'node:process';

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (!a.startsWith('--')) { positional.push(a); continue; }
  const eq = a.indexOf('=');
  if (eq > 0) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
  const next = args[i + 1];
  if (next !== undefined && !next.startsWith('--')) { flags[a.slice(2)] = next; i += 1; }
  else flags[a.slice(2)] = true;
}

const base = String(flags.base || process.env.MP_BASE || 'https://applet.ssemarket.cn').replace(/\/+$/, '');
const token = String(flags.token || process.env.MP_TOKEN || '');
const rawUrl = positional[0] || flags.url;
const appKey = flags.app ? String(flags.app) : '';

const results = [];
function ok(name, detail = '') { results.push({ level: 'ok', name, detail }); }
function warn(name, detail = '') { results.push({ level: 'warn', name, detail }); }
function fail(name, detail = '') { results.push({ level: 'fail', name, detail }); }

function isLocal(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

async function main() {
  if (!rawUrl) {
    console.error('用法：node preflight.mjs <URL> [--app <appKey>] [--token <devToken>] [--base <平台地址>]');
    process.exit(2);
  }

  let url;
  try { url = new URL(rawUrl); } catch {
    fail('URL', '不是合法 URL');
    return report();
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal(url.hostname))) {
    fail('HTTPS', '入口必须是 HTTPS（本地调试允许 http://localhost）');
  } else {
    ok('HTTPS', url.protocol.replace(':', ''));
  }

  let res;
  const started = Date.now();
  try {
    res = await fetch(url, {
      redirect: 'follow',
      headers: { accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    fail('可访问性', `请求失败：${err.message}`);
    return report();
  }
  const ms = Date.now() - started;
  const finalUrl = res.url || url.toString();
  const finalOrigin = new URL(finalUrl).origin;

  if (res.status >= 200 && res.status < 400) ok('HTTP', `${res.status} ${ms}ms`);
  else fail('HTTP', `${res.status} ${ms}ms`);

  if (finalUrl !== url.toString()) warn('重定向', `最终地址：${finalUrl}（origin 需登记 ${finalOrigin}）`);
  else ok('入口', finalUrl);

  const type = String(res.headers.get('content-type') || '');
  if (type.includes('text/html')) ok('Content-Type', type.split(';')[0]);
  else warn('Content-Type', `${type || '空'}（小程序入口通常是 HTML）`);

  let html = '';
  try { html = await res.text(); } catch { /* ignore */ }
  if (/<meta[^>]+name=["']viewport["'][^>]*>/i.test(html)) ok('viewport', '已声明移动端视口');
  else warn('viewport', '未发现 viewport meta，WebView 中可能缩放异常');

  if (/\/sdk\/mp-client\.js/.test(html)) {
    ok('SDK', '页面引用了 mp-client.js');
    if (html.includes(base + '/sdk/mp-client.js')) ok('SDK 地址', base + '/sdk/mp-client.js');
    else warn('SDK 地址', `未发现 ${base}/sdk/mp-client.js，请确认不是旧版/旧平台地址`);
  } else {
    warn('SDK', '未发现 SDK 引用：若页面自己调用 /v1/sessions/exchange 可忽略');
  }

  const csp = res.headers.get('content-security-policy') || '';
  if (!csp) {
    ok('CSP', '未设置（不会拦截 SDK）');
  } else {
    const host = new URL(base).host;
    const allowScript = /script-src[^;]*/.test(csp) && csp.includes(host);
    const allowConnect = /connect-src[^;]*/.test(csp) && csp.includes(host);
    if (allowScript && allowConnect) ok('CSP', `已包含 ${host}`);
    else warn('CSP', `需要放行 script-src / connect-src 中的 ${host}：${csp.slice(0, 200)}`);
  }

  if (/x-frame-options/i.test([...res.headers.keys()].join(','))) {
    warn('X-Frame-Options', '页面禁止被 iframe 嵌入；WebView 顶层打开不受影响');
  }

  // 可选：检查平台登记
  if (appKey) {
    if (!token) {
      warn('平台登记', `传了 --app ${appKey} 但没有 --token，跳过配置核对`);
    } else {
      try {
        const apiRes = await fetch(`${base}/dev/v1/apps/${encodeURIComponent(appKey)}`, {
          headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });
        const data = await apiRes.json().catch(() => null);
        if (!apiRes.ok) {
          warn('平台登记', `${apiRes.status} ${data?.code || ''} ${data?.message || ''}`);
        } else {
          const app = data.app;
          const origins = app.allowedOrigins || [];
          if (origins.includes(finalOrigin)) ok('allowedOrigins', finalOrigin);
          else fail('allowedOrigins', `缺少 ${finalOrigin}；当前：${origins.join(', ') || '（空）'}（可执行 mp apps update --origins ${finalOrigin}）`);
          if (app.status === 'published') ok('发布状态', 'published（CORS 放行）');
          else warn('发布状态', `${app.status}：审核发布前跨源接口会被 CORS 拦截`);
          if (app.entryURL && app.entryURL !== finalUrl) warn('entryURL', `登记为 ${app.entryURL}，实际最终地址 ${finalUrl}`);
        }
      } catch (err) {
        warn('平台登记', `无法查询：${err.message}`);
      }
    }
  }

  return report();
}

function report() {
  const icon = { ok: '✓', warn: '!', fail: '✗' };
  for (const r of results) {
    console.log(`${icon[r.level]} ${r.name}${r.detail ? `: ${r.detail}` : ''}`);
  }
  const failed = results.filter((r) => r.level === 'fail');
  const warned = results.filter((r) => r.level === 'warn');
  console.log(`\n${failed.length ? '存在阻塞问题' : '预检通过'}（${warned.length} 个提醒）`);
  if (failed.length) process.exitCode = 1;
}

await main();