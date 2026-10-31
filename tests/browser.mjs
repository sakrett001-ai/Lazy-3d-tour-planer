import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=path.resolve('test-results');await fs.mkdir(out,{recursive:true});
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:process.env.CHROMIUM_EXECUTABLE?['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']:[]});
const errors=[];const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(base);await page.waitForFunction(()=>window.LAZY);
 await page.screenshot({path:path.join(out,'desktop.png')});
 assert.equal(await page.evaluate(()=>window.LAZY.getProject().walls.length),4);
 await page.locator('[data-view="3d"]').click();
 const frame=await page.locator('#tourFrame').contentFrame();
 await frame.locator('canvas').waitFor({timeout:30000});
 await page.waitForFunction(()=>document.getElementById('tourFrame').contentWindow.TOUR?.ready,{},{timeout:30000});
 await page.screenshot({path:path.join(out,'3d.png')});
 const stats=await frame.locator('body').evaluate(()=>({ready:window.TOUR.ready,render:window.TOUR.renderer.info.render,errors:window.TOUR.errors}));
 console.log(JSON.stringify({stats,errors}));assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(r=>server.close(r))}
