-- 集市小程序开放平台 · MySQL 8 schema（库：ssemarket_mp）
-- 时间统一存 ISO-8601 UTC 文本，便于与 API 直接互通、避免时区歧义。
-- JSON 字段以 TEXT 存储（应用层序列化），避免驱动差异。

CREATE TABLE IF NOT EXISTS mp_developers (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email          VARCHAR(190) NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  display_name   VARCHAR(64) NOT NULL DEFAULT '',
  org_name       VARCHAR(128) NOT NULL DEFAULT '',
  phone          VARCHAR(32) NOT NULL DEFAULT '',
  role           VARCHAR(16) NOT NULL DEFAULT 'developer',
  status         VARCHAR(16) NOT NULL DEFAULT 'active',
  token_version  INT NOT NULL DEFAULT 0,
  email_verified TINYINT(1) NOT NULL DEFAULT 0,
  sso_sub        VARCHAR(64) NULL,
  auth_source    VARCHAR(16) NOT NULL DEFAULT 'password',
  avatar_url     VARCHAR(512) NOT NULL DEFAULT '',
  created_at     VARCHAR(32) NOT NULL,
  updated_at     VARCHAR(32) NOT NULL,
  last_login_at  VARCHAR(32) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_developer_email (email),
  UNIQUE KEY uk_developer_sso (sso_sub)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mp_apps (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  app_key          VARCHAR(64) NOT NULL,
  developer_id     BIGINT UNSIGNED NULL,
  name             VARCHAR(64) NOT NULL,
  description      VARCHAR(512) NOT NULL DEFAULT '',
  icon             VARCHAR(255) NOT NULL DEFAULT '',
  category         VARCHAR(32) NOT NULL DEFAULT 'content',
  entry_url        VARCHAR(1024) NOT NULL DEFAULT '',
  allowed_origins  TEXT NOT NULL,
  scopes           VARCHAR(512) NOT NULL,
  requested_scopes VARCHAR(512) NOT NULL,
  visibility       VARCHAR(16) NOT NULL DEFAULT 'logged_in',
  status           VARCHAR(16) NOT NULL DEFAULT 'draft',
  owner_type       VARCHAR(16) NOT NULL DEFAULT 'partner',
  sort             INT NOT NULL DEFAULT 0,
  version          VARCHAR(32) NOT NULL DEFAULT '1.0.0',
  pinyin           VARCHAR(128) NOT NULL DEFAULT '',
  keywords         VARCHAR(255) NOT NULL DEFAULT '',
  webhook_url      VARCHAR(1024) NOT NULL DEFAULT '',
  secret_hash      CHAR(64) NOT NULL DEFAULT '',
  secret_cipher    VARCHAR(512) NOT NULL DEFAULT '',
  reject_reason    VARCHAR(512) NOT NULL DEFAULT '',
  hosting_mode     VARCHAR(16) NOT NULL DEFAULT 'external',
  hosting_build    VARCHAR(64) NULL,
  hosting_token_hash CHAR(64) NOT NULL DEFAULT '',
  hosting_token_cipher VARCHAR(512) NOT NULL DEFAULT '',
  hosting_updated_at VARCHAR(32) NULL,
  published_at     VARCHAR(32) NULL,
  created_by       BIGINT UNSIGNED NULL,
  created_at       VARCHAR(32) NOT NULL,
  updated_at       VARCHAR(32) NOT NULL,
  deleted_at       VARCHAR(32) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_app_key (app_key),
  KEY idx_status_sort (status, sort, id),
  KEY idx_developer (developer_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mp_app_versions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  app_id          BIGINT UNSIGNED NOT NULL,
  version         VARCHAR(32) NOT NULL,
  entry_url       VARCHAR(1024) NOT NULL DEFAULT '',
  allowed_origins TEXT NOT NULL,
  scopes          VARCHAR(512) NOT NULL,
  changelog       TEXT NOT NULL,
  status          VARCHAR(16) NOT NULL DEFAULT 'draft',
  reject_reason   VARCHAR(512) NOT NULL DEFAULT '',
  submitted_at    VARCHAR(32) NULL,
  reviewed_at     VARCHAR(32) NULL,
  published_at    VARCHAR(32) NULL,
  created_at      VARCHAR(32) NOT NULL,
  updated_at      VARCHAR(32) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_app_version (app_id, version),
  KEY idx_versions_app (app_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mp_app_allowlist (
  app_id  BIGINT UNSIGNED NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  PRIMARY KEY (app_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mp_user_prefs (
  user_id     VARCHAR(128) NOT NULL,
  app_key     VARCHAR(64) NOT NULL,
  is_favorite TINYINT(1) NOT NULL DEFAULT 0,
  opened_at   VARCHAR(32) NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  VARCHAR(32) NOT NULL,
  updated_at  VARCHAR(32) NOT NULL,
  PRIMARY KEY (user_id, app_key),
  KEY idx_prefs_fav (user_id, is_favorite, opened_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mp_app_grants (
  user_id    VARCHAR(128) NOT NULL,
  app_key    VARCHAR(64) NOT NULL,
  scopes     VARCHAR(512) NOT NULL,
  granted_at VARCHAR(32) NOT NULL,
  revoked_at VARCHAR(32) NULL,
  PRIMARY KEY (user_id, app_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mp_devices (
  user_id              VARCHAR(128) NOT NULL,
  device_id            VARCHAR(128) NOT NULL,
  platform             VARCHAR(16) NOT NULL,
  app_version          VARCHAR(32) NOT NULL DEFAULT '',
  push_provider        VARCHAR(16) NOT NULL DEFAULT 'local',
  push_token_hash      CHAR(64) NOT NULL DEFAULT '',
  push_token_cipher    VARCHAR(2048) NULL,
  notification_enabled TINYINT(1) NOT NULL DEFAULT 1,
  locale               VARCHAR(20) NOT NULL DEFAULT '',
  last_seen_at         VARCHAR(32) NULL,
  created_at           VARCHAR(32) NOT NULL,
  updated_at           VARCHAR(32) NOT NULL,
  PRIMARY KEY (user_id, device_id),
  KEY idx_devices_platform (platform)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mp_subscriptions (
  user_id    VARCHAR(128) NOT NULL,
  topic      VARCHAR(32) NOT NULL,
  enabled    TINYINT(1) NOT NULL DEFAULT 1,
  quiet_from VARCHAR(5) NOT NULL DEFAULT '',
  quiet_to   VARCHAR(5) NOT NULL DEFAULT '',
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  PRIMARY KEY (user_id, topic)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mp_events (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id     VARCHAR(128) NOT NULL,
  type         VARCHAR(32) NOT NULL,
  payload      MEDIUMTEXT NOT NULL,
  dedup_key    VARCHAR(128) NULL,
  source       VARCHAR(16) NOT NULL DEFAULT 'main',
  received_at  VARCHAR(32) NOT NULL,
  processed_at VARCHAR(32) NULL,
  status       VARCHAR(16) NOT NULL DEFAULT 'received',
  error        VARCHAR(512) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY uk_event_id (event_id),
  KEY idx_event_dedup (dedup_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mp_notifications (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    VARCHAR(128) NOT NULL,
  event_id   VARCHAR(128) NULL,
  app_key    VARCHAR(64) NOT NULL DEFAULT 'new_posts',
  dedup_key  VARCHAR(128) NULL,
  title      VARCHAR(255) NOT NULL,
  body       VARCHAR(1024) NOT NULL DEFAULT '',
  status     VARCHAR(16) NOT NULL DEFAULT 'in_app',
  error      VARCHAR(512) NOT NULL DEFAULT '',
  created_at VARCHAR(32) NOT NULL,
  read_at    VARCHAR(32) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_notification_dedup (user_id, dedup_key),
  KEY idx_notifications_user (user_id, created_at),
  KEY idx_notifications_event (event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mp_launch_tickets (
  ticket_hash CHAR(64) NOT NULL,
  user_id     VARCHAR(128) NOT NULL,
  app_key     VARCHAR(64) NOT NULL,
  device_id   VARCHAR(128) NOT NULL DEFAULT '',
  origin      VARCHAR(255) NOT NULL DEFAULT '',
  created_at  VARCHAR(32) NOT NULL,
  expires_at  VARCHAR(32) NOT NULL,
  used_at     VARCHAR(32) NULL,
  PRIMARY KEY (ticket_hash),
  KEY idx_tickets_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mp_sessions (
  token_hash   CHAR(64) NOT NULL,
  user_id      VARCHAR(128) NOT NULL,
  app_key      VARCHAR(64) NOT NULL,
  device_id    VARCHAR(128) NOT NULL DEFAULT '',
  scopes       VARCHAR(512) NOT NULL,
  created_at   VARCHAR(32) NOT NULL,
  expires_at   VARCHAR(32) NOT NULL,
  last_seen_at VARCHAR(32) NOT NULL,
  revoked_at   VARCHAR(32) NULL,
  PRIMARY KEY (token_hash),
  KEY idx_sessions_user (user_id, created_at),
  KEY idx_sessions_expire (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mp_nonces (
  scope      VARCHAR(64) NOT NULL,
  nonce      VARCHAR(128) NOT NULL,
  expires_at VARCHAR(32) NOT NULL,
  PRIMARY KEY (scope, nonce),
  KEY idx_nonces_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mp_audit_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_type  VARCHAR(16) NOT NULL,
  actor_id    VARCHAR(128) NOT NULL DEFAULT '',
  action      VARCHAR(64) NOT NULL,
  target_type VARCHAR(32) NOT NULL DEFAULT '',
  target_key  VARCHAR(128) NOT NULL DEFAULT '',
  `before`    MEDIUMTEXT NULL,
  `after`     MEDIUMTEXT NULL,
  ip          VARCHAR(64) NOT NULL DEFAULT '',
  request_id  VARCHAR(64) NOT NULL DEFAULT '',
  created_at  VARCHAR(32) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_audit_created (created_at),
  KEY idx_audit_target (target_key, created_at),
  KEY idx_audit_actor (actor_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mp_feedback (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    VARCHAR(128) NOT NULL DEFAULT '',
  app_key    VARCHAR(64) NOT NULL DEFAULT '',
  content    VARCHAR(2048) NOT NULL,
  contact    VARCHAR(255) NOT NULL DEFAULT '',
  status     VARCHAR(16) NOT NULL DEFAULT 'open',
  created_at VARCHAR(32) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_feedback_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mp_usage_daily (
  day     VARCHAR(10) NOT NULL,
  app_key VARCHAR(64) NOT NULL,
  calls   BIGINT NOT NULL DEFAULT 0,
  users   INT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, app_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;