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
const SHOTS=resolve('qa-r82');
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
 const work=mkdtempSync(join(tmpdir(),'marcosa-r82-incident-ui-'));
 const instances=[],ports=[];
 let chrome=null,cdp=null;
 try{
  const modes=[
   {name:'healthy',options:{},key:null},
   {name:'content',options:{contentWritesDisabled:true},key:'incident.content'},
   {name:'media',options:{publicMediaDisabled:true},key:'incident.media'},
   {name:'both',options:{contentWritesDisabled:true,publicMediaDisabled:true},key:'incident.both'}
  ];
  for(const mode of modes){
   const lab=createApp(mode.options);instances.push(lab);
   await new Promise((ok,fail)=>{lab.server.once('error',fail);lab.server.listen(0,'127.0.0.1',ok);});
   ports.push('http://127.0.0.1:'+lab.server.address().port);
  }
  chrome=spawn(browser(),['--headless=new','--no-sandbox','--disable-dev-shm-usage',
   '--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check',
   '--remote-allow-origins=*','--remote-debugging-port=0',
   '--user-data-dir='+join(work,'profile'),'about:blank'],
   {stdio:['ignore','ignore','pipe'],env:{...process.env,DBUS_SESSION_BUS_ADDRESS:'',NO_AT_BRIDGE:'1'}});
  let stderr='';chrome.stderr.on('data',b=>{stderr=(stderr+String(b)).slice(-900);});
  let port=0;
  for(let i=0;i<375;i++){
   const file=join(work,'profile','DevToolsActivePort');
   if(existsSync(file)){port=Number(readFileSync(file,'utf8').split(/\r?\n/)[0]);if(port)break;}
   if(chrome.exitCode!==null)throw Error('R82_CHROME_EXIT '+stderr);
   await pause(80);
  }
  if(!port)throw Error('R82_DEVTOOLS_TIMEOUT '+stderr);
  cdp=await devtools(port);
  await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');
  mkdirSync(SHOTS,{recursive:true});
  const viewports=[{name:'desktop',width:1440,height:900,mobile:false},
   {name:'mobile',width:390,height:844,mobile:true},
   {name:'compact',width:360,height:740,mobile:true}];
  for(const viewport of viewports){
   await cdp.call('Emulation.setDeviceMetricsOverride',{
    width:viewport.width,height:viewport.height,deviceScaleFactor:1,mobile:viewport.mobile
   });
   for(let k=0;k<modes.length;k++){
    const mode=modes[k],base=ports[k];cdp.requests.length=0;cdp.errors.length=0;
    await cdp.call('Page.navigate',{url:base+'/'});
    await cdp.wait("document.readyState==='complete'&&(/сервер готов|server ready/i).test(document.getElementById('notice')?.textContent||'')",'R82-'+mode.name+'-ready');
    await cdp.evalJS("MARCOSA_LOCALE.setLanguage('ru')");
    const ru=await cdp.evalJS("(()=>{const b=document.getElementById('incident-banner');return{hidden:b.hidden,key:b.dataset.i18nDynamic||null,text:b.textContent,role:b.getAttribute('role'),live:b.getAttribute('aria-live'),locale:document.documentElement.lang,scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth};})()");
    if(ru.hidden!==!mode.key||ru.key!==mode.key||ru.locale!=='ru'
      ||ru.role!=='status'||ru.live!=='polite'||ru.scroll>ru.client+2)
     throw Error('R82_RU_INCIDENT_UI_'+viewport.name+'_'+mode.name+' '+JSON.stringify(ru));
    if(mode.key&&!ru.text.includes('Временная защита'))throw Error('R82_RU_NOTICE '+JSON.stringify(ru));
    if(!mode.key&&ru.text!=='')throw Error('R82_HEALTHY_HAS_VISIBLE_WARNING');
    const image=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    writeFileSync(join(SHOTS,viewport.name+'-'+mode.name+'-ru.png'),Buffer.from(image.data,'base64'));
    await cdp.evalJS("(()=>{const el=document.getElementById('language-switch');el.value='en';el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
    await cdp.wait("document.documentElement.lang==='en'",'R82-language-toggle');
    const en=await cdp.evalJS("(()=>{const b=document.getElementById('incident-banner');return{hidden:b.hidden,key:b.dataset.i18nDynamic||null,text:b.textContent,scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,lang:document.documentElement.lang};})()");
    if(en.key!==mode.key||en.hidden!==!mode.key||en.lang!=='en'||en.scroll>en.client+2)
     throw Error('R82_EN_INCIDENT_UI_'+viewport.name+'_'+mode.name+' '+JSON.stringify(en));
    if(mode.key&&!en.text.includes('Temporary protection'))throw Error('R82_EN_NOTICE '+JSON.stringify(en));
    if(mode.key){
     const eng=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
     writeFileSync(join(SHOTS,viewport.name+'-'+mode.name+'-en.png'),Buffer.from(eng.data,'base64'));
    }
    if(cdp.errors.length)throw Error('R82_BROWSER_JS_'+JSON.stringify(cdp.errors));
    const external=cdp.requests.filter(url=>/^https?:\/\//.test(url)&&!ports.some(p=>url.startsWith(p+'/')));
    if(external.length)throw Error('R82_UNEXPECTED_EXTERNAL_REQUEST '+JSON.stringify(external));
    console.log('R82 ACTUAL CHROME BANNER PASS',viewport.name,mode.name,'RU/EN');
   }
  }
  console.log('R82 COMPLETE: genuine Chromium 1440/390/360 with 4 health states and bilingual incident evidence');
 }finally{
  cdp?.close();
  if(chrome){
   const exited=new Promise(ok=>{if(chrome.exitCode!==null||chrome.signalCode!==null)return ok();chrome.once('exit',ok);setTimeout(ok,2500);});
   chrome.kill('SIGKILL');await exited;
  }
  for(const lab of instances)await lab.close().catch(()=>{});
  try{rmSync(work,{recursive:true,force:true,maxRetries:15,retryDelay:100});}catch(e){console.warn('R82 cleanup:',e.message);}
 }
}
main().catch(e=>{console.error('R82 BROWSER FAILURE',e?.stack||e);process.exitCode=1;});
