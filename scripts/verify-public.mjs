import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const base = 'https://applet.ssemarket.cn';
const token = execFileSync('node', ['--no-warnings', 'scripts/mint-token.js', '--user', '561'], { encoding: 'utf8' }).trim();
const lt = await (await fetch(`${base}/v1/launch-tickets`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ appKey: 'novel', deviceID: 'public_ui', origin: base }),
})).json();

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const problems = [];
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) problems.push(`console: ${m.text()}`); });

await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(300);
await page.screenshot({ path: 'screenshots/19-public-landing.png' });
console.log('public landing ok:', await page.title());

await page.goto(base + '/#/docs', { waitUntil: 'networkidle' });
await page.waitForSelector('.doc-layout');
console.log('public docs ok');

await page.goto(lt.launchURL, { waitUntil: 'networkidle' });
await page.waitForSelector('.mp-hero', { timeout: 10000 });
console.log('public mini program:', await page.locator('.mp-hero h1').innerText());
await page.waitForTimeout(500);
await page.screenshot({ path: 'screenshots/20-public-demo.png' });

const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const admin = await adminCtx.newPage();
admin.on('pageerror', (e) => problems.push(`admin pageerror: ${e.message}`));
await admin.goto(base + '/admin', { waitUntil: 'networkidle' });
await admin.fill('form[data-form="admin-login"] input[name="email"]', 'admin@mp.local');
await admin.fill('form[data-form="admin-login"] input[name="password"]', process.env.MP_ADMIN_PASSWORD || '');
await admin.click('form[data-form="admin-login"] button[type="submit"]');
await admin.waitForSelector('.stat-grid', { timeout: 10000 });
console.log('public admin login ok');
await admin.screenshot({ path: 'screenshots/21-public-admin.png' });

const zip = await page.evaluate(async () => {
  const r = await fetch('/downloads/app-integration-docs.zip');
  return { status: r.status, size: (await r.arrayBuffer()).byteLength };
});
console.log('docs zip', zip);

await browser.close();
if (problems.length) { console.error(problems); process.exit(1); }
console.log('public verification OK');
