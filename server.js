import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, ROOT } from './src/config.js';
import { createLogger } from './src/logger.js';
import { createApp } from './src/app.js';

function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (fs.existsSync(file)) {
    try { process.loadEnvFile(file); } catch { /* ignore malformed .env */ }
  }
}

loadDotEnv();

const config = loadConfig();
const log = createLogger({ level: config.logLevel, logDir: config.logDir });

let app;
try {
  app = await createApp(config, { logger: log });
} catch (err) {
  log.error('startup.failed', {
    error: String(err?.message || err),
    hint: '检查 MySQL 连接与库权限（MP_DB_*），以及 schema 是否可创建',
  });
  process.exit(1);
}

app.server.listen(config.port, config.host, () => {
  log.info('server.listening', {
    url: config.publicBase,
    bind: `${config.host}:${config.port}`,
    db: `${config.db.host}:${config.db.port}/${config.db.name}`,
    redis: config.redisUrl ? 'connected' : 'fallback:memory',
    storage: app.services.storage.backend,
    launchMode: config.launchMode,
  });
  log.info('server.endpoints', {
    openPlatform: `${config.publicBase}/`,
    admin: `${config.publicBase}/admin`,
    api: `${config.publicBase}/v1`,
    docs: `${config.publicBase}/#/docs`,
    health: `${config.publicBase}/healthz`,
  });
  if (config.adminPassword === 'admin123456') {
    log.warn('security.default_admin_password', { hint: '请设置 MP_ADMIN_PASSWORD 并重新部署' });
  }
});

app.server.requestTimeout = 30_000;
app.server.headersTimeout = 35_000;

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('server.shutdown', { signal });
  const timer = setTimeout(() => process.exit(1), 8000);
  timer.unref?.();
  try {
    await app.close();
  } catch (err) {
    log.warn('server.shutdown_error', { error: String(err?.message || err) });
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
  log.error('process.unhandled_rejection', { error: String(err?.message || err), stack: err?.stack });
});
let fatalErrorSeen = false;
process.on('uncaughtException', (err) => {
  // 防止日志本身报错造成无限循环；未捕获异常后交给 supervisor 重启
  if (fatalErrorSeen) process.exit(1);
  fatalErrorSeen = true;
  try {
    log.error('process.uncaught_exception', { error: String(err?.message || err), stack: err?.stack });
  } finally {
    setTimeout(() => process.exit(1), 100);
  }
});