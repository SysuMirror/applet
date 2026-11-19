/**
 * 本地 UI 验收脚本（开发用，不参与运行时）。
 * 运行：node --no-warnings scripts/verify-ui.mjs
 * 产物：screenshots/*.png
 *
 * 脚本自给自足：登录演示开发者 → 新建一个临时小程序 → 提交审核 →
 * 管理员审核通过 → 开发者发布 → 票据换会话打开容器 → 移动端回归。
 * 结束后默认删除临时应用（MP_VERIFY_KEEP_APP=1 可保留）。
 * 任何 console/pageerror/requestfailed 或移动端横向溢出都会导致非零退出。
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadConfig, ROOT } from '../src/config.js';
import { signJwt } from '../src/jwt.js';

process.loadEnvFile?.(path.join(ROOT, '.env'));
const base = (process.env.MP_BASE || 'http://localhost:8080').replace(/\/+$/, '');
const outDir = path.join(ROOT, 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const config = loadConfig();
const suffix = Date.now().toString(36).slice(-6);
const appKey = `ui-verify-${suffix}`;
const appName = `UI 验收 ${suffix}`;
const demoEmail = process.env.MP_VERIFY_DEV_EMAIL || 'demo@mp.local';
const demoPassword = process.env.MP_VERIFY_DEV_PASSWORD || 'demo123456';

const problems = [];
const notes = [];

function watch(page, name) {
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('401')) problems.push(`[${name}] console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`[${name}] pageerror: ${err.message}`));
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (url.includes('/.well-known/') || url.endsWith('/favicon.ico')) return;
    problems.push(`[${name}] request failed: ${url} (${req.failure()?.errorText})`);
  });
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: false });
  console.log(`screenshot: ${name}`);
}

async function pillText(page) {
  return (await page.locator('.detail-head .pill').first().innerText()).trim();
}

async function waitPill(page, label, timeout = 10000) {
  // 页面 CSP 为 script-src 'self'，不能用 waitForFunction（内部会 eval），改用 locator 轮询。
  await page.locator('.detail-head .pill', { hasText: label }).first().waitFor({ timeout });
}

async function loginDeveloper(page) {
  await page.goto(`${base}/#/login`, { waitUntil: 'networkidle' });
  await page.fill('form[data-form="login"] input[name="email"]', demoEmail);
  await page.fill('form[data-form="login"] input[name="password"]', demoPassword);
  await page.click('form[data-form="login"] button[type="submit"]');
  await page.waitForSelector('.stat-grid', { timeout: 10000 });
}

async function createApp(page) {
  await page.goto(`${base}/#/apps/new`, { waitUntil: 'networkidle' });
  await page.waitForSelector('form[data-form="create-app"]');
  await page.fill('input[name="name"]', appName);
  await page.fill('input[name="appKey"]', appKey);
  await page.fill('textarea[name="description"]', '自动化 UI 验收创建的小程序，用于覆盖创建 → 审核 → 发布链路。');
  await page.fill('input[name="entryURL"]', `${base}/demo/app?app=${appKey}`);
  await page.fill('textarea[name="allowedOrigins"]', base);
  await page.click('form[data-form="create-app"] button[type="submit"]');
  await page.waitForURL(new RegExp(`#/apps/${appKey}`), { timeout: 10000 });
  await page.waitForSelector('.tabs');
}

async function submitForReview(page) {
  await page.click('button[data-action="submit-app"]');
  await page.waitForSelector('form[data-modal-form]');
  await page.fill('form[data-modal-form] input[name="version"]', '1.0.0');
  await page.fill('form[data-modal-form] textarea[name="changelog"]', 'UI 验收：首版提交审核');
  await page.click('form[data-modal-form] button[type="submit"]');
  await page.waitForSelector('form[data-modal-form]', { state: 'detached', timeout: 10000 });
  await waitPill(page, '审核中');
}

async function approveAsAdmin(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const admin = await ctx.newPage();
  watch(admin, 'admin');
  await admin.goto(`${base}/admin`, { waitUntil: 'networkidle' });
  await admin.fill('form[data-form="admin-login"] input[name="email"]', process.env.MP_ADMIN_EMAIL || 'admin@mp.local');
  await admin.fill('form[data-form="admin-login"] input[name="password"]', process.env.MP_ADMIN_PASSWORD || '');
  await admin.click('form[data-form="admin-login"] button[type="submit"]');
  await admin.waitForSelector('.stat-grid', { timeout: 10000 });
  await shot(admin, '09-admin-overview');

  await admin.goto(`${base}/admin#/reviews`, { waitUntil: 'networkidle' });
  await admin.waitForTimeout(600);
  await shot(admin, '10-admin-reviews');

  const card = admin.locator('.review-card', { hasText: appName }).first();
  if (await card.count() === 0) throw new Error(`审核队列里没有找到「${appName}」`);
  await card.locator('button[data-action="open-review"]').first().click();
  await admin.waitForSelector('.modal', { timeout: 5000 });
  await shot(admin, '11-admin-review-modal');
  await admin.click('button[data-action="admin-approve"]');
  await admin.waitForTimeout(900);
  const stillThere = await admin.locator('.review-card', { hasText: appName }).count();
  if (stillThere) throw new Error('审核通过后应用仍留在审核队列');
  await ctx.close();
}

async function launchDemo(browser, viewport) {
  const token = signJwt({ sub: '561' }, config.mainJwtSecret, 600);
  const res = await fetch(`${base}/v1/launch-tickets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ appKey, deviceID: 'ui_verify', origin: base }),
  });
  const ticket = await res.json();
  if (!res.ok) throw new Error(`申请启动票据失败：${JSON.stringify(ticket)}`);
  const ctx = await browser.newContext({ viewport });
  const demo = await ctx.newPage();
  watch(demo, 'demo');
  await demo.goto(ticket.launchURL, { waitUntil: 'networkidle' });
  await demo.waitForSelector('.mp-hero', { timeout: 10000 });
  await demo.waitForTimeout(500);
  return { ctx, demo, launchURL: ticket.launchURL };
}

/** 找出移动端横向溢出的具体元素，便于定位。 */
async function findOverflow(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= vw + 1) return [];
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && (rect.right > vw + 1 || rect.left < -1)) {
        const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
        out.push(`${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} (${Math.round(rect.width)}px)`);
        if (out.length >= 5) break;
      }
    }
    return out.length ? out : ['(无法定位，可能是 document 级溢出)'];
  });
}

