#!/usr/bin/env node
'use strict';
/* MARCOSA R9 — real-time Chrome DevTools Protocol test of on-device IndexedDB.
 * No NPM dependencies, no external websites or virtual-clock acceleration.
 * Serves only four public files over localhost, tests save/restore/review/delete.
 */
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {spawn,spawnSync}=require('node:child_process');

const ROOT=path.resolve(__dirname,'..');
const DIST=path.join(ROOT,'dist');
const SHOTS=path.join(ROOT,'qa-r5');
const PUBLIC=new Set(['creator.html','creator.css','creator.js','creator-vault.js']);
const MIME={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8'};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function browser(){
  for(const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){
    const proc=spawnSync('which',[name],{encoding:'utf8'});
    if(proc.status===0&&proc.stdout.trim())return proc.stdout.trim();
  }
  return null;
}
function serve(){
  return http.createServer((req,res)=>{
    let name;
    try{name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname).replace(/^\/+/, '');}
    catch(err){res.writeHead(400);res.end();return;}
    if(!PUBLIC.has(name)){res.writeHead(404);res.end();return;}
    const file=path.join(DIST,name);
    try{
      const data=fs.readFileSync(file);
      res.writeHead(200,{'Content-Type':MIME[path.extname(name).slice(1)]||'text/plain',
        'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      res.end(data);
    }catch(err){res.writeHead(404);res.end();}
  });
}
async function connectPage(port){
  let page;
  for(let i=0;i<80;i++){
    try{
      const response=await fetch('http://127.0.0.1:'+port+'/json/list');
      const entries=await response.json();
      page=entries.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
      if(page)break;
    }catch(err){}
    await pause(100);
  }
  if(!page)throw Error('CDP_PAGE_UNAVAILABLE');
  if(typeof WebSocket!=='function')throw Error('NODE_22_WEBSOCKET_REQUIRED');
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
    const tm=setTimeout(()=>reject(Error('CDP_WEBSOCKET_TIMEOUT')),10000);
    ws.addEventListener('open',()=>{clearTimeout(tm);resolve();},{once:true});
    ws.addEventListener('error',()=>{clearTimeout(tm);reject(Error('CDP_WEBSOCKET_FAILED'));},{once:true});
  });
  let id=0;const pending=new Map();
  ws.addEventListener('message',event=>{
    let msg;
    try{msg=JSON.parse(String(event.data));}catch(err){return;}
    if(typeof msg.id!=='number'||!pending.has(msg.id))return;
    const record=pending.get(msg.id);pending.delete(msg.id);clearTimeout(record.timeout);
    if(msg.error)record.reject(Error('CDP '+record.method+': '+JSON.stringify(msg.error)));
    else record.resolve(msg.result);
  });
  function call(method,params={},timeout=25000){
    if(ws.readyState!==WebSocket.OPEN)return Promise.reject(Error('CDP_SOCKET_CLOSED'));
    return new Promise((resolve,reject)=>{
      const callId=++id;
      const timer=setTimeout(()=>{pending.delete(callId);reject(Error('CDP_TIMEOUT_'+method));},timeout);
      pending.set(callId,{resolve,reject,method,timeout:timer});
      ws.send(JSON.stringify({id:callId,method,params}));
    });
  }
  return {call,close:()=>ws.close()};
}
async function evaluate(cdp,expression,timeout=25000){
  const result=await cdp.call('Runtime.evaluate',{
    expression,awaitPromise:true,returnByValue:true,userGesture:true
  },timeout);
  if(result.exceptionDetails){
    const detail=result.exceptionDetails;
    throw Error('JS_EXCEPTION: '+(detail.text||'')+' '+(detail.exception?.description||''));
  }
  return result.result?.value;
}
async function waitForPage(cdp){
  for(let i=0;i<90;i++){
    try{
      const ready=await evaluate(cdp,"document.readyState==='complete'&&!!window.MarcosaCreatorRuntime&&!!window.MarcosaLocalVault",5000);
      if(ready)return;
    }catch(err){}
    await pause(100);
  }
  throw Error('R9_PAGE_BOOT_TIMEOUT');
}
function liveTest(){
  return (async function(){
    const $=id=>document.getElementById(id);
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const wait=async(check,reason)=>{
      for(let i=0;i<140;i++){if(check())return;await sleep(45);}
      throw Error('WAIT_'+reason+' / '+$('mc-vault-feedback').textContent);
    };
    const check=(value,reason)=>{if(!value)throw Error(reason);};
    const api=window.MarcosaLocalVault;
    check(!!api&&!!window.indexedDB&&!!window.crypto,'VAULT_MISSING');
    check(window.isSecureContext,'NOT_LOCALHOST_SECURE_CONTEXT');
    await wait(()=>$('mc-vault-feedback').textContent.includes('Локальный архив доступен'),'STORAGE');
    check(!$('mc-save-revision').disabled,'SAVE_DISABLED');
    $('mc-project-name').value='R9 Integration Story';
    $('mc-save-revision').click();
    await wait(()=>document.querySelectorAll('#mc-version-list .mc-version-row').length===1,'FIRST_SAVE');
    check(document.querySelectorAll('#mc-project-list .mc-project-card').length===1,'NO_PROJECT_CARD');
    const store=api.createVault(window.indexedDB,window.crypto);
    let list=await store.list();
    check(list.length===1&&list[0].revisions[0].draft.title==='R9 Integration Story','INDEXEDDB_FIRST');
    const field=$('mc-field-opening-scene'),original=field.value;
    field.value=original+' Дополнительная версия для проверки истории изменений.';
    field.dispatchEvent(new Event('input',{bubbles:true}));
    check($('mc-export-review').disabled,'STALE_REVIEW_NOT_BLOCKED');
    $('mc-version-note').value='Second version';
    await wait(()=>!$('mc-save-revision').disabled,'SAVE_UNLOCK_1');
    $('mc-save-revision').click();
    await wait(()=>document.querySelectorAll('#mc-version-list .mc-version-row').length===2,'SECOND_SAVE');
    document.querySelector('#mc-version-list .mc-version-row .mc-version-actions button').click();
    check($('mc-revision-diff').textContent.includes('opening.scene'),'DIFF_MISSING');
    window.confirm=()=>true;
    const rows=document.querySelectorAll('#mc-version-list .mc-version-row');
    rows[rows.length-1].querySelector('.mc-version-actions button:last-child').click();
    check(field.value===original,'RESTORE_WRONG_VERSION');
    check($('mc-export-review').disabled,'STALE_RESTORED_REVIEW');
    await wait(()=>!$('mc-save-revision').disabled,'SAVE_UNLOCK_2');
    $('mc-save-revision').click();
    await wait(()=>document.querySelectorAll('#mc-version-list .mc-version-row').length===3,'THIRD_SAVE');
    for(const key of ['authorship','sponsorship','editorial','privacy']){
      const box=$('mc-review-'+key);box.checked=true;
      box.dispatchEvent(new Event('change',{bubbles:true}));
    }
    check(!$('mc-export-review').disabled,'REVIEW_STILL_DISABLED');
    $('mc-export-review').click();
    check($('mc-export-review').disabled,'CHECKLIST_NOT_RESET');
    check($('mc-vault-feedback').textContent.includes('Пакет'),'REVIEW_FEEDBACK');
    list=await store.list();
    check(list.length===1&&list[0].revisions.length===3,'INDEXEDDB_REVISIONS');
    check(list[0].revisions[0].revision===1&&list[0].revisions[2].revision===3,'VERSION_ORDER');
    check(list[0].revisions[0].draft.rights_self_attested===false,'LEGAL_CONSENT_PERSISTED');
    $('mc-vault').scrollIntoView({block:'start',behavior:'auto'});
    await sleep(150);
    check(document.documentElement.scrollWidth<=document.documentElement.clientWidth+3,'HORIZONTAL_OVERFLOW');
    return {result:'PASS_R9_LIVE_INDEXEDDB',versions:list[0].revisions.length,
      width:document.documentElement.clientWidth,review_exported:true};
  })();
}
function deleteTest(){
  return (async function(){
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    window.confirm=()=>true;
    document.getElementById('mc-delete-project').click();
    for(let i=0;i<120;i++){
      if(document.querySelectorAll('#mc-project-list .mc-project-card').length===0){
        const store=window.MarcosaLocalVault.createVault(window.indexedDB,window.crypto);
        if((await store.list()).length===0)return 'PASS_R9_LOCAL_DELETE';
      }
      await sleep(45);
    }
    throw Error('DELETE_NOT_DURABLE');
  })();
}

