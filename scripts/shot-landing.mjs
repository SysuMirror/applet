import { chromium } from 'playwright';
const b=await chromium.launch({headless:true,args:['--no-sandbox']});
const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto('http://localhost:8080/',{waitUntil:'networkidle'});
await p.waitForTimeout(400);
await p.screenshot({path:'screenshots/01-landing.png'});
await b.close();
