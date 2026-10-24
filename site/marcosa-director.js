/* MARCOSA R25 / Director's Edition.
   Real source stills, finite cinematic viewpoints and subtle pointer parallax.
   No network requests, trackers, fake social activity or artificial progress. */
(function(root){
 'use strict';
 if(!root||!root.document)return;
 const SCENES=Object.freeze({
  city:Object.freeze({caption:'01 / CITY EDITION',description:'Оригинальный кинематографический городской пейзаж MARCOSA'}),
  cinema:Object.freeze({caption:'02 / CINEMA EDITION',description:'Оригинальный кадр интерактивного кино MARCOSA'}),
  studio:Object.freeze({caption:'03 / CREATOR EDITION',description:'Оригинальная сцена творческой студии MARCOSA'})
 });
 function init(){
  const hero=root.document.querySelector('.m25-artwork');
  const bar=root.document.getElementById('m25-scene-chooser');
  if(!hero||!bar)return;
  const buttons=Array.from(bar.querySelectorAll('button[data-m25-scene]'));
  const layers=Array.from(hero.querySelectorAll('[data-m25-visual]'));
  const caption=hero.querySelector('.m25-caption-title');
  if(buttons.length!==3||layers.length!==3||!caption)return;
  let scene='city',frame=0;
  const reduce=root.matchMedia&&root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pointer=root.matchMedia&&root.matchMedia('(pointer:fine)').matches;
  function activate(id){
   const meta=SCENES[id];if(!meta)return false;
   scene=id;
   hero.dataset.m25ActiveScene=id;
   hero.setAttribute('aria-label',meta.description);
   caption.textContent=meta.caption;
   buttons.forEach(button=>{
    const active=button.dataset.m25Scene===id;
    button.classList.toggle('is-active',active);
    button.setAttribute('aria-pressed',String(active));
   });
   layers.forEach(layer=>layer.classList.toggle('is-active',layer.dataset.m25Visual===id));
   return true;
  }
  buttons.forEach((button,index)=>{
   button.addEventListener('click',()=>activate(button.dataset.m25Scene));
   button.addEventListener('keydown',event=>{
    if(event.key!=='ArrowRight'&&event.key!=='ArrowLeft')return;
    event.preventDefault();
    const direction=event.key==='ArrowRight'?1:-1;
    const next=buttons[(index+direction+buttons.length)%buttons.length];
    activate(next.dataset.m25Scene);
    next.focus();
   });
  });
  if(!reduce&&pointer&&typeof root.requestAnimationFrame==='function'){
   const update=event=>{
    const box=hero.getBoundingClientRect();
    const x=Math.max(-1,Math.min(1,(event.clientX-box.left-box.width/2)/(box.width/2)));
    const y=Math.max(-1,Math.min(1,(event.clientY-box.top-box.height/2)/(box.height/2)));
    if(frame)root.cancelAnimationFrame(frame);
    frame=root.requestAnimationFrame(()=>{
     hero.style.setProperty('--m25-pan-x',(x*-8).toFixed(1)+'px');
     hero.style.setProperty('--m25-pan-y',(y*-6).toFixed(1)+'px');
     frame=0;
    });
   };
   hero.addEventListener('pointermove',update,{passive:true});
   hero.addEventListener('pointerleave',()=>{
    if(frame)root.cancelAnimationFrame(frame);
    frame=0;
    hero.style.setProperty('--m25-pan-x','0px');
    hero.style.setProperty('--m25-pan-y','0px');
   });
  }
  activate('city');
  root.document.documentElement.dataset.r25Director='ready';
  root.MarcosaDirector=Object.freeze({
   edition:'R25',localOnly:true,sourceArtOnly:true,sceneCount:buttons.length,
   get activeScene(){return scene;}
  });
 }
 if(root.document.readyState==='loading')
  root.document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
})(typeof window!=='undefined'?window:undefined);
