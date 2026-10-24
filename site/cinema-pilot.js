/* MARCOSA R18: opt-in player of three independent, source-backed standalone films.
   No tracking, automatic network navigation, cross-film storage or story rewriting. */
(function(root){
 'use strict';
 if(!root||!root.document)return;
 const FILMS=Object.freeze({
  'internet-v-humanity':Object.freeze({
   src:'./film-internet-v-humanity.html',title:'THE INTERNET v. HUMANITY',
   source:'https://github.com/osmanosmanov6880-bot/internet-v-humanity/tree/4c492d30656d16a908f0dbd851a703f815b2d34e'}),
  'protocol-zero':Object.freeze({
   src:'./film-protocol-zero.html',title:'PROTOCOL ZERO — Наследники сигнала',
   source:'https://github.com/osmanosmanov6880-bot/protocol-zero/tree/0f1841c0e56e47f7413bea9948e66200409e7a7a/cinema'}),
  'adverse-judge':Object.freeze({
   src:'./film-adverse-judge.html',title:'ADVERSE JUDGE — THE TRIAL OF PROMISES',
   source:'https://github.com/osmanosmanov6880-bot/adverse-judge/tree/f48a00510984a3da2d5527cd01ef8a51f102881e/cinema'})
 });
 const start=()=>{
  const d=root.document,$=id=>d.getElementById(id);
  if(!$('cp-app'))return;
  const frame=$('cp-film-frame'),play=$('cp-play'),restart=$('cp-restart'),
   fullscreen=$('cp-fullscreen'),placeholder=$('cp-placeholder'),stage=$('cp-stage'),
   status=$('cp-status'),title=$('cp-feature-title'),standalone=$('cp-standalone-link'),
   origin=$('cp-source-origin');
  let initiated=false,loads=0,selected='internet-v-humanity';
  const state=text=>{status.textContent=text;};
  function select(slug,scroll){
   if(!Object.prototype.hasOwnProperty.call(FILMS,slug))return false;
   selected=slug;initiated=false;
   frame.hidden=true;frame.removeAttribute('src');placeholder.hidden=false;
   play.disabled=false;restart.disabled=true;fullscreen.disabled=true;
   title.textContent=FILMS[selected].title;
   placeholder.querySelector('strong').textContent=FILMS[selected].title;
   standalone.href=FILMS[selected].src;origin.href=FILMS[selected].source;
   state('Выбран '+FILMS[selected].title+'. Нажми «Запустить историю».');
   for(const element of d.querySelectorAll('[data-cp-film]')){
    const active=element.dataset.cpFilm===selected;
    if(element.hasAttribute('aria-pressed'))element.setAttribute('aria-pressed',String(active));
    element.classList.toggle('is-active',active);
   }
   if(scroll&&typeof stage.scrollIntoView==='function')stage.scrollIntoView({block:'nearest',behavior:'smooth'});
   return true;
  }
  function load(){
   const src=FILMS[selected].src;
   initiated=true;
   placeholder.hidden=true;frame.hidden=false;
   restart.disabled=false;fullscreen.disabled=false;
   // This iframe intentionally has an opaque origin, no top navigation, no persistence.
   frame.src=src;
   state('Загружается '+FILMS[selected].title+'…');
  }
  for(const element of d.querySelectorAll('[data-cp-film]'))element.addEventListener('click',()=>{
   if(select(element.dataset.cpFilm,true))root.location.hash=selected;
  });
  play.addEventListener('click',()=>{load();play.disabled=true;});
  restart.addEventListener('click',()=>{if(initiated)load();});
  fullscreen.addEventListener('click',()=>{
   if(!initiated)return;
   if(typeof stage.requestFullscreen==='function'){
    const response=stage.requestFullscreen();
    if(response&&typeof response.catch==='function')response.catch(()=>state('Полный экран недоступен. Можно открыть фильм отдельно.'));
   }else state('Браузер не поддерживает полный экран. Открой фильм отдельно.');
  });
  frame.addEventListener('load',()=>{
   if(!initiated||frame.getAttribute('src')!==FILMS[selected].src)return;
   loads++;
   state(FILMS[selected].title+' запущен. Решения и история просмотра не отправляются в MARCOSA.');
  });
  const slug=decodeURIComponent(root.location.hash.replace(/^#/,''));
  select(Object.prototype.hasOwnProperty.call(FILMS,slug)?slug:'internet-v-humanity',false);
  return Object.freeze({get launched(){return initiated;},get loads(){return loads;},get film(){return selected;}});
 };
 if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});
 else start();
})(typeof window!=='undefined'?window:undefined);
