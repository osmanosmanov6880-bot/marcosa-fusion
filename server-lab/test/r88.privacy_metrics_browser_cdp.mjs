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
const SHOTS=resolve('qa-r88');
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
 const work=mkdtempSync(join(tmpdir(),'marcosa-r88-privacy-metrics-'));
 let clock=Date.parse('2026-02-01T12:00:00Z');
 const lab=createApp({inviteCode:'r88-private-local',now:()=>clock});
 let chrome=null,cdp=null;
 try{
  await new Promise(ok=>lab.server.listen(0,'127.0.0.1',ok));
  const base='http://127.0.0.1:'+lab.server.address().port;
  async function req(path,{method='GET',cookie,data}={}){
   const headers={};if(cookie)headers.Cookie=cookie;
   if(method!=='GET'){headers.Origin=base;headers['Content-Type']='application/json';}
   const response=await fetch(base+'/api'+path,{method,headers,
    ...(data===undefined?{}:{body:JSON.stringify(data)})});
   return{status:response.status,data:await response.json(),
    cookie:response.headers.get('set-cookie')?.split(';')[0]||null};
  }
  const password='r88-not-production-secret-strong';
  async function member(username){
   const email=username+'@example.net';
   const created=await req('/auth/register',{method:'POST',data:{
    username,email,password,inviteCode:'r88-private-local'}});
   if(created.status!==201)throw Error('R88_REGISTER_'+username+'_'+created.status);
   return{id:lab.db.prepare('SELECT id FROM users WHERE username=?').get(username).id,email};
  }
  async function login(user){
   const r=await req('/auth/login',{method:'POST',data:{email:user.email,password}});
   if(r.status!==200)throw Error('R88_LOGIN_'+r.status);
   return r.cookie;
  }
  const mod=await member('moderator88ui');
  lab.db.prepare("UPDATE users SET role='moderator' WHERE id=?").run(mod.id);
  const memberOne=await member('founder88ui');
  lab.db.prepare("INSERT INTO pilot_invites(id,code_hash,creator_id,label,created_at,expires_at,used_by,used_at) VALUES(?,?,?,?,?,?,?,?)")
   .run('r88-ui-id','a'.repeat(64),mod.id,'synthetic-ui-only',clock-10000,clock+86400000,memberOne.id,clock-1000);
  let ownerCookie=await login(memberOne);
  const consent=await req('/me/retention-consent',{method:'POST',cookie:ownerCookie,data:{consent:true}});
  if(consent.status!==200)throw Error('R88_CONSENT_'+consent.status);
  clock+=7*86400000;
  ownerCookie=await login(memberOne);
  const modCookie=await login(mod);
  const report=await req('/mod/pilot-metrics',{cookie:modCookie});
  if(report.status!==200||report.data.retentionD7!==null
    ||report.data.retentionEvidence.consentCountSuppressed!==true
    ||report.data.retentionEvidence.d7.suppressed!==true)
   throw Error('R88_PRIVATE_API_BAD '+JSON.stringify(report.data));
  const sessionValue=modCookie.split('=')[1];
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
   if(chrome.exitCode!==null)throw Error('R88_CHROME_EXIT '+stderr);
   await pause(80);
  }
  if(!port)throw Error('R88_CHROME_TIMEOUT '+stderr);
  cdp=await devtools(port);
  await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');
  await cdp.call('Network.setCookie',{url:base,name:'marcosa_session',
   value:sessionValue,httpOnly:true,secure:false,sameSite:'Strict',path:'/'});
  mkdirSync(SHOTS,{recursive:true});
  const viewports=[{name:'desktop',width:1440,height:900,mobile:false},
   {name:'phone',width:390,height:844,mobile:true},
   {name:'compact',width:360,height:740,mobile:true}];
  for(const vp of viewports){
   await cdp.call('Emulation.setDeviceMetricsOverride',{
    width:vp.width,height:vp.height,deviceScaleFactor:1,mobile:vp.mobile
   });
   cdp.requests.length=0;cdp.errors.length=0;
   await cdp.call('Page.navigate',{url:base+'/'});
   await cdp.wait("document.readyState==='complete'&&document.querySelector('#pilot-metrics-data')?.textContent.includes('D7:')",'R88-moderator-metrics');
   await cdp.evalJS("MARCOSA_LOCALE.setLanguage('ru')");
   await cdp.wait("document.querySelector('#pilot-metrics-data')?.textContent.includes('скрыто: меньше пяти участников')",'R88-suppressed-ru');
   const ru=await cdp.evalJS("(()=>({language:document.documentElement.lang,detail:document.querySelector('#pilot-metrics-data').textContent,visible:!document.getElementById('moderator').hidden,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+2}))()");
   if(ru.language!=='ru'||!ru.visible||ru.overflow||!ru.detail.includes('D7: скрыто: меньше пяти участников')
     ||!ru.detail.includes('не измерено (нет зрелой когорты)')||ru.detail.includes('@example'))
    throw Error('R88_PRIVACY_RU_'+vp.name+' '+JSON.stringify(ru));
   const screenshot=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
   writeFileSync(join(SHOTS,vp.name+'-ru.png'),Buffer.from(screenshot.data,'base64'));
   await cdp.evalJS("MARCOSA_LOCALE.setLanguage('en')");
   await cdp.wait("document.querySelector('#pilot-metrics-data')?.textContent.includes('suppressed: fewer than five participants')",'R88-suppressed-en');
   const en=await cdp.evalJS("(()=>({language:document.documentElement.lang,detail:document.querySelector('#pilot-metrics-data').textContent,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+2}))()");
   if(en.language!=='en'||en.overflow||!en.detail.includes('D7: suppressed: fewer than five participants')
     ||!en.detail.includes('unmeasured (no mature cohort)')||!en.detail.includes('Member accounts')
     ||en.detail.includes('founder88ui')||en.detail.includes('@example'))
    throw Error('R88_PRIVACY_EN_'+vp.name+' '+JSON.stringify(en));
   const image=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
   writeFileSync(join(SHOTS,vp.name+'-en.png'),Buffer.from(image.data,'base64'));
   if(cdp.errors.length)throw Error('R88_BROWSER_ERRORS_'+JSON.stringify(cdp.errors));
   const external=cdp.requests.filter(url=>/^https?:\/\//.test(url)&&!url.startsWith(base+'/'));
   if(external.length)throw Error('R88_EXTERNAL_NETWORK_'+JSON.stringify(external));
   console.log('R88 PRIVATE PILOT RU/EN CHROME PASS',vp.name);
  }
  console.log('R88 COMPLETE: all 3 viewport sizes, no one-person retention disclosure, no external API');
 }finally{
  cdp?.close();
  if(chrome){
   const exited=new Promise(ok=>{if(chrome.exitCode!==null||chrome.signalCode!==null)return ok();chrome.once('exit',ok);setTimeout(ok,2500);});
   chrome.kill('SIGKILL');await exited;
  }
  await lab.close().catch(()=>{});
  try{rmSync(work,{recursive:true,force:true,maxRetries:15,retryDelay:100});}catch(e){console.warn('R88 cleanup:',e.message);}
 }
}
main().catch(e=>{console.error('R88 BROWSER FAIL',e?.stack||e);process.exitCode=1;});
