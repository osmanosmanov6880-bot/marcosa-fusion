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
const PUBLIC=new Set(['creator.html','creator.css','creator.js','creator-vault.js','creator-backup.js','creator-crypto.js','creator-standalone.js','creator-playtest.js']);
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
    check(!$('mc-delete-project').disabled,'DELETE_BUTTON_STUCK_DISABLED');
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

function r10BackupPrepare(){
  return (async function(){
    const api=window.MarcosaVaultBackup;
    if(!api||!window.MarcosaBackupRuntime)throw Error('BACKUP_RUNTIME_MISSING');
    const store=window.MarcosaLocalVault.createVault(window.indexedDB,window.crypto);
    const records=await store.list();
    if(records.length!==1||records[0].revisions.length!==3)throw Error('BACKUP_SOURCE_VERSIONS');
    const file=api.stringifyBackup(records,new Date().toISOString());
    const parsed=api.parseBackup(file);
    if(parsed.projects.length!==1||parsed.projects[0].revisions.length!==3)
      throw Error('BACKUP_SERIALIZATION_BROKEN');
    window.__r10_test_backup=file;
    document.getElementById('mc-backup-download').click();
    let downloaded=false;
    for(let attempt=0;attempt<110;attempt++){
      if(document.getElementById('mc-backup-feedback').textContent.includes('Резервная копия')){
        downloaded=true;break;
      }
      await new Promise(resolve=>setTimeout(resolve,45));
    }
    if(!downloaded)throw Error('BACKUP_EXPORT_FEEDBACK');
    return {result:'PASS_R10_PORTABLE_BACKUP',bytes:new TextEncoder().encode(file).byteLength,versions:3};
  })();
}
function r10BackupRestore(){
  return (async function(){
    const $=id=>document.getElementById(id);
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const wait=async(check,reason)=>{
      for(let i=0;i<120;i++){if(await check())return;await sleep(45);}
      throw Error('R10_WAIT_'+reason+' / '+$('mc-backup-feedback').textContent);
    };
    const store=window.MarcosaLocalVault.createVault(window.indexedDB,window.crypto);
    const json=window.__r10_test_backup;
    if(!json||!json.includes('marcosa-local-vault-backup/v1'))
      throw Error('BACKUP_MISSING');
    if((await store.list()).length!==0)throw Error('BACKUP_EXPECTED_EMPTY_VAULT');
    window.confirm=()=>true;
    const apply=async()=>{
      const file=new File([json],'marcosa-restore.json',{type:'application/json'});
      const transfer=new DataTransfer();transfer.items.add(file);
      const input=$('mc-backup-file');
      input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    };
    await apply();
    await wait(async()=>document.querySelectorAll('#mc-project-list .mc-project-card').length===1
      &&(await store.list()).length===1,'FIRST_RESTORE');
    let records=await store.list();
    if(records[0].revisions.length!==3||records[0].revisions[0].revision!==1)
      throw Error('BACKUP_LOST_REVISIONS');
    // Reimporting identical data is idempotent; no extra project is created.
    $('mc-backup-feedback').textContent='R10-SECOND-RESTORE';
    await apply();
    await wait(()=>/совпадений пропущено:\s*1/.test($('mc-backup-feedback').textContent),'IDEMPOTENT_MERGE');
    records=await store.list();
    if(records.length!==1)throw Error('DUPLICATE_CREATED');
    // Create a diverging version in the live project; restoring the old backup must
    // produce a second copy rather than replacing the latest revision.
    const latest=records[0];
    const story=window.MarcosaCreatorStudio.normalizeDraft(latest.revisions[2].draft);
    story.title='Новая редакция после резервного копирования';
    await store.save({id:latest.id,expected_revision:3,draft:story,message:'Changed since backup'});
    $('mc-backup-feedback').textContent='R10-CONFLICT-RESTORE';
    await apply();
    await wait(async()=>(await store.list()).length===2,'SAFE_CONFLICT_COPY');
    records=await store.list();
    const current=records.find(item=>item.id===latest.id);
    const restored=records.find(item=>item.id!==latest.id);
    if(!current||!restored||current.revisions.length!==4||restored.revisions.length!==3)
      throw Error('CONFLICT_OVERWROTE_EXISTING_HISTORY');
    if(current.title!==story.title||restored.title===story.title)
      throw Error('CONFLICT_STORY_CORRUPTED');
    $('mc-backup').scrollIntoView({block:'start',behavior:'auto'});
    await sleep(150);
    if(document.documentElement.scrollWidth>document.documentElement.clientWidth+3)
      throw Error('BACKUP_MOBILE_HORIZONTAL_OVERFLOW');
    return {result:'PASS_R10_RESTORE_IDEMPOTENT_CONFLICT_SAFE',projects:records.length,
      versions:[current.revisions.length,restored.revisions.length]};
  })();
}

