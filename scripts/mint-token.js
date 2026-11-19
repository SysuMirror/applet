#!/usr/bin/env node
/**
 * 本地签发主站用户 Token（仅当 MP_MAIN_JWKS_URL / MP_MAIN_INTERNAL_VERIFY_URL 未配置时有效）。
 * 用法：node --no-warnings scripts/mint-token.js --user 561 [--ttl 86400] [--scope dev]
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, ROOT } from '../src/config.js';
import { signJwt } from '../src/jwt.js';

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  try { process.loadEnvFile(envFile); } catch { /* ignore */ }
}

const args = process.argv.slice(2);
function arg(name, fallback = '') {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const userId = arg('user', '10001');
const ttl = Number(arg('ttl', '86400')) || 86400;
const config = loadConfig();

if (config.mainJwksUrl || config.mainVerifyUrl || config.internalVerifyUrl) {
  // 平台仍保留本地 HS256 兜底，便于在配置主站校验后继续做本地联调
  console.error('[mint-token] 注意：当前配置使用主站 JWKS / 校验接口；本地 token 仅用于本地调试。');
}

const token = signJwt(
  { sub: String(userId), name: `用户${userId}`, scope: 'app' },
  config.mainJwtSecret,
  ttl,
);
console.log(token);