#!/usr/bin/env node
'use strict';
/* R113 real Chromium transfer across TWO distinct browser origins.
   Both origins are ephemeral 127.0.0.1 ports, private user profile discarded.
   No actual user storage or server accounts accessed; no remote HTTP requests. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn,spawnSync}=require('node:child_process');
const dist=path.resolve(__dirname,'../dist');
const manifest=JSON.parse(fs.readFileSync(path.join(dist,'build-manifest.json'),'utf8'));
const files=new Set(Object.keys(manifest.files)),sleep=n=>new Promise(r=>setTimeout(r,n));
for(const item of ['social.html','social-core.js','social-transfer.js','marcosa-social-first.css'])
 if(!files.has(item))throw Error('R113_MISSING_APPROVED_ASSET '+item);
function serve(){
 return http.createServer((req,res)=>{
  let name;
  try{name=decodeURIComponent(new URL(req.url,'http://127.0.0.1/').pathname).replace(/^\/+/,'');}
  catch{return res.writeHead(400).end();}
  if(!files.has(name))return res.writeHead(404).end();
  try{
   const data=fs.readFileSync(path.join(dist,name));
   const mime=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':
    name.endsWith('.svg')?'image/svg+xml':name.endsWith('.webp')?'image/webp':'text/html';
   res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   res.end(data);
  }catch{res.writeHead(404).end();}
 });
}
async function listen(server){
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return 'http://127.0.0.1:'+server.address().port+'/';
}
function browserExecutable(){
 for(const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){
  const result=spawnSync('which',[name],{encoding:'utf8'});
  if(result.status===0&&result.stdout.trim())return result.stdout.trim();
 }
 throw Error('R113_CHROME_NOT_INSTALLED');
}
async function attach(port){
 let target;
 for(let n=0;n<180;n++){
  try{
   const response=await fetch('http://127.0.0.1:'+port+'/json/list');
   target=(await response.json()).find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
   if(target)break;
  }catch{}
  await sleep(70);
 }
 if(!target)throw Error('R113_DEVTOOLS_NOT_AVAILABLE');
 const socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('R113_WS_TIMEOUT')),12000);
  socket.addEventListener('open',()=>{clearTimeout(timeout);resolve();},{once:true});
  socket.addEventListener('error',()=>{clearTimeout(timeout);reject(Error('R113_WS_ERROR'));},{once:true});
 });
 const tasks=new Map(),requests=[],exceptions=[];
 let seq=0;
 socket.addEventListener('message',event=>{
  let msg;try{msg=JSON.parse(String(event.data));}catch{return;}
  if(msg.method==='Runtime.exceptionThrown')
   exceptions.push(msg.params?.exceptionDetails?.text||'Exception');
  if(msg.method==='Network.requestWillBeSent')
   requests.push(msg.params?.request?.url||'');
  const task=tasks.get(msg.id);if(!task)return;
  tasks.delete(msg.id);clearTimeout(task.timer);
  if(msg.error)task.reject(Error(task.method+': '+JSON.stringify(msg.error)));
  else task.resolve(msg.result);
 });
 function call(method,params={},ms=25000){
  return new Promise((resolve,reject)=>{
   const id=++seq,timer=setTimeout(()=>{tasks.delete(id);reject(Error('R113_CDP_TIMEOUT '+method));},ms);
   tasks.set(id,{method,resolve,reject,timer});
   socket.send(JSON.stringify({id,method,params}));
  });
 }
 async function evalJS(code){
  const r=await call('Runtime.evaluate',{expression:code,returnByValue:true,awaitPromise:true,userGesture:true});
  if(r.exceptionDetails)throw Error('R113_PAGE_JS_FAILED '+(r.exceptionDetails.exception?.description||r.exceptionDetails.text));
  return r.result?.value;
 }
 async function wait(expr,label){
  for(let n=0;n<130;n++){
   try{if(await evalJS(expr))return;}catch{}
   await sleep(80);
  }
  throw Error('R113_UI_TIMEOUT '+label);
 }
 async function navigate(base,mobile=false){
  await call('Emulation.setDeviceMetricsOverride',{width:mobile?390:1366,height:mobile?844:860,deviceScaleFactor:1,mobile});
  await call('Page.navigate',{url:base+'social.html'});
  await wait("document.readyState==='complete'&&!!window.MarcosaSocial&&!!document.getElementById('so-transfer-import')",'social');
 }
 return {call,evalJS,wait,navigate,requests,exceptions,close:()=>socket.close()};
}
function makeSource(){
 localStorage.clear();
 document.querySelector('[data-so-save="signal"]').click();
 document.getElementById('so-draft-text').value='R113 Исходная личная идея A';
 document.getElementById('so-save-draft').click();
 const original=URL.createObjectURL.bind(URL);
 URL.createObjectURL=function(blob){window.__r113_blob=blob;return original(blob);};
 document.getElementById('so-transfer-export').click();
 return true;
}
function inject(encoded){
 const file=new File([encoded],'marcosa-transfer.json',{type:'application/json'});
 const dt=new DataTransfer();dt.items.add(file);
 const input=document.getElementById('so-transfer-import');
 input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
 return true;
}
function inspect(){
 return {
  saved:JSON.parse(localStorage.getItem('marcosa-social-private-saved-v1')||'[]'),
  draft:JSON.parse(localStorage.getItem('marcosa-social-private-draft-v1')||'""'),
  count:document.getElementById('so-saved-count').textContent,
  message:document.getElementById('so-transfer-feedback').textContent,
  error:document.getElementById('so-transfer-feedback').dataset.error,
  overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth
 };
}
async function main(){
 const serverA=serve(),serverB=serve(),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'marcosa-r113-two-origin-'));
 let processChrome=null,cdp=null;
 try{
  const baseA=await listen(serverA),baseB=await listen(serverB);
  if(baseA===baseB)throw Error('R113_ORIGINS_IDENTICAL');
  processChrome=spawn(browserExecutable(),['--headless=new','--no-sandbox','--disable-dev-shm-usage',
   '--disable-background-networking','--no-first-run','--no-default-browser-check',
   '--remote-allow-origins=*','--remote-debugging-port=0',
   '--user-data-dir='+path.join(tmp,'profile'),'about:blank'],{stdio:['ignore','ignore','pipe']});
  let port=0,stderr='';
  processChrome.stderr.on('data',x=>stderr=(stderr+String(x)).slice(-1400));
  for(let n=0;n<180;n++){
   const pointer=path.join(tmp,'profile','DevToolsActivePort');
   if(fs.existsSync(pointer)){
    port=Number(fs.readFileSync(pointer,'utf8').split(/\r?\n/)[0]);
    if(port)break;
   }
   if(processChrome.exitCode!==null)throw Error('R113_CHROME_EXIT '+stderr);
   await sleep(80);
  }
  if(!port)throw Error('R113_CHROME_START_TIMEOUT '+stderr);
  cdp=await attach(port);
  await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');
  await cdp.navigate(baseA);
  await cdp.evalJS('('+makeSource.toString()+')()');
  const encoded=await cdp.evalJS('(async()=>window.__r113_blob.text())()');
  const exported=JSON.parse(encoded);
  if(exported.format!=='MARCOSA-SOCIAL-TRANSFER'||exported.saved.join(',')!=='signal'||
   exported.draft!=='R113 Исходная личная идея A')throw Error('R113_SOURCE_EXPORT_INVALID');
  await cdp.navigate(baseB,true);
  const empty=await cdp.evalJS('('+inspect.toString()+')()');
  if(empty.saved.length||empty.draft)throw Error('R113_ORIGIN_B_INHERITED_A_DATA');
  await cdp.evalJS('('+inject.toString()+')('+JSON.stringify(encoded)+')');
  await cdp.wait("document.getElementById('so-transfer-feedback').dataset.error==='false'&&document.getElementById('so-saved-count').textContent==='1'",'restore');
  const restored=await cdp.evalJS('('+inspect.toString()+')()');
  if(restored.draft!==exported.draft||restored.saved.join(',')!=='signal'||restored.overflow>6)
   throw Error('R113_CROSS_ORIGIN_RESTORE_FAIL '+JSON.stringify(restored));
  await cdp.call('Page.reload',{ignoreCache:true});
  await cdp.wait("document.readyState==='complete'&&!!window.MarcosaSocial",'reload');
  const reload=await cdp.evalJS('('+inspect.toString()+')()');
  if(reload.draft!==exported.draft||reload.saved.join(',')!=='signal')
   throw Error('R113_B_STORAGE_NOT_PERSISTENT');
  console.log('R113_REAL_CROSS_ORIGIN_EXPLICIT_RESTORE=PASS');
  await cdp.evalJS("(()=>{document.querySelector('[data-so-save=\"creator\"]').click();document.getElementById('so-draft-text').value='B собственный черновик';document.getElementById('so-save-draft').click();return true})()");
  await cdp.evalJS('('+inject.toString()+')('+JSON.stringify(encoded)+')');
  await cdp.wait("document.getElementById('so-transfer-feedback').textContent.includes('не перезаписан')&&document.getElementById('so-transfer-feedback').dataset.error==='false'",'conflict');
  const existing=await cdp.evalJS('('+inspect.toString()+')()');
  if(existing.saved.length!==2||!existing.saved.includes('creator')||!existing.saved.includes('signal')||
   existing.draft!=='B собственный черновик')throw Error('R113_CONFLICT_OVERWROTE_B_DATA');
  const snapshot=JSON.stringify({saved:existing.saved,draft:existing.draft});
  await cdp.evalJS('('+inject.toString()+')('+JSON.stringify('{"format":"corrupted"}')+')');
  await cdp.wait("document.getElementById('so-transfer-feedback').dataset.error==='true'",'invalid');
  const after=await cdp.evalJS('('+inspect.toString()+')()');
  if(snapshot!==JSON.stringify({saved:after.saved,draft:after.draft}))
   throw Error('R113_CORRUPT_ARCHIVE_CHANGED_STORAGE');
  console.log('R113_IMPORT_CONFLICT_CORRUPTION_PROTECTED=PASS');
  await cdp.navigate(baseA);
  const original=await cdp.evalJS('('+inspect.toString()+')()');
  if(original.draft!==exported.draft||original.saved.join(',')!=='signal')
   throw Error('R113_ORIGIN_A_DATA_MODIFIED');
  if(cdp.exceptions.length)throw Error('R113_RUNTIME_ERRORS '+JSON.stringify(cdp.exceptions.slice(0,3)));
  const external=cdp.requests.filter(u=>/^https?:/.test(u)&&!u.startsWith(baseA)&&!u.startsWith(baseB));
  if(external.length)throw Error('R113_EXTERNAL_PAGE_REQUESTS '+JSON.stringify(external.slice(0,3)));
  console.log('R113_ORIGINAL_DOMAIN_DATA_INTACT=PASS');
  console.log('R113_TWO_ORIGIN_REAL_CHROME=PASS');
 }finally{
  if(cdp)try{cdp.close()}catch{}
  if(processChrome){
   const exited=new Promise(resolve=>processChrome.once('exit',resolve));
   if(processChrome.exitCode===null)processChrome.kill('SIGTERM');
   await Promise.race([exited,sleep(2200)]);
   if(processChrome.exitCode===null)processChrome.kill('SIGKILL');
  }
  await Promise.all([serverA,serverB].map(s=>new Promise(resolve=>s.listening?s.close(resolve):resolve())));
  await sleep(150);
  fs.rmSync(tmp,{recursive:true,force:true,maxRetries:15,retryDelay:180});
 }
}
main().catch(e=>{console.error('R113_TWO_ORIGIN_FAIL',e.stack||e);process.exitCode=1});
