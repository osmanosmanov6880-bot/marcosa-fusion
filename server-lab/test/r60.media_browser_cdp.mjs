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
const SHOTS=resolve('qa-r60');
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

function crc(bytes) {
 let value=0xffffffff;
 for(const byte of bytes){value^=byte;for(let k=0;k<8;k++)value=(value&1)?(value>>>1)^0xedb88320:(value>>>1);}
 return (value^0xffffffff)>>>0;
}
function chunk(name,data) {
 const b=Buffer.alloc(data.length+12);
 b.writeUInt32BE(data.length,0);b.write(name,4,'ascii');data.copy(b,8);
 b.writeUInt32BE(crc(b.subarray(4,b.length-4)),b.length-4);
 return b;
}
function png(seed=19) {
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(2,0);ihdr.writeUInt32BE(2,4);ihdr[8]=8;ihdr[9]=6;
 const row=Buffer.from([0,seed,55,95,255,33,69,101,255]);
 return Buffer.concat([
  Buffer.from([137,80,78,71,13,10,26,10]),
  chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.concat([row,row]))),chunk('IEND',Buffer.alloc(0))
 ]);
}
async function main() {
 const work=mkdtempSync(join(tmpdir(),'marcosa-r60-media-browser-'));
 let simulatedNow=Date.now();
 const lab=createApp({inviteCode:'r60-media-browser-invite-2026',now:()=>simulatedNow});
 let chrome=null,cdp=null;
 try {
  await new Promise((ok,fail)=>{lab.server.once('error',fail);lab.server.listen(0,'127.0.0.1',ok);});
  const base='http://127.0.0.1:'+lab.server.address().port;
  const password='strong-marcosa-browser-password-2026';
  async function register(username) {
   const response=await fetch(base+'/api/auth/register',{method:'POST',
    headers:{Origin:base,'Content-Type':'application/json'},
    body:JSON.stringify({username,email:username+'@example.net',password,inviteCode:'r60-media-browser-invite-2026'})});
   if(response.status!==201)throw Error('R60_REGISTER_FAILED '+username+' '+response.status+' '+(await response.text()).slice(0,200));
  }
  chrome=spawn(browser(),[
   '--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
   '--disable-features=MediaRouter,CalculateNativeWinOcclusion','--disable-background-networking',
   '--no-first-run','--no-default-browser-check','--remote-allow-origins=*',
   '--remote-debugging-port=0','--user-data-dir='+join(work,'profile'),'about:blank'
  ],{stdio:['ignore','ignore','pipe'],env:{...process.env,DBUS_SESSION_BUS_ADDRESS:'',NO_AT_BRIDGE:'1'}});
  let stderr='';chrome.stderr.on('data',part=>{stderr=(stderr+String(part)).slice(-1000);});
  let port=0;
  for(let i=0;i<375;i++){
   const path=join(work,'profile','DevToolsActivePort');
   if(existsSync(path)){port=Number(readFileSync(path,'utf8').split(/\r?\n/)[0]);if(port)break;}
   if(chrome.exitCode!==null)throw Error('R60_CHROME_EXITED '+stderr);
   await pause(80);
  }
  if(!port)throw Error('R60_CHROME_PORT_UNAVAILABLE '+stderr);
  cdp=await devtools(port);
  await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');
  mkdirSync(SHOTS,{recursive:true});
  const sizes=[{name:'desktop',width:1440,height:900,mobile:false},
   {name:'mobile',width:390,height:844,mobile:true},
   {name:'compact',width:360,height:740,mobile:true}];
  const fixture=png().toString('base64'),replacement=png(41).toString('base64');
  for(const size of sizes) {
   simulatedNow+=601000; // reset isolated signup limiter for the next independent viewport
   const owner='owner60'+size.name,first='reviewa60'+size.name,second='reviewb60'+size.name;
   await register(owner);await register(first);await register(second);
   lab.db.prepare("UPDATE users SET role='moderator' WHERE username IN (?,?)").run(first,second);
   const world=lab.db.prepare("SELECT w.slug FROM worlds w JOIN users u ON u.id=w.owner_id WHERE u.username=?").get(owner);
   if(!world?.slug)throw Error('R60_WORLD_MISSING_'+size.name);
   const coverUrl=base+'/api/worlds/'+world.slug+'/cover';
   async function publicStatus(){const r=await fetch(coverUrl);await r.arrayBuffer();return r.status;}
   cdp.errors.length=0;cdp.requests.length=0;
   await cdp.call('Network.clearBrowserCookies');
   await cdp.call('Emulation.setDeviceMetricsOverride',{
    width:size.width,height:size.height,deviceScaleFactor:1,mobile:size.mobile
   });
   await cdp.call('Page.navigate',{url:base+'/'});
   await cdp.wait("document.readyState==='complete'&&document.getElementById('notice')?.textContent.includes('сервер готов')",'r60-guest-'+size.name);
   const checkWidth=async label=>{
    const width=await cdp.evalJS("({width:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth})");
    if(width.width>width.viewport+2)throw Error('R60_HORIZONTAL_OVERFLOW '+size.name+' '+label+' '+JSON.stringify(width));
   };
   const screenshot=async label=>{
    await checkWidth(label);
    const captured=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    writeFileSync(join(SHOTS,size.name+'-'+label+'.png'),Buffer.from(captured.data,'base64'));
   };
   const login=async username=>{
    await cdp.evalJS("(()=>{const f=document.getElementById('login-form');f.elements.email.value="+JSON.stringify(username+'@example.net')+";f.elements.password.value="+JSON.stringify(password)+";f.requestSubmit();return true;})()");
    await cdp.wait("document.getElementById('identity')?.textContent==="+JSON.stringify('@'+username),'r60-login-'+username);
   };
   const logout=async()=>{
    await cdp.evalJS("document.getElementById('logout').click()");
    await cdp.wait("document.getElementById('identity')?.textContent==='Гость'",'r60-logout');
   };
   const upload=async image=>{
    const expression="(()=>{const source=Uint8Array.from(atob("+JSON.stringify(image)+"),v=>v.charCodeAt(0));"
     +"const dt=new DataTransfer();dt.items.add(new File([source],'creator-owned.png',{type:'image/png'}));"
     +"document.getElementById('world-cover-panel').open=true;"
     +"document.getElementById('world-cover-file').files=dt.files;"
     +"document.getElementById('world-cover-rights').checked=true;document.getElementById('world-cover-form').requestSubmit();return source.length;})()";
    const sizeUploaded=await cdp.evalJS(expression);
    if(sizeUploaded<57)throw Error('R60_INVALID_FIXTURE');
    await cdp.wait("document.getElementById('world-cover-status')?.textContent.includes('ожидает модерации')",'r60-owner-upload-pending');
   };
   await screenshot('guest');
   if(await publicStatus()!==404)throw Error('R60_GUEST_SEES_MISSING_MEDIA_'+size.name);
   await login(owner);
   await cdp.wait("document.getElementById('world-cover-select')?.options.length>0",'r60-owner-world');
   await upload(fixture);
   await cdp.evalJS("document.getElementById('world-cover-panel').scrollIntoView({block:'center'})");
   await pause(180);
   await screenshot('owner-pending');
   if(await publicStatus()!==404)throw Error('R60_PENDING_MEDIA_PUBLIC_'+size.name);
   if(await cdp.evalJS("document.getElementById('world-cover-appeal-form').hidden")!==true)
    throw Error('R60_PENDING_APPEAL_VISIBLE_'+size.name);
   await logout();
   await login(first);
   await cdp.wait("document.querySelector('#mod-cover-list .mod-cover-item button')!==null",'r60-first-review');
   await cdp.evalJS("document.getElementById('mod-cover-panel').open=true;document.getElementById('mod-cover-panel').scrollIntoView({block:'center'})");
   await screenshot('first-review');
   await cdp.evalJS("(()=>{const button=Array.from(document.querySelectorAll('#mod-cover-list button')).find(b=>b.textContent==='Отклонить');if(!button)throw Error('REJECT_BUTTON_MISSING');button.click();return true;})()");
   await cdp.wait("document.getElementById('mod-cover-list')?.textContent.includes('Новых изображений')",'r60-image-rejected');
   if(await publicStatus()!==404)throw Error('R60_REJECTED_MEDIA_PUBLIC_'+size.name);
   await logout();
   await login(owner);
   await cdp.wait("document.getElementById('world-cover-appeal-form')?.hidden===false",'r60-appeal-form');
   await cdp.evalJS("(()=>{const f=document.getElementById('world-cover-appeal-form');document.getElementById('world-cover-panel').open=true;f.elements.reason.value='Это моя оригинальная фотография, созданная для моего мира, прошу пересмотреть';f.requestSubmit();return true;})()");
   await cdp.wait("document.getElementById('world-cover-appeals-list')?.textContent.includes('Ожидает независимого решения')",'r60-appeal-saved');
   await cdp.evalJS("document.getElementById('world-cover-panel').scrollIntoView({block:'center'})");
   await screenshot('owner-appeal');
   if(await publicStatus()!==404)throw Error('R60_APPEAL_AUTO_PUBLISHED_'+size.name);
   await logout();
   await login(first);
   const firstQueue=await cdp.evalJS("document.querySelectorAll('#mod-cover-appeals-list .mod-cover-item').length");
   if(firstQueue!==0)throw Error('R60_ORIGINAL_REVIEWER_CAN_DECIDE_APPEAL_'+size.name);
   await logout();
   await login(second);
   await cdp.wait("document.querySelector('#mod-cover-appeals-list .mod-cover-item button')!==null",'r60-second-review');
   await cdp.evalJS("document.getElementById('mod-cover-appeals-panel').open=true;document.getElementById('mod-cover-appeals-panel').scrollIntoView({block:'center'})");
   await screenshot('second-review');
   await cdp.evalJS("(()=>{const button=Array.from(document.querySelectorAll('#mod-cover-appeals-list button')).find(b=>b.textContent.includes('повторной проверки'));if(!button)throw Error('REOPEN_BUTTON_MISSING');button.click();return true;})()");
   await cdp.wait("document.getElementById('mod-cover-appeals-list')?.textContent.includes('Новых апелляций')",'r60-reopened');
   if(await publicStatus()!==404)throw Error('R60_REOPEN_AUTO_PUBLISHED_'+size.name);
   await cdp.wait("document.querySelector('#mod-cover-list .mod-cover-item button')!==null",'r60-image-returned-to-review');
   await cdp.evalJS("(()=>{const button=Array.from(document.querySelectorAll('#mod-cover-list button')).find(b=>b.textContent==='Одобрить изображение');if(!button)throw Error('APPROVE_BUTTON_MISSING');button.click();return true;})()");
   await cdp.wait("document.getElementById('mod-cover-list')?.textContent.includes('Новых изображений')",'r60-independent-image-approval');
   if(await publicStatus()!==200)throw Error('R60_APPROVED_MEDIA_NOT_PUBLIC_'+size.name);
   await logout();
   await login(owner);
   await cdp.wait("document.getElementById('world-cover-status')?.textContent.includes('Одобрено')",'r60-owner-approved');
   await cdp.wait("document.querySelector('#world-list img.world-cover-art')!==null",'r60-public-world-card-image');
   await cdp.evalJS("document.getElementById('world-list').scrollIntoView({block:'center'})");
   await pause(180);
   await screenshot('approved-world');
   await upload(replacement);
   if(await publicStatus()!==404)throw Error('R60_REPLACEMENT_LEAKS_PRIOR_APPROVAL_'+size.name);
   await cdp.evalJS("document.getElementById('world-cover-panel').scrollIntoView({block:'center'})");
   await screenshot('replacement-pending');
   await cdp.evalJS("(()=>{window.confirm=()=>true;document.getElementById('world-cover-delete').click();return true;})()");
   await cdp.wait("document.getElementById('world-cover-status')?.textContent.includes('нет обложки')",'r60-owner-delete');
   if(await publicStatus()!==404)throw Error('R60_DELETED_MEDIA_PUBLIC_'+size.name);
   await screenshot('owner-deleted');
   const outsiders=cdp.requests.filter(url=>/^https?:\/\//.test(url)&&!url.startsWith(base));
   if(outsiders.length)throw Error('R60_UNEXPECTED_EXTERNAL_REQUEST '+outsiders.slice(0,3).join(','));
   if(cdp.errors.length)throw Error('R60_BROWSER_RUNTIME_EXCEPTION '+cdp.errors.slice(0,5).join(';'));
   console.log('R60 CHROMIUM PASS',size.name,'pending/rejected/appealed/reopened/approved/replaced/deleted, guest isolation');
  }
  console.log('R60 COMPLETE: 24 real desktop/mobile/compact screenshots, real UI upload, two independent moderators, no public pre-approval');
 } finally {
  cdp?.close();
  if(chrome) {
   const exited=new Promise(resolve=>{
    if(chrome.exitCode!==null||chrome.signalCode!==null)return resolve();
    chrome.once('exit',resolve);setTimeout(resolve,2500);
   });
   chrome.kill('SIGKILL');await exited;
  }
  await lab.close().catch(()=>{});
  try{rmSync(work,{recursive:true,force:true,maxRetries:15,retryDelay:130});}
  catch(error){console.warn('R60 TEMP CLEANUP WARNING',error.message);}
 }
}
main().catch(error=>{console.error('R60 BROWSER FAILURE',error?.stack||error);process.exitCode=1;});
