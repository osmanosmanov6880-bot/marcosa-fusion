#!/usr/bin/env node
'use strict';
/* R110 real Chromium: private Social transfer download, import, conflict safety.
   Only local server/temporary Chrome profile; no production connections. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),
 http=require('node:http'),{spawn,spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),DIST=path.join(ROOT,'dist'),QA=path.join(ROOT,'qa-r110');
const manifest=JSON.parse(fs.readFileSync(path.join(DIST,'build-manifest.json'),'utf8'));
const allow=new Set(Object.keys(manifest.files));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function chrome(){
 for(const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){
  const v=spawnSync('which',[name],{encoding:'utf8'});
  if(v.status===0&&v.stdout.trim())return v.stdout.trim();
 }
 throw Error('R110_REAL_CHROME_REQUIRED');
}
function server(){
 return http.createServer((req,res)=>{
  let file;
  try{file=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname).replace(/^\/+/,'');}
  catch{res.writeHead(400).end();return;}
  if(!allow.has(file)){res.writeHead(404).end();return;}
  try{
   const bytes=fs.readFileSync(path.join(DIST,file));
   const mime=file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':
    file.endsWith('.svg')?'image/svg+xml':file.endsWith('.webp')?'image/webp':'text/html';
   res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   res.end(bytes);
  }catch{res.writeHead(404).end();}
 });
}
async function inspector(port){
 let target;
 for(let i=0;i<170;i++){
  try{
   const r=await fetch('http://127.0.0.1:'+port+'/json/list');
   target=(await r.json()).find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
   if(target)break;
  }catch{}
  await delay(70);
 }
 if(!target)throw Error('R110_NO_CDP_PAGE');
 const ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{
  const t=setTimeout(()=>reject(Error('R110_CDP_CONNECT_TIMEOUT')),13000);
  ws.addEventListener('open',()=>{clearTimeout(t);resolve()},{once:true});
  ws.addEventListener('error',()=>{clearTimeout(t);reject(Error('R110_CDP_CONNECT_ERROR'))},{once:true});
 });
 let seq=0;const jobs=new Map(),errors=[],requests=[];
 ws.addEventListener('message',event=>{
  let x;try{x=JSON.parse(String(event.data));}catch{return;}
  if(x.method==='Runtime.exceptionThrown')errors.push(x.params?.exceptionDetails?.text||'Runtime exception');
  if(x.method==='Network.requestWillBeSent')requests.push(x.params?.request?.url||'');
  const job=jobs.get(x.id);if(!job)return;
  jobs.delete(x.id);clearTimeout(job.timer);
  if(x.error)job.reject(Error(job.method+' '+JSON.stringify(x.error)));
  else job.resolve(x.result);
 });
 function call(method,params={},timeout=25000){
  return new Promise((resolve,reject)=>{
   const id=++seq;
   const timer=setTimeout(()=>{jobs.delete(id);reject(Error('R110_CDP_TIMEOUT '+method))},timeout);
   jobs.set(id,{resolve,reject,timer,method});
   ws.send(JSON.stringify({id,method,params}));
  });
 }
 async function evaluate(expression){
  const x=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true},20000);
  if(x.exceptionDetails)throw Error('R110_JS_EXCEPTION '+(x.exceptionDetails.exception?.description||x.exceptionDetails.text));
  return x.result?.value;
 }
 async function wait(code,label){
  for(let n=0;n<120;n++){
   try{if(await evaluate(code))return;}catch{}
   await delay(80);
  }
  throw Error('R110_NOT_READY '+label);
 }
 return {call,evaluate,wait,errors,requests,close:()=>ws.close()};
}
function prepareExport(){
 localStorage.clear();
 const save=document.querySelector('[data-so-save="signal"]');
 save.click();
 const textarea=document.getElementById('so-draft-text');
 textarea.value='R110 исходная личная заметка';
 document.getElementById('so-save-draft').click();
 if(document.getElementById('so-saved-count').textContent!=='1')throw Error('Bookmark did not persist');
 const orig=URL.createObjectURL.bind(URL);
 URL.createObjectURL=function(value){window.__r110_export_blob=value;return orig(value)};
 document.getElementById('so-transfer-export').click();
 return true;
}
function importBackup(encoded){
 const file=new File([JSON.stringify(encoded)],'social-transfer.json',{type:'application/json'});
 const dt=new DataTransfer();
 dt.items.add(file);
 const picker=document.getElementById('so-transfer-import');
 picker.files=dt.files;
 picker.dispatchEvent(new Event('change',{bubbles:true}));
 return true;
}
function inspectImport(){
 return {
  saved:JSON.parse(localStorage.getItem('marcosa-social-private-saved-v1')),
  draft:JSON.parse(localStorage.getItem('marcosa-social-private-draft-v1')),
  count:document.getElementById('so-saved-count').textContent,
  warning:document.getElementById('so-transfer-feedback').textContent,
  overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
  buttonVisible:document.getElementById('so-transfer-export').getBoundingClientRect().width>70
 };
}
async function main(){
 if(!allow.has('social-transfer.js'))throw Error('R110_TRANSFER_MODULE_NOT_IN_SIGNED_BUILD');
 const web=server(),profileDir=fs.mkdtempSync(path.join(os.tmpdir(),'marcosa-r110-cdp-'));
 let browser=null,cdp=null;
 try{
  await new Promise((res,rej)=>{web.once('error',rej);web.listen(0,'127.0.0.1',res)});
  const base='http://127.0.0.1:'+web.address().port+'/',chromePath=chrome();
  browser=spawn(chromePath,['--headless=new','--no-sandbox','--disable-dev-shm-usage',
   '--disable-background-networking','--no-first-run','--no-default-browser-check',
   '--remote-allow-origins=*','--remote-debugging-port=0','--user-data-dir='+path.join(profileDir,'profile'),'about:blank'],
   {stdio:['ignore','ignore','pipe']});
  let debugPort=0,error='';
  browser.stderr.on('data',data=>error=(error+String(data)).slice(-1400));
  for(let i=0;i<180;i++){
   const pointer=path.join(profileDir,'profile','DevToolsActivePort');
   if(fs.existsSync(pointer)){debugPort=Number(fs.readFileSync(pointer,'utf8').split(/\r?\n/)[0]);if(debugPort)break;}
   if(browser.exitCode!==null)throw Error('R110_CHROME_EXITED '+error);
   await delay(80);
  }
  if(!debugPort)throw Error('R110_CHROME_DEBUG_PORT_NOT_READY '+error);
  cdp=await inspector(debugPort);
  await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');
  fs.mkdirSync(QA,{recursive:true});
  for(const viewport of [{name:'desktop',width:1440,height:900,mobile:false},
                         {name:'mobile',width:390,height:844,mobile:true}]){
   await cdp.call('Emulation.setDeviceMetricsOverride',
    {width:viewport.width,height:viewport.height,deviceScaleFactor:1,mobile:viewport.mobile});
   await cdp.call('Page.navigate',{url:base+'social.html'});
   await cdp.wait("document.readyState==='complete' && !!window.MarcosaSocial && !!document.querySelector('#so-transfer-import')",'social-ui');
   await cdp.evaluate('('+prepareExport.toString()+')()');
   const exported=await cdp.evaluate('(async()=>JSON.parse(await window.__r110_export_blob.text()))()');
   if(exported.format!=='MARCOSA-SOCIAL-TRANSFER'||exported.version!==1||
    exported.saved.length!==1||exported.saved[0]!=='signal'||
    !exported.draft.includes('исходная'))throw Error('R110_EXPORTED_REAL_BLOB_INVALID');
   const imported={
    ...exported,
    saved:['signal','atlas'],
    draft:'Текст из другого браузера (не должен затереть)',
    exportedAt:'2026-10-26T00:00:00.000Z'
   };
   await cdp.evaluate('('+importBackup.toString()+')('+JSON.stringify(imported)+')');
   await cdp.wait("document.getElementById('so-transfer-feedback').textContent.includes('Импортировано 1 закладок')",'import-feedback');
   const end=await cdp.evaluate('('+inspectImport.toString()+')()');
   if(end.saved.length!==2||!end.saved.includes('atlas')||!end.saved.includes('signal')||
    end.count!=='2'||end.draft!=='R110 исходная личная заметка'||
    !end.warning.includes('не перезаписан')||end.overflow>6||!end.buttonVisible)
     throw Error('R110_REAL_BROWSER_IMPORT_UNSAFE '+JSON.stringify(end));
   await cdp.evaluate("document.getElementById('so-transfer-panel').scrollIntoView({block:'center',behavior:'instant'});true");
   await delay(120);
   const shot=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
   const png=Buffer.from(shot.data,'base64');
   if(png.length<9000||png.subarray(0,4).toString('hex')!=='89504e47')throw Error('R110_SCREENSHOT_EMPTY');
   fs.writeFileSync(path.join(QA,'r110-'+viewport.name+'-social-portability.png'),png);
   const external=cdp.requests.filter(u=>/^https?:/.test(u)&&!u.startsWith(base));
   if(external.length)throw Error('R110_EXTERNAL_NETWORK_REQUESTS '+JSON.stringify(external.slice(0,5)));
   if(cdp.errors.length)throw Error('R110_RUNTIME_ERRORS '+JSON.stringify(cdp.errors.slice(0,3)));
   console.log('R110_'+viewport.name.toUpperCase()+'_BROWSER_TRANSFER=PASS');
  }
  console.log('R110_REAL_BROWSER_BACKUP_IMPORT=PASS');
 }finally{
  if(cdp)try{cdp.close()}catch{}
  if(browser){
   const done=new Promise(resolve=>browser.once('exit',resolve));
   if(browser.exitCode===null)browser.kill('SIGTERM');
   await Promise.race([done,delay(2200)]);
   if(browser.exitCode===null)browser.kill('SIGKILL');
  }
  await new Promise(resolve=>web.close(resolve));
  await delay(250);
  try{fs.rmSync(profileDir,{recursive:true,force:true,maxRetries:20,retryDelay:200})}
  catch(e){console.warn('R110 Chrome profile cleanup:',e.code||e.message)}
 }
}
main().catch(e=>{console.error('R110_REAL_BROWSER_FAIL',e.stack||e);process.exitCode=1});
