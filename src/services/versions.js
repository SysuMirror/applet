import { conflict, notFound } from '../errors.js';
import { nowIso, safeJsonParse } from '../util.js';
import { mapApp, getApp, normalizeOriginsForEntry } from './catalog.js';

export function mapVersion(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    appId: Number(row.app_id),
    version: row.version,
    entryURL: row.entry_url,
    allowedOrigins: safeJsonParse(row.allowed_origins, []),
    scopes: safeJsonParse(row.scopes, []),
    changelog: row.changelog || '',
    status: row.status,
    rejectReason: row.reject_reason || '',
    submittedAt: row.submitted_at || null,
    reviewedAt: row.reviewed_at || null,
    publishedAt: row.published_at || null,
    createdAt: row.created_at,
  };
}

export async function listVersions(db, appId) {
  const rows = await db.prepare('SELECT * FROM mp_app_versions WHERE app_id = ? ORDER BY id DESC')
    .all(Number(appId));
  return rows.map(mapVersion);
}

export async function findVersion(db, appId, version) {
  return db.prepare('SELECT * FROM mp_app_versions WHERE app_id = ? AND version = ?')
    .get(Number(appId), String(version));
}

export async function getVersionById(db, appId, versionId) {
  return db.prepare('SELECT * FROM mp_app_versions WHERE app_id = ? AND id = ?')
    .get(Number(appId), Number(versionId));
}

export async function upsertDraftVersion(db, app, {
  version, entryURL, allowedOrigins, scopes, changelog = '',
}) {
  const existing = await findVersion(db, app.id, version);
  if (existing) {
    if (['reviewing', 'approved', 'published'].includes(existing.status)) {
      throw conflict('VERSION_IN_REVIEW', '该版本已提交审核或已发布，请更换版本号');
    }
    await db.prepare(`
      UPDATE mp_app_versions
      SET entry_url = ?, allowed_origins = ?, scopes = ?, changelog = ?, status = 'draft', updated_at = ?
      WHERE id = ?
    `).run(entryURL, JSON.stringify(allowedOrigins), JSON.stringify(scopes), changelog, nowIso(), Number(existing.id));
    return getVersionById(db, app.id, existing.id);
  }
  const now = nowIso();
  const info = await db.prepare(`
    INSERT INTO mp_app_versions
      (app_id, version, entry_url, allowed_origins, scopes, changelog, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)
  `).run(
    Number(app.id), version, entryURL, JSON.stringify(allowedOrigins),
    JSON.stringify(scopes), changelog, now, now,
  );
  return getVersionById(db, app.id, info.lastInsertRowid);
}

