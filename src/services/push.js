import { decryptSecret } from '../util.js';

/**
 * 推送投递器。默认未配置任何渠道时，通知只保留为站内消息（App 轮询/本地通知兜底）。
 * 配置 MP_PUSH_WEBHOOK 后，会把通知与设备 token 交给聚合推送网关（FCM/HMS/APNs 的适配层）。
 *
 * Webhook 请求体：
 *   { notification: {...}, devices: [{ deviceId, platform, provider, token, locale }] }
 * 返回 2xx 视为投递成功。
 */
export class PushService {
  constructor({ config, log }) {
    this.config = config;
    this.log = log;
  }

  get enabled() {
    return Boolean(this.config.pushWebhook);
  }

  async devicesFor(db, userId) {
    const rows = await db.prepare(
      'SELECT * FROM mp_devices WHERE user_id = ? AND notification_enabled = 1',
    ).all(String(userId));
    return rows.map((row) => {
      let token = '';
      try {
        if (row.push_token_cipher) token = decryptSecret(row.push_token_cipher, this.config.appSecretMasterKey);
      } catch { token = ''; }
      return {
        deviceId: row.device_id,
        platform: row.platform,
        provider: row.push_provider,
        token,
        locale: row.locale || '',
      };
    }).filter((d) => d.token && d.provider !== 'local');
  }

  async deliver(db, notification) {
    if (!this.enabled) {
      await this.markStatus(db, notification.id, 'in_app', '');
      return { status: 'in_app' };
    }
    const devices = await this.devicesFor(db, notification.user_id);
    if (!devices.length) {
      await this.markStatus(db, notification.id, 'in_app', '');
      return { status: 'in_app' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.pushTimeoutMs);
    try {
      const res = await fetch(this.config.pushWebhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          notification: {
            id: notification.id,
            userId: notification.user_id,
            appKey: notification.app_key,
            eventId: notification.event_id,
            title: notification.title,
            body: notification.body,
          },
          devices,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`推送网关返回 HTTP ${res.status}`);
      await this.markStatus(db, notification.id, 'sent', '');
      return { status: 'sent' };
    } catch (err) {
      const message = String(err?.message || err).slice(0, 300);
      await this.markStatus(db, notification.id, 'failed', message);
      this.log?.warn('push.failed', { notificationId: notification.id, error: message });
      return { status: 'failed', error: message };
    } finally {
      clearTimeout(timer);
    }
  }

  async markStatus(db, id, status, error) {
    try {
      await db.prepare('UPDATE mp_notifications SET status = ?, error = ? WHERE id = ?')
        .run(status, error || '', Number(id));
    } catch (err) {
      this.log?.warn('push.status_update_failed', { id, error: String(err?.message || err) });
    }
  }
}