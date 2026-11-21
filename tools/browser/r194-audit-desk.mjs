/**
 * Real Chromium mobile/desktop offline acceptance for R194. No login,
 * credentials, network traffic, server, deploy or localStorage needed.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {buildR194Fixture} from '../../ops/r194/fixture.mjs';
const f=await buildR194Fixture();
const dir=mkdtempSync(join(tmpdir(),'marcosa-r194-chromium-'));
const file=join(dir,'index.html');
writeFileSync(file,f.rendered.html,'utf8');
const screenshotDir=process.env.MARCOSA_BROWSER_SCREENSHOTS||join(dir,'screenshots');
mkdirSync(screenshotDir,{recursive:true});
const violations=[],errors=[];
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 for(const width of [390,1440]){
  const ctx=await browser.newContext({viewport:{width,height:900},offline:true});
  const page=await ctx.newPage();
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('request',request=>{
   if(/^https?:/.test(request.url()))violations.push(request.url());
  });
  await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(()=>document.querySelector('#r194-status')?.textContent.includes('Автономный режим'));
  assert.equal(await page.locator('article.control').count(),8);
  assert.equal(await page.locator('article.control:visible').count(),8);
  const overflow=await page.evaluate(()=>({
   sw:document.documentElement.scrollWidth,ww:window.innerWidth
  }));
  assert.ok(overflow.sw<=overflow.ww+1,'mobile viewport horizontal overflow '+JSON.stringify(overflow));
  await page.screenshot({path:join(screenshotDir,'marcosa-r194-'+width+'.png'),fullPage:true});
  await page.locator('#r194-search').fill('TLS');
  assert.equal(await page.locator('article.control:visible').count(),1);
  await page.locator('#r194-search').fill('');
  await page.locator('#r194-filter').selectOption('BLOCKED');
  assert.ok((await page.locator('article.control:visible').count())>=1);
  await page.locator('#r194-filter').selectOption('ALL');
  const card=page.locator('#control-TLS_ORIGIN');
  await card.locator('button[data-r194-action="REOPEN"]').click();
  await card.locator('button[data-r194-action="START"]').click();
  await card.locator('button[data-r194-action="COMPLETE"]').click();
  assert.match(await card.locator('.r194-progress').innerText(),/Локальная задача завершена/);
  await page.locator('#r194-filter').selectOption('LOCAL_DONE');
  assert.equal(await page.locator('article.control:visible').count(),1);
  await page.locator('#r194-export').click();
  const exported=await page.locator('#r194-export-json').inputValue();
  const data=JSON.parse(exported);
  assert.equal(data.decision,'NO_GO');
  assert.equal(data.productionAuthorized,false);
  assert.equal(data.progress.TLS_ORIGIN,'DONE_LOCAL');
  await page.locator('#r194-reset').click();
  await page.locator('#r194-import-json').fill(exported);
  await page.locator('#r194-import').click();
  assert.match(await page.locator('#r194-status').innerText(),/Импортирован/);
  await page.locator('#r194-import-json').fill('{"decision":"GO"}');
  await page.locator('#r194-import').click();
  assert.match(await page.locator('#r194-status').innerText(),/отклонён/);
  assert.ok(!await page.locator('#r194-status').innerText().then(s=>s.includes('Production разрешён')));
  await ctx.close();
 }
 assert.deepEqual(errors,[]);
 assert.deepEqual(violations,[]);
 console.log('R194_REAL_CHROMIUM_MOBILE_DESKTOP_OFFLINE_FILTER_TASK_IMPORT_EXPORT=PASS');
 console.log('R194_EXTERNAL_APPROVAL_PRODUCTION=NO_GO');
}finally{
 await browser.close();
 if(!process.env.MARCOSA_BROWSER_SCREENSHOTS)rmSync(dir,{recursive:true,force:true});
}
