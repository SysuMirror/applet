import { hashPassword } from './auth.js';
import { createAppRecord, getApp } from './services/catalog.js';
import { nowIso } from './util.js';

const OFFICIAL_APPS = [
  {
    appKey: 'novel',
    name: '小说',
    icon: 'tabler:book-2',
    category: 'content',
    description: '长篇连载与书架，随时续读。',
    scopes: ['profile:read', 'prefs:read', 'prefs:write', 'posts:read'],
    sort: 100,
    pinyin: 'xiaoshuo',
    keywords: '小说 阅读 书 连载 book novel',
  },
  {
    appKey: 'ranking',
    name: '排行榜',
    icon: 'tabler:trophy',
    category: 'content',
    description: '热门帖子、创作榜与本周新星。',
    scopes: ['profile:read', 'prefs:read', 'posts:read'],
    sort: 95,
    pinyin: 'paixingbang',
    keywords: '排行 榜单 热门 ranking hot',
  },
  {
    appKey: 'resume',
    name: '简历',
    icon: 'tabler:file-cv',
    category: 'tool',
    description: '在线简历：模板、编辑、预览与投递。',
    scopes: ['profile:read', 'prefs:read', 'prefs:write'],
    sort: 90,
    pinyin: 'jianli',
    keywords: '简历 求职 模板 投递 resume cv',
  },
  {
    appKey: 'media',
    name: '音乐视频',
    icon: 'tabler:disc',
    category: 'content',
    description: '帖子里的音乐与视频，边逛边听。',
    scopes: ['profile:read', 'prefs:read', 'prefs:write', 'posts:read'],
    sort: 85,
    pinyin: 'yinyueshipin',
    keywords: '音乐 视频 播放 歌单 media music video',
  },
  {
    appKey: 'shop',
    name: '商城',
    icon: 'tabler:shopping-bag',
    category: 'shopping',
    description: '集市周边、会员权益与金币兑换。',
    scopes: ['profile:read', 'prefs:read'],
    sort: 80,
    pinyin: 'shangcheng',
    keywords: '商城 周边 兑换 会员 shop mall',
  },
  {
    appKey: 'course',
    name: '课程专区',
    icon: 'tabler:book',
    category: 'content',
    description: '课程、讲座与学习资料，随时回看。',
    scopes: ['profile:read', 'prefs:read', 'posts:read'],
    sort: 75,
    pinyin: 'kechengzhuanqu',
    keywords: '课程 讲座 学习 资料 course class',
  },
];

async function ensureAdmin(db, config, log) {
  const existing = await db.prepare('SELECT * FROM mp_developers WHERE email = ?').get(config.adminEmail);
  if (existing) {
    if (existing.role !== 'admin') {
      await db.prepare("UPDATE mp_developers SET role = 'admin', updated_at = ? WHERE id = ?")
        .run(nowIso(), Number(existing.id));
    }
    return Number(existing.id);
  }
  const now = nowIso();
  const info = await db.prepare(`
    INSERT INTO mp_developers
      (email, password_hash, display_name, role, status, email_verified, created_at, updated_at)
    VALUES (?, ?, ?, 'admin', 'active', 1, ?, ?)
  `).run(config.adminEmail, hashPassword(config.adminPassword), config.adminDisplayName, now, now);
  log?.warn('seed.admin_created', {
    email: config.adminEmail,
    hint: config.adminPassword === 'admin123456'
      ? '正在使用默认密码，请通过 MP_ADMIN_PASSWORD 修改后重新部署'
      : '管理员账号已按环境变量创建',
  });
  return Number(info.lastInsertRowid);
}

