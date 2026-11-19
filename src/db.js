import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

/**
 * MySQL 8 连接池 + 与原有调用风格兼容的异步接口。
 * 所有返回值为 Promise；路由与 service 层均按 async 编写。
 */
export async function openDb(config) {
  const pool = mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.name,
    waitForConnections: true,
    connectionLimit: config.db.poolSize || 12,
    maxIdle: config.db.poolSize || 12,
    idleTimeout: 60_000,
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: true,
    multipleStatements: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
  });
  await pool.query('SELECT 1');
  const schema = fs.readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf8');
  const statements = schema
    .split(/;\s*(?:\r?\n|$)/)
    .map((chunk) => chunk.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim())
    .filter(Boolean);
  for (const statement of statements) {
    await pool.query(statement);
  }
  await ensureSsoColumns(pool, config.db.name);
  await ensureHostingColumns(pool, config.db.name);
  return wrap(pool);
}

async function ensureSsoColumns(pool, dbName) {
  const [cols] = await pool.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [dbName, 'mp_developers'],
  );
  const existing = new Set(cols.map((row) => row.COLUMN_NAME || row.column_name));
  const additions = [
    ['sso_sub', 'VARCHAR(64) NULL'],
    ['auth_source', "VARCHAR(16) NOT NULL DEFAULT 'password'"],
    ['avatar_url', "VARCHAR(512) NOT NULL DEFAULT ''"],
  ];
  for (const [name, ddl] of additions) {
    if (!existing.has(name)) await pool.query(`ALTER TABLE mp_developers ADD COLUMN ${name} ${ddl}`);
  }
  const [indexes] = await pool.query(
    'SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?',
    [dbName, 'mp_developers', 'uk_developer_sso'],
  );
  if (!indexes.length) {
    await pool.query('ALTER TABLE mp_developers ADD UNIQUE KEY uk_developer_sso (sso_sub)');
  }
}

async function ensureHostingColumns(pool, dbName) {
  const [cols] = await pool.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [dbName, 'mp_apps'],
  );
  const existing = new Set(cols.map((row) => row.COLUMN_NAME || row.column_name));
  const additions = [
    ['hosting_mode', "VARCHAR(16) NOT NULL DEFAULT 'external'"],
    ['hosting_build', 'VARCHAR(64) NULL'],
    ['hosting_token_hash', "CHAR(64) NOT NULL DEFAULT ''"],
    ['hosting_token_cipher', "VARCHAR(512) NOT NULL DEFAULT ''"],
    ['hosting_updated_at', 'VARCHAR(32) NULL'],
  ];
  for (const [name, ddl] of additions) {
    if (!existing.has(name)) await pool.query(`ALTER TABLE mp_apps ADD COLUMN ${name} ${ddl}`);
  }
}

function wrap(pool) {
  const db = {
    pool,
    prepare(sql) {
      return {
        async get(...params) {
          const [rows] = await pool.execute(sql, params);
          return rows[0];
        },
        async all(...params) {
          const [rows] = await pool.execute(sql, params);
          return rows;
        },
        async run(...params) {
          const [result] = await pool.execute(sql, params);
          return {
            changes: Number(result.affectedRows || 0),
            lastInsertRowid: Number(result.insertId || 0),
          };
        },
      };
    },
    async query(sql, params = []) {
      const [result] = await pool.query(sql, params);
      return result;
    },
    async ping() {
      await pool.query('SELECT 1');
    },
    async close() {
      await pool.end();
    },
  };
  return db;
}

export async function one(db, sql, ...params) {
  return db.prepare(sql).get(...params);
}

export async function all(db, sql, ...params) {
  return db.prepare(sql).all(...params);
}

export async function run(db, sql, ...params) {
  return db.prepare(sql).run(...params);
}

export async function count(db, sql, ...params) {
  const row = await db.prepare(sql).get(...params);
  return row ? Number(Object.values(row)[0] || 0) : 0;
}

/** 清理过期数据；由定时任务调用，幂等。 */
export async function cleanup(db, retentionDays = 30) {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - retentionDays * 86400_000).toISOString();
  await db.prepare('DELETE FROM mp_launch_tickets WHERE expires_at < ?').run(cutoff);
  await db.prepare('DELETE FROM mp_sessions WHERE expires_at < ?').run(cutoff);
  await db.prepare('DELETE FROM mp_nonces WHERE expires_at < ?').run(now);
  await db.prepare('DELETE FROM mp_notifications WHERE created_at < ?').run(cutoff);
  await db.prepare('DELETE FROM mp_usage_daily WHERE day < ?').run(cutoff.slice(0, 10));
  await db.prepare('DELETE FROM mp_audit_logs WHERE created_at < ?').run(cutoff);
}