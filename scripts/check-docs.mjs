import { chromium } from 'playwright';
const b=await chromium.launch({headless:true,args:['--no-sandbox']});
const p=await b.newPage({viewport:{width:1440,height:1000}});
const errs=[];
p.on('pageerror',e=>errs.push('pageerror '+e.message));
p.on('console',m=>{ if(m.type()==='error' && !m.text().includes('401')) errs.push('console '+m.text()); });
await p.goto('http://localhost:8080/#/docs',{waitUntil:'networkidle'});
await p.waitForSelector('.doc-layout');
const link=await p.locator('a[href="/downloads/app-integration-docs.zip"]').count();
const status=await p.evaluate(async()=> (await fetch('/downloads/app-integration-docs.zip')).status);
console.log('docs link',link,'zip status',status);
await b.close();
if(errs.length){console.error(errs);process.exit(1);}
console.log('docs page OK');
