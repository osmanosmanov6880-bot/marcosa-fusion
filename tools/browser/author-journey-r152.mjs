/**
 * R152 independent author-to-reader acceptance in real Chromium.
 * All sessions, posts and seasons are genuine loopback HTTP/SQLite actions.
 * Synthetic identities only; no external account or payment service.
 */
import {mkdtemp,mkdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../../server-lab/server.mjs';

const inviteCode='r152-real-author-journey-invite';
const app=createApp({inviteCode});
const evidence=process.env.MARCOSA_BROWSER_SCREENSHOTS||
 join(await mkdtemp(join(tmpdir(),'marcosa-r152-')),'screenshots');
await mkdir(evidence,{recursive:true});
let browser;
const assert=(ok,message)=>{if(!ok)throw Error(message);};
async function account(page,base,username){
 const email=username+'@example.invalid',password='real-browser-test-password-2026';
 await page.goto(base+'/',{waitUntil:'domcontentloaded'});
 const form=page.locator('#register-form');
 await form.evaluate(el=>{el.closest('details').open=true});
 await form.locator('[name="inviteCode"]').fill(inviteCode);
 await form.locator('[name="username"]').fill(username);
 await form.locator('[name="email"]').fill(email);
 await form.locator('[name="password"]').fill(password);
 await form.locator('button[type="submit"]').click();
 await page.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('Локальный профиль создан'),{timeout:12000});
 await page.locator('#login-form [name="email"]').fill(email);
 await page.locator('#login-form [name="password"]').fill(password);
 await page.locator('#login-form button[type="submit"]').click();
 await page.waitForFunction(name=>document.getElementById('identity')?.textContent==='@'+name,username,{timeout:12000});
 assert(await page.locator('#member-access').isVisible(),'Authenticated member area unavailable');
}
async function publish(page,base,text){
 await page.goto(base+'/',{waitUntil:'domcontentloaded'});
 await page.locator('#post-world option').first().waitFor({timeout:12000});
 await page.locator('#post-form textarea[name="body"]').fill(text);
 await page.locator('#post-form button[value="published"]').click();
 await page.waitForFunction(value=>document.querySelector('#my-posts')?.textContent.includes(value),text,{timeout:12000});
}
async function chapter(page,base,slug,title){
 await page.goto(base+'/series/'+slug,{waitUntil:'domcontentloaded'});
 const form=page.locator('#new-episode');
 assert(await form.count()===1,'Published author post missing in episode editor');
 await form.evaluate(el=>{el.closest('details').open=true});
 await form.locator('[name="title"]').fill(title);
 await Promise.all([
  page.waitForNavigation({waitUntil:'domcontentloaded',timeout:15000}),
  form.locator('button').click()
 ]);
 await page.locator('#series-tools .post').filter({hasText:title}).waitFor({timeout:12000});
}
async function journey(browser,base,{size,width,height}){
 const author=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
 const reader=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
 const a=await author.newPage(),b=await reader.newPage(),errors=[];
 for(const p of [a,b])p.on('pageerror',e=>errors.push(String(e)));
 const authorId='writer152'+size,readerId='fan152'+size,slug='season152-'+size;
 try{
  await account(a,base,authorId);
  await publish(a,base,'R152 verified original chapter one '+size);
  await a.goto(base+'/series',{waitUntil:'domcontentloaded'});
  const form=a.locator('#new-series');
  await form.evaluate(el=>{el.closest('details').open=true});
  await form.locator('[name="slug"]').fill(slug);
  await form.locator('[name="title"]').fill('R152 author season '+size);
  await form.locator('[name="description"]').fill('An original story made in the real local author interface');
  await Promise.all([
   a.waitForURL(url=>url.pathname==='/series/'+slug,{timeout:15000}),
   form.locator('button').click()
  ]);
  await chapter(a,base,slug,'Глава первая');
  await account(b,base,readerId);
  await b.goto(base+'/series/'+slug,{waitUntil:'domcontentloaded'});
  const subscribe=b.getByRole('button',{name:'Подписаться на новые эпизоды'});
  await subscribe.waitFor({timeout:12000});
  await subscribe.click();
  await b.getByRole('button',{name:'Отписаться от новых эпизодов'}).waitFor();
  const mark=b.locator('#series-tools button').filter({hasText:'я посмотрел выпуск'}).first();
  await mark.waitFor({timeout:12000});
  await mark.click();
  await b.getByRole('button',{name:'Удалить мои отметки'}).waitFor();
  await publish(a,base,'R152 verified original chapter two '+size);
  await chapter(a,base,slug,'Глава вторая');
  await b.goto(base+'/series',{waitUntil:'domcontentloaded'});
  const continueLabel=b.getByRole('heading',{name:'Продолжить чтение'});
  await continueLabel.waitFor({timeout:12000});
  const next=b.locator('#series-reminders a[href^="/series/"]');
  await next.filter({hasText:'Глава вторая'}).waitFor({timeout:12000});
  const dismiss=b.locator('#series-reminders button[aria-label*="Глава вторая"]');
  await dismiss.waitFor({timeout:12000});
  await dismiss.click();
  await b.getByText('Напоминание скрыто.').waitFor({timeout:12000});
  const overflow=await b.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  assert(overflow<=2,'Horizontal overflow on '+size+': '+overflow);
  const shot=join(evidence,size+'-creator-journey.png');
  await b.screenshot({path:shot,fullPage:true});
  assert((await stat(shot)).size>4000,'Empty browser evidence');
  assert(errors.length===0,'Uncaught browser errors: '+errors.join('; '));
  console.log('PASS R152 author-journey: '+size+' register/login > post > season > chapters > subscribe > consent > next > dismiss');
 }finally{await author.close();await reader.close();}
}
try{
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port;
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 await journey(browser,base,{size:'desktop',width:1440,height:900});
 await journey(browser,base,{size:'mobile',width:390,height:844});
}finally{
 if(browser)await browser.close();
 await app.close();
}