function r11EncryptedRecovery(){
  return (async function(){
    const $=id=>document.getElementById(id);
    const wait=async(test,why)=>{
      for(let attempt=0;attempt<180;attempt++){
        if(await test())return;
        await new Promise(resolve=>setTimeout(resolve,65));
      }
      throw Error('R11_WAIT_'+why+' / '+$('mc-crypto-feedback').textContent);
    };
    const api=window.MarcosaVaultCrypto;
    const backup=window.MarcosaVaultBackup;
    const store=window.MarcosaLocalVault.createVault(window.indexedDB,window.crypto);
    if(!api||!window.MarcosaCryptoRuntime?.available||!window.isSecureContext)
      throw Error('R11_CRYPTO_UNAVAILABLE');
    const passphrase='MARCOSA-Horizon-Golden-Stars-2026';
    const records=await store.list();
    if(records.length!==2||records.some(x=>x.revisions.length<3))
      throw Error('R11_SOURCE_MISSING');
    const plain=backup.stringifyBackup(records,new Date().toISOString());
    const encrypted=await api.encryptBackup(plain,passphrase,window.crypto);
    if(encrypted.includes('Новая редакция')||encrypted.includes(records[0].id))
      throw Error('R11_PLAINTEXT_LEAK');
    const decrypted=await api.decryptBackup(encrypted,passphrase,window.crypto);
    if(JSON.stringify(decrypted.projects)!==JSON.stringify(records))
      throw Error('R11_ROUNDTRIP_NOT_IDENTICAL');
    let wrongRejected=false;
    try{
      await api.decryptBackup(encrypted,'Different-Horizon-Golden-Stars-2026',window.crypto);
    }catch(err){wrongRejected=err.message==='DECRYPT_FAILED';}
    if(!wrongRejected)throw Error('R11_WRONG_PASSWORD_ACCEPTED');
    const tampered=JSON.parse(encrypted);
    tampered.ciphertext=(tampered.ciphertext[0]==='A'?'B':'A')+tampered.ciphertext.slice(1);
    let tamperRejected=false;
    try{
      await api.decryptBackup(JSON.stringify(tampered),passphrase,window.crypto);
    }catch(err){tamperRejected=err.message==='DECRYPT_FAILED';}
    if(!tamperRejected)throw Error('R11_CORRUPTED_ARCHIVE_ACCEPTED');
    $('mc-crypto-pass').value=passphrase;
    $('mc-crypto-confirm').value=passphrase;
    $('mc-crypto-download').click();
    await wait(()=>$('mc-crypto-feedback').textContent.includes('Зашифрованная копия'),'ENCRYPT_UI');
    if($('mc-crypto-pass').value||$('mc-crypto-confirm').value)
      throw Error('R11_PASSWORD_LEFT_IN_INPUTS_AFTER_EXPORT');
    // Test actual full deletion and import via the encrypted file picker.
    for(const record of records)await store.remove(record.id);
    await window.MarcosaLocalVaultRuntime.refresh();
    if((await store.list()).length!==0)throw Error('R11_CLEAR_BEFORE_RESTORE');
    window.confirm=()=>true;
    const upload=async(password,fileText)=>{
      $('mc-crypto-pass').value=password;
      const file=new File([fileText],'marcosa-encrypted-vault.json',{type:'application/json'});
      const transfer=new DataTransfer();
      transfer.items.add(file);
      $('mc-crypto-file').files=transfer.files;
      $('mc-crypto-file').dispatchEvent(new Event('change',{bubbles:true}));
    };
    await upload(passphrase,encrypted);
    await wait(async()=>((await store.list()).length===2&&
      $('mc-crypto-feedback').textContent.includes('расшифрован')),'RESTORE_UI');
    if($('mc-crypto-pass').value||$('mc-crypto-confirm').value)
      throw Error('R11_PASSWORD_LEFT_AFTER_IMPORT');
    let restored=await store.list();
    if(!restored.every(x=>records.some(y=>JSON.stringify(x)===JSON.stringify(y))))
      throw Error('R11_VERSION_HISTORY_ALTERED');
    $('mc-crypto-feedback').textContent='R11_SECOND_IMPORT';
    await upload(passphrase,encrypted);
    await wait(()=>$('mc-crypto-feedback').textContent.includes('совпадающих пропущено: 2'),'IDEMPOTENT_IMPORT');
    if((await store.list()).length!==2)throw Error('R11_REIMPORT_DUPLICATED');
    $('mc-crypto-feedback').textContent='R11_WRONG_PASSWORD_TEST';
    await upload('Different-Horizon-Golden-Stars-2026',encrypted);
    await wait(()=>$('mc-crypto-feedback').textContent.includes('Не удалось расшифровать'),'WRONG_PASSWORD_UI');
    if($('mc-crypto-pass').value)throw Error('R11_PASSWORD_LEFT_AFTER_FAILURE');
    if((await store.list()).length!==2)throw Error('R11_BAD_PASSWORD_CORRUPTED_VAULT');
    $('mc-crypto').scrollIntoView({block:'start',behavior:'auto'});
    await new Promise(resolve=>setTimeout(resolve,180));
    if(document.documentElement.scrollWidth>document.documentElement.clientWidth+3)
      throw Error('R11_MOBILE_HORIZONTAL_OVERFLOW');
    restored=await store.list();
    return {result:'PASS_R11_AES_GCM_ENCRYPT_DECRYPT',projects:restored.length,
      revisions:restored.map(r=>r.revisions.length),bytes:encrypted.length,
      wrong_password_rejected:true,tampering_rejected:true,
      idempotent:true,passwords_cleared:true};
  })();
}


