#!/usr/bin/env node
/* R28 real Chrome QA — local two-way social, no external dependency.
 * Starts genuine SQLite/HTTP API and interacts with actual HTML controls.
 * No production credentials. Desktop + 390 and 360 pixel phone captures.
 */
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,existsSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createApp} from '../server.mjs';

const pause=ms=>new Promise(done=>setTimeout(done,ms));
const SHOTS=resolve('qa-r71');
function browser(){
 for(const binary of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){
  const found=spawnSync('which',[binary],{encoding:'utf8'});
  if(found.status===0&&found.stdout.trim())return found.stdout.trim();
 }
 throw Error('CHROME_NOT_INSTALLED');
}
async function devtools(port){
 let target;
 for(let i=0;i<120;i++){
  try{
   const items=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
   target=items.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
   if(target)break;
  }catch{}
  await pause(85);
 }
 if(!target)throw Error('CDP_TARGET_NOT_READY');
 const ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{
  const t=setTimeout(()=>reject(Error('CDP_WS_TIMEOUT')),10000);
  ws.addEventListener('open',()=>{clearTimeout(t);resolve();},{once:true});
  ws.addEventListener('error',()=>{clearTimeout(t);reject(Error('CDP_WS_ERROR'));},{once:true});
 });
 const jobs=new Map(),requests=[],errors=[];let seq=0;
 ws.addEventListener('message',event=>{
  let data;try{data=JSON.parse(String(event.data));}catch{return;}
  if(data.method==='Network.requestWillBeSent')requests.push(data.params?.request?.url||'');
  if(data.method==='Runtime.exceptionThrown')errors.push(data.params?.exceptionDetails?.text||'exception');
  if(!jobs.has(data.id))return;
  const j=jobs.get(data.id);jobs.delete(data.id);clearTimeout(j.t);
  data.error?j.reject(Error(j.method+': '+JSON.stringify(data.error))):j.resolve(data.result);
 });
 function call(method,params={}){
  return new Promise((resolve,reject)=>{
   const id=++seq,t=setTimeout(()=>{jobs.delete(id);reject(Error('CDP_TIMEOUT '+method));},16000);
   jobs.set(id,{resolve,reject,t,method});ws.send(JSON.stringify({id,method,params}));
  });
 }
 async function evalJS(expression){
  const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});
  if(result.exceptionDetails)throw Error('JS: '+(result.exceptionDetails.exception?.description||result.exceptionDetails.text));
  return result.result?.value;
 }
 async function wait(expression,label){
  for(let i=0;i<150;i++){
   try{if(await evalJS(expression))return;}catch{}
   await pause(80);
  }
  let diag='unavailable';
  try{diag=JSON.stringify(await evalJS("(()=>({notice:document.getElementById('notice')?.textContent,formValid:document.getElementById('register-form')?.checkValidity(),registerOpen:document.getElementById('register-form')?.closest('details')?.open,identity:document.getElementById('identity')?.textContent}))()"));}catch{}
  throw Error('WAIT_TIMEOUT '+label+' DIAGNOSTIC '+diag);

 }
 return{call,evalJS,wait,requests,errors,close:()=>ws.close()};
}




