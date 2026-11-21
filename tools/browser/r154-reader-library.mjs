/**
 * R154 real desktop/mobile browser test of reader bookmarks, notification mute,
 * author archive/restore and personally downloadable portability JSON.
 */
import {chromium} from 'playwright';
import {createApp} from '../../server-lab/server.mjs';
import {verifySeasonPortability} from '../../server-lab/series-portability.mjs';
import {mkdtemp,mkdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const inviteCode='r154-browser-lab-invite',app=createApp({inviteCode});
const evidence=process.env.MARCOSA_BROWSER_SCREENSHOTS||join(await mkdtemp(join(tmpdir(),'r154-browser-')),'screenshots');
await mkdir(evidence,{recursive:true});
let browser;
const ensure=(ok,message)=>{if(!ok)throw Error(message);};
try{
 await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+app.server.address().port;
 async function api(path,{method='GET',cookie='',body}={}){
  const response=await fetch(base+'/api'+path,{method,headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const json=await response.json();
  ensure(response.ok,method+' '+path+' HTTP '+response.status+' '+JSON.stringify(json));
  return{json,cookie:response.headers.get('set-cookie')?.split(';')[0],
   disposition:response.headers.get('content-disposition')};
 }
 async function actor(name){
  const auth={username:name,email:name+'@example.invalid',password:'r154-unique-browser-test-password',inviteCode};
  await api('/auth/register',{method:'POST',body:auth});
  const login=await api('/auth/login',{method:'POST',body:auth});
  const me=(await api('/auth/me',{cookie:login.cookie})).json;
  return{cookie:login.cookie,world:me.worlds[0].id,userId:me.user.id};
 }
 async function contextFor(member,width,height){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
  const [name,...value]=member.cookie.split('=');
  await context.addCookies([{name,value:value.join('='),url:base,sameSite:'Strict',httpOnly:true}]);
  return context;
 }
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 for(const {size,width,height} of [{size:'desktop',width:1440,height:900},{size:'mobile',width:390,height:844}]){
  const writer=await actor('writer154'+size),reader=await actor('reader154'+size);
  const slug='season154-'+size,path='/series/'+slug;
  await api('/series',{method:'POST',cookie:writer.cookie,
   body:{worldId:writer.world,slug,title:'R154 Creator Story '+size}});
  async function chapter(title){
   const post=(await api('/posts',{method:'POST',cookie:writer.cookie,
    body:{worldId:writer.world,status:'published',body:'Original text '+title}})).json;
   return(await api(path+'/episodes',{method:'POST',cookie:writer.cookie,body:{postId:post.id,title}})).json;
  }
  const first=await chapter('R154 First');
  const rc=await contextFor(reader,width,height),ac=await contextFor(writer,width,height);
  const rp=await rc.newPage(),ap=await ac.newPage(),errors=[];
  for(const page of [rp,ap])page.on('pageerror',error=>errors.push(String(error)));
  await rp.goto(base+path,{waitUntil:'domcontentloaded'});
  const subscribe=rp.getByRole('button',{name:'Подписаться на новые эпизоды'});
  await subscribe.waitFor({timeout:12000});
  await subscribe.click();
  await rp.getByRole('button',{name:'Приостановить уведомления'}).waitFor({timeout:12000});
  const save=rp.getByRole('button',{name:'Сохранить выпуск'}).first();
  await save.waitFor({timeout:12000});
  await save.click();
  await rp.getByRole('button',{name:'Убрать из сохранённого'}).first().waitFor({timeout:12000});
  await rp.getByRole('button',{name:'Приостановить уведомления'}).click();
  await rp.getByRole('button',{name:'Включить уведомления'}).waitFor({timeout:12000});
  await chapter('R154 Muted Chapter');
  ensure((await api('/me/series-reminders',{cookie:reader.cookie})).json.items.length===0,
   'Muted reader received an unwanted reminder');
  await rp.getByRole('button',{name:'Включить уведомления'}).click();
  await rp.getByRole('button',{name:'Приостановить уведомления'}).waitFor({timeout:12000});
  const final=await chapter('R154 Last Chapter');
  ensure((await api('/me/series-reminders',{cookie:reader.cookie})).json.items[0].episodeId===final.id,
   'Unmuted reader did not receive a new chapter');
  await rp.goto(base+'/series',{waitUntil:'domcontentloaded'});
  await rp.getByRole('heading',{name:'Сохранённые выпуски'}).waitFor({timeout:12000});
  await rp.getByRole('link',{name:/R154 First/}).first().waitFor({timeout:12000});
  await ap.goto(base+path,{waitUntil:'domcontentloaded'});
  await ap.getByRole('heading',{name:'История изменений сезона'}).waitFor({timeout:12000});
  ap.once('dialog',dialog=>dialog.accept());
  const archive=ap.locator('#series-publication').getByRole('button',{name:'Снять сезон с публикации'});
  await archive.click();
  await ap.getByRole('button',{name:'Вернуть сезон в публикацию'}).waitFor({timeout:12000});
  const hidden=await rp.goto(base+path,{waitUntil:'domcontentloaded'});
  ensure(hidden.status()===404,'Archived season must not be readable to a subscriber');
  ensure((await api('/me/series-reminders',{cookie:reader.cookie})).json.items.length===0,'Archived reminders must disappear');
  ensure((await api('/me/series-bookmarks',{cookie:reader.cookie})).json.items.length===0,'Archived bookmark must be hidden');
  const personal=await api('/me/series-portability',{cookie:reader.cookie});
  ensure(verifySeasonPortability(personal.json),'Portable archive checksum invalid');
  ensure(personal.json.payload.bookmarks[0].episodeId===first.id,'Voluntary saved item missing in private archive');
  ensure(personal.disposition.includes('attachment;'),'Downloadable JSON missing response header');
  await ap.getByRole('button',{name:'Вернуть сезон в публикацию'}).click();
  await ap.getByRole('button',{name:'Снять сезон с публикации'}).waitFor({timeout:12000});
  ensure((await api('/me/series-reminders',{cookie:reader.cookie})).json.items.length===0,'Restore cannot replay old notifications');
  ensure((await api('/me/series-bookmarks',{cookie:reader.cookie})).json.items.length===1,'Restored saved story must be visible');
  await rp.goto(base+'/series',{waitUntil:'domcontentloaded'});
  const widthOverflow=await rp.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  ensure(widthOverflow<=2,'Horizontal scroll in R154 '+size);
  ensure(errors.length===0,'JavaScript errors '+size+': '+errors.join('; '));
  const filename=join(evidence,size+'-r154-personal-library.png');
  await rp.screenshot({path:filename,fullPage:true});
  ensure((await stat(filename)).size>4000,'PNG proof missing');
  await rc.close();await ac.close();
  console.log('PASS R154 '+size+': save > mute > unmute > notify > archive > private export > restore');
 }
}finally{
 if(browser)await browser.close();
 await app.close();
}
