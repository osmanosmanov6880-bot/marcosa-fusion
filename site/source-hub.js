/* MARCOSA R15 source provenance index.
 * Source origin and hashes from user-provided ZIP inventory and connected GitHub repos.
 * Does NOT claim 43 live domains, commercial revenues, ownership or valid film rights.
 */
(function(root,factory){
 'use strict';const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root&&root.document){
  root.MarcosaSourceAtlas=api;
  const start=()=>api.mount(root.document);
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
 }
})(typeof window!=='undefined'?window:undefined,function(){
 'use strict';
 const RECORDS=[{"kind":"github","name":"-","title":"-","source_url":"https://github.com/osmanosmanov6880-bot/-","branch":"main","cinema":false,"is_full_cinema":false,"notes":null,"production_verified":false},{"kind":"github","name":"adverse-judge","title":"ADVERSE JUDGE","source_url":"https://github.com/osmanosmanov6880-bot/adverse-judge","branch":"main","cinema":true,"is_full_cinema":true,"notes":"Полный исходный кино-движок и 15 сцен; R18-версия запускается в MARCOSA без API.","production_verified":false},{"kind":"github","name":"breakthrough-engineering-adventure","title":"breakthrough-engineering-adventure","source_url":"https://github.com/osmanosmanov6880-bot/breakthrough-engineering-adventure","branch":"main","cinema":false,"is_full_cinema":false,"notes":null,"production_verified":false},{"kind":"github","name":"BRUMO.CLUB","title":"BRUMO.CLUB","source_url":"https://github.com/osmanosmanov6880-bot/BRUMO.CLUB","branch":"main","cinema":false,"is_full_cinema":false,"notes":null,"production_verified":false},{"kind":"github","name":"impossible-ventures","title":"impossible-ventures","source_url":"https://github.com/osmanosmanov6880-bot/impossible-ventures","branch":"main","cinema":false,"is_full_cinema":false,"notes":null,"production_verified":false},{"kind":"github","name":"impossible-ventures-cinematic-engine","title":"impossible-ventures-cinematic-engine","source_url":"https://github.com/osmanosmanov6880-bot/impossible-ventures-cinematic-engine","branch":"main","cinema":false,"is_full_cinema":false,"notes":"README-only, not a runnable cinema engine.","production_verified":false},{"kind":"github","name":"internet-v-humanity","title":"THE INTERNET v. HUMANITY","source_url":"https://github.com/osmanosmanov6880-bot/internet-v-humanity","branch":"main","cinema":true,"is_full_cinema":false,"notes":"Настоящий автономный интерактивный пролог с двумя финалами; серверное кино-API не заявлено.","production_verified":false},{"kind":"github","name":"marcosa-fusion","title":"marcosa-fusion","source_url":"https://github.com/osmanosmanov6880-bot/marcosa-fusion","branch":"main","cinema":false,"is_full_cinema":false,"notes":null,"production_verified":false},{"kind":"github","name":"osa-global-intelligence","title":"osa-global-intelligence","source_url":"https://github.com/osmanosmanov6880-bot/osa-global-intelligence","branch":"main","cinema":false,"is_full_cinema":false,"notes":null,"production_verified":false},{"kind":"github","name":"osa-global-intelligence-2","title":"osa-global-intelligence-2","source_url":"https://github.com/osmanosmanov6880-bot/osa-global-intelligence-2","branch":"main","cinema":false,"is_full_cinema":false,"notes":null,"production_verified":false},{"kind":"github","name":"osgard-empire","title":"osgard-empire","source_url":"https://github.com/osmanosmanov6880-bot/osgard-empire","branch":"main","cinema":false,"is_full_cinema":false,"notes":null,"production_verified":false},{"kind":"github","name":"osgard-universe","title":"osgard-universe","source_url":"https://github.com/osmanosmanov6880-bot/osgard-universe","branch":"main","cinema":false,"is_full_cinema":false,"notes":null,"production_verified":false},{"kind":"github","name":"osgard-world","title":"osgard-world","source_url":"https://github.com/osmanosmanov6880-bot/osgard-world","branch":"master","cinema":false,"is_full_cinema":false,"notes":null,"production_verified":false},{"kind":"github","name":"proofos-global-intelligence","title":"proofos-global-intelligence","source_url":"https://github.com/osmanosmanov6880-bot/proofos-global-intelligence","branch":"main","cinema":false,"is_full_cinema":false,"notes":null,"production_verified":false},{"kind":"github","name":"protocol-zero","title":"PROTOCOL ZERO","source_url":"https://github.com/osmanosmanov6880-bot/protocol-zero","branch":"main","cinema":true,"is_full_cinema":true,"notes":null,"production_verified":false},{"kind":"github","name":"remix-arena","title":"remix-arena","source_url":"https://github.com/osmanosmanov6880-bot/remix-arena","branch":"main","cinema":false,"is_full_cinema":false,"notes":null,"production_verified":false},{"kind":"github","name":"SkillCred","title":"SkillCred","source_url":"https://github.com/osmanosmanov6880-bot/SkillCred","branch":"main","cinema":false,"is_full_cinema":false,"notes":null,"production_verified":false},{"kind":"github","name":"universa-work","title":"universa-work","source_url":"https://github.com/osmanosmanov6880-bot/universa-work","branch":"main","cinema":false,"is_full_cinema":false,"notes":null,"production_verified":false},{"kind":"github","name":"ZION-9-INFINITE","title":"ZION-9-INFINITE","source_url":"https://github.com/osmanosmanov6880-bot/ZION-9-INFINITE","branch":"main","cinema":false,"is_full_cinema":false,"notes":null,"production_verified":false},{"kind":"github","name":"zion-9-worlds","title":"zion-9-worlds","source_url":"https://github.com/osmanosmanov6880-bot/zion-9-worlds","branch":"main","cinema":false,"is_full_cinema":false,"notes":null,"production_verified":false},{"kind":"archive","name":"AdOS Network","title":"AdOS Network","archive":"AdOS_Network_v17.0.0_FULL_SOURCE(1).zip","cinema":false,"cinema_paths":[],"files":263,"sha256":"1712c7e40aee4a53eb96b40b489b1317912269a90921f8959ea33fb0743c4164","production_verified":false},{"kind":"archive","name":"IMPOSSIBLE-AI-v0.1.0-FULL-SOURCE(1).zip","title":"IMPOSSIBLE-AI-v0.1.0-FULL-SOURCE(1).zip","archive":"IMPOSSIBLE-AI-v0.1.0-FULL-SOURCE(1).zip","cinema":false,"cinema_paths":[],"files":33,"sha256":"4bbdc832285ba497fc429b7861f8703fb3aa3d3c66caf7174215e4a2dce967e0","production_verified":false},{"kind":"archive","name":"IntentGraph Cosmic ONE","title":"IntentGraph Cosmic ONE","archive":"IntentGraph_Cosmic_ONE_v4.5_FULL_SOURCE(1).zip","cinema":true,"cinema_paths":["IntentGraph_Cosmic_ONE_v4.5/web/cinema/index.html"],"files":263,"sha256":"4551555663b4eb8caa6c6155e0e0bd1029e9cd5d359fbf6b838e77a92f812c8c","production_verified":false},{"kind":"archive","name":"IntentMesh","title":"IntentMesh","archive":"IntentMesh_v2.9_GROWTH_INTELLIGENCE_FULL_SOURCE (6).zip","cinema":false,"cinema_paths":[],"files":219,"sha256":"6d242fd1d24b3e05aec4aaa874701fe3a8ddc3d0588aed81f4fb40c110724e3b","production_verified":false},{"kind":"archive","name":"KRAKEN OMEGA","title":"KRAKEN OMEGA","archive":"KRAKEN_OMEGA_v0.50_FULL_SOURCE_QA(1).zip","cinema":false,"cinema_paths":[],"files":1062,"sha256":"0520f95dbdf2da7a99116a66533b49dbe530da46368d06841e8f970d19178c2d","production_verified":false},{"kind":"archive","name":"KVALORA V0 17 0 PREMIUM FULL SOURCE(1).zip","title":"KVALORA V0 17 0 PREMIUM FULL SOURCE(1).zip","archive":"KVALORA_V0_17_0_PREMIUM_FULL_SOURCE(1).zip","cinema":false,"cinema_paths":[],"files":100,"sha256":"07071b62dda2e946d0366eabc07e7922154390e0de2ec7cde8d73d0203717ce8","production_verified":false},{"kind":"archive","name":"OpsPilot Spectrum / Cinema","title":"OpsPilot Spectrum / Cinema","archive":"OpsPilot_Spectrum_v2.2_Cinema_v1.1_UNIFIED(1).zip","cinema":true,"cinema_paths":["spectrum-patch/public/cinema/index.html"],"files":190,"sha256":"563e4e950f20d708924a54002b07d79027469868ed20dd2dd8524efbe25f80c6","production_verified":false},{"kind":"archive","name":"OutcomeMesh","title":"OutcomeMesh","archive":"OutcomeMesh_v0.15_SOURCE_RU(1).zip","cinema":false,"cinema_paths":[],"files":175,"sha256":"cb00ba1294e82a283f198c3cdbcfef0f057d6632cdd79e092754841a727821bf","production_verified":false},{"kind":"archive","name":"ProofOS Supreme","title":"ProofOS Supreme","archive":"ProofOS_Supreme_v0.12.0_FIVE_WAVES_ENTERPRISE_FULL_SOURCE(1).zip","cinema":false,"cinema_paths":[],"files":383,"sha256":"095c1b5bce07834437469ff058e71c1feda0107db2848fb7f6db524f7e1bce16","production_verified":false},{"kind":"archive","name":"SIGNAL WORLDS","title":"SIGNAL WORLDS","archive":"SIGNAL_WORLDS_v1.0.0_SOURCE(1).zip","cinema":true,"cinema_paths":["SIGNAL_WORLDS_v1.0.0/public/cinema/index.html","SIGNAL_WORLDS_v1.0.0/public/cinema/js/app.mjs"],"files":132,"sha256":"b50f043e9dcf1585c679fa7a9865dc1c6681289059a26cfe60ba8741cfab0d1d","production_verified":false},{"kind":"archive","name":"TIMELESS Ω","title":"TIMELESS Ω","archive":"TIMELESS_OMEGA_v0.21.0_PG_RELIABILITY_SOURCE(1).zip","cinema":false,"cinema_paths":[],"files":223,"sha256":"00de6fbe30562b889ed160b988f9a1533ed0e676471684aef57041ff07b94efe","production_verified":false},{"kind":"archive","name":"UNIVERSA WORK","title":"UNIVERSA WORK","archive":"UNIVERSA_WORK_v0.30.0_SOURCE (1).zip","cinema":false,"cinema_paths":[],"files":198,"sha256":"4c458cb6ae659590b3118b4a8a921e00960eafe067658389a7c4121c661822a4","production_verified":false},{"kind":"archive","name":"WAITOS GLOBAL","title":"WAITOS GLOBAL","archive":"WAITOS_GLOBAL_v1.9.0_FULL_SOURCE(1).zip","cinema":false,"cinema_paths":[],"files":229,"sha256":"e0786bfb67b80e2d7309aafe957b51d8fc847dff2959d3b7e13cec8fa9803211","production_verified":false}];
 function normalizeText(x){return String(x||'').normalize('NFKC').toLocaleLowerCase('ru').trim();}
 function filter(records,query,group='all'){
  if(!['all','github','archives','cinema'].includes(group))throw Error('INVALID_SOURCE_FILTER');
  if(!Array.isArray(records))throw Error('INVALID_SOURCE_LIST');
  const q=normalizeText(query);
  return records.filter(item=>{
   if(group==='github'&&item.kind!=='github')return false;
   if(group==='archives'&&item.kind!=='archive')return false;
   if(group==='cinema'&&!item.cinema)return false;
   return !q||normalizeText([item.name,item.title,item.archive,item.branch,item.notes].filter(Boolean).join(' ')).includes(q);
  });
 }
 function safeExternal(url){
  if(typeof url!=='string'||!/^https:\/\/github\.com\/osmanosmanov6880-bot\/[A-Za-z0-9_.-]+$/.test(url))
   throw Error('UNVERIFIED_SOURCE_URL');
  return url;
 }
 // Only the three source-verified owner-supplied cinema archives were repackaged
 // into independently audited, static R19 HTML files. No ZIP or business backend is published.
 const R19_PLAYABLE=Object.freeze({
  'SIGNAL_WORLDS_v1.0.0_SOURCE(1).zip':'signal-worlds',
  'OpsPilot_Spectrum_v2.2_Cinema_v1.1_UNIFIED(1).zip':'opspilot',
  'IntentGraph_Cosmic_ONE_v4.5_FULL_SOURCE(1).zip':'intentgraph'
 });
 const snapshot=Object.freeze(RECORDS.map(item=>Object.freeze(item)));
 function mount(doc){
  if(!doc.getElementById('sh-app'))return null;
  const $=id=>doc.getElementById(id),host=$('sh-grid'),query=$('sh-search'),count=$('sh-count');
  let group='all';
  const element=(tag,klass,label)=>{
   const node=doc.createElement(tag);
   if(klass)node.className=klass;
   if(label!==undefined)node.textContent=label;
   return node;
  };
  function render(){
   const items=filter(snapshot,query.value,group);
   host.replaceChildren();
   count.textContent=items.length+' / '+snapshot.length+' исходников';
   if(!items.length){host.append(element('p','sh-none','По запросу нет исходников в доступном реестре. Уточни название или сбрось фильтр.'));return items;}
   for(const item of items){
    const card=element('article','sh-card'),rail=element('div','sh-card-rail');
    rail.append(element('span','sh-source',item.kind==='github'?'GITHUB · SOURCE':'ZIP · USER ARCHIVE'));
    if(item.cinema)rail.append(element('span','sh-tag','КИНО · CODE'));
    if(item.kind==='github'&&item.name==='internet-v-humanity')
      rail.append(element('span','sh-tag','PREVIEW ONLY'));
    card.append(rail,element('h3','',item.title));
    if(item.kind==='github'){
     const details=item.notes||(item.cinema?'Настоящие исходники интерактивного кино в GitHub.':'Исходный репозиторий доступен в подключённом GitHub.');
     card.append(element('p','',details));
     const link=element('a','sh-link','ПОСМОТРЕТЬ ИСХОДНИКИ ↗');
     link.href=safeExternal(item.source_url);link.target='_blank';link.rel='noopener noreferrer';
     card.append(link);
     if(item.name==='internet-v-humanity'){
      // The standalone source-identical prologue is bundled in this static release.
      const play=element('a','sh-link sh-play','ИГРАТЬ В НАСТОЯЩИЙ ПРОЛОГ ↗');
      play.href='./cinema-pilot.html';
      play.setAttribute('aria-label','Запустить проверенный кинематографический пролог THE INTERNET v. HUMANITY');
      card.append(play);
     }else if(item.name==='protocol-zero'||item.name==='adverse-judge'){
      const play=element('a','sh-link sh-play','ИГРАТЬ В ПОЛНЫЙ ИНТЕРАКТИВНЫЙ ФИЛЬМ ↗');
      play.href='./cinema-pilot.html#'+item.name;
      play.setAttribute('aria-label','Запустить '+item.title+' в кинотеатре MARCOSA');
      card.append(play);
     }
    }else{
     card.append(element('p','','Проверен ZIP исходников: '+item.files+' файлов. Имя архива: '+item.archive));
     if(item.cinema_paths.length)card.append(element('p','','Движок: '+item.cinema_paths.slice(0,2).join(', ')));
     card.append(element('p','','SHA-256 '+item.sha256.slice(0,16)+'…'));
     const slug=R19_PLAYABLE[item.archive];
     if(slug){
      card.append(element('span','sh-local','R19 · ТОЛЬКО КИНО-ИСТОЧНИК ОПУБЛИКОВАН'));
      const play=element('a','sh-link sh-play','ИГРАТЬ В ИСХОДНЫЙ КИНО-ДВИЖОК ↗');
      play.href='./cinema-pilot.html#'+slug;
      play.setAttribute('aria-label','Запустить '+item.title+' в MARCOSA CINEMA');
      card.append(play);
     }else{
      card.append(element('span','sh-local','ПЕРЕДАНО ВЛАДЕЛЬЦЕМ · НЕ РАЗМЕЩЕНО НА САЙТЕ'));
     }
    }
    host.append(card);
   }
   return items;
  }
  query.addEventListener('input',render);
  const controls=Array.from(doc.querySelectorAll('[data-sh-filter]'));
  for(const button of controls)button.addEventListener('click',()=>{
   group=button.dataset.shFilter;
   for(const another of controls){another.classList.toggle('is-active',another===button);another.setAttribute('aria-pressed',String(another===button));}
   render();
  });
  $('sh-total-repos').textContent=String(snapshot.filter(x=>x.kind==='github').length);
  $('sh-total-archives').textContent=String(snapshot.filter(x=>x.kind==='archive').length);
  render();
  return Object.freeze({get filter(){return group;},get count(){return filter(snapshot,query.value,group).length;},render});
 }
 return Object.freeze({RECORDS:snapshot,filter,safeExternal,mount});
});