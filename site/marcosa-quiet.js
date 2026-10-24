/* MARCOSA R23 — quiet-luxury home directory (client-only).
   No remote calls, analytics, simulated social accounts or fake engagement. */
(function(root){
 'use strict';
 if(!root||!root.document)return;
 function init(){
  const search=root.document.getElementById('q23-search-input');
  const directory=root.document.getElementById('q23-directory');
  if(!search||!directory)return;
  const items=Array.from(directory.querySelectorAll('[data-q23-search]'));
  const empty=root.document.getElementById('q23-empty');
  function apply(){
   const needle=search.value.trim().toLocaleLowerCase('ru');
   let count=0;
   for(const item of items){
    const tags=(item.dataset.q23Search+' '+item.textContent).toLocaleLowerCase('ru');
    item.hidden=Boolean(needle)&&!tags.includes(needle);
    if(!item.hidden)count++;
   }
   if(empty)empty.hidden=count!==0;
   return count;
  }
  search.addEventListener('input',apply);
  apply();
  root.MarcosaQuiet=Object.freeze({localOnly:true,editorialCards:items.length,edition:'R23'});
 }
 if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
})(typeof window!=='undefined'?window:undefined);
