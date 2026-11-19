import { ApiError, badRequest } from './errors.js';

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler, meta = {}) {
    this.routes.push({
      method: method.toUpperCase(),
      pattern,
      parts: pattern.split('/').filter(Boolean),
      handler,
      meta,
    });
    return this;
  }

  get(pattern, handler, meta) { return this.add('GET', pattern, handler, meta); }
  post(pattern, handler, meta) { return this.add('POST', pattern, handler, meta); }
  put(pattern, handler, meta) { return this.add('PUT', pattern, handler, meta); }
  patch(pattern, handler, meta) { return this.add('PATCH', pattern, handler, meta); }
  delete(pattern, handler, meta) { return this.add('DELETE', pattern, handler, meta); }

  match(method, pathname) {
    const segs = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method && !(method === 'HEAD' && route.method === 'GET')) continue;
      if (route.parts.length !== segs.length) continue;
      const params = {};
      let matched = true;
      for (let i = 0; i < route.parts.length; i += 1) {
        const part = route.parts[i];
        if (part.startsWith(':')) {
          try { params[part.slice(1)] = decodeURIComponent(segs[i]); } catch { matched = false; break; }
          if (params[part.slice(1)] === '') { matched = false; break; }
        } else if (part !== segs[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return { route, params };
    }
    return null;
  }
}

const MAX_BODY = 1024 * 1024;

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const pair of String(header).split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const key = pair.slice(0, idx).trim();
    if (!key || key in out) continue;
    try { out[key] = decodeURIComponent(pair.slice(idx + 1).trim()); } catch { out[key] = ''; }
  }
  return out;
}

export function serializeCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge != null) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  if (opts.expires) parts.push(`Expires=${new Date(opts.expires).toUTCString()}`);
  parts.push(`Path=${opts.path || '/'}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  return parts.join('; ');
}

export function createContext({ req, res, config, requestId }) {
  const url = new URL(req.url, 'http://internal.invalid');
  const cookies = parseCookies(req.headers.cookie);
  let rawPromise = null;
  let parsedBody;

  async function readRaw(maxBytes = MAX_BODY) {
    if (rawPromise) return rawPromise;
    rawPromise = new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let done = false;
      const fail = (err) => { if (!done) { done = true; reject(err); } };
      req.on('data', (chunk) => {
        if (done) return;
        size += chunk.length;
        if (size > maxBytes) {
          fail(new ApiError(413, 'PAYLOAD_TOO_LARGE', '请求体过大'));
          req.pause();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
      req.on('error', (err) => fail(err));
    });
    return rawPromise;
  }

  const ctx = {
    req,
    res,
    config,
    requestId,
    url,
    pathname: url.pathname,
    query: url.searchParams,
    params: {},
    headers: req.headers,
    method: req.method,
    ip: '',
    cookies,
    getCookie(name) { return cookies[name] || ''; },

    async rawBody(maxBytes = MAX_BODY) {
      return readRaw(maxBytes);
    },

    async body() {
      if (parsedBody !== undefined) return parsedBody;
      const raw = await readRaw();
      if (!raw.length) { parsedBody = {}; return parsedBody; }
      const type = String(req.headers['content-type'] || '');
      if (!type.includes('application/json') && !type.includes('+json')) {
        throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', '请使用 application/json');
      }
      try {
        const parsed = JSON.parse(raw.toString('utf8'));
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('not an object');
        }
        parsedBody = parsed;
      } catch {
        throw badRequest('INVALID_JSON', '请求体不是合法的 JSON 对象');
      }
      return parsedBody;
    },

    setCookie(name, value, opts = {}) {
      const cookie = serializeCookie(name, value, {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: 'Lax',
        ...opts,
      });
      const prev = res.getHeader('Set-Cookie');
      const list = prev ? (Array.isArray(prev) ? prev : [String(prev)]) : [];
      list.push(cookie);
      res.setHeader('Set-Cookie', list);
    },

    clearCookie(name, opts = {}) {
      ctx.setCookie(name, '', { ...opts, maxAge: 0 });
    },

    json(data, status = 200, extraHeaders = {}) {
      if (res.headersSent) return;
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
      res.end(JSON.stringify(data));
    },

    status(status, payload = {}) {
      ctx.json(payload, status);
    },

    text(body, status = 200, contentType = 'text/plain; charset=utf-8') {
      if (res.headersSent) return;
      res.statusCode = status;
      res.setHeader('Content-Type', contentType);
      res.end(body);
    },

    redirect(location, status = 302) {
      if (res.headersSent) return;
      res.statusCode = status;
      res.setHeader('Location', location);
      res.end();
    },
  };
  return ctx;
}

export function requireString(body, field, { min = 1, max = 256, code = 'INVALID_INPUT' } = {}) {
  const value = body?.[field];
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    throw badRequest(code, `字段 ${field} 不合法`);
  }
  return value.trim();
}

export function optionalString(body, field, { max = 1024 } = {}) {
  const value = body?.[field];
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max) {
    throw badRequest('INVALID_INPUT', `字段 ${field} 不合法`);
  }
  return value.trim();
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}