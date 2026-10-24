/* MARCOSA R14: deliberate offline film-audit continuity, no remote storage.
 * User self-attestations are NEVER evidence of domain ownership, rights approval or publication.
 */
(function(root,factory){
 'use strict';
 const kit=typeof module==='object'&&module.exports?require('./film-network.js'):(root&&root.MarcosaFilmNetwork);
 const api=factory(kit);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root&&root.document){
  root.MarcosaFilmContinuity=api;
  const ready=()=>{root.MarcosaFilmContinuityRuntime=api.mount(root.document,root);};
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',ready,{once:true});
  else ready();
 }
})(typeof window!=='undefined'?window:undefined,function(kit){
 'use strict';
 if(!kit)throw Error('FILM_NETWORK_R13_REQUIRED');
 const MAX_BYTES=1024*1024,MAX_SNAPSHOTS=12;
 const DB='marcosa-film-audit-local-r14',TABLE='revisions';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const own=(a,k)=>Object.prototype.hasOwnProperty.call(a,k);
 function objectKeys(x,keys,code){
  if(!x||typeof x!=='object'||Array.isArray(x)||
     Object.keys(x).sort().join('|')!==keys.slice().sort().join('|'))throw Error(code);
 }
 function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object'){
   const o={};for(const key of Object.keys(value).sort()){
    if(key==='__proto__'||key==='constructor'||key==='prototype')throw Error('UNSAFE_KEY');
    o[key]=canonical(value[key]);
   }
   return o;
  }
  return value;
 }
 function iso(s){
  return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s)
   &&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
 }
 function utf8Bytes(text){return new TextEncoder().encode(text).byteLength;}
 function parseReport(text){
  if(typeof text!=='string'||utf8Bytes(text)>MAX_BYTES)throw Error('REPORT_SIZE');
  const value=JSON.parse(text);
  objectKeys(value,[
   'schema','generated_at','review_status','externally_verified','publication_state',
   'analytics_events_collected','sites','shortlist'
  ],'UNKNOWN_REPORT_FIELDS');
  if(value.schema!==kit.SCHEMA||!iso(value.generated_at))throw Error('INVALID_REPORT_METADATA');
  if(value.review_status!=='user_self_assessment_only'||value.externally_verified!==false||
     value.publication_state!=='not_published'||value.analytics_events_collected!==0)
   throw Error('FORGED_VERIFICATION');
  if(!Array.isArray(value.sites)||value.sites.length>43)throw Error('INVALID_REPORT_SITES');
  // Verify every redundant/derived property. Do not trust imported ranks,
  // verified flags, collected counters or rights statements.
  const base=value.sites.map(item=>{
   objectKeys(item,[
    'slot','domain','name','checks','note','score_kind','checks_completed',
    'independent_rights_verification','independent_domain_verification','missing_checks'
   ],'INVALID_SITE_EXPORT');
   const {slot,domain,name,checks,note}=item;
   return kit.normalizeSite({slot,domain,name,checks,note});
  });
  const expected=kit.report(base,value.generated_at);
  if(JSON.stringify(canonical(value))!==JSON.stringify(canonical(expected)))
   throw Error('TAMPERED_REPORT');
  return expected;
 }
 function reportSites(report){
  return report.sites.map(item=>{
   const {slot,domain,name,checks,note}=item;
   return kit.normalizeSite({slot,domain,name,checks,note});
  });
 }
 function exportReport(sites,when){
  const report=kit.report(sites,when);
  const text=JSON.stringify(report,null,2)+'\n';
  if(utf8Bytes(text)>MAX_BYTES)throw Error('REPORT_SIZE');
  // Round-trip the actual bytes about to be saved.
  return parseReport(text);
 }
 function validateSnapshot(value){
  objectKeys(value,['id','saved_at','report'],'INVALID_SNAPSHOT');
  if(typeof value.id!=='string'||!UUID.test(value.id)||!iso(value.saved_at))
   throw Error('INVALID_SNAPSHOT_ID');
  const safe=parseReport(JSON.stringify(value.report));
  return {id:value.id,saved_at:value.saved_at,report:safe};
 }
 function createStore(indexedDB,crypto){
  if(!indexedDB||!crypto||typeof crypto.randomUUID!=='function')
   throw Error('LOCAL_STORAGE_UNAVAILABLE');
  function open(){
   return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB,1);
    request.onupgradeneeded=()=>{
     const db=request.result;
     if(!db.objectStoreNames.contains(TABLE))db.createObjectStore(TABLE,{keyPath:'id'});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||Error('OPEN_DB_FAILED'));
    request.onblocked=()=>reject(Error('OPEN_DB_BLOCKED'));
   });
  }
  async function transact(mode,body){
   const db=await open();
   try{
    return await new Promise((resolve,reject)=>{
     let value,completed=false;
     const tx=db.transaction(TABLE,mode),store=tx.objectStore(TABLE);
     tx.oncomplete=()=>{completed=true;resolve(value);};
     tx.onabort=()=>{if(!completed)reject(tx.error||Error('TRANSACTION_ABORTED'));};
     tx.onerror=()=>{};
     try{body(store,assign=>{value=assign;},err=>{
      if(!completed){try{tx.abort();}catch(ignore){}reject(err);}
     });}catch(err){try{tx.abort();}catch(ignore){}reject(err);}
    });
   }finally{db.close();}
  }
  return Object.freeze({
   async list(){
    const all=await transact('readonly',(store,set)=>{
     const request=store.getAll();
     request.onsuccess=()=>set(request.result);
    });
    return all.map(validateSnapshot).sort((a,b)=>b.saved_at.localeCompare(a.saved_at)||b.id.localeCompare(a.id));
   },
   async save(sites,at=new Date().toISOString()){
    const report=exportReport(sites,at);
    if(!report.sites.length)throw Error('EMPTY_REPORT');
    const snapshot=validateSnapshot({id:crypto.randomUUID(),saved_at:at,report});
    return transact('readwrite',(store,set,fail)=>{
     const count=store.count();
     count.onsuccess=()=>{
      if(count.result>=MAX_SNAPSHOTS)return fail(Error('SNAPSHOT_LIMIT'));
      store.add(snapshot);set(snapshot);
     };
    });
   },
   async get(id){
    if(!UUID.test(String(id)))throw Error('INVALID_SNAPSHOT_ID');
    const value=await transact('readonly',(store,set)=>{
     const request=store.get(id);
     request.onsuccess=()=>set(request.result);
    });
    if(!value)throw Error('SNAPSHOT_NOT_FOUND');
    return validateSnapshot(value);
   },
   async remove(id){
    if(!UUID.test(String(id)))throw Error('INVALID_SNAPSHOT_ID');
    return transact('readwrite',(store,set)=>{store.delete(id);set(true);});
   }
  });
 }
 const copy={
  ru:{
   title:'СОХРАНЕНИЕ АУДИТА / R14',lead:'Твоя проверка кино-сайтов не должна исчезать при обновлении вкладки. Сохраняй до 12 отдельных локальных версий и продолжай работу позже.',
   save:'СОХРАНИТЬ ТЕКУЩУЮ ВЕРСИЮ',import:'ОТКРЫТЬ СОХРАНЁННЫЙ JSON',empty:'Локальных версий нет. Сначала импортируй реальные домены и сохрани результат.',
   restore:'ВОССТАНОВИТЬ',remove:'УДАЛИТЬ',warning:'Снимки НЕ зашифрованы и лежат только в браузере этого устройства. Очистка данных сайта удалит их. Регулярно скачивай JSON-отчёт из раздела выше и храни отдельно.',
   statusSaved:'Версия сохранена только на этом устройстве. Снимков: ',statusRestored:'Аудит восстановлен. Сайтов: ',
   statusImported:'JSON импортирован для редактирования. Не забудь сохранить новую локальную версию. Сайтов: ',
   statusEmpty:'Сначала загрузи хотя бы один действительный домен.',statusLimit:'Достигнут лимит 12 снимков. Удали старый снимок вручную после отдельного скачивания JSON.',
   statusInvalid:'Файл отклонён: неподходящая схема, изменённые статусы, повреждённые проверки или слишком большой размер. Текущий аудит не изменён.',
   statusStorage:'Локальное хранилище недоступно; скачивай JSON, чтобы не потерять данные.',
   statusFail:'Ошибка операции с локальными версиями. Проверь место в браузере.',
   statusRemoved:'Локальный снимок удалён. Остальные версии сохранены.',
   confirmLoad:'Заменить открытый аудит сохранённым снимком? Несохранённые изменения текущей вкладки будут потеряны.',
   confirmFile:'Заменить открытый аудит содержимым JSON? Несохранённые изменения текущей вкладки будут потеряны.',
   confirmDelete:'Удалить только этот локальный снимок? Вернуть его можно будет лишь из отдельно скачанного JSON.',
   all:'ЛОКАЛЬНЫЕ ВЕРСИИ',privacy:'Никакого автоматического сохранения, синхронизации, проверки доменов или публикации.',
   evidence:'Сайтов',self:'Авторских отметок',blocked:'Неподтверждённый аудит'
  },
  en:{
   title:'AUDIT RECOVERY / R14',lead:'Continue reviewing film sites after a page refresh. Explicitly save up to 12 separate on-device versions.',
   save:'SAVE LOCAL SNAPSHOT',import:'IMPORT REVIEW JSON',empty:'No saved snapshots yet. Import real domains and save a version.',
   restore:'RESTORE',remove:'DELETE',warning:'Snapshots are NOT encrypted and exist only in this browser. Clearing site data removes them. Download a separate JSON report regularly.',
   statusSaved:'Saved locally on this device. Snapshots: ',statusRestored:'Review restored. Sites: ',
   statusImported:'JSON loaded for editing; save a new local snapshot if needed. Sites: ',statusEmpty:'Import at least one real domain first.',
   statusLimit:'12-snapshot limit reached. Download a separate JSON and delete an old snapshot manually.',
   statusInvalid:'File rejected: incompatible schema, forged approvals, invalid checks, or oversized data. Your current work is unchanged.',
   statusStorage:'On-device storage unavailable. Download a JSON to preserve your work.',
   statusFail:'Could not access local snapshots. Check browser storage availability.',
   statusRemoved:'The selected local snapshot was deleted; other versions remain.',
   confirmLoad:'Replace the current review with this snapshot? Unsaved changes in this tab will be lost.',
   confirmFile:'Replace the current review with the imported JSON? Unsaved changes in this tab will be lost.',
   confirmDelete:'Delete this local snapshot? Only an independently downloaded JSON can restore it.',
   all:'LOCAL SNAPSHOTS',privacy:'No autosave, sync, live domain verification or publication.',
   evidence:'Sites',self:'Author checkmarks',blocked:'Unverified author assessment'
  },
  zh:{
   title:'审核恢复 / R14',lead:'关闭或刷新页面后可继续审核。手动在本机保存最多 12 个独立版本。',
   save:'保存本地版本',import:'导入审核 JSON',empty:'暂无本地版本。先导入真实域名，再保存。',
   restore:'恢复版本',remove:'删除版本',warning:'本地版本未加密。清除浏览器网站数据会丢失它们。请另外下载 JSON 备份。',
   statusSaved:'已在本设备保存。版本数：',statusRestored:'审核已恢复，网站数：',
   statusImported:'JSON 已导入，可继续编辑。请手动保存，网站数：',statusEmpty:'请先导入至少一个真实域名。',
   statusLimit:'已达到 12 个版本上限。请先下载 JSON，再手动删除旧版本。',
   statusInvalid:'文件格式、状态或数据不符合要求。现有审核未被修改。',
   statusStorage:'本地存储不可用。请下载 JSON 备份。',
   statusFail:'无法访问本地版本，请检查浏览器存储。',
   statusRemoved:'该版本已删除，其他版本保留。',
   confirmLoad:'替换当前审核？未保存的内容将丢失。',
   confirmFile:'用这个 JSON 替换当前审核？未保存的内容将丢失。',
   confirmDelete:'删除这个本地版本？请确保已另存 JSON。',
   all:'本地审核版本',privacy:'无自动保存、同步、网站验证或发布。',
   evidence:'网站数',self:'作者勾选数',blocked:'尚未独立验证'
  }
 };
 function mount(doc,win){
  if(!doc.getElementById('fn-continuity'))return null;
  const $=id=>doc.getElementById(id),runtime=win.MarcosaFilmNetworkRuntime;
  if(!runtime)throw Error('FILM_NETWORK_RUNTIME_MISSING');
  let store=null,busy=false;
  const lang=()=>copy[runtime.language]||copy.ru;
  const t=k=>lang()[k]||copy.ru[k]||k;
  const status=(key,extra='')=>{$('fn14-feedback').textContent=t(key)+extra;};
  const lock=value=>{busy=value;$('fn14-save').disabled=value||!store;$('fn14-import').disabled=value;};
  const node=(tag,cls,content)=>{
   const item=doc.createElement(tag);if(cls)item.className=cls;if(content!=null)item.textContent=content;return item;
  };
  function translation(){
   doc.querySelectorAll('[data-fn14]').forEach(x=>{const k=x.dataset.fn14;if(own(lang(),k))x.textContent=t(k);});
  }
  async function refresh(){
   const list=$('fn14-list');list.replaceChildren();
   if(!store){list.append(node('p','fn-empty',t('statusStorage')));return [];}
   const data=await store.list();
   if(!data.length){list.append(node('p','fn-empty',t('empty')));return data;}
   for(const entry of data){
    const row=node('div','fn-snapshot');
    const info=node('div','fn-snapshot-info');
    info.append(node('strong','',entry.saved_at.slice(0,16).replace('T',' ')+' UTC'));
    const checks=entry.report.sites.reduce((sum,item)=>sum+item.checks_completed,0);
    info.append(node('span','',t('evidence')+': '+entry.report.sites.length+' · '+t('self')+': '+checks));
    const actions=node('div','fn-snapshot-actions');
    const restore=node('button','',t('restore'));restore.type='button';
    restore.addEventListener('click',async()=>{
     if(busy)return;
     if(runtime.sites.length&&typeof win.confirm==='function'&&!win.confirm(t('confirmLoad')))return;
     lock(true);
     try{
      const snapshot=await store.get(entry.id);
      const count=runtime.replaceSites(reportSites(snapshot.report));
      status('statusRestored',String(count));
     }catch(err){status('statusFail');}
     finally{lock(false);}
    });
    const remove=node('button','fn-delete',t('remove'));remove.type='button';
    remove.addEventListener('click',async()=>{
     if(busy)return;
     if(typeof win.confirm==='function'&&!win.confirm(t('confirmDelete')))return;
     lock(true);
     try{await store.remove(entry.id);await refresh();status('statusRemoved');}
     catch(err){status('statusFail');}
     finally{lock(false);}
    });
    actions.append(restore,remove);row.append(info,actions);list.append(row);
   }
   return data;
  }
  $('fn14-save').addEventListener('click',async()=>{
   if(busy||!store)return;
   if(!runtime.sites.length){status('statusEmpty');return;}
   lock(true);
   try{await store.save(runtime.sites);const snapshots=await refresh();status('statusSaved',String(snapshots.length));}
   catch(err){status(err&&err.message==='SNAPSHOT_LIMIT'?'statusLimit':'statusFail');}
   finally{lock(false);}
  });
  $('fn14-import').addEventListener('change',async ev=>{
   const file=ev.target.files&&ev.target.files[0];ev.target.value='';if(!file||busy)return;
   lock(true);
   try{
    if(file.size>MAX_BYTES)throw Error('REPORT_SIZE');
    const input=parseReport(await file.text());
    if(runtime.sites.length&&typeof win.confirm==='function'&&!win.confirm(t('confirmFile')))return;
    const count=runtime.replaceSites(reportSites(input));
    status('statusImported',String(count));
   }catch(err){status('statusInvalid');}
   finally{lock(false);}
  });
  doc.querySelectorAll('[data-fn-lang]').forEach(el=>el.addEventListener('click',()=>{
   translation();refresh().catch(()=>status('statusFail'));
  }));
  translation();lock(true);
  try{store=createStore(win.indexedDB,win.crypto);lock(false);refresh().catch(()=>status('statusFail'));}
  catch(err){store=null;lock(false);status('statusStorage');refresh();}
  return Object.freeze({refresh,get available(){return !!store;}});
 }
 return Object.freeze({MAX_BYTES,MAX_SNAPSHOTS,parseReport,reportSites,exportReport,validateSnapshot,createStore,mount});
});