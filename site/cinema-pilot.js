/* MARCOSA R16 — isolated player for a source-identical standalone GitHub cinema.
   Local only. No stats, tracking or automatic navigation to another website. */
(function(root){
 'use strict';
 if(!root||!root.document)return;
 const start=()=>{
  const d=root.document,$=id=>d.getElementById(id);
  if(!$('cp-app'))return;
  const frame=$('cp-film-frame'),play=$('cp-play'),restart=$('cp-restart'),
   fullscreen=$('cp-fullscreen'),placeholder=$('cp-placeholder'),stage=$('cp-stage'),
   status=$('cp-status');
  let initiated=false,loads=0;
  const src='./film-internet-v-humanity.html';
  const state=(text)=>{status.textContent=text;};
  function load(){
   initiated=true;
   placeholder.hidden=true;
   frame.hidden=false;
   restart.disabled=false;
   fullscreen.disabled=false;
   // A fresh sandboxed navigation starts the real source's opening scene.
   // allow-same-origin is intentionally absent, so localStorage is inaccessible.
   frame.src=src;
   state('Загружается настоящий интерактивный пролог…');
  }
  play.addEventListener('click',()=>{load();play.disabled=true;});
  restart.addEventListener('click',()=>{if(initiated)load();});
  fullscreen.addEventListener('click',()=>{
   if(!initiated)return;
   if(typeof stage.requestFullscreen==='function'){
    const response=stage.requestFullscreen();
    if(response&&typeof response.catch==='function')response.catch(()=>{
     state('Полноэкранный режим не разрешён браузером. Можно открыть историю отдельно.');
    });
   }else state('Этот браузер не поддерживает полноэкранный режим. Открой историю отдельно.');
  });
  frame.addEventListener('load',()=>{
   if(!initiated||frame.getAttribute('src')!==src)return;
   loads++;
   state('Игра запущена. Выбирай решения внутри кадра; история и выбор не отправляются в MARCOSA.');
  });
  return Object.freeze({get launched(){return initiated;},get loads(){return loads;}});
 };
 if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});
 else start();
})(typeof window!=='undefined'?window:undefined);