async function assertNoOverflow(page, name) {
  const offenders = await findOverflow(page);
  if (offenders.length) problems.push(`[${name}] 移动端横向溢出：${offenders.join('、')}`);
}

async function cleanupApp(page) {
  if (process.env.MP_VERIFY_KEEP_APP === '1') {
    notes.push(`已保留临时应用 ${appKey}（MP_VERIFY_KEEP_APP=1）`);
    return;
  }
  try {
    await page.goto(`${base}/#/apps/${appKey}/overview`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.tabs', { timeout: 8000 });
    if (await page.locator('button[data-action="unpublish-app"]').count()) {
      await page.click('button[data-action="unpublish-app"]');
      await page.waitForSelector('[data-modal-confirm]');
      await page.click('[data-modal-confirm]');
      await page.waitForTimeout(800);
    }
    if (await page.locator('button[data-action="delete-app"]').count()) {
      await page.click('button[data-action="delete-app"]');
      await page.waitForSelector('[data-modal-confirm]');
      await page.click('[data-modal-confirm]');
      await page.waitForTimeout(800);
    }
    notes.push(`已清理临时应用 ${appKey}`);
  } catch (err) {
    notes.push(`清理临时应用失败（不影响验收结论）：${err.message}`);
  }
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
let pageRef = null;
let created = false;
try {
  // ── 公开页面 + 开发者控制台 ──────────────────────────────────────────
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  pageRef = page;
  watch(page, 'portal');

  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await shot(page, '01-landing');

  await page.goto(`${base}/#/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  await shot(page, '02-login');

  await loginDeveloper(page);
  await page.waitForTimeout(400);
  await shot(page, '03-dashboard');

  await createApp(page);
  created = true;
  await shot(page, '05-app-detail');

  await page.goto(`${base}/#/apps/${appKey}/config`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#secret-value', { timeout: 8000 });
  await shot(page, '06-app-config');

  await page.goto(`${base}/#/apps/${appKey}/versions`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tabs');
  await shot(page, '07-app-versions');

  await page.goto(`${base}/#/apps`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.app-card', { timeout: 8000 });
  await shot(page, '04-apps');

  await page.goto(`${base}/#/apps/${appKey}/overview`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tabs');
  await submitForReview(page);
  await shot(page, '08-app-submitted');

  // ── 管理后台审核 ────────────────────────────────────────────────────
  await approveAsAdmin(browser);

  // ── 开发者发布 ──────────────────────────────────────────────────────
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.tabs');
  await page.click('button[data-action="publish-app"]');
  await page.waitForSelector('[data-modal-confirm]');
  await page.click('[data-modal-confirm]');
  await waitPill(page, '已发布');
  await shot(page, '12-app-published');

  // ── 小程序容器演示 ──────────────────────────────────────────────────
  const desktop = await launchDemo(browser, { width: 1440, height: 1000 });
  await shot(desktop.demo, '13-demo-miniapp');
  await desktop.demo.click('#capsule button[data-mp-action="menu"]');
  await shot(desktop.demo, '14-demo-menu');

  // ── 账号 / 文档 ─────────────────────────────────────────────────────
  await page.goto(`${base}/#/account`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await shot(page, '15-account');

  await page.goto(`${base}/#/docs`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.doc-layout');
  await shot(page, '16-docs');

  // ── 移动端回归 ──────────────────────────────────────────────────────
  const mobileCtx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  });
  const mobile = await mobileCtx.newPage();
  watch(mobile, 'mobile');
  await mobile.goto(`${base}/`, { waitUntil: 'networkidle' });
  await mobile.waitForTimeout(300);
  await assertNoOverflow(mobile, 'mobile-landing');
  await shot(mobile, '17-mobile-landing');
  await mobile.goto(`${base}/#/docs`, { waitUntil: 'networkidle' });
  await mobile.waitForSelector('.doc-layout');
  await mobile.waitForTimeout(300);
  await assertNoOverflow(mobile, 'mobile-docs');
  await shot(mobile, '18-mobile-docs');
  await mobileCtx.close();

  const mobileDemo = await launchDemo(browser, { width: 390, height: 844 });
  await assertNoOverflow(mobileDemo.demo, 'mobile-demo');
  await shot(mobileDemo.demo, '19-mobile-demo');
  await mobileDemo.ctx.close();

  // 桌面 demo 上下文后关
  await desktop.ctx.close();
} finally {
  // 验收中途失败也尽量清掉临时应用，避免污染开发者控制台和审核队列
  if (pageRef && created) await cleanupApp(pageRef);
  await browser.close();
}

for (const note of notes) console.log(`note: ${note}`);
if (problems.length) {
  console.error('\n发现前端问题：');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log('\nUI 验收通过，无 console/page 错误，移动端无横向溢出');