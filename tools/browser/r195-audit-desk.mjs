/** Real Chromium mobile+desktop offline E2E. Test actual download/import,
 * replay/tamper refusal, filter, role CSV, file reload and console/CSP errors. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {buildR194Fixture} from '../../ops/r194/fixture.mjs';
import {renderR195Dashboard} from '../../ops/r195/dashboard.mjs';
const fixture=await buildR194Fixture();
const rendered=renderR195Dashboard({commit:fixture.commit,
 bundleSha256:fixture.bundleSha256,
 assessment:fixture.after.assessment,ledger:fixture.board,
 evidenceDelta:fixture.evidenceDelta,riskTrend:fixture.riskTrend});
const root=mkdtempSync(join(tmpdir(),'marcosa-r195-chromium-'));
const file=join(root,'index.html');
writeFileSync(file,rendered.html,'utf8');
const screenshotDir=process.env.MARCOSA_BROWSER_SCREENSHOTS||
 join(root,'screenshots');
mkdirSync(screenshotDir,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const issues=[],requests=[];
try{
 for(const width of [360,390,768,1440]){
  const context=await browser.newContext({viewport:{width,height:900},
   offline:true,acceptDownloads:true});
  const page=await context.newPage();
  page.on('pageerror',e=>issues.push(String(e)));
  page.on('console',msg=>{if(msg.type()==='error')issues.push(msg.text());});
  page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(()=>document.querySelector('#r195-message')?.textContent.includes('Автономный режим'));
  assert.equal(await page.locator('article.control').count(),8);
  assert.equal(await page.locator('article.control:visible').count(),8);
  assert.equal(await page.locator('button[data-r195-owner]').count(),6);
  const geometry=await page.evaluate(()=>({
   contentWidth:document.documentElement.scrollWidth,viewport:innerWidth
  }));
  assert.ok(geometry.contentWidth<=geometry.viewport+1,
   'horizontal mobile overflow: '+JSON.stringify(geometry));
  await page.screenshot({path:join(screenshotDir,'marcosa-r195-'+width+'.png'),
   fullPage:true});
  await page.locator('#r194-search').fill('TLS');
  assert.equal(await page.locator('article.control:visible').count(),1);
  await page.locator('#r194-search').fill('');
  await page.locator('#r195-owner').selectOption('SECURITY');
  assert.equal(await page.locator('article.control:visible').count(),2);
  await page.locator('#r195-owner').selectOption('ALL');
  const card=page.locator('#control-TLS_ORIGIN');
  const otherCard=page.locator('#control-PRIVACY_LEGAL');
  assert.match(await otherCard.locator('.r195-progress').innerText(),/Не начато/);
  await card.locator('button[data-r195-action="REOPEN"]').click();
  await page.waitForFunction(()=>document.querySelector('#control-TLS_ORIGIN .r195-progress')?.textContent.includes('Не начато'));
  assert.match(await otherCard.locator('.r195-progress').innerText(),/Не начато/);
  await card.locator('button[data-r195-action="START"]').click();
  await page.waitForFunction(()=>document.querySelector('#control-TLS_ORIGIN .r195-progress')?.textContent.includes('В работе'));
  assert.match(await otherCard.locator('.r195-progress').innerText(),/Не начато/);
  await card.locator('button[data-r195-action="COMPLETE"]').click();
  await page.waitForFunction(()=>document.querySelector('#control-TLS_ORIGIN .r195-progress')?.textContent.includes('Локально завершено'));
  assert.match(await otherCard.locator('.r195-progress').innerText(),/Не начато/);
  assert.match(await card.locator('.r195-progress').innerText(),/Локально завершено/);
  assert.equal(await page.locator('#r195-count').innerText(),'3');
  await page.locator('#r194-filter').selectOption('LOCAL_DONE');
  assert.equal(await page.locator('article.control:visible').count(),1);
  await page.locator('#r194-filter').selectOption('ALL');
  const [download] = await Promise.all([
   page.waitForEvent('download'),page.locator('#r195-export').click()
  ]);
  assert.match(download.suggestedFilename(),/r195-.*-draft.json/);
  const raw=readFileSync(await download.path(),'utf8');
  const exported=JSON.parse(raw);
  assert.equal(exported.schemaVersion,2);
  assert.equal(exported.decision,'NO_GO');
  assert.equal(exported.events.length,3);
  assert.equal(exported.progress.TLS_ORIGIN,'DONE_LOCAL');
  assert.equal(exported.productionAuthorized,false);
  await page.locator('#r195-reset').click();
  assert.equal(await page.locator('#r195-count').innerText(),'0');
  await page.locator('#r195-file').setInputFiles({
   name:'portable.json',mimeType:'application/json',buffer:Buffer.from(raw)
  });
  await page.locator('#r195-import').click();
  await page.waitForFunction(()=>document.querySelector('#r195-message').textContent.includes('Черновик v2 проверен'));
  assert.equal(await page.locator('#r195-count').innerText(),'3');
  const attack={...exported,events:exported.events.map((x,i)=>
    i===0?{...x,to:'DONE_LOCAL'}:x)};
  await page.locator('#r195-file').setInputFiles([]);
  await page.locator('#r195-paste').fill(JSON.stringify(attack));
  await page.locator('#r195-import').click();
  await page.waitForFunction(()=>document.querySelector('#r195-message').textContent.includes('Импорт отклонён'));
  assert.equal(await page.locator('#r195-count').innerText(),'3');
  const [roleDownload]=await Promise.all([
   page.waitForEvent('download'),
   page.locator('button[data-r195-owner="SECURITY"]').click()
  ]);
  assert.match(roleDownload.suggestedFilename(),/security-handoff.csv/);
  assert.match(readFileSync(await roleDownload.path(),'utf8'),/NO_GO/);
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#r195-message')?.textContent.includes('Автономный режим'));
  assert.equal(await page.locator('#r195-count').innerText(),'0');
  await context.close();
 }
 assert.deepEqual(requests,[]);
 assert.deepEqual(issues,[]);
 console.log('R195_REAL_CHROMIUM_360_390_768_1440_FILE_IMPORT_EXPORT_ROLE_CSV_SHA256_OFFLINE=PASS');
 console.log('R195_PRODUCTION_OR_REAL_HUMAN_APPROVAL=NO_GO');
}finally{
 await browser.close();
 if(!process.env.MARCOSA_BROWSER_SCREENSHOTS)rmSync(root,{recursive:true,force:true});
}
