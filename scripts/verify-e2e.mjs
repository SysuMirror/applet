import { chromium } from 'playwright';
const base=process.env.MP_BASE || 'http://localhost:8080';
const key='ui-test-'+Date.now().toString().slice(-6);
const name='UI 测试应用';
const problems=[];
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await ctx.newPage();
page.on('pageerror',e=>problems.push('pageerror '+e.message));
page.on('console',m=>{ if(m.type()==='error' && !m.text().includes('401')) problems.push('console '+m.text()); });

await page.goto(base+'/#/login',{waitUntil:'networkidle'});
await page.fill('form[data-form="login"] input[name="email"]','demo@mp.local');
await page.fill('form[data-form="login"] input[name="password"]','demo123456');
await page.click('form[data-form="login"] button[type="submit"]');
await page.waitForSelector('.stat-grid');

await page.goto(base+'/#/apps/new',{waitUntil:'networkidle'});
await page.fill('input[name="name"]',name);
await page.fill('input[name="appKey"]',key);
await page.fill('textarea[name="description"]','通过 UI 创建的端到端测试应用');
await page.fill('input[name="entryURL"]',base+'/demo/app?app='+key);
await page.fill('textarea[name="allowedOrigins"]',base);
await page.click('form[data-form="create-app"] button[type="submit"]');
await page.waitForURL(/apps\/ui-test-/);
await page.waitForSelector('.tabs');
console.log('created', key, 'status:', await page.locator('.detail-head .pill').first().innerText());

await page.click('button[data-action="submit-app"]');
await page.waitForSelector('form[data-modal-form]');
await page.fill('form[data-modal-form] input[name="version"]','1.0.0');
await page.fill('form[data-modal-form] textarea[name="changelog"]','UI 端到端测试提交');
await page.click('form[data-modal-form] button[type="submit"]');
await page.waitForTimeout(900);
console.log('after submit:', await page.locator('.detail-head .pill').first().innerText());

const actx=await browser.newContext({viewport:{width:1440,height:1000}});
const admin=await actx.newPage();
admin.on('pageerror',e=>problems.push('admin pageerror '+e.message));
await admin.goto(base+'/admin',{waitUntil:'networkidle'});
await admin.fill('form[data-form="admin-login"] input[name="email"]','admin@mp.local');
await admin.fill('form[data-form="admin-login"] input[name="password"]',process.env.MP_ADMIN_PASSWORD || '');
await admin.click('form[data-form="admin-login"] button[type="submit"]');
await admin.waitForSelector('.stat-grid');
await admin.goto(base+'/admin#/reviews',{waitUntil:'networkidle'});
await admin.waitForTimeout(600);
const card=admin.locator('.review-card',{hasText:name});
if(await card.count()===0) throw new Error('审核队列没有找到新应用');
await card.first().locator('button[data-action="open-review"]').first().click();
await admin.waitForSelector('.modal');
await admin.click('button[data-action="admin-approve"]');
await admin.waitForTimeout(900);
console.log('admin approved');

await page.reload({waitUntil:'networkidle'});
await page.waitForSelector('.tabs');
console.log('after approve:', await page.locator('.detail-head .pill').first().innerText());
await page.click('button[data-action="publish-app"]');
await page.click('[data-modal-confirm]');
await page.waitForTimeout(900);
console.log('after publish:', await page.locator('.detail-head .pill').first().innerText());

const tok=await (await import('child_process')).execFileSync('node',['--no-warnings','scripts/mint-token.js','--user','8888'],{encoding:'utf8'}).trim();
const tr=await fetch(base+'/v1/launch-tickets',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+tok},body:JSON.stringify({appKey:key,deviceID:'e2e',origin:base})});
const td=await tr.json();
if(!tr.ok) throw new Error('launch ticket '+JSON.stringify(td));
const dctx=await browser.newContext({viewport:{width:1440,height:1000}});
const demo=await dctx.newPage();
demo.on('pageerror',e=>problems.push('demo pageerror '+e.message));
await demo.goto(td.launchURL,{waitUntil:'networkidle'});
await demo.waitForSelector('.mp-hero');
console.log('demo opened:', await demo.locator('.mp-hero h1').innerText());
await demo.screenshot({path:'screenshots/14-e2e-demo.png'});
await page.screenshot({path:'screenshots/15-e2e-published.png'});

await browser.close();
if(problems.length){ console.error('PROBLEMS'); for(const p of problems) console.error('-',p); process.exit(1);}
console.log('E2E OK');