async function main(){
 const work=mkdtempSync(join(tmpdir(),'marcosa-r71-locale-'));
 const lab=createApp({inviteCode:'r71-local-locale-tests'});
 let chrome=null,cdp=null;
 try{
  await new Promise((ok,fail)=>{lab.server.once('error',fail);lab.server.listen(0,'127.0.0.1',ok);});
  const base='http://127.0.0.1:'+lab.server.address().port;
  const registered=await fetch(base+'/api/auth/register',{
   method:'POST',headers:{Origin:base,'Content-Type':'application/json'},
   body:JSON.stringify({username:'localeowner',email:'owner-r71@example.net',
    password:'r71-a-safe-local-test-password',inviteCode:'r71-local-locale-tests'})
  });
  if(registered.status!==201)throw Error('R71_FIXTURE_REGISTRATION_FAILED '+registered.status);
  // Deliberately equal to key phrases: user data MUST NOT be translated.
  lab.db.prepare("UPDATE worlds SET title=?,description=? WHERE slug=?")
   .run('Войти','Пароль','u-localeowner');
  const data=lab.db.prepare("SELECT w.id,w.owner_id FROM worlds w WHERE w.slug='u-localeowner'").get();
  lab.db.prepare("INSERT INTO posts(world_id,author_id,body,status,created_at,updated_at) VALUES(?,?,?,'published',?,?)")
   .run(data.id,data.owner_id,'Твой доступ',Date.now(),Date.now());
  chrome=spawn(browser(),['--headless=new','--no-sandbox','--disable-dev-shm-usage',
   '--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check',
   '--remote-allow-origins=*','--remote-debugging-port=0',
   '--user-data-dir='+join(work,'profile'),'about:blank'],
   {stdio:['ignore','ignore','pipe'],env:{...process.env,DBUS_SESSION_BUS_ADDRESS:'',NO_AT_BRIDGE:'1'}});
  let stderr='';chrome.stderr.on('data',part=>{stderr=(stderr+String(part)).slice(-900);});
  let port=0;
  for(let i=0;i<375;i++){
   const file=join(work,'profile','DevToolsActivePort');
   if(existsSync(file)){port=Number(readFileSync(file,'utf8').split(/\r?\n/)[0]);if(port)break;}
   if(chrome.exitCode!==null)throw Error('R71_CHROME_EXIT '+stderr);
   await pause(80);
  }
  if(!port)throw Error('R71_CHROME_DEVTOOLS_TIMEOUT '+stderr);
  cdp=await devtools(port);
  await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');
  mkdirSync(SHOTS,{recursive:true});
  const viewports=[
   {name:'desktop',width:1440,height:900,mobile:false},
   {name:'mobile',width:390,height:844,mobile:true},
   {name:'compact',width:360,height:740,mobile:true}
  ];
  for(const viewport of viewports){
   cdp.errors.length=0;cdp.requests.length=0;
   await cdp.call('Emulation.setDeviceMetricsOverride',{
    width:viewport.width,height:viewport.height,deviceScaleFactor:1,mobile:viewport.mobile
   });
   await cdp.call('Page.navigate',{url:base+'/'});
   await cdp.wait("document.readyState==='complete'&&document.getElementById('notice')?.textContent.includes('server ready')||document.readyState==='complete'&&document.getElementById('notice')?.textContent.includes('сервер готов')",'R71-root-ready');
   await cdp.wait("document.querySelector('#world-list .world-card h3')?.textContent==='Войти'",'R71-actual-untranslated-World');
   await cdp.evalJS("MARCOSA_LOCALE.setLanguage('ru')");
   const shot=async suffix=>{
    const state=await cdp.evalJS("({size:document.documentElement.scrollWidth,client:document.documentElement.clientWidth})");
    if(state.size>state.client+2)throw Error('R71_HORIZONTAL_OVERFLOW_'+viewport.name+'_'+suffix+' '+JSON.stringify(state));
    const image=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    writeFileSync(join(SHOTS,viewport.name+'-'+suffix+'.png'),Buffer.from(image.data,'base64'));
   };
   const ru=await cdp.evalJS("(()=>({lang:document.documentElement.lang,hero:document.querySelector('h1')?.textContent,login:document.querySelector('#login-form button')?.textContent,world:document.querySelector('#world-list .world-card h3')?.textContent,post:document.querySelector('#feed-list .post-body')?.textContent,keys:MARCOSA_LOCALE.catalogKeys().length}))()");
   if(ru.lang!=='ru'||!ru.hero.includes('Мир начинается')||ru.login!=='Войти в свой мир'||ru.world!=='Войти'||ru.post!=='Твой доступ'||ru.keys<70)
    throw Error('R71_RUSSIAN_BASELINE_'+viewport.name+' '+JSON.stringify(ru));
   await shot('russian');
   await cdp.evalJS("(()=>{const sel=document.getElementById('language-switch');sel.value='en';sel.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
   await cdp.wait("document.documentElement.lang==='en'&&document.querySelector('h1')?.textContent.includes('A world begins')",'R71-switch-English');
   const en=await cdp.evalJS("(()=>({lang:document.documentElement.lang,hero:document.querySelector('h1')?.textContent,login:document.querySelector('#login-form button')?.textContent,skip:document.querySelector('.skip-navigation')?.textContent,search:document.querySelector('#discover-form button')?.textContent,open:document.querySelector('#world-list .world-open')?.textContent,world:document.querySelector('#world-list .world-card h3')?.textContent,post:document.querySelector('#feed-list .post-body')?.textContent,title:document.title,aria:document.getElementById('discover-category')?.getAttribute('aria-label'),saved:localStorage.getItem('marcosa.ui.language.r71'),topic:[...document.getElementById('discover-category').options].some(x=>x.textContent==='Art')}))()");
   if(en.lang!=='en'||!en.hero.includes('A world begins')||en.login!=='Enter your World'||en.skip!=='Skip to main content'||en.search!=='Search'||en.open!=='Open World ↗'||en.world!=='Войти'||en.post!=='Твой доступ'||!en.title.includes('English beta')||en.aria!=='Filter Worlds by topic'||en.saved!=='en'||!en.topic)
    throw Error('R71_ENGLISH_OR_USER_DATA_'+viewport.name+' '+JSON.stringify(en));
   await shot('english');
   await cdp.call('Page.navigate',{url:base+'/'});
   await cdp.wait("document.readyState==='complete'&&document.documentElement.lang==='en'&&document.querySelector('h1')?.textContent.includes('A world begins')",'R71-persist-reload');
   await cdp.call('Page.navigate',{url:base+'/w/u-localeowner'});
   await cdp.wait("document.readyState==='complete'&&document.getElementById('world-detail')?.hidden===false&&document.documentElement.lang==='en'",'R71-SSR-world-reload');
   const ssr=await cdp.evalJS("(()=>({title:document.title,world:document.getElementById('world-detail-title')?.textContent,description:document.getElementById('world-detail-description')?.textContent,close:document.getElementById('world-close')?.textContent,robots:document.querySelector('meta[name=robots]')?.content}))()");
   if(ssr.world!=='Войти'||ssr.description!=='Пароль'||ssr.close!=='← All Worlds'||ssr.robots!=='noindex,nofollow'||!ssr.title.includes('Войти'))
    throw Error('R71_SSR_USER_CONTENT_PROTECTION_'+viewport.name+' '+JSON.stringify(ssr));
   await cdp.evalJS("MARCOSA_LOCALE.setLanguage('ru')");
   const recovered=await cdp.evalJS("({lang:document.documentElement.lang,label:document.getElementById('world-close')?.textContent,selection:document.getElementById('language-switch')?.value})");
   if(recovered.lang!=='ru'||recovered.label!=='← Все миры'||recovered.selection!=='ru')
    throw Error('R71_RESTORATION_'+viewport.name+' '+JSON.stringify(recovered));
   const external=cdp.requests.filter(url=>/^https?:\/\//.test(url)&&!url.startsWith(base));
   if(external.length||cdp.errors.length)
    throw Error('R71_BROWSER_ISOLATION_'+viewport.name+' '+JSON.stringify({external,errors:cdp.errors}));
   console.log('R71 CHROMIUM BILINGUAL PASS',viewport.name,'RU/EN/persist/World user-data isolation');
  }
  console.log('R71 COMPLETE: six real Chromium RU+EN screenshots across 1440/390/360');
 }finally{
  cdp?.close();
  if(chrome){
   const exited=new Promise(ok=>{if(chrome.exitCode!==null||chrome.signalCode!==null)return ok();chrome.once('exit',ok);setTimeout(ok,2500);});
   chrome.kill('SIGKILL');await exited;
  }
  await lab.close().catch(()=>{});
  try{rmSync(work,{recursive:true,force:true,maxRetries:15,retryDelay:100});}catch(e){console.warn('R71 cleanup warning:',e.message);}
 }
}
main().catch(error=>{console.error('R71 CHROME FAILURE',error?.stack||error);process.exitCode=1;});
