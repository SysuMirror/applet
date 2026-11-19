import { chromium } from 'playwright';
const b=await chromium.launch({headless:true,args:['--no-sandbox']});
const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto('https://applet.ssemarket.cn/admin',{waitUntil:'networkidle'});
await p.waitForTimeout(400);
console.log((await p.locator('body').innerText()).slice(0,500).replace(/\n/g,' | '));
await p.screenshot({path:'screenshots/30-admin-login-sso.png'});
await b.close();
