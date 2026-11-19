/**
 * 主站 outbox → 小程序平台事件推送 worker 示例。
 *
 * 原则：
 * 1. 发帖事务里只写 outbox 表，不在请求链路同步调用平台；
 * 2. 后台 worker 轮询 outbox，签名后推送；失败指数退避 + 死信；
 * 3. eventID 全局唯一，dedupKey 使用业务键（如 post:7726）。
 *
 * 下面的 db 接口需按你的 ORM 适配：
 *   db.claimBatch(limit)  → [{id, eventID, postID, title, partition, authorUserID, createdAt, dedupKey, attempts}]
 *   db.markSent(id) / db.markRetry(id, nextAt, error) / db.markDead(id, error)
 */
import { signInternalRequest } from './signature.mjs';

const PLATFORM = process.env.MP_BASE || 'http://localhost:8080';
const SECRET = process.env.MP_INTERNAL_SECRET;
const MAX_ATTEMPTS = 8;

if (!SECRET) throw new Error('缺少 MP_INTERNAL_SECRET');

async function deliver(event, fetchImpl = fetch) {
  const body = JSON.stringify({
    eventID: event.eventID,
    postID: event.postID,
    title: event.title,
    partition: event.partition,
    authorUserID: event.authorUserID,
    createdAt: event.createdAt,
    dedupKey: event.dedupKey,
  });
  const signed = signInternalRequest(SECRET, body);
  const res = await fetchImpl(`${PLATFORM}/internal/v1/events/new-post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...signed.headers },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

/** 一次轮询：成功标记、失败退避、超过上限进死信。 */
export async function drainOnce(db, { limit = 20, fetchImpl = fetch } = {}) {
  const batch = await db.claimBatch(limit);
  for (const event of batch) {
    try {
      const result = await deliver(event, fetchImpl);
      // 平台返回 duplicate:true 也表示已接受，直接标记成功
      await db.markSent(event.id, result);
    } catch (err) {
      const attempts = (event.attempts || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await db.markDead(event.id, String(err.message || err));
      } else {
        const delaySec = Math.min(3600, 2 ** attempts * 5);
        await db.markRetry(event.id, new Date(Date.now() + delaySec * 1000), String(err.message || err));
      }
    }
  }
  return batch.length;
}

export async function runWorker(db, { intervalMs = 5000 } = {}) {
  let running = true;
  process.on('SIGTERM', () => { running = false; });
  while (running) {
    try {
      const count = await drainOnce(db);
      await new Promise((r) => setTimeout(r, count ? 200 : intervalMs));
    } catch (err) {
      console.error('[mp-outbox] poll failed', err);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

// 用法：await runWorker(myOutboxRepository);