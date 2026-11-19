#!/usr/bin/env node
/**
 * 重置管理员密码（不影响已签发 token 之外的配置）。
 * 用法：
 *   node --no-warnings scripts/set-admin-password.js --email admin@mp.local --password 'NewPass!123'
 *   node --no-warnings scripts/set-admin-password.js --email 3238499590@qq.com --password '...' --create --name '内部管理员'
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, ROOT } from '../src/config.js';
import { openDb } from '../src/db.js';
import { hashPassword } from '../src/auth.js';
import { nowIso } from '../src/util.js';

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  try { process.loadEnvFile(envFile); } catch { /* ignore */ }
}

const args = process.argv.slice(2);
const get = (name, fallback = '') => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
};

const email = get('email', 'admin@mp.local').toLowerCase();
const password = get('password');
const create = args.includes('--create');
const displayName = get('name', '平台管理员');
if (!password || password.length < 8) {
  console.error('用法：node scripts/set-admin-password.js --email admin@mp.local --password <至少 8 位>');
  process.exit(2);
}

const config = loadConfig();
const db = await openDb(config);
let admin = await db.prepare('SELECT * FROM mp_developers WHERE email = ?').get(email);
if (!admin) {
  if (!create) {
    console.error(`找不到账号：${email}（加 --create 可直接创建管理员）`);
    await db.close();
    process.exit(1);
  }
  const now = nowIso();
  const info = await db.prepare(`
    INSERT INTO mp_developers
      (email, password_hash, display_name, role, status, email_verified, created_at, updated_at)
    VALUES (?, ?, ?, 'admin', 'active', 1, ?, ?)
  `).run(email, hashPassword(password), displayName, now, now);
  admin = await db.prepare('SELECT * FROM mp_developers WHERE id = ?').get(info.lastInsertRowid);
  await db.close();
  console.log(`已创建管理员 ${email}（可用密码登录 /admin，也可之后用 UniSSO 登录）。`);
  process.exit(0);
}
await db.prepare(`
  UPDATE mp_developers
  SET password_hash = ?,
      auth_source = CASE WHEN auth_source = 'sso' THEN 'sso+password' ELSE auth_source END,
      token_version = token_version + 1,
      updated_at = ?
  WHERE id = ?
`).run(hashPassword(password), nowIso(), Number(admin.id));
await db.close();
console.log(`已重置 ${email} 的密码（该账号其他登录会话已失效）。`);