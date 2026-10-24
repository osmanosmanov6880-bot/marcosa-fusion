/* MARCOSA R22: real cinematic world console controls.
   Does not collect viewers, metrics, accounts or any personal data. */
(function(root){
 "use strict";
 if(!root||!root.document)return;
 const boot=()=>{
  const search=root.document.getElementById('m22-world-search');
  const panel=root.document.getElementById('m22-experience');
  if(!search||!panel)return;
  const features=Array.from(root.document.querySelectorAll('[data-m22-search]'));
  const empty=root.document.getElementById('m22-search-empty');
  const all=()=>{
   const needle=search.value.trim().toLocaleLowerCase('ru');
   let visible=0;
   let featureCount=0;
   for(const element of features){
    const hay=(element.getAttribute('data-m22-search')||'').toLocaleLowerCase('ru');
    const show=(!needle||hay.includes(needle));
    element.hidden=!show;
    if(show){visible++;if(element.classList.contains('m22-feature'))featureCount++;}
   }
   if(empty)empty.hidden=featureCount!==0;
   return visible;
  };
  search.addEventListener('input',all);
  root.MarcosaGateway=Object.freeze({searchableWorlds:features.length,hasRealLinks:features.every(a=>a.tagName==='A')});
  all();
 };
 if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});
 else boot();
})(typeof window!=='undefined'?window:undefined);
