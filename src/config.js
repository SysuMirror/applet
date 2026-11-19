/**
 * 配置：全部来自环境变量，缺省值可直接在 YatTerra Pod 内运行。
 * 密钥首次启动自动生成并持久化到 <dataDir>/secrets.json（0600），
 * 保证 Pod 重启后已签发的会话 / 事件签名仍然有效。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(import.meta.dirname, '..');

function str(value, fallback = '') {
  const v = value == null ? '' : String(value).trim();
  return v || fallback;
}

function int(value, fallback) {
  const n = Number.parseInt(str(value), 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback = false) {
  const v = str(value).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return fallback;
}

function list(value) {
  return str(value).split(',').map((s) => s.trim()).filter(Boolean);
}

function loadSecrets(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'secrets.json');
  let secrets = {};
  if (fs.existsSync(file)) {
    try {
      secrets = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      throw new Error(`无法解析密钥文件 ${file}`);
    }
  }
  const keys = ['mainJwt', 'internal', 'appSecret', 'devJwt', 'metrics', 'ssoState'];
  let changed = false;
  for (const key of keys) {
    if (!secrets[key]) {
      secrets[key] = crypto.randomBytes(32).toString('base64url');
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(file, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch { /* ignore */ }
  }
  return secrets;
}

export function loadConfig(overrides = {}) {
  const env = process.env;
  const dataDir = path.resolve(overrides.dataDir || str(env.MP_DATA_DIR, path.join(ROOT, 'data')));
  const uploadsDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  const secrets = loadSecrets(dataDir);
  const port = int(overrides.port ?? env.PORT, 8080);
  const publicBase = str(
    overrides.publicBase || env.MP_PUBLIC_BASE || env.PUBLIC_URL,
    `http://localhost:${port}`,
  ).replace(/\/+$/, '');

  const config = {
    env: str(env.MP_ENV || env.NODE_ENV, 'production'),
    root: ROOT,
    dataDir,
    uploadsDir,
    host: str(env.MP_HOST, '0.0.0.0'),
    port,
    publicBase,
    launchBase: str(env.MP_LAUNCH_BASE, `${publicBase}/launch`),
    cookieSecure: bool(env.MP_COOKIE_SECURE, publicBase.startsWith('https://')),
    trustProxy: bool(env.MP_TRUST_PROXY, true),
    allowHttpLocalhost: bool(
      env.MP_ALLOW_HTTP_LOCALHOST,
      publicBase.startsWith('http://') || !str(env.MP_ENV, '').includes('prod'),
    ),

    // MySQL（独立库 + 独立账号；不与其他服务共用）
    db: {
      host: str(overrides.dbHost || env.MP_DB_HOST, 'mysql.platform-infra.svc.cluster.local'),
      port: int(overrides.dbPort ?? env.MP_DB_PORT, 3306),
      user: str(overrides.dbUser || env.MP_DB_USER, 'mp_service'),
      password: str(overrides.dbPassword ?? env.MP_DB_PASSWORD),
      name: str(overrides.dbName || env.MP_DB_NAME, 'ssemarket_mp'),
      poolSize: int(env.MP_DB_POOL_SIZE, 12),
    },

    // Redis（独立 ACL 用户，键前缀 mp:）
    redisUrl: str(overrides.redisUrl ?? env.MP_REDIS_URL),
    redisPrefix: str(env.MP_REDIS_PREFIX, 'mp:'),

    // MinIO 对象存储（图标等；凭证可能限定到某个桶）
    minio: {
      enabled: bool(env.MP_MINIO_ENABLED, Boolean(str(env.MP_MINIO_ENDPOINT))),
      endpoint: str(env.MP_MINIO_ENDPOINT, 'minio.platform-infra.svc.cluster.local'),
      port: int(env.MP_MINIO_PORT, 9000),
      useSSL: bool(env.MP_MINIO_USE_SSL, false),
      accessKey: str(env.MP_MINIO_ACCESS_KEY),
      secretKey: str(env.MP_MINIO_SECRET_KEY),
      bucket: str(env.MP_MINIO_BUCKET, 'applet'),
      prefix: str(env.MP_MINIO_PREFIX, 'ssemarket-mp/'),
    },

    // 主站用户身份校验
    mainJwtSecret: str(env.MP_MAIN_JWT_SECRET, secrets.mainJwt),
    mainJwksUrl: str(overrides.mainJwksUrl ?? env.MP_MAIN_JWKS_URL),
    mainJwtIssuer: str(overrides.mainJwtIssuer ?? env.MP_MAIN_JWT_ISSUER),
    mainJwtAudience: str(overrides.mainJwtAudience ?? env.MP_MAIN_JWT_AUDIENCE),

    // UniSSO（外部应用：OAuth2 授权码 + PKCE；M2M 仅内接应用可用）
    sso: {
      enabled: bool(env.MP_SSO_ENABLED, Boolean(str(env.MP_SSO_CLIENT_ID) && str(env.MP_SSO_CLIENT_SECRET))),
      base: str(env.MP_SSO_BASE, 'https://sso.ssemarket.cn').replace(/\/+$/, ''),
      clientId: str(env.MP_SSO_CLIENT_ID),
      clientSecret: str(env.MP_SSO_CLIENT_SECRET),
      redirectUri: str(env.MP_SSO_REDIRECT_URI, `${publicBase}/callback`),
      scopes: str(env.MP_SSO_SCOPES, 'openid profile:username profile:name profile:avatar email roles sse_identity'),
      stateTtl: int(env.MP_SSO_STATE_TTL, 600),
      stateSecret: str(env.MP_SSO_STATE_SECRET, secrets.ssoState),
      autoLogin: bool(env.MP_SSO_AUTO_LOGIN, true),
      sessionCookies: list(str(env.MP_SSO_SESSION_COOKIES, 'unisso_sid,sse_sso,unisso_session')),
      adminEmails: list(env.MP_SSO_ADMIN_EMAILS).map((v) => v.toLowerCase()),
      adminIds: list(env.MP_SSO_ADMIN_IDS),
      // 内接应用的无感登录与 OAuth 使用同一个 client；
      // 单独配置时优先用 MP_SSO_M2M_*，否则回退到主 client。
      m2mClientId: str(env.MP_SSO_M2M_CLIENT_ID) || str(env.MP_SSO_CLIENT_ID),
      m2mClientSecret: str(env.MP_SSO_M2M_CLIENT_SECRET) || str(env.MP_SSO_CLIENT_SECRET),
      timeoutMs: int(env.MP_SSO_TIMEOUT_MS, 8000),
      appTokenTtl: int(env.MP_SSO_APP_TOKEN_TTL, 7200),
    },
    // 主站可直接校验的 HTTP 接口（GET + Authorization: Bearer），用于不共享密钥的场景
    mainVerifyUrl: str(overrides.mainVerifyUrl ?? env.MP_MAIN_VERIFY_URL),
    internalVerifyUrl: str(overrides.internalVerifyUrl ?? env.MP_MAIN_INTERNAL_VERIFY_URL),

    internalSecret: str(env.MP_INTERNAL_SECRET, secrets.internal),
    appSecretMasterKey: crypto
      .createHash('sha256')
      .update(str(env.MP_APP_SECRET_KEY, secrets.appSecret))
      .digest(),
    devJwtSecret: str(env.MP_DEV_JWT_SECRET, secrets.devJwt),
    // 只有显式设置时才要求 Bearer 访问 /metrics；否则仅依赖平台网络边界
    metricsToken: str(env.MP_METRICS_TOKEN),

    devSessionTtl: int(env.MP_DEV_SESSION_TTL, 7 * 24 * 3600),
    sessionTtl: int(env.MP_SESSION_TTL, 2 * 3600),
    ticketTtl: int(env.MP_TICKET_TTL, 60),
    launchMode: str(env.MP_LAUNCH_MODE, 'direct') === 'gateway' ? 'gateway' : 'direct',
    notificationTzOffsetMinutes: int(env.MP_TZ_OFFSET_MINUTES, 480),

    adminEmail: str(env.MP_ADMIN_EMAIL, 'admin@mp.local').toLowerCase(),
    adminPassword: str(env.MP_ADMIN_PASSWORD, 'admin123456'),
    adminDisplayName: str(env.MP_ADMIN_NAME, '平台管理员'),

    pushWebhook: str(env.MP_PUSH_WEBHOOK),
    pushTimeoutMs: int(env.MP_PUSH_TIMEOUT_MS, 5000),
    maxNotificationsPerHour: int(env.MP_MAX_NOTIFICATIONS_PER_HOUR, 20),
    maxDevApps: int(env.MP_MAX_DEV_APPS, 10),
    maxOriginsPerApp: int(env.MP_MAX_ORIGINS_PER_APP, 10),
    corsExtraOrigins: list(env.MP_CORS_ORIGINS),
    demoMode: bool(env.MP_DEMO_MODE, true),

    rateLimits: {
      apiIp: int(env.MP_RL_API_IP, 600),
      userApi: int(env.MP_RL_USER_API, 240),
      launch: int(env.MP_RL_LAUNCH, 30),
      exchange: int(env.MP_RL_EXCHANGE, 60),
      login: int(env.MP_RL_LOGIN, 10),
      register: int(env.MP_RL_REGISTER, 5),
      devApi: int(env.MP_RL_DEV, 240),
      internal: int(env.MP_RL_INTERNAL, 600),
    },

    logLevel: str(env.MP_LOG_LEVEL, 'info'),
    logDir: str(env.LOG_DIR, path.join(ROOT, 'logs')),
    requestLog: bool(env.MP_REQUEST_LOG, true),
    dataRetentionDays: int(env.MP_RETENTION_DAYS, 30),
  };

  config.secrets = secrets;
  return config;
}

export const KNOWN_SCOPES = [
  'profile:read',
  'prefs:read',
  'prefs:write',
  'notifications:read',
  'notifications:write',
  'posts:read',
];

export const CATEGORIES = [
  { key: 'content', name: '内容', icon: 'book' },
  { key: 'tool', name: '工具', icon: 'wrench' },
  { key: 'life', name: '生活', icon: 'coffee' },
  { key: 'official', name: '官方', icon: 'badge' },
  { key: 'game', name: '游戏', icon: 'gamepad' },
  { key: 'shopping', name: '购物', icon: 'bag' },
  { key: 'other', name: '其他', icon: 'grid' },
];

export const TOPICS = ['new_posts'];

export const APP_STATUSES = ['draft', 'reviewing', 'approved', 'rejected', 'published', 'offline'];
export const VERSION_STATUSES = ['draft', 'reviewing', 'approved', 'rejected', 'published', 'superseded'];
export const PLATFORMS = ['android', 'ohos', 'windows', 'ios', 'web'];
export const PUSH_PROVIDERS = ['fcm', 'hms', 'apns', 'wns', 'local'];