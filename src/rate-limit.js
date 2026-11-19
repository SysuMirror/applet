import { tooMany } from './errors.js';

/**
 * 限流：优先 Redis 固定窗口（多实例共享），Redis 不可用时退化为单进程内存。
 * Redis 键统一带 mp: 前缀，符合组 ACL 约束。
 */
export class RateLimiter {
  constructor({ redis = null, prefix = 'mp:', logger = null, maxEntries = 50000 } = {}) {
    this.redis = redis;
    this.prefix = prefix;
    this.logger = logger;
    this.map = new Map();
    this.lastSweep = Date.now();
    this.maxEntries = maxEntries;
    this.hits = 0;
    this.redisFailures = 0;
  }

  async hit(key, capacity, windowSeconds = 60) {
    this.hits += 1;
    if (this.redis) {
      try {
        const windowMs = windowSeconds * 1000;
        const bucketId = Math.floor(Date.now() / windowMs);
        const redisKey = `${this.prefix}rl:${key}:${bucketId}`;
        const count = Number(await this.redis.incr(redisKey));
        if (count === 1) await this.redis.expire(redisKey, windowSeconds + 10);
        const retryAfter = Math.max(1, Math.ceil(((bucketId + 1) * windowMs - Date.now()) / 1000));
        return { ok: count <= capacity, remaining: Math.max(0, capacity - count), retryAfter };
      } catch (err) {
        this.redisFailures += 1;
        this.logger?.warn('rate_limit.redis_failed', { error: String(err?.message || err) });
      }
    }
    return this.memoryHit(key, capacity, windowSeconds);
  }

  memoryHit(key, capacity, windowSeconds = 60) {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const bucketId = Math.floor(now / windowMs);
    const fullKey = `${key}|${bucketId}`;
    let entry = this.map.get(fullKey);
    if (!entry) {
      entry = { count: 0, expires: (bucketId + 1) * windowMs };
      this.map.set(fullKey, entry);
    }
    entry.count += 1;
    if (now - this.lastSweep > 60_000 || this.map.size > this.maxEntries) {
      this.sweep(now);
    }
    const retryAfter = Math.max(1, Math.ceil((entry.expires - now) / 1000));
    return {
      ok: entry.count <= capacity,
      remaining: Math.max(0, capacity - entry.count),
      retryAfter,
    };
  }

  sweep(now = Date.now()) {
    this.lastSweep = now;
    for (const [key, entry] of this.map) {
      if (entry.expires <= now) this.map.delete(key);
    }
  }

  get size() { return this.map.size; }
}

export async function enforce(limiter, { name, subject, capacity, windowSeconds = 60, code = 'RATE_LIMITED' }) {
  if (!capacity || capacity <= 0) return;
  const result = await limiter.hit(`${name}:${subject || 'anonymous'}`, capacity, windowSeconds);
  if (!result.ok) throw tooMany(code, '请求过于频繁，请稍后再试', result.retryAfter);
}