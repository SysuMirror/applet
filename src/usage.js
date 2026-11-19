import { nowIso } from './util.js';

/**
 * 按 app_key + 天 统计调用次数与去重用户数。
 * 内存聚合、定时落库；进程重启会丢失最多一个 flush 周期的数据（可接受，仅用于看板）。
 */
export class UsageTracker {
  constructor() {
    this.rows = new Map();
  }

  record(appKey, userId = '') {
    if (!appKey) return;
    const day = nowIso().slice(0, 10);
    const key = `${day}|${appKey}`;
    let row = this.rows.get(key);
    if (!row) {
      row = { day, appKey, calls: 0, users: new Set() };
      this.rows.set(key, row);
    }
    row.calls += 1;
    if (userId) row.users.add(String(userId));
  }

  async flush(db) {
    if (!this.rows.size) return 0;
    const rows = [...this.rows.values()];
    this.rows.clear();
    const stmt = db.prepare(`
      INSERT INTO mp_usage_daily (day, app_key, calls, users) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        calls = calls + VALUES(calls),
        users = users + VALUES(users)
    `);
    for (const row of rows) {
      await stmt.run(row.day, row.appKey, row.calls, row.users.size);
    }
    return rows.length;
  }
}