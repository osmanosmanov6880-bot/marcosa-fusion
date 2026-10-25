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
const SHOTS=resolve('qa-r64');
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
 const work=mkdtempSync(join(tmpdir(),'marcosa-r64-keys-'));
 const lab=createApp({inviteCode:'r64-keys-for-accessibility'});
 let chrome=null,cdp=null;
 try{
  await new Promise((ok,fail)=>{lab.server.once('error',fail);lab.server.listen(0,'127.0.0.1',ok);});
  const base='http://127.0.0.1:'+lab.server.address().port;
  const init=await fetch(base+'/api/auth/register',{
   method:'POST',headers:{'Content-Type':'application/json',Origin:base},
   body:JSON.stringify({username:'a11yowner',email:'a11yowner@example.net',
    password:'this-is-an-isolated-password-r64',inviteCode:'r64-keys-for-accessibility'})
  });
  if(init.status!==201)throw Error('R64_FIXTURE_USER_FAILED '+init.status);
  chrome=spawn(browser(),[
   '--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
   '--disable-features=MediaRouter,CalculateNativeWinOcclusion',
   '--disable-background-networking','--no-first-run','--no-default-browser-check',
   '--remote-allow-origins=*','--remote-debugging-port=0','--user-data-dir='+join(work,'profile'),'about:blank'
  ],{stdio:['ignore','ignore','pipe'],env:{...process.env,DBUS_SESSION_BUS_ADDRESS:'',NO_AT_BRIDGE:'1'}});
  let stderr='';chrome.stderr.on('data',part=>{stderr=(stderr+String(part)).slice(-1000);});
  let port=0;
  for(let i=0;i<375;i++){
   const path=join(work,'profile','DevToolsActivePort');
   if(existsSync(path)){port=Number(readFileSync(path,'utf8').split(/\r?\n/)[0]);if(port)break;}
   if(chrome.exitCode!==null)throw Error('R64_CHROME_EXIT '+stderr);
   await pause(80);
  }
  if(!port)throw Error('R64_DEVTOOLS_PORT_TIMEOUT '+stderr);
  cdp=await devtools(port);
  await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');
  mkdirSync(SHOTS,{recursive:true});
  const sizes=[
   {name:'desktop',width:1440,height:900,mobile:false},
   {name:'mobile',width:390,height:844,mobile:true},
   {name:'compact',width:360,height:740,mobile:true}
  ];
  const key=async value=>{
   const args={key:value,code:value==='Escape'?'Escape':'Enter',
    windowsVirtualKeyCode:value==='Escape'?27:13};
   await cdp.call('Input.dispatchKeyEvent',{type:'rawKeyDown',...args});
   await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',...args});
  };
  for(const size of sizes){
   cdp.errors.length=0;cdp.requests.length=0;
   await cdp.call('Emulation.setDeviceMetricsOverride',{
    width:size.width,height:size.height,deviceScaleFactor:1,mobile:size.mobile
   });
   await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
   await cdp.call('Page.navigate',{url:base+'/'});
   await cdp.wait("document.readyState==='complete'&&document.getElementById('notice')?.textContent.includes('сервер готов')",'R64-ready');
   const semantic=await cdp.evalJS("(()=>({lang:document.documentElement.lang,main:document.querySelectorAll('main').length,skip:document.querySelector('.skip-navigation')?.getAttribute('href'),titleTabindex:document.getElementById('world-detail-title')?.tabIndex,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+2,reduce:matchMedia('(prefers-reduced-motion:reduce)').matches}))()");
   if(semantic.lang!=='ru'||semantic.main!==1||semantic.skip!=='#main-content'||semantic.titleTabindex!==-1||semantic.overflow||!semantic.reduce)throw Error('R64_SEMANTIC_FAILURE_'+size.name+' '+JSON.stringify(semantic));
   await cdp.evalJS("document.querySelector('.skip-navigation').focus()");
   await key('Enter');
   await cdp.wait("document.activeElement?.id==='main-content'",'R64-skip-link-keyboard');
   const passedSkip=await cdp.evalJS("(()=>{const s=document.querySelector('.skip-navigation');s.focus();return getComputedStyle(s).transform==='none';})()");
   if(!passedSkip)throw Error('R64_FOCUS_SKIP_NOT_VISIBLE_'+size.name);
   await cdp.evalJS("document.querySelector('#world-list a.world-open').focus()");
   await key('Enter');
   await cdp.wait("document.getElementById('world-detail')?.hidden===false&&document.activeElement?.id==='world-detail-title'",'R64-open-world-focus');
   const shot=async label=>{
    const audit=await cdp.evalJS("({width:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth})");
    if(audit.width>audit.viewport+2)throw Error('R64_HORIZONTAL_SCROLL_'+size.name+' '+label);
    const png=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    writeFileSync(join(SHOTS,size.name+'-'+label+'.png'),Buffer.from(png.data,'base64'));
   };
   await pause(90);
   await shot('world-focus');
   await key('Escape');
   await cdp.wait("document.getElementById('world-detail')?.hidden===true&&document.activeElement?.classList.contains('world-open')",'R64-esc-restore');
   await shot('after-escape');
   // Deep links must be accessible without relying on the first 30-card catalog.
   await cdp.call('Page.navigate',{url:base+'/#world-u-a11yowner'});
   await cdp.wait("document.getElementById('world-detail')?.hidden===false&&document.activeElement?.id==='world-detail-title'",'R64-deep-link-focus');
   await cdp.evalJS("document.getElementById('world-close').focus()");
   await key('Enter');
   await cdp.wait("document.getElementById('world-detail')?.hidden===true&&document.activeElement?.classList.contains('world-open')",'R64-close-button-focus-return');
   const outside=cdp.requests.filter(url=>/^https?:\/\//.test(url)&&!url.startsWith(base));
   if(outside.length||cdp.errors.length)throw Error('R64_BROWSER_SECURITY_'+size.name+' '+JSON.stringify({outside,errors:cdp.errors}));
   console.log('R64 CHROME ACCESSIBILITY PASS',size.name,'skip/World open/Escape/close/deep-link/reduced-motion');
  }
  console.log('R64 COMPLETE: 3 real Chromium viewports, 6 screenshots, keyboard navigation and focus return');
 }finally{
  cdp?.close();
  if(chrome){
   const exited=new Promise(ok=>{if(chrome.exitCode!==null||chrome.signalCode!==null)return ok();chrome.once('exit',ok);setTimeout(ok,2500);});
   chrome.kill('SIGKILL');await exited;
  }
  await lab.close().catch(()=>{});
  try{rmSync(work,{recursive:true,force:true,maxRetries:15,retryDelay:130});}
  catch(error){console.warn('R64 cleanup warning:',error.message);}
 }
}
main().catch(error=>{console.error('R64 ACCESSIBILITY FAILURE',error?.stack||error);process.exitCode=1;});
