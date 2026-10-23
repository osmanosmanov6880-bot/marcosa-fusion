/* MARCOSA R10 — explicit local vault backup/restore: no server, no autosave.
 * Contains user-authored manuscripts. JSON is not encrypted and must not be
 * treated as proof of rights or independent editorial approval.
 */
(function(root,factory){
  'use strict';
  const vault=typeof module==='object'&&module.exports?require('./creator-vault.js'):(root&&root.MarcosaLocalVault);
  const api=factory(vault);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document){
    root.MarcosaVaultBackup=api;
    const start=()=>{root.MarcosaBackupRuntime=api.mount(root.document,root);};
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});
    else start();
  }
})(typeof window!=='undefined'?window:undefined,function(vault){
  'use strict';
  if(!vault)throw Error('MARCOSA_VAULT_REQUIRED');
  const SCHEMA='marcosa-local-vault-backup/v1';
  const MAX_BYTES=2*1024*1024;
  const exact=(obj,keys,tag)=>{
    if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('INVALID_'+tag);
    const a=Object.keys(obj).sort(),b=keys.slice().sort();
    if(a.length!==b.length||a.some((k,i)=>k!==b[i]))throw Error('UNKNOWN_'+tag);
  };
  const utc=value=>typeof value==='string'&&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&
    Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
  function normalizeBackup(raw){
    exact(raw,['schema','exported_at','projects'],'BACKUP');
    if(raw.schema!==SCHEMA||!utc(raw.exported_at))throw Error('INVALID_BACKUP_CONTRACT');
    if(!Array.isArray(raw.projects)||raw.projects.length>vault.MAX_PROJECTS)
      throw Error('INVALID_BACKUP_PROJECT_COUNT');
    const projects=raw.projects.map(vault.normalizeRecord);
    if(new Set(projects.map(x=>x.id)).size!==projects.length)throw Error('DUPLICATE_BACKUP_IDS');
    return {schema:SCHEMA,exported_at:raw.exported_at,projects};
  }
  function stringifyBackup(records,time){
    const valid=normalizeBackup({schema:SCHEMA,exported_at:time,projects:records});
    const serialized=JSON.stringify(valid,null,2)+'\n';
    const bytes=new TextEncoder().encode(serialized).byteLength;
    if(bytes>MAX_BYTES)throw Error('BACKUP_TOO_LARGE');
    return serialized;
  }
  function parseBackup(text){
    if(typeof text!=='string'||text.length>MAX_BYTES||
       new TextEncoder().encode(text).byteLength>MAX_BYTES)throw Error('BACKUP_TOO_LARGE');
    return normalizeBackup(JSON.parse(text));
  }
  function planRestore(incoming,existing){
    if(!Array.isArray(incoming)||!Array.isArray(existing))throw Error('INVALID_RESTORE_PLAN');
    const a=incoming.map(vault.normalizeRecord),b=existing.map(vault.normalizeRecord);
    if(a.length>vault.MAX_PROJECTS||b.length>vault.MAX_PROJECTS)
      throw Error('INVALID_RESTORE_PLAN');
    if(new Set(a.map(x=>x.id)).size!==a.length||new Set(b.map(x=>x.id)).size!==b.length)
      throw Error('DUPLICATE_BACKUP_IDS');
    const map=new Map(b.map(x=>[x.id,x]));
    let added=0,skipped=0,conflicts=0;
    for(const entry of a){
      const old=map.get(entry.id);
      if(!old)added++;
      else if(JSON.stringify(old)===JSON.stringify(entry))skipped++;
      else conflicts++;
    }
    return Object.freeze({
      incoming:a.length,added,skipped,conflicts,capacity:b.length+added+conflicts,
      canRestore:b.length+added+conflicts<=vault.MAX_PROJECTS
    });
  }
  const COPY={
    ru:{
      title:'РЕЗЕРВНАЯ КОПИЯ АРХИВА',intro:'Скачай все локальные проекты со всеми сохранёнными редакциями в одном JSON. Восстановление бережно объединяет архивы и никогда не перезаписывает существующую историю.',
      export:'СКАЧАТЬ ВСЕ ПРОЕКТЫ',import:'ВОССТАНОВИТЬ АРХИВ JSON',
      warning:'Файл содержит полные тексты историй и НЕ зашифрован. Храни в безопасном месте, не отправляй посторонним. Копия не означает публикацию или проверку авторских прав.',
      noStorage:'Этот браузер не поддерживает локальный архив. Пользуйся обычным экспортом JSON в редакторе.',
      empty:'Сначала сохрани хотя бы одну версию проекта.',saved:'Резервная копия скачана на устройство. Ничего не отправлено в сеть.',
      restored:'Восстановление завершено. Открой нужный проект в списке выше. Добавлено: ',
      failed:'Архив отклонён: неверный формат, повреждённые данные или размер более 2 МБ.',
      limit:'Недостаточно места в локальном архиве: максимум 8 проектов. Экспортируй и удали ненужные проекты вручную.',
      error:'Ошибка сохранения или чтения локального архива. Старые данные не перезаписаны.',
      prompt:'Восстановить выбранный файл? Ни один существующий проект не будет перезаписан.',
      stats:'Новых: ',skip:'; совпадений пропущено: ',conflict:'; конфликтов сохранено отдельными копиями: ',
      help:'Полное резервное копирование работает только в этом браузере. Импорт ограничен 2 МБ и максимум 8 проектами.'
    },
    en:{
      title:'FULL VAULT BACKUP',intro:'Download all local projects and every retained revision in one JSON. Restoring safely merges archives and never overwrites an existing history.',
      export:'DOWNLOAD ALL PROJECTS',import:'RESTORE JSON VAULT',
      warning:'This file contains your full story manuscripts and is NOT encrypted. Keep it safe; do not share it publicly. A backup does not grant publication or rights approval.',
      noStorage:'Local vault is unavailable in this browser. Use the editor’s standalone JSON export.',
      empty:'Save at least one project revision first.',saved:'Backup downloaded to this device. No story data was sent to a server.',
      restored:'Restore finished. Open a project from the list above. Added: ',
      failed:'Backup rejected: invalid data, tampering, or file over 2 MB.',
      limit:'Local archive is full: maximum 8 projects. Export and manually delete unused projects first.',
      error:'Could not read or restore the vault. Existing projects were not overwritten.',
      prompt:'Restore this file? No existing project will be overwritten.',
      stats:'New: ',skip:'; duplicates skipped: ',conflict:'; conflicting copies preserved: ',
      help:'Whole-vault backup is local to this browser. Import capped at 2 MB / 8 projects.'
    },
    zh:{
      title:'完整档案备份',intro:'将所有本地项目及其版本下载到一个 JSON 文件。恢复只合并记录，不覆盖已有项目。',
      export:'下载全部项目',import:'恢复 JSON 档案',
      warning:'文件包含完整故事文本且未加密。请安全保存，不要公开分享。备份不代表版权审核或发布批准。',
      noStorage:'此浏览器无法使用本地档案，请从编辑器导出单个 JSON。',
      empty:'请先保存至少一个项目版本。',saved:'已下载本地备份，未将数据上传。',
      restored:'恢复成功。请在上面的列表中打开项目。新增：',
      failed:'拒绝该备份：格式错误、数据已修改或文件超过 2 MB。',
      limit:'本地档案已满（最多 8 个项目）。请先导出并手动删除不需要的项目。',
      error:'档案读写失败，已有项目未被覆盖。',
      prompt:'恢复这个备份文件？现有项目不会被覆盖。',
      stats:'新增：',skip:'；跳过重复：',conflict:'；保留独立冲突副本：',
      help:'完整备份只在本浏览器工作，最多导入 2 MB / 8 个项目。'
    }
  };
  function mount(doc,win){
    if(!doc.getElementById('mc-backup'))return null;
    const $=id=>doc.getElementById(id);
    let language='ru',store=null,busy=false;
    const t=key=>(COPY[language]||COPY.ru)[key];
    const status=(key,suffix='')=>{$('mc-backup-feedback').textContent=t(key)+suffix;};
    const button=$('mc-backup-download'),upload=$('mc-backup-file');
    const fileLink=(name,text)=>{
      const blob=new Blob([text],{type:'application/json;charset=utf-8'});
      const url=URL.createObjectURL(blob),link=doc.createElement('a');
      link.href=url;link.download=name;doc.body.append(link);link.click();link.remove();
      win.setTimeout(()=>URL.revokeObjectURL(url),1500);
    };
    const refreshCopy=()=>{
      const creator=win.MarcosaCreatorRuntime;
      language=creator&&creator.locale||'ru';
      doc.querySelectorAll('[data-mcb-text]').forEach(node=>{
        const key=node.dataset.mcbText;if(Object.prototype.hasOwnProperty.call(COPY[language]||COPY.ru,key))
          node.textContent=t(key);
      });
    };
    function lock(next){busy=next;button.disabled=next||!store;upload.disabled=next||!store;}
    async function download(){
      if(!store||busy)return;
      lock(true);
      try{
        const records=await store.list();
        if(!records.length){status('empty');return;}
        const text=stringifyBackup(records,new Date().toISOString());
        fileLink('marcosa-vault-backup-'+new Date().toISOString().slice(0,10)+'.json',text);
        status('saved');
      }catch(err){status('error');}
      finally{lock(false);}
    }
    async function importFile(event){
      if(!store||busy)return;
      const file=event.target.files&&event.target.files[0];
      event.target.value='';
      if(!file)return;
      lock(true);
      try{
        if(file.size>MAX_BYTES)throw Error('BACKUP_TOO_LARGE');
        const incoming=parseBackup(await file.text());
        const existing=await store.list();
        const plan=planRestore(incoming.projects,existing);
        if(!plan.canRestore){status('limit');return;}
        const describe=t('stats')+(plan.added+plan.conflicts)+t('skip')+plan.skipped+
          t('conflict')+plan.conflicts;
        if(typeof win.confirm==='function'&&!win.confirm(t('prompt')+'\n\n'+describe))return;
        const result=await store.restoreRecords(incoming.projects);
        const runtime=win.MarcosaLocalVaultRuntime;
        if(runtime&&typeof runtime.refresh==='function')await runtime.refresh();
        status('restored',result.added+t('skip')+result.skipped+t('conflict')+result.conflicts);
      }catch(err){
        const cause=String(err&&err.message||'');
        status(cause==='PROJECT_LIMIT'?'limit':/BACKUP|INVALID_|UNKNOWN_|DUPLICATE_/.test(cause)?'failed':'error');
      }finally{lock(false);}
    }
    button.addEventListener('click',download);
    upload.addEventListener('change',importFile);
    doc.querySelectorAll('[data-mc-lang]').forEach(b=>b.addEventListener('click',refreshCopy));
    refreshCopy();
    try{store=vault.createVault(win.indexedDB,win.crypto);lock(false);}
    catch(err){store=null;lock(true);status('noStorage');}
    return Object.freeze({download,importFile,get available(){return !!store;}});
  }
  return Object.freeze({SCHEMA,MAX_BYTES,COPY,normalizeBackup,stringifyBackup,
    parseBackup,planRestore,mount});
});