async function ensureOfficialApps(db, config, adminId, log) {
  const origin = (() => { try { return new URL(config.publicBase).origin; } catch { return ''; } })();
  for (const spec of OFFICIAL_APPS) {
    const existing = await getApp(db, spec.appKey, { includeDeleted: true });
    if (existing) {
      const now = nowIso();
      const entryURL = `${config.publicBase}/demo/app?app=${spec.appKey}`;
      // 官方演示应用的入口/排序/权限跟随当前部署配置，避免换域名后入口失效
      await db.prepare(`
        UPDATE mp_apps SET name = ?, icon = ?, category = ?, description = ?, scopes = ?,
          sort = ?, pinyin = ?, keywords = ?,
          entry_url = CASE WHEN hosting_mode = 'internal' THEN entry_url ELSE ? END,
          allowed_origins = CASE WHEN hosting_mode = 'internal' THEN allowed_origins ELSE ? END,
          updated_at = ?
        WHERE id = ?
      `).run(
        spec.name, spec.icon, spec.category, spec.description, JSON.stringify(spec.scopes),
        spec.sort, spec.pinyin, spec.keywords, entryURL,
        JSON.stringify(origin ? [origin] : []), now, Number(existing.id),
      );
      if (existing.hosting_mode !== 'internal') {
        await db.prepare(`
          UPDATE mp_app_versions SET entry_url = ?, allowed_origins = ?, updated_at = ?
          WHERE app_id = ? AND status = 'published'
        `).run(entryURL, JSON.stringify(origin ? [origin] : []), now, Number(existing.id));
      }
      continue;
    }
    const { app } = await createAppRecord(db, {
      ...spec,
      entryURL: `${config.publicBase}/demo/app?app=${spec.appKey}`,
      allowedOrigins: origin ? [origin] : [],
      ownerType: 'official',
      status: 'published',
      version: '1.0.0',
      createdBy: adminId,
      config,
    });
    const now = nowIso();
    await db.prepare('UPDATE mp_apps SET published_at = ? WHERE id = ?').run(now, Number(app.id));
    await db.prepare(`
      UPDATE mp_app_versions SET status = 'published', submitted_at = ?, reviewed_at = ?, published_at = ?
      WHERE app_id = ? AND version = '1.0.0'
    `).run(now, now, now, Number(app.id));
    log?.info('seed.official_app', { appKey: spec.appKey });
  }

  // 旧演示应用不在新的产品目录中，软删除避免继续出现在 App 面板
  const now = nowIso();
  for (const legacy of ['coin', 'help']) {
    await db.prepare("UPDATE mp_apps SET status = 'offline', deleted_at = ?, updated_at = ? WHERE app_key = ? AND deleted_at IS NULL")
      .run(now, now, legacy);
  }
}

async function ensureDemoDeveloper(db, config, log) {
  if (!config.demoMode) return;
  const email = 'demo@mp.local';
  let developer = await db.prepare('SELECT * FROM mp_developers WHERE email = ?').get(email);
  if (!developer) {
    const now = nowIso();
    const info = await db.prepare(`
      INSERT INTO mp_developers
        (email, password_hash, display_name, org_name, role, status, email_verified, created_at, updated_at)
      VALUES (?, ?, '示例开发者', '集市工作室', 'developer', 'active', 1, ?, ?)
    `).run(email, hashPassword('demo123456'), now, now);
    developer = await db.prepare('SELECT * FROM mp_developers WHERE id = ?').get(info.lastInsertRowid);
    log?.info('seed.demo_developer', { email, password: 'demo123456' });
  }
  const existingNotes = await getApp(db, 'study-notes', { includeDeleted: true });
  if (existingNotes) {
    if (existingNotes.entry_url.includes('/demo/app?app=study-notes')) {
      const currentOrigin = (() => { try { return new URL(config.publicBase).origin; } catch { return ''; } })();
      await db.prepare('UPDATE mp_apps SET entry_url = ?, allowed_origins = ?, updated_at = ? WHERE id = ?')
        .run(`${config.publicBase}/demo/app?app=study-notes`, JSON.stringify(currentOrigin ? [currentOrigin] : []), nowIso(), Number(existingNotes.id));
    }
    return;
  }

  const origin = (() => { try { return new URL(config.publicBase).origin; } catch { return ''; } })();
  const { app } = await createAppRecord(db, {
    appKey: 'study-notes',
    name: '学习笔记',
    icon: 'tabler:notes',
    category: 'tool',
    description: '把帖子里的灵感收进自己的笔记本，支持标签与复习提醒。',
    entryURL: `${config.publicBase}/demo/app?app=study-notes`,
    allowedOrigins: origin ? [origin] : [],
    scopes: ['profile:read', 'prefs:read', 'prefs:write', 'posts:read'],
    visibility: 'public',
    developerId: Number(developer.id),
    ownerType: 'partner',
    keywords: '笔记 学习 标签 复习 notes',
    pinyin: 'xuexibiji',
    config,
  });
  const now = nowIso();
  await db.prepare(`
    UPDATE mp_app_versions SET status = 'reviewing', changelog = ?, submitted_at = ?, updated_at = ?
    WHERE app_id = ? AND version = '1.0.0'
  `).run('首版：支持从帖子创建笔记、标签整理与复习提醒。', now, now, Number(app.id));
  await db.prepare("UPDATE mp_apps SET status = 'reviewing', updated_at = ? WHERE id = ?")
    .run(now, Number(app.id));
  log?.info('seed.demo_app', { appKey: 'study-notes', status: 'reviewing' });
}

export async function seed(db, config, log) {
  const adminId = await ensureAdmin(db, config, log);
  await ensureOfficialApps(db, config, adminId, log);
  await ensureDemoDeveloper(db, config, log);
  return { adminId };
}