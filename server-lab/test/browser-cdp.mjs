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
const SHOTS=resolve('qa-r28');
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
  throw Error('WAIT_TIMEOUT '+label);
 }
 return{call,evalJS,wait,requests,errors,close:()=>ws.close()};
}
async function main(){
 const work=mkdtempSync(join(tmpdir(),'marcosa-r28-browser-'));
 const lab=createApp({inviteCode:'r28-browser-invite-that-is-long'});
 let chrome=null,cdp=null;
 try{
  await new Promise((resolve,reject)=>{
   lab.server.once('error',reject);
   lab.server.listen(0,'127.0.0.1',resolve);
  });
  const base='http://127.0.0.1:'+lab.server.address().port;
  chrome=spawn(browser(),[
   '--headless=new','--no-sandbox','--disable-dev-shm-usage',
   '--disable-background-networking','--no-first-run','--no-default-browser-check',
   '--remote-allow-origins=*','--remote-debugging-port=0','--user-data-dir='+join(work,'profile'),
   'about:blank'
  ],{stdio:['ignore','ignore','pipe']});
  let stderr='';chrome.stderr.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-1000);});
  let port=0;
  for(let i=0;i<160;i++){
   const path=join(work,'profile','DevToolsActivePort');
   if(existsSync(path)){port=Number(readFileSync(path,'utf8').split(/\r?\n/)[0]);if(port)break;}
   if(chrome.exitCode!==null)throw Error('CHROME_EXITED '+stderr);
   await pause(80);
  }
  if(!port)throw Error('CHROME_DEBUG_PORT_UNAVAILABLE '+stderr);
  cdp=await devtools(port);
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Network.enable');
  mkdirSync(SHOTS,{recursive:true});
  const sizes=[
   {name:'desktop',width:1440,height:900,mobile:false},
   {name:'mobile',width:390,height:844,mobile:true},
   {name:'compact',width:360,height:740,mobile:true}
  ];
  for(const size of sizes){
   console.log('R28 BROWSER SCREEN:',size.name);
   cdp.errors.length=0;cdp.requests.length=0;
   await cdp.call('Emulation.setDeviceMetricsOverride',{
    width:size.width,height:size.height,deviceScaleFactor:1,mobile:size.mobile
   });
   await cdp.call('Page.navigate',{url:base+'/'});
   await cdp.wait("document.readyState==='complete'&&document.getElementById('notice')?.textContent.includes('сервер готов')",'public-ready');
   const initial=await cdp.evalJS('(()=>({width:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth,headline:document.querySelector("h1")?.textContent,feed:!!document.getElementById("feed-list"),height:document.querySelector(".hero").getBoundingClientRect().height}))()');
   if(initial.width>initial.viewport+2||!initial.headline.includes('Мир начинается')||!initial.feed)
    throw Error('PUBLIC_LAYOUT_BROKEN '+size.name+' '+JSON.stringify(initial));
   const screenshot=async kind=>{
    const result=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    writeFileSync(join(SHOTS,size.name+'-'+kind+'.png'),Buffer.from(result.data,'base64'));
   };
   await screenshot('guest');
   const identity='r28'+size.name;
   const code="(()=>{const f=document.getElementById('register-form');f.elements.inviteCode.value='r28-browser-invite-that-is-long';f.elements.username.value='"+identity+"';f.elements.email.value='"+identity+"@example.net';f.elements.password.value='long-safe-password-2026';f.requestSubmit();return true;})()";
   await cdp.evalJS(code);
   await cdp.wait("document.getElementById('notice').textContent.includes('Локальный профиль создан')",'account-created');
   await cdp.evalJS("(()=>{const f=document.getElementById('login-form');f.elements.email.value='"+identity+"@example.net';f.elements.password.value='long-safe-password-2026';f.requestSubmit();return true;})()");
   await cdp.wait("document.getElementById('identity').textContent==='@"+identity+"'",'signed-in');
   const statement='Мой мир — фактическая публикация R28 '+size.name;
   await cdp.evalJS("(()=>{const f=document.getElementById('post-form');f.elements.body.value='"+statement+"';f.requestSubmit(f.querySelector('button[value=published]'));return true;})()");
   await cdp.wait("document.getElementById('feed-list').textContent.includes('"+statement+"')",'published');
   const audit=await cdp.evalJS("(()=>({width:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth,personal:!document.getElementById('member-access').hidden,worlds:document.querySelectorAll('#world-list .world-card').length,posts:document.querySelectorAll('#feed-list .post').length,remoteImages:document.querySelectorAll('#feed-list img').length}))()");
   if(audit.width>audit.viewport+2||!audit.personal||audit.worlds<1||audit.posts<1||audit.remoteImages!==0)
    throw Error('AUTHENTICATED_LAYOUT_BROKEN '+size.name+' '+JSON.stringify(audit));
   await screenshot('authenticated');
   const external=cdp.requests.filter(url=>/^https?:\/\//.test(url)&&!url.startsWith(base));
   if(external.length)throw Error('EXTERNAL_NETWORK_ACCESS '+external.slice(0,5).join(' | '));
   if(cdp.errors.length)throw Error('BROWSER_JS_ERRORS '+cdp.errors.slice(0,5).join(' | '));
   console.log('R28 BROWSER PASS',size.name,JSON.stringify({public:initial,authenticated:audit,external:0}));
  }
  console.log('R28 BROWSER QA COMPLETE: 6 original Chrome screenshots, real signup, login and publishing');
 }finally{
  cdp?.close();
  if(chrome){
   const exited=new Promise(resolve=>{
    if(chrome.exitCode!==null||chrome.signalCode!==null)return resolve();
    chrome.once('exit',resolve);
    setTimeout(resolve,2500);
   });
   chrome.kill('SIGKILL');
   await exited;
  }
  await lab.close().catch(()=>{});
  // Cleanup must never mask the original browser failure or visual diagnostic.
  try{rmSync(work,{recursive:true,force:true,maxRetries:15,retryDelay:130});}
  catch(error){console.warn('R28 TEMP CLEANUP WARNING',error.message);}

 }
}
main().catch(error=>{console.error('R28 BROWSER FAILURE',error?.stack||error);process.exitCode=1;});