async function main(){
  const binary=browser();
  if(!binary){
    console.error('R9 Chrome DevTools acceptance: missing Chrome/Chromium binary');
    process.exitCode=2;return;
  }
  const server=serve(),profile=fs.mkdtempSync(path.join(os.tmpdir(),'marcosa-r9-chromium-'));
  let chrome=null,cdp=null;
  try{
    await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen(0,'127.0.0.1',resolve);
    });
    const webPort=server.address().port;
    chrome=spawn(binary,[
      '--headless=new','--no-sandbox','--disable-dev-shm-usage',
      '--disable-background-networking','--no-first-run','--no-default-browser-check',
      '--remote-allow-origins=*','--remote-debugging-port=0','--user-data-dir='+profile,
      'about:blank'
    ],{stdio:['ignore','ignore','pipe']});
    let stderr='';
    chrome.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-4500);});
    const file=path.join(profile,'DevToolsActivePort');
    let port=null;
    for(let i=0;i<130;i++){
      if(fs.existsSync(file)){
        const p=Number(fs.readFileSync(file,'utf8').split(/\r?\n/)[0]);
        if(Number.isSafeInteger(p)&&p>0){port=p;break;}
      }
      if(chrome.exitCode!==null)throw Error('CHROME_EXITED '+stderr.slice(-1200));
      await pause(100);
    }
    if(!port)throw Error('CHROME_DEBUG_PORT_UNAVAILABLE '+stderr.slice(-1200));
    cdp=await connectPage(port);
    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');
    fs.mkdirSync(SHOTS,{recursive:true});
    for(const device of [{name:'desktop',width:1440,height:900,mobile:false},
                         {name:'mobile',width:390,height:844,mobile:true}]){
      await cdp.call('Emulation.setDeviceMetricsOverride',{
        width:device.width,height:device.height,deviceScaleFactor:1,mobile:device.mobile
      });
      await cdp.call('Page.navigate',{url:'http://127.0.0.1:'+webPort+'/creator.html'});
      await waitForPage(cdp);
      const result=await evaluate(cdp,'('+liveTest.toString()+')()',35000);
      if(result?.result!=='PASS_R9_LIVE_INDEXEDDB')throw Error('UNEXPECTED_RESULT '+JSON.stringify(result));
      console.log('R9 real Chrome '+device.name+':',JSON.stringify(result));
      const shot=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      const raw=Buffer.from(shot.data,'base64');
      if(raw.length<10000||raw.toString('hex',0,4)!=='89504e47')throw Error('R9_BAD_PNG_'+device.name);
      fs.writeFileSync(path.join(SHOTS,'r9-live-'+device.name+'-vault.png'),raw);
      const deleted=await evaluate(cdp,'('+deleteTest.toString()+')()',20000);
      if(deleted!=='PASS_R9_LOCAL_DELETE')throw Error('R9_DELETE_FAILED '+deleted);
      console.log('R9 real Chrome '+device.name+':',deleted,'screenshot bytes:',raw.length);
    }
    console.log('R9 CDP end-to-end: PASS (desktop/mobile, real IndexedDB, localhost only)');
  }finally{
    if(cdp)try{cdp.close();}catch(err){}
    if(chrome)chrome.kill('SIGTERM');
    await new Promise(resolve=>server.close(()=>resolve()));
    fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:150});
  }
}
main().catch(err=>{console.error('R9 CDP end-to-end FAIL:',err&&err.stack||err);process.exitCode=1;});