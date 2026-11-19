export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toJSON(requestId) {
    const body = { code: this.code, message: this.message, requestId };
    if (this.details !== undefined) body.details = this.details;
    return body;
  }
}

export function badRequest(code, message, details) {
  return new ApiError(400, code, message, details);
}

export function unauthorized(code = 'UNAUTHORIZED', message = '未登录或登录已过期') {
  return new ApiError(401, code, message);
}

export function forbidden(code = 'FORBIDDEN', message = '无权访问') {
  return new ApiError(403, code, message);
}

export function notFound(code = 'NOT_FOUND', message = '资源不存在') {
  return new ApiError(404, code, message);
}

export function conflict(code = 'CONFLICT', message = '资源冲突') {
  return new ApiError(409, code, message);
}

export function tooMany(code = 'RATE_LIMITED', message = '请求过于频繁，请稍后再试', retryAfter = 60) {
  const err = new ApiError(429, code, message);
  err.retryAfter = retryAfter;
  return err;
}