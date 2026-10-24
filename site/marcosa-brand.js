/* MARCOSA R21: shared, local-only, accessible world navigation and transition.
   This is real DOM navigation, not a simulated app or a third-party loader. */
(function(root){
 'use strict';
 if(!root||!root.document)return;
 const WORLDS=Object.freeze([
  Object.freeze({id:'gateway',href:'./index.html',short:'Вход',name:'Network OS',icon:'✧',heading:'ВХОД В СЕТЬ МИРОВ'}),
  Object.freeze({id:'social',href:'./social.html',short:'Общение',name:'Social Core',icon:'♥',heading:'ОТКРЫВАЕМ СООБЩЕСТВО'}),
  Object.freeze({id:'cinema',href:'./cinema-pilot.html',short:'Кино',name:'Cinema',icon:'▶',heading:'ОТКРЫВАЕМ КИНОМИР'}),
  Object.freeze({id:'creator',href:'./creator.html',short:'Студия',name:'Creator Studio',icon:'✦',heading:'ОТКРЫВАЕМ СТУДИЮ'}),
  Object.freeze({id:'atlas',href:'./source-hub.html',short:'Атлас',name:'Source Atlas',icon:'◎',heading:'СВЯЗЫВАЕМ ПРОЕКТЫ'}),
  Object.freeze({id:'stories',href:'./stories.html',short:'Истории',name:'Story Lab',icon:'◇',heading:'ВХОДИМ В ИСТОРИЮ'}),
  Object.freeze({id:'film-network',href:'./film-network.html',short:'Сеть',name:'Film Network',icon:'⌗',heading:'ОТКРЫВАЕМ КИНОСЕТЬ'})
 ]);
 const file=String(root.location.pathname.split('/').pop()||'index.html').toLowerCase();
 const byFile=Object.fromEntries(WORLDS.map(w=>[w.href.slice(2),w]));
 const current=byFile[file]||WORLDS[0];
 const reduced=root.matchMedia&&root.matchMedia('(prefers-reduced-motion: reduce)').matches;
 let overlay,locked=false;
 function make(tag,cls,text){
  const node=root.document.createElement(tag);
  if(cls)node.className=cls;
  if(text!==undefined)node.textContent=text;
  return node;
 }
 function linkOf(w){
  const a=make('a',w.id===current.id?'m-nav-active':'');
  a.href=w.href;
  a.setAttribute('aria-label',w.name);
  a.title=w.name;
  if(w.id===current.id)a.setAttribute('aria-current','page');
  const sign=make('span','',w.icon);
  sign.setAttribute('data-m-nav-icon','');
  a.append(sign,make('span','m-world-label',w.short));
  return a;
 }
 function buildNav(){
  if(root.document.querySelector('.m-world-bar'))return;
  const nav=make('nav','m-world-bar');
  nav.setAttribute('aria-label','Миры MARCOSA — переход между разделами');
  const home=make('a');
  home.href='./index.html';
  home.title='MARCOSA Network OS';
  home.setAttribute('aria-label','MARCOSA — главная');
  const logo=make('img');logo.src='./marcosa-mark.svg';logo.alt='';logo.width=36;logo.height=36;
  home.append(logo);
  nav.append(home);
  for(const w of WORLDS)nav.append(linkOf(w));
  root.document.body.append(nav);
 }
 function makeOverlay(){
  overlay=make('div','m-transition');
  overlay.dataset.active='false';
  overlay.hidden=true;
  overlay.setAttribute('role','status');
  overlay.setAttribute('aria-live','polite');
  overlay.setAttribute('aria-atomic','true');
  const core=make('div','m-transition-core');
  const mark=make('img','m-transition-mark');
  mark.src='./marcosa-mark.svg';mark.alt='';mark.width=132;mark.height=132;
  const name=make('strong','', 'MARCOSA');
  const action=make('small','m-transition-action', 'МИРЫ СОЕДИНЯЮТСЯ');
  const bar=make('span','m-transition-progress');
  bar.append(make('i'));
  core.append(mark,name,action,bar);
  overlay.append(core);
  root.document.body.append(overlay);
 }
 function show(next){
  if(!overlay)return;
  const label=overlay.querySelector('.m-transition-action');
  if(label)label.textContent=next||'СОЕДИНЯЕМ МИРЫ';
  overlay.hidden=false;
  overlay.dataset.active='true';
  overlay.setAttribute('aria-hidden','false');
 }
 function hide(){
  locked=false;
  if(!overlay)return;
  overlay.dataset.active='false';
  overlay.setAttribute('aria-hidden','true');
  if(reduced){overlay.hidden=true;return;}
  root.setTimeout(()=>{if(overlay.dataset.active==='false')overlay.hidden=true;},290);
 }
 function targetWorld(url){return byFile[url.pathname.split('/').pop().toLowerCase()]||null;}
 function internalNavigate(event){
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||locked)return;
  const a=event.target&&event.target.closest?event.target.closest('a[href]'):null;
  if(!a||a.hasAttribute('download')||a.target&&a.target!=='_self')return;
  const raw=a.getAttribute('href');
  if(!raw||raw.charAt(0)==='#'||/^(?:mailto:|tel:|javascript:)/i.test(raw))return;
  let url;
  try{url=new URL(a.href,root.location.href);}catch{return;}
  if(url.origin!==root.location.origin||url.pathname===root.location.pathname)return;
  const world=targetWorld(url);
  if(!world)return;
  if(reduced)return;
  event.preventDefault();
  locked=true;
  show(world.heading);
  // Browser-native same-origin document navigation, no fake progress percentages.
  root.setTimeout(()=>root.location.assign(url.href),370);
  root.setTimeout(()=>{if(root.document.visibilityState==='visible')hide();},1900);
 }
 function boot(){
  root.document.documentElement.dataset.mWorld=current.id;
  buildNav();
  makeOverlay();
  root.document.addEventListener('click',internalNavigate,false);
  root.addEventListener('pageshow',hide);
  root.addEventListener('pagehide',()=>{locked=false;});
  if(!reduced&&root.document.readyState!=='complete'){
   show('ЗАГРУЖАЕМ '+current.name.toUpperCase());
   root.addEventListener('load',hide,{once:true});
   root.setTimeout(hide,2200);
  }
 }
 if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});
 else boot();
 root.MarcosaBrand=Object.freeze({
  worlds:WORLDS.map(w=>Object.freeze({id:w.id,href:w.href,name:w.name})),
  current:current.id
 });
})(typeof window!=='undefined'?window:undefined);
