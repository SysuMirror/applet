import { Router } from '../http.js';
import { ApiError, badRequest } from '../errors.js';
import { enforce } from '../rate-limit.js';

/**
 * Voice Studio（TTS）代理。
 *
 * API Key 只存在服务端环境变量 MP_TTS_API_KEY，小程序页面调用同源 /v1/tts/*，
 * 不接触也不暴露 Key。这里只转发合成/音色/任务接口，并做简单限流。
 */
const router = new Router();

const BASE = () => String(process.env.MP_TTS_BASE || 'https://tts.ssemarket.cn').replace(/\/+$/, '');
const KEY = () => String(process.env.MP_TTS_API_KEY || '');

async function limit(ctx, name, capacity = 30, windowSeconds = 60) {
  await enforce(ctx.services.limiter, {
    name: `tts-${name}`,
    subject: ctx.ip,
    capacity,
    windowSeconds,
  });
}

async function upstream(pathname, init = {}, timeoutMs = 70000) {
  const key = KEY();
  if (!key) throw new ApiError(503, 'TTS_NOT_CONFIGURED', '语音合成服务尚未配置');
  const headers = new Headers(init.headers || {});
  headers.set('X-API-Key', key);
  const res = await fetch(`${BASE()}${pathname}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res;
}

async function forwardJson(ctx, res) {
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { message: text.slice(0, 500) }; }
  ctx.json(body, res.status);
}

async function forwardAudio(ctx, res) {
  const buffer = Buffer.from(await res.arrayBuffer());
  ctx.res.statusCode = res.status;
  ctx.res.setHeader('Content-Type', res.headers.get('content-type') || 'audio/wav');
  ctx.res.setHeader('Cache-Control', 'no-store');
  const jobId = res.headers.get('x-job-id');
  if (jobId) ctx.res.setHeader('X-Job-Id', jobId);
  ctx.res.end(buffer);
}

router.get('/v1/tts/me', async (ctx) => {
  await limit(ctx, 'me', 60);
  forwardJson(ctx, await upstream('/api/v1/me'));
});

router.get('/v1/tts/base-models', async (ctx) => {
  await limit(ctx, 'models', 60);
  forwardJson(ctx, await upstream('/api/v1/base-models'));
});

router.get('/v1/tts/voices', async (ctx) => {
  await limit(ctx, 'voices', 60);
  const qs = ctx.url.search || '?limit=20';
  forwardJson(ctx, await upstream(`/api/v1/voices${qs}`));
});

router.get('/v1/tts/voices/:runId/sample', async (ctx) => {
  await limit(ctx, 'sample', 60);
  const res = await upstream(`/api/v1/voices/${encodeURIComponent(ctx.params.runId)}/sample`);
  if (!res.ok) return forwardJson(ctx, res);
  await forwardAudio(ctx, res);
});

router.post('/v1/tts', async (ctx) => {
  await limit(ctx, 'synthesize', 12);
  const body = await ctx.body();
  const text = String(body.text || '').trim();
  if (!text) throw badRequest('TTS_TEXT_REQUIRED', '请输入要合成的文本');
  if (text.length > 5000) throw badRequest('TTS_TEXT_TOO_LONG', '文本不能超过 5000 字');
  if (!body.voice_id && !body.run_id && !(body.base_model && body.ref_asset_id)) {
    throw badRequest('TTS_TARGET_REQUIRED', '请选择音色');
  }
  const timeout = Math.min(Math.max(Number(ctx.query.get('timeout')) || 60, 5), 600);
  const res = await upstream(`/api/v1/tts?timeout=${timeout}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, (timeout + 10) * 1000);
  const type = String(res.headers.get('content-type') || '');
  if (res.ok && type.startsWith('audio/')) return forwardAudio(ctx, res);
  return forwardJson(ctx, res);
});

router.get('/v1/tts/songs', async (ctx) => {
  await limit(ctx, 'songs', 60);
  forwardJson(ctx, await upstream('/api/v1/songs'));
});

router.get('/v1/tts/covers', async (ctx) => {
  await limit(ctx, 'covers', 60);
  const qs = ctx.url.search || '?limit=20';
  forwardJson(ctx, await upstream(`/api/v1/covers${qs}`));
});

router.post('/v1/tts/covers', async (ctx) => {
  await limit(ctx, 'cover-create', 6);
  const body = await ctx.body();
  if (!body.song_id) throw badRequest('TTS_SONG_REQUIRED', '请选择歌曲');
  if (!body.run_id && !body.voice_id) throw badRequest('TTS_VOICE_REQUIRED', '请选择翻唱音色');
  forwardJson(ctx, await upstream('/api/v1/covers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
});

router.get('/v1/tts/covers/:coverId', async (ctx) => {
  await limit(ctx, 'cover-status', 120);
  forwardJson(ctx, await upstream(`/api/v1/covers/${encodeURIComponent(ctx.params.coverId)}`));
});

router.get('/v1/tts/covers/:coverId/audio', async (ctx) => {
  await limit(ctx, 'cover-audio', 60);
  const res = await upstream(`/api/v1/covers/${encodeURIComponent(ctx.params.coverId)}/audio`);
  if (!res.ok) return forwardJson(ctx, res);
  await forwardAudio(ctx, res);
});

router.get('/v1/tts/tasks/:jobId', async (ctx) => {
  await limit(ctx, 'task', 60);
  forwardJson(ctx, await upstream(`/api/v1/tasks/${encodeURIComponent(ctx.params.jobId)}`));
});

router.get('/v1/tts/tasks/:jobId/audio', async (ctx) => {
  await limit(ctx, 'task-audio', 60);
  const res = await upstream(`/api/v1/tasks/${encodeURIComponent(ctx.params.jobId)}/audio`);
  if (!res.ok) return forwardJson(ctx, res);
  await forwardAudio(ctx, res);
});

export default router;