/**
 * Real Chromium R153 acceptance: editorial UI, selective consent erasure,
 * paginated private inbox and bulk dismissal, desktop + mobile.
 */
import {chromium} from 'playwright';
import {createApp} from '../../server-lab/server.mjs';
import {mkdtemp,mkdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const app=createApp({inviteCode:'r153-chromium-editor-invite'});
const evidence=process.env.MARCOSA_BROWSER_SCREENSHOTS||
 join(await mkdtemp(join(tmpdir(),'marcosa-editor-')),'screenshots');
await mkdir(evidence,{recursive:true});
let browser;
const ensure=(condition,message)=>{if(!condition)throw Error(message);};
try{
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port;
 async function api(path,{method='GET',cookie='',body}={}){
  const response=await fetch(base+'/api'+path,{method,headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const json=await response.json();
  if(!response.ok)throw Error(method+' '+path+' HTTP '+response.status+' '+JSON.stringify(json));
  return{json,cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 async function account(name){
  const creds={username:name,email:name+'@example.invalid',password:'long-r153-playwright-password',inviteCode:'r153-chromium-editor-invite'};
  await api('/auth/register',{method:'POST',body:creds});
  const login=await api('/auth/login',{method:'POST',body:creds});
  return{cookie:login.cookie,world:(await api('/auth/me',{cookie:login.cookie})).json.worlds[0].id};
 }
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 for(const {size,width,height} of [
  {size:'desktop',width:1440,height:900},
  {size:'mobile',width:390,height:844}
 ]){
  const author=await account('ed153'+size),reader=await account('rd153'+size);
  const slug='editor-season-'+size,route='/series/'+slug;
  await api('/series',{method:'POST',cookie:author.cookie,
   body:{slug,worldId:author.world,title:'R153 Original Season',description:'A real editor fixture'}});
  const publish=async title=>{
   const post=(await api('/posts',{method:'POST',cookie:author.cookie,
    body:{worldId:author.world,status:'published',body:title}})).json;
   const added=(await api(route+'/episodes',{method:'POST',cookie:author.cookie,
    body:{postId:post.id,title}})).json;
   return{postId:post.id,episodeId:added.id};
  };
  const posts=[];
  for(let i=0;i<3;i++)posts.push(await publish('R153 chapter '+i+' '+size));
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
  const raw=author.cookie.split('=');
  await context.addCookies([{name:raw[0],value:raw.slice(1).join('='),url:base,sameSite:'Strict',httpOnly:true}]);
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(base+route,{waitUntil:'domcontentloaded'});
  const meta=page.locator('#series-meta');
  await meta.evaluate(el=>{el.closest('details').open=true});
  await meta.locator('[name="title"]').fill('R153 Edited Season');
  await meta.locator('[name="description"]').fill('');
  await Promise.all([
   page.waitForNavigation({waitUntil:'domcontentloaded',timeout:15000}),
   meta.locator('button').click()
  ]);
  ensure((await api(route,{cookie:author.cookie})).json.series.title==='R153 Edited Season',
   'Metadata title was not persisted');
  const list=page.locator('#episode-editor li');
  await list.first().getByRole('button',{name:'Ниже'}).click();
  await page.waitForLoadState('domcontentloaded');
  let episodes=(await api(route,{cookie:author.cookie})).json.episodes;
  ensure(episodes[0].id===posts[1].episodeId,'Editorial order not persisted');
  const edit=page.locator('#episode-editor li').first();
  await edit.locator('input').fill('R153 Updated Chapter');
  await Promise.all([
   page.waitForNavigation({waitUntil:'domcontentloaded',timeout:15000}),
   edit.getByRole('button',{name:'Переименовать'}).click()
  ]);
  episodes=(await api(route,{cookie:author.cookie})).json.episodes;
  ensure(episodes[0].title==='R153 Updated Chapter','Episode rename not persisted');
  page.once('dialog',dialog=>dialog.accept());
  await Promise.all([
   page.waitForNavigation({waitUntil:'domcontentloaded',timeout:15000}),
   page.locator('#episode-editor li').last().getByRole('button',{name:'Убрать из сезона'}).click()
  ]);
  episodes=(await api(route,{cookie:author.cookie})).json.episodes;
  ensure(episodes.length===2,'Episode removal not persisted');
  ensure(app.db.prepare('SELECT COUNT(*) AS n FROM posts WHERE id=?').get(posts[2].postId).n===1,
   'Deleting a season relation must not delete the source post');
  const readerContext=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
  const rc=reader.cookie.split('=');
  await readerContext.addCookies([{name:rc[0],value:rc.slice(1).join('='),url:base,
   sameSite:'Strict',httpOnly:true}]);
  const readerPage=await readerContext.newPage();
  readerPage.on('pageerror',e=>errors.push(String(e)));
  await readerPage.goto(base+route,{waitUntil:'domcontentloaded'});
  ensure(await readerPage.locator('#episode-editor').count()===0,
   'Non-owners must not see editorial controls');
  await api(route+'/subscription',{method:'POST',cookie:reader.cookie,body:{}});
  await api(route+'/metrics/attendance',{method:'POST',cookie:reader.cookie,
   body:{episodeId:episodes[0].id,consent:true}});
  await readerPage.reload({waitUntil:'domcontentloaded'});
  const revoke=readerPage.getByRole('button',{name:/Снять отметку с выпуска/});
  await revoke.waitFor({timeout:12000});
  await revoke.click();
  ensure(!(await api(route+'/metrics/attendance',{cookie:reader.cookie})).json.episodes[0].marked,
   'Reader failed to remove voluntary attendance mark');
  for(let i=0;i<23;i++)await publish('R153 new subscriber chapter '+i+' '+size);
  await readerPage.goto(base+'/series',{waitUntil:'domcontentloaded'});
  const more=readerPage.getByRole('button',{name:'Показать ещё'});
  await more.waitFor({timeout:12000});
  await more.click();
  await readerPage.locator('#series-reminders li').filter({hasText:'R153 new subscriber chapter 0'}).waitFor({timeout:12000});
  const clear=readerPage.getByRole('button',{name:'Скрыть все напоминания'});
  await clear.click();
  await readerPage.getByText('Все напоминания скрыты.').waitFor({timeout:12000});
  ensure((await api('/me/series-reminders',{cookie:reader.cookie})).json.items.length===0,
   'Bulk dismissal must erase private reminders');
  const overflow=await readerPage.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  ensure(overflow<=2,'R153 horizontal overflow '+size);
  ensure(errors.length===0,'Uncaught JS page errors '+size+': '+errors.join('; '));
  const path=join(evidence,size+'-r153-editor-and-inbox.png');
  await readerPage.screenshot({path,fullPage:true});
  ensure((await stat(path)).size>4000,'Expected browser screenshot missing');
  await readerContext.close();await context.close();
  console.log('PASS R153 '+size+': editor > reorder > rename > unlink > private mark erasure > paginated inbox > clear all');
 }
}finally{
 if(browser)await browser.close();
 await app.close();
}
