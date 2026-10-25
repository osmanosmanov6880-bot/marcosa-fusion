/* MARCOSA R110 — explicitly user-controlled, local-only Social transfer.
   No network, no accounts, no storage-origin tricks, no hidden synchronization.
   The JSON backup is NOT encrypted; warn users before taking it off-device. */
(function(root){
 'use strict';
 const FORMAT='MARCOSA-SOCIAL-TRANSFER';
 const VERSION=1;
 const MAX_BACKUP=16384;
 const DRAFT_KEY='marcosa-social-private-draft-v1';
 const SAVED_KEY='marcosa-social-private-saved-v1';
 const IDS=Object.freeze(['cinema','signal','creator','atlas']);
 const ID_SET=new Set(IDS);
 function savedList(value){
  if(!Array.isArray(value)||value.length>IDS.length)throw Error('Список избранного недопустим');
  const seen=new Set();
  for(const id of value){
   if(typeof id!=='string'||!ID_SET.has(id)||seen.has(id))throw Error('Некорректные или повторяющиеся закладки');
   seen.add(id);
  }
  return value.slice();
 }
 function draftText(value){
  if(typeof value!=='string'||value.length>700)throw Error('Черновик слишком длинный или повреждён');
  return value;
 }
 function normalized(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Некорректный архив');
  return {saved:savedList(value.saved),draft:draftText(value.draft)};
 }
 function state(storage){
  if(!storage||typeof storage.getItem!=='function')throw Error('Локальное хранилище недоступно');
  let draft='',saved=[];
  const draftRaw=storage.getItem(DRAFT_KEY),savedRaw=storage.getItem(SAVED_KEY);
  try{
   if(draftRaw!==null)draft=JSON.parse(draftRaw);
   if(savedRaw!==null)saved=JSON.parse(savedRaw);
  }catch{throw Error('Существующие локальные данные повреждены: импорт заблокирован');}
  return normalized({saved,draft});
 }
 function backup(value,date){
  const current=normalized(value);
  const exportedAt=typeof date==='string'?date:new Date().toISOString();
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(exportedAt) ||
    !Number.isFinite(Date.parse(exportedAt)))throw Error('Недопустимая дата архива');
  return JSON.stringify({format:FORMAT,version:VERSION,exportedAt,saved:current.saved,draft:current.draft},null,2);
 }
 function parseBackup(text){
  if(typeof text!=='string'||text.length>MAX_BACKUP)throw Error('Архив превышает безопасный размер');
  let raw;
  try{raw=JSON.parse(text);}catch{throw Error('Невозможно прочитать JSON-архив');}
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
    raw.format!==FORMAT||raw.version!==VERSION||
    typeof raw.exportedAt!=='string'||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(raw.exportedAt)||
    !Number.isFinite(Date.parse(raw.exportedAt))||
    Object.keys(raw).sort().join('|')!=='draft|exportedAt|format|saved|version')
   throw Error('Это не проверенный архив MARCOSA Social v1');
  return normalized(raw);
 }
 function merge(current,incoming){
  const a=normalized(current),b=normalized(incoming);
  const joined=Array.from(new Set(a.saved.concat(b.saved)));
  // Existing text wins; never overwrite a user's current private draft.
  const conflict=Boolean(a.draft&&b.draft&&a.draft!==b.draft);
  return {saved:joined,draft:a.draft||b.draft,conflict,added:joined.length-a.saved.length,
   importedDraft:!a.draft&&Boolean(b.draft)};
 }
 function persist(storage,next){
  const cleaned=normalized(next);
  const oldDraft=storage.getItem(DRAFT_KEY),oldSaved=storage.getItem(SAVED_KEY);
  try{
   storage.setItem(SAVED_KEY,JSON.stringify(cleaned.saved));
   storage.setItem(DRAFT_KEY,JSON.stringify(cleaned.draft));
  }catch{
   // localStorage is nontransactional: best-effort recovery, never announce success.
   try{
    if(oldSaved===null)storage.removeItem(SAVED_KEY);else storage.setItem(SAVED_KEY,oldSaved);
    if(oldDraft===null)storage.removeItem(DRAFT_KEY);else storage.setItem(DRAFT_KEY,oldDraft);
   }catch{/* A blocked browser may also refuse rollback; report failure. */}
   throw Error('Сохранение не выполнено. Проверь хранилище и исходный архив.');
  }
  return cleaned;
 }
 const api=Object.freeze({format:FORMAT,version:VERSION,maxBackup:MAX_BACKUP,ids:IDS,
  savedList,draftText,state,backup,parseBackup,merge,persist});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(!root||!root.document)return;
 function init(){
  const doc=root.document,$=id=>doc.getElementById(id);
  const panel=$('so-transfer-panel'),exportButton=$('so-transfer-export'),
    importButton=$('so-transfer-import-trigger'),fileInput=$('so-transfer-import'),
    feedback=$('so-transfer-feedback');
  if(!panel||!exportButton||!importButton||!fileInput||!feedback)return;
  const announce=(message,error)=>{
   feedback.textContent=message;
   feedback.dataset.error=String(Boolean(error));
  };
  exportButton.addEventListener('click',()=>{
   try{
    const payload=backup(state(root.localStorage));
    const blob=new Blob([payload],{type:'application/json;charset=utf-8'});
    const url=root.URL.createObjectURL(blob);
    const link=doc.createElement('a');
    link.download='MARCOSA-social-transfer-v1.json';
    link.href=url;
    doc.body.append(link);link.click();link.remove();
    root.setTimeout(()=>root.URL.revokeObjectURL(url),1000);
    announce('Архив избранного и короткой заметки подготовлен. JSON не зашифрован: храни его в безопасном месте.',false);
   }catch(error){announce(error.message||'Экспорт недоступен.',true);}
  });
  importButton.addEventListener('click',()=>fileInput.click());
  fileInput.addEventListener('change',async()=>{
   const file=fileInput.files&&fileInput.files[0];
   if(!file)return;
   try{
    if(file.size>MAX_BACKUP)throw Error('Архив слишком большой');
    const imported=parseBackup(await file.text());
    const current=state(root.localStorage);
    const merged=merge(current,imported);
    const edit=$('so-draft-text');
    if(edit&&edit.value.trim()!==current.draft.trim()&&
      (!root.confirm||!root.confirm('В поле есть несохранённый текст. Сначала сохрани его или нажми OK, чтобы продолжить импорт.')))
     throw Error('Импорт отменён: сначала сохрани текущий черновик');
    persist(root.localStorage,merged);
    if(typeof root.dispatchEvent==='function'&&typeof root.Event==='function')
     root.dispatchEvent(new root.Event('marcosa:social-transfer'));
    announce('Импортировано '+merged.added+' закладок. '+
     (merged.conflict?'Существующий черновик сохранён, отличный текст из архива не перезаписан.':
     merged.importedDraft?'Черновик из архива восстановлен.':'Существующий черновик оставлен без изменений.'),false);
   }catch(error){announce(error.message||'Невозможно импортировать архив',true);}
   finally{fileInput.value='';}
  });
 }
 if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
})(typeof window!=='undefined'?window:undefined);
