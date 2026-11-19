/**
 * 移动端回归（390×844）：检查开发者控制台、公开页和后台是否有横向溢出。
 * 运行：node --no-warnings scripts/verify-responsive.mjs
 * 产物：screenshots/2x-mobile-*.png
 * 有横向溢出、console error 或 pageerror 时以非零码退出。
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from '../src/config.js';

process.loadEnvFile?.(path.join(ROOT, '.env'));
const base = (process.env.MP_BASE || 'http://localhost:8080').replace(/\/+$/, '');
const outDir = path.join(ROOT, 'screenshots');
fs.mkdirSync(outDir, { recursive: true });
const email = process.env.MP_VERIFY_DEV_EMAIL || 'demo@mp.local';
const password = process.env.MP_VERIFY_DEV_PASSWORD || 'demo123456';

const problems = [];

function watch(page, name) {
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('401')) problems.push(`[${name}] console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[${name}] pageerror: ${e.message}`));
}

async function findOverflow(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= vw + 1) return [];
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && (rect.right > vw + 1 || rect.left < -1)) {
        const cls = typeof el.className === 'string'
          ? el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
        out.push(`${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} (${Math.round(rect.width)}px)`);
        if (out.length >= 5) break;
      }
    }
    return out.length ? out : ['(document 级溢出，无法定位到具体元素)'];
  });
}

async function check(page, name) {
  const offenders = await findOverflow(page);
  if (offenders.length) problems.push(`[${name}] 横向溢出：${offenders.join('、')}`);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log(`${offenders.length ? 'FAIL' : 'ok  '} ${name}`);
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  watch(page, 'mobile');

  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await check(page, '21-mobile-landing');

  await page.goto(`${base}/#/login`, { waitUntil: 'networkidle' });
  await page.waitForSelector('form[data-form="login"]');
  await check(page, '22-mobile-login');

  await page.goto(`${base}/#/docs`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.doc-layout');
  await page.waitForTimeout(300);
  await check(page, '23-mobile-docs');

  await page.goto(`${base}/#/login`, { waitUntil: 'networkidle' });
  await page.fill('form[data-form="login"] input[name="email"]', email);
  await page.fill('form[data-form="login"] input[name="password"]', password);
  await page.click('form[data-form="login"] button[type="submit"]');
  await page.waitForSelector('.stat-grid', { timeout: 10000 });
  await check(page, '24-mobile-dashboard');

  await page.goto(`${base}/#/apps`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await check(page, '25-mobile-apps');

  await page.goto(`${base}/#/account`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await check(page, '26-mobile-account');

  // 用独立上下文：开发者 Cookie 访问 /admin 会得到预期的 403，不应污染回归结果
  const adminCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const admin = await adminCtx.newPage();
  watch(admin, 'mobile-admin');
  await admin.goto(`${base}/admin`, { waitUntil: 'networkidle' });
  await admin.waitForSelector('form[data-form="admin-login"]');
  await check(admin, '27-mobile-admin-login');
} finally {
  await browser.close();
}

if (problems.length) {
  console.error('\n移动端发现问题：');
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}
console.log('\n移动端回归通过：无横向溢出、无 console/page 错误');