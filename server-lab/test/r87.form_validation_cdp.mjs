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
const SHOTS=resolve('qa-r87');
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
 const work=mkdtempSync(join(tmpdir(),'marcosa-r87-accessibility-'));
 const app=createApp({inviteCode:'r87-local-only'});let chrome=null,cdp=null;
 try{
  await new Promise((ok,fail)=>{app.server.once('error',fail);app.server.listen(0,'127.0.0.1',ok);});
  const base='http://127.0.0.1:'+app.server.address().port;
  chrome=spawn(browser(),['--headless=new','--no-sandbox','--disable-dev-shm-usage',
   '--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check',
   '--remote-allow-origins=*','--remote-debugging-port=0',
   '--user-data-dir='+join(work,'profile'),'about:blank'],
   {stdio:['ignore','ignore','pipe'],env:{...process.env,DBUS_SESSION_BUS_ADDRESS:'',NO_AT_BRIDGE:'1'}});
  let stderr='';chrome.stderr.on('data',b=>{stderr=(stderr+String(b)).slice(-1200);});
  let port=0;
  for(let i=0;i<375;i++){
   const file=join(work,'profile','DevToolsActivePort');
   if(existsSync(file)){port=Number(readFileSync(file,'utf8').split(/\r?\n/)[0]);if(port)break;}
   if(chrome.exitCode!==null)throw Error('R87_CHROME_EXIT '+stderr);
   await pause(80);
  }
  if(!port)throw Error('R87_DEVTOOLS_TIMEOUT '+stderr);
  cdp=await devtools(port);
  await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');
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
   await cdp.wait("document.readyState==='complete'&&(/сервер готов|server ready/i).test(document.getElementById('notice')?.textContent||'')",'R87-'+vp.name+'-ready');
   await cdp.evalJS("MARCOSA_LOCALE.setLanguage('ru')");
   // Invalid *native* requestSubmit must be blocked before network and
   // focus first invalid field, even when several are invalid at once.
   await cdp.evalJS("(()=>{document.getElementById('login-form').requestSubmit();return true;})()");
   await cdp.wait("!document.querySelector('#login-form .form-validation-summary')?.hidden",'R87-invalid-login');
   const ru=await cdp.evalJS("(()=>{const f=document.getElementById('login-form'),s=f.querySelector('.form-validation-summary');return{lang:document.documentElement.lang,text:s.textContent,role:s.getAttribute('role'),hidden:s.hidden,fields:[...f.querySelectorAll('input')].map(x=>({invalid:x.getAttribute('aria-invalid'),link:x.getAttribute('aria-describedby'),native:x.validity.valid})),focus:document.activeElement.getAttribute('name'),id:s.id,width:document.documentElement.scrollWidth,client:document.documentElement.clientWidth};})()");
   if(ru.lang!=='ru'||ru.role!=='alert'||ru.hidden||!ru.text.includes('Проверь выделенные поля')
    ||ru.focus!=='email'||ru.fields.length!==2||ru.fields.some(x=>x.invalid!=='true'||x.native||!x.link?.includes(ru.id))
    ||ru.width>ru.client+2)
    throw Error('R87_RUSSIAN_NATIVE_VALIDATION_'+vp.name+' '+JSON.stringify(ru));
   const image=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
   writeFileSync(join(SHOTS,vp.name+'-invalid-ru.png'),Buffer.from(image.data,'base64'));
   await cdp.evalJS("MARCOSA_LOCALE.setLanguage('en')");
   const en=await cdp.evalJS("(()=>{const s=document.querySelector('#login-form .form-validation-summary');return{lang:document.documentElement.lang,text:s.textContent,hidden:s.hidden,focus:document.activeElement.name,width:document.documentElement.scrollWidth,client:document.documentElement.clientWidth};})()");
   if(en.lang!=='en'||en.hidden||!en.text.includes('Please check the highlighted fields')
     ||en.focus!=='email'||en.width>en.client+2)
    throw Error('R87_ENGLISH_NATIVE_VALIDATION_'+vp.name+' '+JSON.stringify(en));
   const eng=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
   writeFileSync(join(SHOTS,vp.name+'-invalid-en.png'),Buffer.from(eng.data,'base64'));
   // Repair the invalid values; ARIA references and alert MUST disappear.
   await cdp.evalJS("(()=>{const f=document.getElementById('login-form');for(const [n,v] of [['email','owner-r87@example.invalid'],['password','r87-safe-test-password']]){const field=f.elements.namedItem(n);field.value=v;field.dispatchEvent(new Event('input',{bubbles:true}));}return true;})()");
   const repaired=await cdp.evalJS("(()=>{const f=document.getElementById('login-form');return{hidden:f.querySelector('.form-validation-summary').hidden,valid:f.checkValidity(),fields:[...f.querySelectorAll('input')].map(x=>({invalid:x.getAttribute('aria-invalid'),described:x.getAttribute('aria-describedby')}))};})()");
   if(!repaired.hidden||!repaired.valid||repaired.fields.some(x=>x.invalid==='true'))
    throw Error('R87_REPAIRED_FORM_ERROR_NOT_CLEARED_'+vp.name+' '+JSON.stringify(repaired));
   // Registration is a different static form with independent summary.
   await cdp.evalJS("(()=>{const f=document.getElementById('register-form');f.closest('details').open=true;f.requestSubmit();return true;})()");
   await cdp.wait("!document.querySelector('#register-form .form-validation-summary')?.hidden",'R87-registration-validation');
   const registration=await cdp.evalJS("(()=>{const f=document.getElementById('register-form'),s=f.querySelector('.form-validation-summary');return{lang:document.documentElement.lang,visible:!s.hidden,id:s.id,text:s.textContent,invalid:[...f.querySelectorAll('input')].filter(x=>x.getAttribute('aria-invalid')==='true').length,first:document.activeElement.name,loginHidden:document.querySelector('#login-form .form-validation-summary').hidden};})()");
   if(registration.lang!=='en'||!registration.visible||registration.invalid<3
     ||registration.first!=='inviteCode'||!registration.loginHidden
     ||!registration.text.includes('Please check'))
    throw Error('R87_REGISTRATION_ISOLATION_'+vp.name+' '+JSON.stringify(registration));
   if(cdp.requests.some(url=>url.includes('/api/auth/login')||url.includes('/api/auth/register')))
    throw Error('R87_NATIVE_VALIDATION_ALLOWED_HTTP_AUTH_REQUEST '+JSON.stringify(cdp.requests));
   if(cdp.errors.length)throw Error('R87_BROWSER_EXCEPTION '+JSON.stringify(cdp.errors));
   const external=cdp.requests.filter(url=>/^https?:\/\//.test(url)&&!url.startsWith(base+'/'));
   if(external.length)throw Error('R87_EXTERNAL_REQUEST '+JSON.stringify(external));
   console.log('R87 ACCESSIBLE FORM PASS',vp.name,'RU/EN','login and registration');
  }
  console.log('R87 COMPLETE 3 device sizes, native invalid event, first-focus, aria fields, RU/EN, no auth request');
 }finally{
  cdp?.close();
  if(chrome){
   const exited=new Promise(ok=>{if(chrome.exitCode!==null||chrome.signalCode!==null)return ok();chrome.once('exit',ok);setTimeout(ok,2500);});
   chrome.kill('SIGKILL');await exited;
  }
  await app.close().catch(()=>{});
  try{rmSync(work,{recursive:true,force:true,maxRetries:15,retryDelay:100});}catch(e){console.warn('R87 cleanup:',e.message);}
 }
}
main().catch(e=>{console.error('R87 BROWSER FAIL',e?.stack||e);process.exitCode=1;});
