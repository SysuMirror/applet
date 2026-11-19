import { createClient } from 'redis';

/**
 * Redis 连接。连接失败不阻塞服务启动 —— 限流、票据、nonce 会自动退化为 MySQL/内存实现。
 */
export async function createRedis(config, logger) {
  if (!config.redisUrl) return null;
  const client = createClient({
    url: config.redisUrl,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 3000,
      reconnectStrategy: (retries) => Math.min(200 + retries * 300, 3000),
    },
  });
  client.on('error', (err) => logger?.warn('redis.error', { error: String(err?.message || err) }));
  client.on('reconnecting', () => logger?.warn('redis.reconnecting'));
  try {
    await client.connect();
    await client.ping();
    logger?.info('redis.connected', { prefix: config.redisPrefix });
    return client;
  } catch (err) {
    logger?.warn('redis.unavailable', { error: String(err?.message || err) });
    try { await client.destroy(); } catch { /* ignore */ }
    return null;
  }
}