export async function submitForReview(db, app, version, {
  changelog = '', entryURL, allowedOrigins, scopes,
}) {
  const existing = await findVersion(db, app.id, version);
  const now = nowIso();
  const origins = normalizeOriginsForEntry(entryURL, allowedOrigins);
  let versionId;
  if (existing) {
    if (['reviewing', 'approved', 'published'].includes(existing.status)) {
      throw conflict('VERSION_IN_REVIEW', '该版本已在审核或已发布，请更换版本号');
    }
    await db.prepare(`
      UPDATE mp_app_versions
      SET entry_url = ?, allowed_origins = ?, scopes = ?, changelog = ?, status = 'reviewing',
          reject_reason = '', submitted_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      entryURL, JSON.stringify(origins), JSON.stringify(scopes),
      changelog || existing.changelog || '', now, now, Number(existing.id),
    );
    versionId = Number(existing.id);
  } else {
    const info = await db.prepare(`
      INSERT INTO mp_app_versions
        (app_id, version, entry_url, allowed_origins, scopes, changelog, status, submitted_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'reviewing', ?, ?, ?)
    `).run(
      Number(app.id), version, entryURL, JSON.stringify(origins),
      JSON.stringify(scopes), changelog, now, now, now,
    );
    versionId = Number(info.lastInsertRowid);
  }

  const appStatus = ['published', 'offline'].includes(app.status) ? app.status : 'reviewing';
  await db.prepare('UPDATE mp_apps SET status = ?, reject_reason = ?, updated_at = ? WHERE id = ?')
    .run(appStatus, '', now, Number(app.id));

  // 审核快照：应用表也写入待审配置，便于后台对照；发布时才正式生效。
  await db.prepare(`
    UPDATE mp_apps SET entry_url = ?, allowed_origins = ?, scopes = ?, version = ?, updated_at = ?
    WHERE id = ? AND status != 'published'
  `).run(entryURL, JSON.stringify(origins), JSON.stringify(scopes), version, now, Number(app.id));

  return getVersionById(db, app.id, versionId);
}

export async function approveVersion(db, app, versionId) {
  const version = await getVersionById(db, app.id, versionId);
  if (!version) throw notFound('VERSION_NOT_FOUND', '版本不存在');
  if (version.status !== 'reviewing') throw conflict('VERSION_NOT_REVIEWING', '该版本不在待审核状态');
  const now = nowIso();
  await db.prepare("UPDATE mp_app_versions SET status = 'approved', reviewed_at = ?, updated_at = ? WHERE id = ?")
    .run(now, now, Number(version.id));
  if (app.status === 'reviewing') {
    await db.prepare("UPDATE mp_apps SET status = 'approved', reject_reason = '', updated_at = ? WHERE id = ?")
      .run(now, Number(app.id));
  }
  return getVersionById(db, app.id, version.id);
}

export async function rejectVersion(db, app, versionId, reason) {
  const version = await getVersionById(db, app.id, versionId);
  if (!version) throw notFound('VERSION_NOT_FOUND', '版本不存在');
  if (version.status !== 'reviewing') throw conflict('VERSION_NOT_REVIEWING', '该版本不在待审核状态');
  const now = nowIso();
  await db.prepare(`
    UPDATE mp_app_versions SET status = 'rejected', reject_reason = ?, reviewed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(reason, now, now, Number(version.id));
  if (app.status === 'reviewing') {
    await db.prepare("UPDATE mp_apps SET status = 'rejected', reject_reason = ?, updated_at = ? WHERE id = ?")
      .run(reason, now, Number(app.id));
  }
  return getVersionById(db, app.id, version.id);
}

export async function publishVersion(db, app, versionId) {
  const version = await getVersionById(db, app.id, versionId);
  if (!version) throw notFound('VERSION_NOT_FOUND', '版本不存在');
  if (version.status !== 'approved') throw conflict('VERSION_NOT_APPROVED', '只有审核通过的版本才能发布');
  const now = nowIso();
  // 发布时再次兜底：入口 origin 必须在 allowedOrigins 中且排第一位
  const origins = normalizeOriginsForEntry(version.entry_url, version.allowed_origins);
  await db.prepare('UPDATE mp_app_versions SET allowed_origins = ? WHERE id = ?')
    .run(JSON.stringify(origins), Number(version.id));
  await db.prepare("UPDATE mp_app_versions SET status = 'superseded', updated_at = ? WHERE app_id = ? AND status = 'published'")
    .run(now, Number(app.id));
  await db.prepare("UPDATE mp_app_versions SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?")
    .run(now, now, Number(version.id));
  await db.prepare(`
    UPDATE mp_apps
    SET entry_url = ?, allowed_origins = ?, scopes = ?, version = ?, status = 'published',
        published_at = COALESCE(published_at, ?), reject_reason = '', updated_at = ?
    WHERE id = ?
  `).run(
    version.entry_url, JSON.stringify(origins), version.scopes, version.version,
    now, now, Number(app.id),
  );
  return { app: await getApp(db, app.app_key), version: await getVersionById(db, app.id, version.id) };
}

export async function unpublishApp(db, app) {
  const now = nowIso();
  await db.prepare("UPDATE mp_apps SET status = 'offline', updated_at = ? WHERE id = ?")
    .run(now, Number(app.id));
  return mapApp(await getApp(db, app.app_key));
}