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
const SHOTS=resolve('qa-r89');
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
 const work=mkdtempSync(join(tmpdir(),'marcosa-r89-readiness-ui-'));
 const lab=createApp({inviteCode:'r89-ui-only'});let chrome=null,cdp=null;
 try{
  await new Promise(ok=>lab.server.listen(0,'127.0.0.1',ok));
  const base='http://127.0.0.1:'+lab.server.address().port;
  const username='moderator89ui',email='moderator89ui@example.net',password='r89-ui-strong-test-password';
  async function send(path,data){
   const response=await fetch(base+'/api'+path,{method:'POST',
    headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(data)});
   return{status:response.status,body:await response.json(),
    cookie:response.headers.get('set-cookie')?.split(';')[0]||null};
  }
  const registered=await send('/auth/register',{username,email,password,inviteCode:'r89-ui-only'});
  if(registered.status!==201)throw Error('R89_BROWSER_FIXTURE_REGISTER_'+registered.status);
  lab.db.prepare("UPDATE users SET role='moderator' WHERE username=?").run(username);
  const login=await send('/auth/login',{email,password});
  if(login.status!==200||!login.cookie)throw Error('R89_BROWSER_FIXTURE_LOGIN_'+login.status);
  chrome=spawn(browser(),['--headless=new','--no-sandbox','--disable-dev-shm-usage',
   '--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check',
   '--remote-allow-origins=*','--remote-debugging-port=0',
   '--user-data-dir='+join(work,'profile'),'about:blank'],
   {stdio:['ignore','ignore','pipe'],env:{...process.env,DBUS_SESSION_BUS_ADDRESS:'',NO_AT_BRIDGE:'1'}});
  let stderr='';chrome.stderr.on('data',b=>{stderr=(stderr+String(b)).slice(-1000);});
  let port=0;
  for(let i=0;i<375;i++){
   const file=join(work,'profile','DevToolsActivePort');
   if(existsSync(file)){port=Number(readFileSync(file,'utf8').split(/\r?\n/)[0]);if(port)break;}
   if(chrome.exitCode!==null)throw Error('R89_CHROME_EXIT '+stderr);
   await pause(80);
  }
  if(!port)throw Error('R89_CHROME_TIMEOUT '+stderr);
  cdp=await devtools(port);
  await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');
  await cdp.call('Network.setCookie',{url:base,name:'marcosa_session',
   value:login.cookie.split('=')[1],httpOnly:true,secure:false,sameSite:'Strict',path:'/'});
  mkdirSync(SHOTS,{recursive:true});
  for(const viewport of [
   {name:'desktop',width:1440,height:900,mobile:false},
   {name:'phone',width:390,height:844,mobile:true},
   {name:'compact',width:360,height:740,mobile:true}
  ]){
   await cdp.call('Emulation.setDeviceMetricsOverride',{width:viewport.width,
    height:viewport.height,deviceScaleFactor:1,mobile:viewport.mobile});
   cdp.errors.length=0;cdp.requests.length=0;
   await cdp.call('Page.navigate',{url:base+'/'});
   await cdp.wait("document.readyState==='complete'&&!document.getElementById('moderator')?.hidden",'R89-moderator-ready');
   await cdp.evalJS("MARCOSA_LOCALE.setLanguage('ru')");
   await cdp.evalJS("(()=>{document.getElementById('mod-readiness-panel').open=true;document.getElementById('mod-readiness-refresh').click();return true;})()");
   await cdp.wait("document.querySelector('#mod-readiness-status')?.dataset.ready==='true'",'R89-sqlite-healthy');
   const ru=await cdp.evalJS("(()=>{const x=document.getElementById('mod-readiness-status');return{lang:document.documentElement.lang,text:x.textContent,role:x.getAttribute('role'),live:x.getAttribute('aria-live'),ready:x.dataset.ready,scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth};})()");
   if(ru.lang!=='ru'||ru.role!=='status'||ru.live!=='polite'||ru.ready!=='true'
     ||!ru.text.includes('SQLite: целостность')||ru.scroll>ru.client+2)
    throw Error('R89_READY_RU_'+viewport.name+' '+JSON.stringify(ru));
   await cdp.evalJS("document.getElementById('mod-readiness-status').scrollIntoView({block:'center'})");
   const frame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
   writeFileSync(join(SHOTS,viewport.name+'-ru-ready.png'),Buffer.from(frame.data,'base64'));
   await cdp.evalJS("MARCOSA_LOCALE.setLanguage('en')");
   await cdp.wait("document.querySelector('#mod-readiness-status')?.textContent.includes('SQLite integrity')",'R89-sqlite-English');
   const en=await cdp.evalJS("(()=>({lang:document.documentElement.lang,text:document.getElementById('mod-readiness-status').textContent,scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}))()");
   if(en.lang!=='en'||!en.text.includes('SQLite integrity')||en.scroll>en.client+2)
    throw Error('R89_READY_EN_'+viewport.name+' '+JSON.stringify(en));
   const frameEn=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
   writeFileSync(join(SHOTS,viewport.name+'-en-ready.png'),Buffer.from(frameEn.data,'base64'));
   if(cdp.errors.length)throw Error('R89_RUNTIME_ERROR_'+JSON.stringify(cdp.errors));
   const external=cdp.requests.filter(x=>/^https?:\/\//.test(x)&&!x.startsWith(base+'/'));
   if(external.length)throw Error('R89_EXTERNAL_REQUEST '+JSON.stringify(external));
   console.log('R89 CHROME OPERATOR READY PASS',viewport.name,'RU/EN');
  }
  console.log('R89 COMPLETE: real operator button, true SQLite, desktop/phone language and focus');
 }finally{
  cdp?.close();
  if(chrome){const exited=new Promise(ok=>{if(chrome.exitCode!==null||chrome.signalCode!==null)return ok();chrome.once('exit',ok);setTimeout(ok,2500);});chrome.kill('SIGKILL');await exited;}
  await lab.close().catch(()=>{});
  try{rmSync(work,{recursive:true,force:true,maxRetries:15,retryDelay:100});}catch(e){console.warn('R89 cleanup:',e.message);}
 }
}
main().catch(e=>{console.error('R89 BROWSER FAIL',e?.stack||e);process.exitCode=1;});
