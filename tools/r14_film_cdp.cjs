#!/usr/bin/env node
'use strict';
/* R14: real-clock Chromium acceptance for offline film-audit snapshots. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn,spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SHOTS=path.join(ROOT,'qa-r14'),DIST=path.join(ROOT,'dist');
const ALLOW=new Set(['network.js','film-network.js','film-network.css','film-network.html','film-continuity.js']);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function browser(){
 for(const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){
  const p=spawnSync('which',[name],{encoding:'utf8'});
  if(p.status===0&&p.stdout.trim())return p.stdout.trim();
 }
 throw Error('CHROMIUM_MISSING');
}
function server(){
 return http.createServer((req,res)=>{
  let name;try{name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname).replace(/^\/+/,''));}
  catch(e){res.writeHead(400);res.end();return;}
  if(!ALLOW.has(name)){res.writeHead(404);res.end();return;}
  try{
   const buf=fs.readFileSync(path.join(DIST,name));
   res.writeHead(200,{'Content-Type':name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html; charset=utf-8','Cache-Control':'no-store'});
   res.end(buf);
  }catch(e){res.writeHead(404);res.end();}
 });
}
async function cdpConnect(port){
 let page;
 for(let i=0;i<90;i++){
  try{page=(await (await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(p=>p.type==='page'&&p.webSocketDebuggerUrl);if(page)break;}
  catch(e){}
  await sleep(100);
 }
 if(!page)throw Error('CDP_NO_PAGE');
 const socket=new WebSocket(page.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('CDP_WS_TIMEOUT')),10000);
  socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
  socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('CDP_WS_ERROR'));},{once:true});
 });
 let next=0;const pending=new Map(),requests=[];
 socket.addEventListener('message',event=>{
  let m;try{m=JSON.parse(String(event.data));}catch(e){return;}
  if(m.method==='Network.requestWillBeSent')requests.push(m.params?.request?.url||'');
  if(!pending.has(m.id))return;
  const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);
  if(m.error)p.reject(Error('CDP '+p.method+': '+JSON.stringify(m.error)));else p.resolve(m.result);
 });
 const call=(method,params={},duration=25000)=>new Promise((resolve,reject)=>{
  const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP_TIMEOUT_'+method));},duration);
  pending.set(id,{method,resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
 });
 async function evalJS(expression,duration=35000){
  const msg=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},duration);
  if(msg.exceptionDetails)throw Error('JS_EXCEPTION '+(msg.exceptionDetails.exception?.description||msg.exceptionDetails.text));
  return msg.result?.value;
 }
 return {call,evalJS,requests,close:()=>socket.close()};
}
async function ready(cdp){
 for(let i=0;i<110;i++){
  try{if(await cdp.evalJS("document.readyState==='complete'&&!!window.MarcosaFilmNetworkRuntime&&!!window.MarcosaFilmContinuityRuntime",5000))return;}
  catch(e){}
  await sleep(80);
 }
 throw Error('R14_UI_NOT_READY');
}
function firstPhase(){
 return (async function(){
  const $=id=>document.getElementById(id);
  const check=(test,label)=>{if(!test)throw Error(label);};
  const wait=async(test,label)=>{
   for(let i=0;i<125;i++){if(await test())return;await new Promise(resolve=>setTimeout(resolve,45));}
   throw Error('WAIT_'+label+' / '+$('fn14-feedback').textContent);
  };
  const kit=window.MarcosaFilmNetwork,mod=window.MarcosaFilmContinuity,app=window.MarcosaFilmNetworkRuntime;
  const store=mod.createStore(window.indexedDB,window.crypto);
  check(window.isSecureContext,'NOT_SECURE_ORIGIN');
  const csv='asset_id,verified_domain,project_name\nFILM-01,film.example.org,Story One\nFILM-02,movie.example.net,Story Two\n';
  const file=new File([csv],'film-domains.csv',{type:'text/csv'});
  const dt=new DataTransfer();dt.items.add(file);
  $('fn-import').files=dt.files;
  $('fn-import').dispatchEvent(new Event('change',{bubbles:true}));
  await wait(()=>app.sites.length===2,'IMPORT_CSV');
  for(let i=0;i<6;i++)$('fn-checks').querySelectorAll('input')[i].click();
  $('fn-note').value='Opening checked.\nIndependent rights still unverified.';
  $('fn-note').dispatchEvent(new Event('input',{bubbles:true}));
  check(app.sites[0].note.includes('\n'),'NEWLINES_NOT_PRESERVED');
  check(kit.shortlist(app.sites).length===1,'PILOT_CANDIDATE_MISSING');
  $('fn14-save').click();
  await wait(async()=>((await store.list()).length===1),'SAVE_ONE');
  check((await store.list())[0].report.sites[0].checks_completed===6,'FIRST_VERSION_CHANGED');
  await new Promise(resolve=>setTimeout(resolve,130));
  $('fn-checks').querySelectorAll('input')[6].click();
  $('fn-note').value='Opening and source checked.\nIndependent legal document still required.';
  $('fn-note').dispatchEvent(new Event('input',{bubbles:true}));
  $('fn14-save').click();
  await wait(async()=>((await store.list()).length===2),'SAVE_TWO');
  const versions=await store.list();
  check(versions[0].report.sites[0].checks_completed===7,'LATEST_VERSION_MISSING');
  check(versions[1].report.sites[0].checks_completed===6,'PREVIOUS_VERSION_OVERWRITTEN');
  return {pass:'PASS_R14_TWO_IMMUTABLE_LOCAL_REVISIONS',sites:2,revisions:2};
 })();
}
function restorePhase(){
 return (async function(){
  const $=id=>document.getElementById(id);
  const wait=async(test,label)=>{
   for(let i=0;i<120;i++){if(await test())return;await new Promise(resolve=>setTimeout(resolve,45));}
   throw Error('WAIT_'+label+' / '+$('fn14-feedback').textContent);
  };
  const kit=window.MarcosaFilmNetwork,mod=window.MarcosaFilmContinuity,app=window.MarcosaFilmNetworkRuntime;
  const store=mod.createStore(window.indexedDB,window.crypto);
  if(app.sites.length!==0)throw Error('AUTOSAVE_OR_UNAUTHORIZED_AUTORESTORE');
  await wait(()=>document.querySelectorAll('#fn14-list .fn-snapshot').length===2,'SNAPSHOTS_AFTER_REFRESH');
  window.confirm=()=>true;
  document.querySelector('#fn14-list .fn-snapshot button').click();
  await wait(()=>app.sites.length===2,'RESTORE');
  if(kit.checked(app.sites[0])!==7||!app.sites[0].note.includes('legal document'))
   throw Error('RESTORED_DATA_LOST');
  const report=kit.report(app.sites,new Date().toISOString());
  const upload=async data=>{
   const input=$('fn14-import'),dt=new DataTransfer();
   dt.items.add(new File([data],'audit.json',{type:'application/json'}));
   input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  };
  const forged=JSON.parse(JSON.stringify(report));forged.externally_verified=true;
  await upload(JSON.stringify(forged));
  await wait(()=>$('fn14-feedback').textContent.includes('Файл отклонён'),'TAMPER_REJECTED');
  if(kit.checked(app.sites[0])!==7)throw Error('FORGED_IMPORT_CHANGED_CURRENT_STATE');
  $('fn-clear').click();
  if(app.sites.length!==0)throw Error('CLEAR_FAILED');
  await upload(JSON.stringify(report));
  await wait(()=>app.sites.length===2,'R13_JSON_IMPORT');
  if(kit.checked(app.sites[0])!==7)throw Error('R13_JSON_LOST_CHECKS');
  if((await store.list()).length!==2)throw Error('IMPORT_AUTO_SAVED');
  for(let i=0;i<10;i++)await store.save(app.sites,new Date(Date.now()+1000+i).toISOString());
  if((await store.list()).length!==12)throw Error('LIMIT_12_FAILED');
  let full=false;
  try{await store.save(app.sites);}catch(err){full=err.message==='SNAPSHOT_LIMIT';}
  if(!full||(await store.list()).length!==12)throw Error('NON_ATOMIC_OVER_LIMIT');
  await store.remove((await store.list())[0].id);
  if((await store.list()).length!==11)throw Error('REMOVE_VERSION_FAILED');
  await store.save(app.sites);
  if((await store.list()).length!==12)throw Error('NO_REUSE_AFTER_REMOVE');
  const all=await store.list();
  for(let i=2;i<all.length;i++)await store.remove(all[i].id);
  await window.MarcosaFilmContinuityRuntime.refresh();
  $('fn-continuity').scrollIntoView({block:'start',behavior:'instant'});
  await new Promise(resolve=>setTimeout(resolve,140));
  if(document.documentElement.scrollWidth-document.documentElement.clientWidth>3)
   throw Error('HORIZONTAL_OVERFLOW_MOBILE');
  if(document.querySelectorAll('img[src=x]').length)throw Error('HTML_INJECTION');
  return {pass:'PASS_R14_REOPEN_JSON_TAMPER_LIMIT',sites:app.sites.length,revisions:(await store.list()).length};
 })();
}
async function main(){
 const chromium=browser(),httpServer=server(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'marcosa-r14-'));
 let proc=null,cdp=null;
 try{
  await new Promise((ok,fail)=>{httpServer.once('error',fail);httpServer.listen(0,'127.0.0.1',ok);});
  const webport=httpServer.address().port,profile=path.join(temp,'profile');
  proc=spawn(chromium,['--headless=new','--no-sandbox','--disable-dev-shm-usage',
   '--disable-background-networking','--no-first-run','--no-default-browser-check',
   '--remote-allow-origins=*','--remote-debugging-port=0','--user-data-dir='+profile,
   'about:blank'],{stdio:['ignore','ignore','pipe']});
  let chromeErrors='';proc.stderr.on('data',buf=>chromeErrors=(chromeErrors+String(buf)).slice(-3000));
  let port=0;
  for(let i=0;i<130;i++){
   const info=path.join(profile,'DevToolsActivePort');
   if(fs.existsSync(info)){port=Number(fs.readFileSync(info,'utf8').split(/\r?\n/)[0]);if(port>0)break;}
   if(proc.exitCode!==null)throw Error('CHROME_EXIT '+chromeErrors);
   await sleep(100);
  }
  if(!port)throw Error('CHROME_PORT_MISSING '+chromeErrors);
  cdp=await cdpConnect(port);
  await cdp.call('Runtime.enable');
  await cdp.call('Page.enable');
  await cdp.call('Network.enable');
  fs.mkdirSync(SHOTS,{recursive:true});
  for(const device of [{name:'desktop',width:1440,height:900,mobile:false},{name:'mobile',width:390,height:844,mobile:true}]){
   await cdp.call('Emulation.setDeviceMetricsOverride',{width:device.width,height:device.height,deviceScaleFactor:1,mobile:device.mobile});
   cdp.requests.length=0;
   await cdp.call('Page.navigate',{url:'http://127.0.0.1:'+webport+'/film-network.html'});
   await ready(cdp);
   const first=await cdp.evalJS('('+firstPhase.toString()+')()',40000);
   if(first.pass!=='PASS_R14_TWO_IMMUTABLE_LOCAL_REVISIONS')throw Error('PHASE_ONE '+JSON.stringify(first));
   console.log('R14 '+device.name+' phase1: '+JSON.stringify(first));
   await cdp.call('Page.navigate',{url:'http://127.0.0.1:'+webport+'/film-network.html'});
   await ready(cdp);
   const second=await cdp.evalJS('('+restorePhase.toString()+')()',65000);
   if(second.pass!=='PASS_R14_REOPEN_JSON_TAMPER_LIMIT')throw Error('PHASE_TWO '+JSON.stringify(second));
   console.log('R14 '+device.name+' phase2: '+JSON.stringify(second));
   const screenshot=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
   const bytes=Buffer.from(screenshot.data,'base64');
   if(bytes.length<10000||bytes.subarray(0,4).toString('hex')!=='89504e47')
    throw Error('INVALID_PNG_'+device.name);
   fs.writeFileSync(path.join(SHOTS,'r14-real-'+device.name+'-audit-recovery.png'),bytes);
   if(cdp.requests.some(u=>/^https?:/.test(u)&&!u.startsWith('http://127.0.0.1:'+webport+'/')))
    throw Error('UNEXPECTED_EXTERNAL_REQUESTS_'+device.name);
   // Prepare a clean browser for next device without deleting somebody else's files.
   await cdp.evalJS("(async()=>{const s=MarcosaFilmContinuity.createStore(indexedDB,crypto);for(const x of await s.list())await s.remove(x.id);return true;})()",14000);
  }
  console.log('R14 desktop/mobile Chrome local audit recovery: PASS');
 }finally{
  if(cdp)try{cdp.close();}catch(e){}
  if(proc){
   const stopped=new Promise(ok=>proc.once('exit',ok));
   if(proc.exitCode===null)proc.kill('SIGTERM');
   await Promise.race([stopped,sleep(2200)]);
   if(proc.exitCode===null)proc.kill('SIGKILL');
   await sleep(120);
  }
  await new Promise(ok=>httpServer.close(ok));
  try{fs.rmSync(temp,{recursive:true,force:true,maxRetries:12,retryDelay:250});}
  catch(e){console.warn('R14 profile cleanup:',e.message);}
 }
}
main().catch(e=>{console.error('R14 CHROMIUM FAIL:',e.stack||e);process.exitCode=1;});