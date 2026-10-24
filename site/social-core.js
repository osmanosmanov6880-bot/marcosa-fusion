/* MARCOSA R21 Social Core. Local-only interactive community preview, never a fake backend. */
(function(root){
 'use strict';
 if(!root||!root.document)return;
 const KEY_DRAFT='marcosa-social-private-draft-v1';
 const KEY_SAVED='marcosa-social-private-saved-v1';
 const LABELS=Object.freeze({cinema:'MARCOSA CINEMA',signal:'SIGNAL WORLDS',creator:'CREATOR STUDIO',atlas:'SOURCE ATLAS'});
 function read(key,fallback){
  try{
   const raw=root.localStorage.getItem(key);
   return raw===null?fallback:JSON.parse(raw);
  }catch{return fallback;}
 }
 function write(key,data){
  try{root.localStorage.setItem(key,JSON.stringify(data));return true;}
  catch{return false;}
 }
 function del(key){try{root.localStorage.removeItem(key);return true;}catch{return false;}}
 function init(){
  const doc=root.document;
  const $=id=>doc.getElementById(id);
  if(!$('so-app'))return;
  const cards=Array.from(doc.querySelectorAll('#so-cards .so-card'));
  const filters=Array.from(doc.querySelectorAll('[data-so-filter]'));
  const input=$('so-search'),text=$('so-draft-text'),info=$('so-draft-status');
  let filter='all',query='';
  // An explicit local-only deep link to saved items, not a remote query.
  try{
   if(new URLSearchParams(root.location.search).get('view')==='saved')filter='saved';
  }catch{filter='all';}
  let saved=read(KEY_SAVED,[]);
  if(!Array.isArray(saved))saved=[];
  saved=saved.filter(id=>Object.prototype.hasOwnProperty.call(LABELS,id));
  saved=Array.from(new Set(saved));
  function bookmarks(){
   const quickCount=$('so-saved-count');
   if(quickCount)quickCount.textContent=String(saved.length);
   $('so-bookmark-summary').textContent=saved.length
    ?saved.map(id=>LABELS[id]).join(' · ')
    :'Ещё ничего не сохранено. Выбери ☆ у понравившегося мира.';
   doc.querySelectorAll('[data-so-save]').forEach(button=>{
    const active=saved.includes(button.dataset.soSave);
    button.setAttribute('aria-pressed',String(active));
    button.textContent=active?'★ СОХРАНЕНО':'☆ СОХРАНИТЬ';
   });
  }
  function render(){
   let count=0;
   for(const card of cards){
    const matchesType=filter==='saved'?saved.includes(card.dataset.soId):(filter==='all'||card.dataset.soType===filter);
    const haystack=(card.dataset.soSearch+' '+card.textContent).toLocaleLowerCase('ru');
    const matchesSearch=!query||haystack.includes(query);
    card.hidden=!(matchesType&&matchesSearch);
    if(!card.hidden)count++;
   }
   $('so-count').textContent=count+' из '+cards.length+' проектов';
   $('so-empty').hidden=count!==0;
   filters.forEach(button=>{
    const current=button.dataset.soFilter===filter;
    button.classList.toggle('active',current);
    button.setAttribute('aria-pressed',String(current));
   });
  }
  filters.forEach(button=>button.addEventListener('click',()=>{
   filter=button.dataset.soFilter;
   render();
  }));
  input.addEventListener('input',()=>{query=input.value.trim().toLocaleLowerCase('ru');render();});
  doc.querySelectorAll('[data-so-save]').forEach(button=>button.addEventListener('click',()=>{
   const id=button.dataset.soSave;
   if(!Object.prototype.hasOwnProperty.call(LABELS,id))return;
   saved=saved.includes(id)?saved.filter(x=>x!==id):saved.concat(id);
   if(write(KEY_SAVED,saved)){bookmarks();render();}
   else $('so-bookmark-summary').textContent='Не удалось сохранить закладку: хранилище браузера недоступно.';
  }));
  function showPrivateNote(value){
   const card=$('so-personal-note'),body=$('so-personal-note-body');
   if(!card||!body)return;
   card.hidden=!value;
   body.textContent=value||'';
  }
    const original=read(KEY_DRAFT,'');
  if(typeof original==='string'){text.value=original.slice(0,700);showPrivateNote(text.value);}
  function counter(){$('so-length').textContent=String(text.value.length)+' / 700';}
  text.addEventListener('input',counter);
  $('so-save-draft').addEventListener('click',()=>{
   const value=text.value.trim();
   if(!value){info.textContent='Сначала напиши хотя бы одну мысль.';text.focus();return;}
   const success=write(KEY_DRAFT,value);
   info.textContent=success
    ?'Черновик сохранён только в этом браузере. Другие пользователи его не видят.'
    :'Не удалось сохранить: браузер запрещает локальное хранилище.';
   if(success)showPrivateNote(value);
  });
  $('so-clear-draft').addEventListener('click',()=>{
   const success=del(KEY_DRAFT);
   text.value='';counter();if(success)showPrivateNote('');
   info.textContent=success?'Локальный черновик удалён. Публикаций не было.':'Браузер не разрешил удалить сохранение.';
  });
  counter();bookmarks();render();
  root.MarcosaSocial=Object.freeze({localOnly:true,sourceCardCount:cards.length});
 }
 if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
})(typeof window!=='undefined'?window:undefined);
