import fs from 'node:fs';
import path from 'node:path';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
const MAX_FILE_BYTES = 20 * 1024 * 1024;

// 下游管道关闭时不要让 EPIPE 变成 uncaughtException
process.stdout.on?.('error', () => {});
process.stderr.on?.('error', () => {});

function openStream(file, logDir) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const stream = fs.createWriteStream(file, { flags: 'a' });
    stream.on('error', () => { stream.__broken = true; });
    return stream;
  } catch {
    return null;
  }
}

export function createLogger({ level = 'info', logDir = '', file = 'mp-service.log' } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  let stream = null;
  let filePath = '';
  let bytes = 0;

  if (logDir) {
    filePath = path.join(logDir, file);
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_BYTES) {
        fs.renameSync(filePath, `${filePath}.1`);
      }
      bytes = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    } catch { /* 文件不存在 */ }
    stream = openStream(filePath, logDir);
  }

  function rotate() {
    if (!stream || !filePath) return;
    try {
      stream.end();
      fs.renameSync(filePath, `${filePath}.1`);
      stream = openStream(filePath, path.dirname(filePath));
      bytes = 0;
    } catch {
      stream = null;
    }
  }

  const emit = (lvl, msg, fields) => {
    if ((LEVELS[lvl] ?? 99) < threshold) return;
    const entry = { ts: new Date().toISOString(), level: lvl, msg, ...fields };
    let line;
    try { line = `${JSON.stringify(entry)}\n`; } catch {
      line = `${JSON.stringify({ ts: entry.ts, level: lvl, msg })}\n`;
    }
    // stdout 由 supervisor 收集；EPIPE 时静默失败，绝不再触发 uncaughtException
    try {
      if (process.stdout.writable) process.stdout.write(line);
    } catch { /* ignore */ }
    if (stream && !stream.__broken) {
      try {
        stream.write(line);
        bytes += Buffer.byteLength(line);
        if (bytes > MAX_FILE_BYTES) rotate();
      } catch {
        stream = null;
      }
    }
  };

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    close: () => { try { stream?.end(); } catch { /* ignore */ } },
  };
}