function r13PlaytestAnalysis(){
  return (async function(){
    const $=id=>document.getElementById(id);
    const engine=window.MarcosaPlayableExport;
    const analyzer=window.MarcosaPlaytest;
    const dashboard=window.MarcosaPlaytestRuntime;
    if(!engine||!analyzer||!dashboard)throw Error('R13_DASHBOARD_NOT_MOUNTED');
    const original=window.MarcosaCreatorRuntime.getEditedDraft();
    const fingerprint=await engine.storyFingerprint(original,window.crypto);
    const ratings=[
      {schema:analyzer.SCHEMA,story_fingerprint:fingerprint,path:'00',rating:5},
      {schema:analyzer.SCHEMA,story_fingerprint:fingerprint,path:'01',rating:4},
      {schema:analyzer.SCHEMA,story_fingerprint:fingerprint,path:'10',rating:3},
      {schema:analyzer.SCHEMA,story_fingerprint:fingerprint,path:'11',rating:1}
    ];
    const input=$('mc-playtest-files');
    const transfer=new DataTransfer();
    ratings.forEach((report,i)=>transfer.items.add(new File(
      [JSON.stringify(report)],'offline-reader-'+i+'.json',{type:'application/json'}
    )));
    input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    let imported=false;
    for(let i=0;i<120;i++){
      if(dashboard.count===4){imported=true;break;}
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    if(!imported)throw Error('R13_DASHBOARD_IMPORT_TIMEOUT '+$('mc-playtest-status').textContent);
    const summary=dashboard.summary;
    if(summary?.imported_reports!==4||summary.overall_average!==3.25||
       summary.endings.some(x=>x.count!==1)||
       $('mc-playtest-count').textContent!=='4'||
       $('mc-playtest-export').disabled)
      throw Error('R13_DASHBOARD_WRONG_TOTALS '+JSON.stringify(summary));
    $('mc-playtest-export').click();
    if(!$('mc-playtest-status').textContent.includes('Анонимная сводка'))
      throw Error('R13_SUMMARY_EXPORT_FAILED');
    const bad={...ratings[0],story_fingerprint:'0'.repeat(64)};
    const mixed=new DataTransfer();
    mixed.items.add(new File([JSON.stringify(ratings[0])],'correct.json',{type:'application/json'}));
    mixed.items.add(new File([JSON.stringify(bad)],'wrong-story.json',{type:'application/json'}));
    input.files=mixed.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    let rejected=false;
    for(let i=0;i<120;i++){
      if($('mc-playtest-status').textContent.includes('другой редакции')){
        rejected=true;break;
      }
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    if(!rejected||dashboard.count!==4)
      throw Error('R13_MISMATCHED_BATCH_NOT_ATOMIC');
    $('mc-playtest').scrollIntoView({block:'start',behavior:'auto'});
    await new Promise(resolve=>setTimeout(resolve,160));
    if(document.documentElement.scrollWidth>document.documentElement.clientWidth+3)
      throw Error('R13_MOBILE_HORIZONTAL_OVERFLOW');
    return {result:'PASS_R13_OFFLINE_REPORT_IMPORT',reports:4,average:3.25,
      per_ending:[1,1,1,1],mismatched_batch_rejected:true};
  })();
}
function r13InvalidateStaleResults(){
  return (async function(){
    const field=document.getElementById('mc-field-title');
    const runtime=window.MarcosaPlaytestRuntime;
    if(runtime?.count!==4)throw Error('R13_EXPECTED_IMPORTED_REPORTS');
    field.value='Редакция после тестирования читателей';
    field.dispatchEvent(new Event('input',{bubbles:true}));
    if(runtime.count!==0||
       document.getElementById('mc-playtest-count').textContent!=='0'||
       !document.getElementById('mc-playtest-export').disabled)
      throw Error('R13_STALE_FEEDBACK_WAS_NOT_CLEARED');
    return 'PASS_R13_STORY_REVISION_INVALIDATION';
  })();
}

function r10Cleanup(){
  return (async function(){
    const store=window.MarcosaLocalVault.createVault(window.indexedDB,window.crypto);
    const list=await store.list();
    for(const record of list)await store.remove(record.id);
    await window.MarcosaLocalVaultRuntime.refresh();
    if((await store.list()).length!==0)throw Error('R10_CLEANUP_NOT_DURABLE');
    return 'PASS_R10_CLEANUP';
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
      const backedUp=await evaluate(cdp,'('+r10BackupPrepare.toString()+')()',20000);
      if(backedUp?.result!=='PASS_R10_PORTABLE_BACKUP')throw Error('R10_EXPORT_FAILED '+JSON.stringify(backedUp));
      console.log('R10 real Chrome '+device.name+':',JSON.stringify(backedUp));
      const deleted=await evaluate(cdp,'('+deleteTest.toString()+')()',20000);
      if(deleted!=='PASS_R9_LOCAL_DELETE')throw Error('R9_DELETE_FAILED '+deleted);
      console.log('R9 real Chrome '+device.name+':',deleted,'screenshot bytes:',raw.length);
      const recovery=await evaluate(cdp,'('+r10BackupRestore.toString()+')()',30000);
      if(recovery?.result!=='PASS_R10_RESTORE_IDEMPOTENT_CONFLICT_SAFE')
        throw Error('R10_RESTORE_FAILED '+JSON.stringify(recovery));
      console.log('R10 real Chrome '+device.name+':',JSON.stringify(recovery));
      const backupShot=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      const backupPng=Buffer.from(backupShot.data,'base64');
      if(backupPng.length<10000||backupPng.toString('hex',0,4)!=='89504e47')
        throw Error('R10_BAD_PNG_'+device.name);
      fs.writeFileSync(path.join(SHOTS,'r10-live-'+device.name+'-vault-restore.png'),backupPng);
      const cryptoTest=await evaluate(cdp,'('+r11EncryptedRecovery.toString()+')()',70000);
      if(cryptoTest?.result!=='PASS_R11_AES_GCM_ENCRYPT_DECRYPT')
        throw Error('R11_CRYPTO_E2E_FAILED '+JSON.stringify(cryptoTest));
      console.log('R11 real Chrome '+device.name+':',JSON.stringify(cryptoTest));
      const encryptedShot=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      const encryptedPng=Buffer.from(encryptedShot.data,'base64');
      if(encryptedPng.length<10000||encryptedPng.toString('hex',0,4)!=='89504e47')
        throw Error('R11_BAD_PNG_'+device.name);
      fs.writeFileSync(path.join(SHOTS,'r11-live-'+device.name+'-encrypted-vault.png'),encryptedPng);
      const playtest=await evaluate(cdp,'('+r13PlaytestAnalysis.toString()+')()',30000);
      if(playtest?.result!=='PASS_R13_OFFLINE_REPORT_IMPORT')
        throw Error('R13_ANALYTICS_E2E_FAILED '+JSON.stringify(playtest));
      console.log('R13 real Chrome '+device.name+':',JSON.stringify(playtest));
      const chart=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      const chartPng=Buffer.from(chart.data,'base64');
      if(chartPng.length<10000||chartPng.toString('hex',0,4)!=='89504e47')
        throw Error('R13_BAD_ANALYTICS_PNG_'+device.name);
      fs.writeFileSync(path.join(SHOTS,'r13-live-'+device.name+'-playtest-analytics.png'),chartPng);
      const invalidated=await evaluate(cdp,'('+r13InvalidateStaleResults.toString()+')()',15000);
      if(invalidated!=='PASS_R13_STORY_REVISION_INVALIDATION')
        throw Error('R13_VERSION_MISMATCH_NOT_INVALIDATED');
      console.log('R13 real Chrome '+device.name+':',invalidated,'screenshot bytes:',chartPng.length);
      const clean=await evaluate(cdp,'('+r10Cleanup.toString()+')()',20000);
      if(clean!=='PASS_R10_CLEANUP')throw Error('R10_CLEANUP_FAILED');
      console.log('R10 real Chrome '+device.name+':',clean,'screenshot bytes:',backupPng.length);
    }
    console.log('R9–R13 CDP end-to-end: PASS (desktop/mobile, encrypted archives, offline reader feedback dashboard)');
  }finally{
    if(cdp)try{cdp.close();}catch(err){}
    if(chrome){
      const stopped=new Promise(resolve=>chrome.once('exit',()=>resolve()));
      if(chrome.exitCode===null)chrome.kill('SIGTERM');
      await Promise.race([stopped,pause(2500)]);
      if(chrome.exitCode===null)chrome.kill('SIGKILL');
      await pause(150);
    }
    await new Promise(resolve=>server.close(()=>resolve()));
    try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:12,retryDelay:250});}
    catch(err){console.warn('Chrome temporary-profile cleanup warning:',err.message);}
  }
}
main().catch(err=>{console.error('R9 CDP end-to-end FAIL:',err&&err.stack||err);process.exitCode=1;});