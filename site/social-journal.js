/* MARCOSA R27 / Local Journal.
   Real CRUD, pinning, search, manual portable backup, not a public post service.
   All user-authored text is rendered with textContent; never innerHTML.
   There is NO network, account or database connection. */
(function(root){
 'use strict';
 const KEY='marcosa-r27-private-journal-v1';
 const FORMAT='MARCOSA-JOURNAL';
 const VERSION=1;
 const MAX_ITEMS=40, MAX_TITLE=90, MAX_BODY=2000, MAX_BACKUP=250000;
 const CATEGORIES=Object.freeze({idea:'Идея',story:'История',project:'Проект',research:'Исследование'});
 const ID_PATTERN=/^mj-[a-z0-9-]{8,70}$/;
 function record(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Некорректная запись');
  const {id,title,body,category,createdAt,updatedAt,pinned}=value;
  if(typeof id!=='string'||!ID_PATTERN.test(id))throw Error('Некорректный идентификатор');
  if(typeof title!=='string'||!title.trim()||title.length>MAX_TITLE)throw Error('Название записи недопустимо');
  if(typeof body!=='string'||!body.trim()||body.length>MAX_BODY)throw Error('Текст записи недопустим');
  if(!Object.prototype.hasOwnProperty.call(CATEGORIES,category))throw Error('Неизвестная тема записи');
  if(typeof createdAt!=='string'||!Number.isFinite(Date.parse(createdAt))||createdAt.length>32)throw Error('Некорректная дата создания');
  if(typeof updatedAt!=='string'||!Number.isFinite(Date.parse(updatedAt))||updatedAt.length>32)throw Error('Некорректная дата изменения');
  if(typeof pinned!=='boolean')throw Error('Некорректное закрепление');
  return {id,title:title.trim(),body:body.trim(),category,createdAt,updatedAt,pinned};
 }
 function validateList(list){
  if(!Array.isArray(list)||list.length>MAX_ITEMS)throw Error('Слишком много записей — максимум '+MAX_ITEMS);
  const ids=new Set();
  return list.map(raw=>{
   const item=record(raw);
   if(ids.has(item.id))throw Error('Дублированный идентификатор в резервной копии');
   ids.add(item.id);return item;
  });
 }
 function readBackup(text){
  if(typeof text!=='string'||text.length>MAX_BACKUP)throw Error('Резервная копия слишком большая');
  let parsed;
  try{parsed=JSON.parse(text);}catch{throw Error('Файл не является корректным JSON');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
     parsed.format!==FORMAT||parsed.version!==VERSION)
   throw Error('Это не резервная копия MARCOSA Journal v1');
  return validateList(parsed.items);
 }
 function merge(current,received){
  const original=validateList(current),incoming=validateList(received);
  const seen=new Set(original.map(x=>x.id)),next=original.slice();
  let added=0,duplicates=0,overflow=0;
  for(const item of incoming){
   if(seen.has(item.id)){duplicates++;continue;}
   if(next.length>=MAX_ITEMS){overflow++;continue;}
   next.push(item);seen.add(item.id);added++;
  }
  return {items:next,added,duplicates,overflow};
 }
 const api=Object.freeze({format:FORMAT,version:VERSION,maxItems:MAX_ITEMS,
  maxTitle:MAX_TITLE,maxBody:MAX_BODY,record,validateList,readBackup,merge});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(!root||!root.document)return;
 function init(){
  const doc=root.document;
  const $=id=>doc.getElementById(id);
  const form=$('s27-editor'),list=$('s27-list');
  if(!form||!list)return;
  const title=$('s27-title-input'),body=$('s27-body'),category=$('s27-category');
  const search=$('s27-search'),filter=$('s27-filter'),sort=$('s27-sort');
  const status=$('s27-feedback'),undo=$('s27-undo');
  let records=[],editing=null,deleted=null;
  function announce(message,isError){
   status.textContent=message;
   status.dataset.error=String(Boolean(isError));
  }
  function load(){
   try{
    const raw=root.localStorage.getItem(KEY);
    if(!raw)return [];
    if(raw.length>MAX_BACKUP)return [];
    return validateList(JSON.parse(raw));
   }catch{
    announce('Не удалось прочитать журнал. Сохранённые данные не перезаписаны.',true);
    return [];
   }
  }
  function persist(next){
   try{
    root.localStorage.setItem(KEY,JSON.stringify(validateList(next)));
    records=next;return true;
   }catch{
    announce('Браузер не разрешил сохранить данные. Проверь свободное место и настройки хранилища.',true);
    return false;
   }
  }
  function newId(){
   if(root.crypto&&typeof root.crypto.randomUUID==='function')
    return 'mj-'+root.crypto.randomUUID();
   return 'mj-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,14);
  }
  function make(tag,className,text){
   const node=doc.createElement(tag);
   if(className)node.className=className;
   if(text!==undefined)node.textContent=text;
   return node;
  }
  function button(label,action,id){
   const node=make('button','s27-action',label);
   node.type='button';node.dataset.action=action;node.dataset.id=id;
   return node;
  }
  function countLabel(n){
   return n+' '+(n%10===1&&n%100!==11?'запись':(n%10>=2&&n%10<=4&&!(n%100>=12&&n%100<=14)?'записи':'записей'));
  }
  function resetForm(){
   editing=null;form.reset();category.value='idea';
   $('s27-editor-mode').textContent='НОВАЯ ЗАПИСЬ';
   $('s27-save').textContent='СОХРАНИТЬ В ЖУРНАЛ';
   $('s27-length').textContent='0 / '+MAX_BODY;
  }
  function render(){
   $('s27-count').textContent=countLabel(records.length);
   const q=search.value.trim().toLocaleLowerCase('ru');
   let subset=records.filter(item=>(filter.value==='all'||item.category===filter.value)&&
    (!q||(item.title+' '+item.body+' '+CATEGORIES[item.category]).toLocaleLowerCase('ru').includes(q)));
   const mode=sort.value;
   subset.sort((a,b)=>Number(b.pinned)-Number(a.pinned)||
    (mode==='az'?a.title.localeCompare(b.title,'ru'):
     mode==='old'?Date.parse(a.updatedAt)-Date.parse(b.updatedAt):
     Date.parse(b.updatedAt)-Date.parse(a.updatedAt))||a.id.localeCompare(b.id));
   const nodes=subset.map(item=>{
    const li=make('li','s27-entry');
    li.dataset.journalId=item.id;
    const meta=make('div','s27-entry-meta');
    meta.append(make('span','s27-category',CATEGORIES[item.category]));
    const when=make('time','s27-time',new Date(item.updatedAt).toLocaleDateString('ru-RU'));
    when.dateTime=item.updatedAt;meta.append(when);
    if(item.pinned)meta.append(make('span','s27-pin-label','ЗАКРЕПЛЕНО'));
    const h3=make('h3','s27-entry-title',item.title);
    const summary=make('p','s27-entry-body',item.body.length>260?item.body.slice(0,260)+'…':item.body);
    const actions=make('div','s27-entry-actions');
    actions.append(button('РЕДАКТИРОВАТЬ','edit',item.id));
    actions.append(button(item.pinned?'ОТКРЕПИТЬ':'ЗАКРЕПИТЬ','pin',item.id));
    actions.append(button('УДАЛИТЬ','delete',item.id));
    li.append(meta,h3,summary,actions);
    return li;
   });
   list.replaceChildren(...nodes);
   $('s27-empty').hidden=subset.length>0;
   $('s27-filter-count').textContent='Показано: '+subset.length;
   $('s27-export').disabled=records.length===0;
   undo.hidden=!deleted;
  }
  function focusEditor(item){
   editing=item.id;title.value=item.title;body.value=item.body;category.value=item.category;
   $('s27-editor-mode').textContent='РЕДАКТИРОВАНИЕ';
   $('s27-save').textContent='СОХРАНИТЬ ИЗМЕНЕНИЯ';
   $('s27-length').textContent=body.value.length+' / '+MAX_BODY;
   form.scrollIntoView({block:'start',behavior:root.matchMedia&&root.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
   title.focus({preventScroll:true});
  }
  records=load();resetForm();render();
  body.addEventListener('input',()=>$('s27-length').textContent=body.value.length+' / '+MAX_BODY);
  $('s27-reset').addEventListener('click',()=>{resetForm();announce('Форма очищена. Сохранённые записи не затронуты.',false);});
  for(const control of [search,filter,sort])
   control.addEventListener(control===search?'input':'change',render);
  form.addEventListener('submit',event=>{
   event.preventDefault();
   const label=title.value.trim(),detail=body.value.trim(),now=new Date().toISOString();
   if(!label||!detail||label.length>MAX_TITLE||detail.length>MAX_BODY||
      !Object.prototype.hasOwnProperty.call(CATEGORIES,category.value)){
    announce('Добавь название, текст и корректную тему.',true);
    (!label?title:body).focus();return;
   }
   const prior=editing?records.find(x=>x.id===editing):null;
   if(editing&&!prior){announce('Запись не найдена. Создай новую.',true);resetForm();return;}
   if(!editing&&records.length>=MAX_ITEMS){
    announce('Журнал заполнен. Экспортируй архив и удали старые записи.',true);return;
   }
   let item;
   try{item=record({
    id:prior?prior.id:newId(),title:label,body:detail,category:category.value,
    createdAt:prior?prior.createdAt:now,updatedAt:now,pinned:prior?prior.pinned:false
   });}catch(err){announce(err.message,true);return;}
   const next=prior?records.map(x=>x.id===item.id?item:x):[item].concat(records);
   if(!persist(next))return;
   deleted=null;resetForm();render();announce(prior?'Изменения сохранены только в этом браузере.':'Запись добавлена в личный журнал на этом устройстве.',false);
  });
  list.addEventListener('click',event=>{
   const control=event.target.closest('button[data-action]');
   if(!control||!list.contains(control))return;
   const item=records.find(x=>x.id===control.dataset.id);
   if(!item)return;
   if(control.dataset.action==='edit'){focusEditor(item);announce('Редактируй запись и сохрани изменения.',false);return;}
   if(control.dataset.action==='pin'){
    const next=records.map(x=>x.id===item.id?Object.assign({},x,{pinned:!x.pinned}):x);
    if(persist(next)){deleted=null;render();announce(item.pinned?'Запись откреплена.':'Запись закреплена первой.',false);}
    return;
   }
   if(control.dataset.action==='delete'){
    const next=records.filter(x=>x.id!==item.id);
    if(persist(next)){
     deleted=item;if(editing===item.id)resetForm();render();
     announce('Запись удалена. Действие можно отменить до следующего изменения.',false);
    }
   }
  });
  undo.addEventListener('click',()=>{
   if(!deleted)return;
   if(records.length>=MAX_ITEMS){announce('Нет места для восстановления.',true);return;}
   const recovered=deleted;
   if(persist([recovered].concat(records))){
    deleted=null;render();announce('Удалённая запись восстановлена.',false);
   }
  });
  $('s27-export').addEventListener('click',()=>{
   if(!records.length){announce('Журнал пуст — экспортировать нечего.',true);return;}
   const payload=JSON.stringify({format:FORMAT,version:VERSION,exportedAt:new Date().toISOString(),items:records},null,2);
   const blob=new Blob([payload],{type:'application/json;charset=utf-8'});
   const url=root.URL.createObjectURL(blob);
   const link=make('a');link.href=url;link.download='MARCOSA-journal-backup.json';
   doc.body.append(link);link.click();link.remove();
   root.setTimeout(()=>root.URL.revokeObjectURL(url),1000);
   announce('Локальная резервная копия подготовлена. JSON не зашифрован — храни его безопасно.',false);
  });
  $('s27-import').addEventListener('change',async event=>{
   const input=event.currentTarget,file=input.files&&input.files[0];
   if(!file)return;
   try{
    if(file.size>MAX_BACKUP)throw Error('Файл слишком большой');
    const raw=await file.text();
    const incoming=readBackup(raw);
    const result=merge(records,incoming);
    if(result.added&&!persist(result.items))return;
    deleted=null;render();
    announce('Импортировано: '+result.added+'. Дубликатов: '+result.duplicates+'. Не поместились: '+result.overflow+'.',false);
   }catch(err){announce(err.message||'Не удалось импортировать резервную копию.',true);}
   finally{input.value='';}
  });
  root.MarcosaJournal=Object.freeze({localOnly:true,version:VERSION,maxItems:MAX_ITEMS,get count(){return records.length;}});
 }
 if(root.document.readyState==='loading')
  root.document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
})(typeof window!=='undefined'?window:undefined);
