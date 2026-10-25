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
const SHOTS=resolve('qa-r65');
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


import {deflateSync} from 'node:zlib';
function crc(buffer){
 let c=0xffffffff;
 for(const byte of buffer){c^=byte;for(let k=0;k<8;k++)c=(c&1)?(c>>>1)^0xedb88320:(c>>>1);}
 return(c^0xffffffff)>>>0;
}
function chunk(name,data){
 const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length,0);
 b.write(name,4,'ascii');data.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,b.length-4)),b.length-4);return b;
}
function png(){
 const h=Buffer.alloc(13);h.writeUInt32BE(2,0);h.writeUInt32BE(2,4);h[8]=8;h[9]=6;
 const row=Buffer.from([0,21,34,45,255,67,78,89,255]);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.concat([row,row]))),chunk('IEND',Buffer.alloc(0))]);
}
async function main(){
 const tmp=mkdtempSync(join(tmpdir(),'marcosa-r65-cdp-'));
 let clock=Date.now();
 const lab=createApp({inviteCode:'r65-chrome-only-pilot-code',now:()=>clock});
 let chrome=null,cdp=null;
 try{
  await new Promise((ok,fail)=>{lab.server.once('error',fail);lab.server.listen(0,'127.0.0.1',ok);});
  const base='http://127.0.0.1:'+lab.server.address().port;
  const password='strong-local-browser-password-2026';
  async function register(username){
   const res=await fetch(base+'/api/auth/register',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username,email:username+'@example.net',password,inviteCode:'r65-chrome-only-pilot-code'})});
   if(res.status!==201)throw Error('R65_REGISTER_FAILED_'+username+'_'+res.status);
  }
  chrome=spawn(browser(),['--headless=new','--no-sandbox','--disable-dev-shm-usage',
   '--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check',
   '--remote-allow-origins=*','--remote-debugging-port=0','--user-data-dir='+join(tmp,'profile'),
   'about:blank'],{stdio:['ignore','ignore','pipe'],env:{...process.env,DBUS_SESSION_BUS_ADDRESS:'',NO_AT_BRIDGE:'1'}});
  let stderr='';chrome.stderr.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-900);});
  let port=0;
  for(let i=0;i<375;i++){
   const file=join(tmp,'profile','DevToolsActivePort');
   if(existsSync(file)){port=Number(readFileSync(file,'utf8').split(/\r?\n/)[0]);if(port)break;}
   if(chrome.exitCode!==null)throw Error('R65_CHROME_EXIT '+stderr);
   await pause(80);
  }
  if(!port)throw Error('R65_CHROME_PORT '+stderr);
  cdp=await devtools(port);
  await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');
  mkdirSync(SHOTS,{recursive:true});
  const fixture=png().toString('base64');
  for(const size of [{name:'desktop',width:1440,height:900,mobile:false},{name:'mobile',width:390,height:844,mobile:true}]){
   clock+=601000;
   const owner='r65owner'+size.name,reporter='r65report'+size.name,
    initial='r65init'+size.name,second='r65review'+size.name;
   await register(owner);await register(reporter);await register(initial);await register(second);
   lab.db.prepare("UPDATE users SET role='moderator' WHERE username IN (?,?)").run(initial,second);
   cdp.errors.length=0;cdp.requests.length=0;
   await cdp.call('Network.clearBrowserCookies');
   await cdp.call('Emulation.setDeviceMetricsOverride',{width:size.width,height:size.height,deviceScaleFactor:1,mobile:size.mobile});
   await cdp.call('Page.navigate',{url:base+'/'});
   await cdp.wait("document.readyState==='complete'&&document.getElementById('notice')?.textContent.includes('сервер готов')",'ready');
   const login=async username=>{
    await cdp.evalJS("(()=>{const f=document.getElementById('login-form');f.elements.email.value="+JSON.stringify(username+'@example.net')+";f.elements.password.value="+JSON.stringify(password)+";f.requestSubmit();return true;})()");
    await cdp.wait("document.getElementById('identity')?.textContent==="+JSON.stringify('@'+username),'login-'+username);
   };
   const logout=async()=>{
    await cdp.evalJS("document.getElementById('logout').click()");
    await cdp.wait("document.getElementById('identity')?.textContent==='Гость'",'logout');
   };
   const shot=async name=>{
    const widths=await cdp.evalJS("({a:document.documentElement.scrollWidth,b:document.documentElement.clientWidth})");
    if(widths.a>widths.b+2)throw Error('R65_LAYOUT_OVERFLOW_'+size.name+'_'+name);
    const img=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    writeFileSync(join(SHOTS,size.name+'-'+name+'.png'),Buffer.from(img.data,'base64'));
   };
   const url=base+'/api/worlds/u-'+owner+'/cover';
   const publicStatus=async()=>{const r=await fetch(url);await r.arrayBuffer();return r.status;};
   await login(owner);
   await cdp.wait("document.getElementById('world-cover-select')?.options.length>0",'ownerWorld');
   await cdp.evalJS("(()=>{const bytes=Uint8Array.from(atob("+JSON.stringify(fixture)+"),s=>s.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],'real-owner-cover.png',{type:'image/png'}));document.getElementById('world-cover-file').files=dt.files;document.getElementById('world-cover-panel').open=true;document.getElementById('world-cover-rights').checked=true;document.getElementById('world-cover-form').requestSubmit();return true;})()");
   await cdp.wait("document.getElementById('world-cover-status')?.textContent.includes('ожидает модерации')",'pending');
   if(await publicStatus()!==404)throw Error('R65_OWNER_EARLY_PUBLIC');
   await logout();
   await login(initial);
   await cdp.wait("Array.from(document.querySelectorAll('#mod-cover-list button')).some(b=>b.textContent.includes('Одобрить'))",'modInitial');
   await cdp.evalJS("Array.from(document.querySelectorAll('#mod-cover-list button')).find(b=>b.textContent.includes('Одобрить')).click()");
   await cdp.wait("document.getElementById('mod-cover-list')?.textContent.includes('Новых изображений')",'approved');
   if(await publicStatus()!==200)throw Error('R65_PUBLIC_APPROVAL_MISSING');
   await logout();
   await login(reporter);
   await cdp.evalJS("document.querySelector('a.world-open[href=\\\"#world-u-"+owner+"\\\"]').click()");
   await cdp.wait("document.getElementById('world-detail')?.hidden===false&&document.getElementById('world-cover-report-panel')?.hidden===false",'reporterUI');
   await cdp.evalJS("(()=>{document.getElementById('world-cover-report-panel').open=true;document.getElementById('world-cover-report-panel').scrollIntoView({block:'center'});return true;})()");
   await shot('open-report');
   await cdp.evalJS("(()=>{const f=document.getElementById('world-cover-report-form');f.elements.reason.value='privacy';f.elements.detail.value='This picture might expose private personal information';f.requestSubmit();return true;})()");
   await cdp.wait("document.getElementById('my-cover-reports')?.textContent.includes('Ожидает проверки')",'submitted');
   await cdp.evalJS("(()=>{document.getElementById('my-cover-reports-panel').open=true;document.getElementById('my-cover-reports-panel').scrollIntoView({block:'center'});return true;})()");
   await shot('private-report-history');
   if(await publicStatus()!==200)throw Error('R65_REPORT_AUTO_HID_COVER');
   await logout();
   await login(second);
   await cdp.wait("Array.from(document.querySelectorAll('#mod-queue-health-data .pilot-metric')).some(e=>e.textContent.includes('Жалобы на публичные обложки')&&e.textContent.includes('1 открыто'))",'r69-actual-open-media-complaint');
   await cdp.evalJS("(()=>{document.getElementById('mod-queue-health-panel').open=true;document.getElementById('mod-queue-health-panel').scrollIntoView({block:'center'});return true;})()");
   await shot('moderation-operations-before');
   await cdp.wait("Array.from(document.querySelectorAll('#mod-cover-reports button')).some(b=>b.textContent.includes('Подтвердить'))",'moderatorSecond');
   await cdp.evalJS("(()=>{document.getElementById('mod-cover-reports-panel').open=true;document.getElementById('mod-cover-reports-panel').scrollIntoView({block:'center'});return true;})()");
   await shot('independent-queue');
   await cdp.evalJS("Array.from(document.querySelectorAll('#mod-cover-reports button')).find(b=>b.textContent.includes('Подтвердить')).click()");
   await cdp.wait("document.getElementById('mod-cover-reports')?.textContent.includes('Новых жалоб')",'takedown');
   await cdp.evalJS("document.getElementById('mod-queue-health-refresh').click()");
   await cdp.wait("Array.from(document.querySelectorAll('#mod-queue-health-data .pilot-metric')).some(e=>e.textContent.includes('Жалобы на публичные обложки')&&e.textContent.includes('0 открыто'))",'r69-real-queue-cleared');
   await shot('moderation-operations-after');
   if(await publicStatus()!==404)throw Error('R65_PUBLIC_TAKEDOWN_NOT_APPLIED');
   await logout();
   await login(owner);
   await cdp.wait("document.getElementById('world-cover-status')?.textContent.includes('Отклонено')",'ownerCanAppeal');
   const outsiders=cdp.requests.filter(u=>/^https?:\/\//.test(u)&&!u.startsWith(base));
   if(outsiders.length||cdp.errors.length)throw Error('R65_NETWORK_OR_JS_'+JSON.stringify({outsiders,errors:cdp.errors}));
   console.log('R65 CHROMIUM PASS',size.name,'owner-upload/approve/user-report/independent-takedown/appeal');
  }
  console.log('R69 COMPLETE: 10 real desktop/mobile browser captures, including moderator queue before/after independent takedown');
 }finally{
  cdp?.close();
  if(chrome){const done=new Promise(ok=>{if(chrome.exitCode!==null||chrome.signalCode!==null)return ok();chrome.once('exit',ok);setTimeout(ok,2500);});chrome.kill('SIGKILL');await done;}
  await lab.close().catch(()=>{});
  try{rmSync(tmp,{recursive:true,force:true,maxRetries:15,retryDelay:130});}
  catch(err){console.warn('R65 temp cleanup warning',err.message);}
 }
}
main().catch(error=>{console.error('R65 CHROME FAILURE',error?.stack||error);process.exitCode=1;});
