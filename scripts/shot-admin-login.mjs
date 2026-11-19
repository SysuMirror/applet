import { chromium } from 'playwright';
const b=await chromium.launch({headless:true,args:['--no-sandbox']});
const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto('https://applet.ssemarket.cn/admin',{waitUntil:'networkidle'});
await p.waitForTimeout(500);
await p.screenshot({path:'screenshots/22-admin-login.png'});
console.log('admin login shot');
await b.close();
