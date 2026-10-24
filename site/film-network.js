/* MARCOSA R13 — film-network pilot evidence kit.
 * Offline browser workspace; never scans/domains, publishes, tracks or verifies rights.
 * All checkboxes are user declarations, not independent evidence.
 */
(function(root,factory){
 'use strict';
 const network=typeof module==='object'&&module.exports?require('./network.js'):(root&&root.MarcosaNetworkPreview);
 const api=factory(network);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root&&root.document){
   root.MarcosaFilmNetwork=api;
   const boot=()=>{root.MarcosaFilmNetworkRuntime=api.mount(root.document,root);};
   if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});
   else boot();
 }
})(typeof window!=='undefined'?window:undefined,function(network){
 'use strict';
 if(!network)throw Error('NETWORK_SOURCE_REQUIRED');
 const SCHEMA='marcosa-film-pilot-evidence/v1';
 const CHECKS=Object.freeze([
   'domain_control','content_rights','story_playable','mobile_tested',
   'after_ending_cta','world_fit','source_access','performance_checked'
 ]);
 const REQUIRED=Object.freeze(['domain_control','content_rights','story_playable','mobile_tested','after_ending_cta','world_fit']);
 const SLOT=/^FILM-(0[1-9]|[1-3][0-9]|4[0-3])$/;
 const MAX_TEXT=240;
 const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
 const tvals={
  ru:{
   title:'Киносеть MARCOSA · аудит подключения',lead:'Загрузи реальные домены, проверь готовность каждого интерактивного фильма и получи три кандидата для первого пилота. Никаких выдуманных сайтов и автоматических публикаций.',
   source:'ЛОКАЛЬНЫЙ РЕЕСТР / R13',identity:'43 ожидаемых сайта · 0 подтверждённых источников из репозитория',
   upload:'ЗАГРУЗИТЬ CSV САЙТОВ',template:'СКАЧАТЬ ШАБЛОН 43 ДОМЕНОВ',report:'СКАЧАТЬ ПАКЕТ ПРОВЕРКИ JSON',
   reset:'ОЧИСТИТЬ ЛОКАЛЬНЫЙ СПИСОК',sites:'ИМПОРТИРОВАННЫЕ КАНДИДАТЫ',empty:'Пока нет реальных доменов. Импортируй CSV — пустые слоты не считаются сайтами.',
   details:'ПРОВЕРКА ОДНОГО САЙТА',hint:'Отметки — только твои заявления. Реальную работоспособность, домен и права нужно проверять отдельно.',
   notes:'ЗАМЕЧАНИЯ ПО ПРОВЕРКЕ',notesHint:'Какие страницы, сценарии и документы следует проверить вручную?',select:'Выберите площадку в списке.',
   short:'ПЕРВАЯ ТРОЙКА ДЛЯ ТЕХНИЧЕСКОГО АУДИТА',shortEmpty:'Для отбора нужны подтверждения владельца по шести обязательным пунктам. Сначала проверь реальные сайты.',
   missing:'Не отмечено: ',readiness:'Самооценка: ',manual:'Кандидат для независимой проверки',hold:'Требуются дополнительные данные',
   snippet:'СКАЧАТЬ HTML-БЛОК ПОСЛЕ ФИНАЛА',snippetLocked:'Для примера перехода отметь управление доменом, права и возможность перехода после финала.',
   reportDone:'Пакет для ручного аудита скачан. Никакие сайты не опубликованы.',importDone:'Импортировано реальных кандидатов: ',importFail:'Ошибка файла: ',limit:'Лимит 43 площадки. Нужен корректный исходный CSV.',
   csvNeeded:'Загрузи CSV с действительными доменами, а не с пустыми слотами.',declared:'САМООЦЕНКА — НЕ НЕЗАВИСИМАЯ ПРОВЕРКА',
   privacy:'Информация остаётся в этой вкладке. Экспорт осуществляется вручную. Без запросов к сайтам, cookies, рекламного трекинга, платежей и публикации.',
   afterTitle:'История закончилась. Хочешь продолжить?',afterText:'Познакомься с независимыми цифровыми историями и сообществами MARCOSA.',afterLink:'Открыть MARCOSA ↗',
   home:'MARCOSA / ГЛАВНАЯ',story:'СТУДИЯ СЮЖЕТОВ',selectSite:'ОТКРЫТЬ ПРОВЕРКУ',
   checks:['Управляю доменом или уполномочен владельцем','Имею права на историю и ссылку','Интерактивная история реально воспроизводится','Проверил навигацию на телефоне','После финала можно добавить добровольный переход','Подобрал подходящую тему/World в MARCOSA','Имею доступ к исходникам сайта','Проверил скорость загрузки на устройстве'],
   banners:'Проверка сети без ложных метрик',ready:'Кандидатов для ручного пилота: ',imported:'Доменов в этом сеансе: ',
   saved:'HTML-пример скачан. Он не внедрён на сайт.',choose:'Выбери площадку и заполни обязательные отметки.',error:'Действие не выполнено. Проверь формат и права на скачивание.'
  },
  en:{
   title:'MARCOSA Film Network · onboarding audit',lead:'Import real domains, self-assess each interactive film and identify three candidates for the first technical pilot. No fabricated domains or automatic deployment.',
   source:'LOCAL INVENTORY / R13',identity:'43 expected sites · 0 repository-verified sources',
   upload:'IMPORT SITE CSV',template:'DOWNLOAD 43-SITE TEMPLATE',report:'DOWNLOAD REVIEW JSON',
   reset:'CLEAR THIS LOCAL LIST',sites:'IMPORTED CANDIDATES',empty:'No real domains imported. Empty CSV slots do not count as sites.',
   details:'REVIEW ONE SITE',hint:'Checkboxes reflect your statements only. Domain control, rights and actual function require independent review.',
   notes:'REVIEW NOTES',notesHint:'Which pages, scenes and rights documents should be checked?',
   select:'Select a site from the list.',short:'FIRST THREE TECHNICAL REVIEW CANDIDATES',
   shortEmpty:'Select candidates only after the six required owner checkboxes are completed.',
   missing:'Unchecked: ',readiness:'Self-checks: ',manual:'Candidate for independent review',hold:'More evidence needed',
   snippet:'DOWNLOAD POST-ENDING HTML',snippetLocked:'For an example link, declare domain control, content rights and availability of an after-ending CTA.',
   reportDone:'Manual-review package downloaded. No site was published.',importDone:'Imported real candidates: ',importFail:'Invalid file: ',limit:'Maximum 43 candidates. Use a valid CSV source.',
   csvNeeded:'Import a CSV with real domains, not empty template slots.',declared:'SELF-ASSESSMENT — NOT INDEPENDENT VERIFICATION',
   privacy:'All information stays in this tab. Manual export only. No site scans, cookies, tracking, payments or publication.',
   afterTitle:'Your story has ended. Want to explore more?',afterText:'Explore independent stories and communities in MARCOSA.',afterLink:'Open MARCOSA ↗',
   home:'MARCOSA / HOME',story:'STORY CREATOR',selectSite:'OPEN REVIEW',
   checks:['I control the domain or have authorization','I have content and link rights','The interactive story actually plays','I checked mobile navigation','An optional link fits after an ending','I found a relevant MARCOSA topic or World','I have the site source code','I checked loading speed on a device'],
   banners:'Network evidence before metrics',ready:'Manual pilot candidates: ',imported:'Sites this session: ',saved:'Example HTML downloaded. It was not deployed.',choose:'Choose a site and complete the required checks.',error:'Could not complete the action.'
  },
  zh:{
   title:'MARCOSA 电影网络 · 接入审查',lead:'导入真实域名，检查互动电影接入条件，筛选前三个技术试点候选。不虚构网站，不自动发布。',
   source:'本地资产清单 / R13',identity:'预计 43 个站点 · 仓库验证来源 0',
   upload:'导入站点 CSV',template:'下载 43 个站点模板',report:'下载审核 JSON',
   reset:'清空本地列表',sites:'导入的候选站点',empty:'尚无真实域名。空模板不算已上线站点。',
   details:'检查单个站点',hint:'勾选项只是用户自述；域名、版权与运行情况仍需独立核实。',
   notes:'审核备注',notesHint:'需要独立检查哪些场景及证明？',select:'在列表中选择站点。',
   short:'首批三个技术审核候选',shortEmpty:'先完成六个必填自检项。',
   missing:'未勾选：',readiness:'自评：',manual:'待独立审核的候选',hold:'需要更多资料',
   snippet:'下载结局后的 HTML',snippetLocked:'请先自述拥有域名控制权、版权和结局跳转位置。',
   reportDone:'审核包已下载，未发布网站。',importDone:'已导入真实候选：',importFail:'文件错误：',limit:'最多 43 个站点。',
   csvNeeded:'请导入真实域名 CSV，而不是空模板。',declared:'自评并非独立审核',
   privacy:'信息仅保留在当前页面。手动导出，没有扫描、Cookie、跟踪、付款或发布。',
   afterTitle:'故事结束了。还想探索更多吗？',afterText:'探索 MARCOSA 的独立故事与社区。',afterLink:'打开 MARCOSA ↗',
   home:'MARCOSA / 首页',story:'故事创作',selectSite:'打开审核',
   checks:['我控制该域名或已获授权','我拥有内容和链接使用权','互动故事可以正常播放','已在手机检查导航','结局后可自愿跳转','已找到相关 MARCOSA 主题','我能访问网站源码','已在设备上检查加载速度'],
   banners:'以证据而非虚构数据为基础',ready:'人工试点候选：',imported:'当前页面站点数：',
   saved:'HTML 示例已下载，未部署。',choose:'选择站点并完成必填项。',error:'操作失败。'
  }
 };
 const t=(lang,key)=>(tvals[lang]||tvals.ru)[key]||tvals.ru[key]||key;
 function strictText(x,min,max,name){
  if(typeof x!=='string'||x.trim().length<min||x.trim().length>max||/[\u0000-\u001f\u007f]/.test(x))throw Error('INVALID_'+name);
  return x.trim();
 }
 function safeNote(value){
  if(typeof value!=='string')throw Error('INVALID_NOTE');
  const note=value.replace(/\r\n?/g,'\n').trim();
  if(note.length>MAX_TEXT||/[\u0000-\u0009\u000b-\u001f\u007f]/.test(note))throw Error('INVALID_NOTE');
  return note;
 }
 function newSite(raw){
  if(!raw||typeof raw!=='object'||!SLOT.test(raw.asset_id))throw Error('INVALID_SITE_SLOT');
  const domain=network.checkDomain(raw.domain);
  const name=typeof raw.project_name==='string'&&raw.project_name.trim()?strictText(raw.project_name,1,100,'NAME'):'';
  return {slot:raw.asset_id,domain,name,checks:Object.fromEntries(CHECKS.map(x=>[x,false])),note:''};
 }
 function importCsv(csv){
  const rows=network.parseFilmImport(csv),seenSlots=new Set(),sites=[];
  for(const raw of rows){
   if(!SLOT.test(raw.asset_id)||seenSlots.has(raw.asset_id))throw Error('DUPLICATE_OR_INVALID_FILM_ID');
   seenSlots.add(raw.asset_id);sites.push(newSite(raw));
  }
  return sites.sort((a,b)=>a.slot.localeCompare(b.slot));
 }
 const keys=['slot','domain','name','checks','note'];
 function normalizeSite(site){
  if(!site||Array.isArray(site)||typeof site!=='object'||Object.keys(site).sort().join('|')!==keys.slice().sort().join('|'))
   throw Error('UNKNOWN_SITE_FIELD');
  if(!SLOT.test(site.slot)||network.checkDomain(site.domain)!==site.domain)throw Error('INVALID_SITE');
  const name=site.name===''?'':strictText(site.name,1,100,'NAME');
  const note=safeNote(site.note);
  if(!site.checks||Array.isArray(site.checks)||Object.keys(site.checks).sort().join('|')!==CHECKS.slice().sort().join('|'))
   throw Error('INVALID_SITE_CHECKS');
  const checks={};for(const key of CHECKS){if(typeof site.checks[key]!=='boolean')throw Error('INVALID_CHECK');checks[key]=site.checks[key];}
  return {slot:site.slot,domain:site.domain,name,checks,note};
 }
 function checked(site){return CHECKS.filter(k=>site.checks[k]).length;}
 function eligible(site){return REQUIRED.every(k=>site.checks[k]);}
 function shortlist(sites){
  const data=sites.map(normalizeSite);
  return data.filter(eligible).sort((a,b)=>checked(b)-checked(a)||a.slot.localeCompare(b.slot)).slice(0,3)
   .map((site,i)=>({rank:i+1,slot:site.slot,domain:site.domain,self_checks:checked(site),
     review_status:'candidate_pending_independent_verification'}));
 }
 function report(input,time){
  if(!Array.isArray(input)||input.length>43)throw Error('INVALID_SITE_COUNT');
  if(typeof time!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(time)||!Number.isFinite(Date.parse(time)))
   throw Error('INVALID_EXPORT_TIME');
  const sites=input.map(normalizeSite),slots=new Set(),domains=new Set();
  for(const site of sites){
   if(slots.has(site.slot)||domains.has(site.domain))throw Error('DUPLICATE_FILM_OR_DOMAIN');
   slots.add(site.slot);domains.add(site.domain);
  }
  return {schema:SCHEMA,generated_at:time,review_status:'user_self_assessment_only',
   externally_verified:false,publication_state:'not_published',analytics_events_collected:0,
   sites:sites.map(site=>({...site,score_kind:'number_of_author_self_checks',checks_completed:checked(site),
     independent_rights_verification:false,independent_domain_verification:false,
     missing_checks:CHECKS.filter(k=>!site.checks[k])})),shortlist:shortlist(sites)};
 }
 function escapeHtml(x){return String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
 function referral(site,lang='ru'){
  const item=normalizeSite(site);
  if(!item.checks.domain_control||!item.checks.content_rights||!item.checks.after_ending_cta)
   throw Error('AUTHOR_ATTESTATION_REQUIRED');
  const l=tvals[lang]||tvals.ru;
  const label=escapeHtml(item.name||item.domain),asset=escapeHtml(item.slot);
  return '<aside class="marcosa-after-ending" data-marcosa-film="'+asset+'" role="complementary" aria-label="'+escapeHtml(l.afterTitle)+'" '+
   'style="margin:2rem auto;padding:24px;max-width:640px;border:1px solid #bc6676;border-radius:16px;background:#0d1930;color:#f8f1e2;font-family:system-ui,sans-serif">'+
   '<small style="color:#e6c394">MARCOSA / MANUAL PLACEMENT DRAFT</small>'+
   '<h2 style="font-size:1.5rem;line-height:1.3">'+escapeHtml(l.afterTitle)+'</h2>'+
   '<p>'+escapeHtml(l.afterText)+'</p>'+
   '<p style="color:#b9cbd6;font-size:.875rem">'+label+'</p>'+
   '<a href="https://marcosa.club/" target="_blank" rel="noopener noreferrer" style="color:#ffdeb1;font-weight:700">'+escapeHtml(l.afterLink)+'</a>'+
   '</aside>\n';
 }
 function mount(doc,win){
  if(!doc.getElementById('fn-app'))return null;
  const $=id=>doc.getElementById(id);
  const el=(tag,cls,value)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(value!==undefined)node.textContent=value;return node;};
  let language='ru',sites=[],selected=null;
  const say=(key,detail='')=>{$('fn-status').textContent=t(language,key)+detail;};
  const download=(name,content,mime)=>{
   const blob=new Blob([content],{type:mime}),url=URL.createObjectURL(blob),a=doc.createElement('a');
   a.href=url;a.download=name;doc.body.append(a);a.click();a.remove();win.setTimeout(()=>URL.revokeObjectURL(url),1200);
  };
  function renderList(){
   const pane=$('fn-sites');pane.replaceChildren();
   $('fn-count').textContent=sites.length+' / 43';
   if(!sites.length)pane.append(el('p','fn-empty',t(language,'empty')));
   for(const site of sites){
    const row=el('article','fn-site'+(site.slot===selected?' chosen':''));
    const info=el('div','fn-site-info');
    info.append(el('strong','',site.name||site.slot));
    info.append(el('span','',site.slot+' · '+site.domain));
    info.append(el('small','',t(language,'readiness')+checked(site)+' / '+CHECKS.length+' · '+(eligible(site)?t(language,'manual'):t(language,'hold'))));
    const open=el('button','fn-open',t(language,'selectSite'));open.type='button';
    open.addEventListener('click',()=>{selected=site.slot;render();$('fn-checks').scrollIntoView({block:'nearest'});});
    row.append(info,open);pane.append(row);
   }
  }
  function selectedSite(){return sites.find(x=>x.slot===selected)||null;}
  function renderDetails(){
   const site=selectedSite();
   const pane=$('fn-checks');pane.replaceChildren();
   $('fn-site-title').textContent=site?(site.name||site.slot)+' · '+site.domain:t(language,'select');
   $('fn-detail-status').textContent=site?t(language,'readiness')+checked(site)+' / '+CHECKS.length+' · '+(eligible(site)?t(language,'manual'):t(language,'hold')):'';
   $('fn-note').value=site?site.note:'';
   $('fn-note').disabled=!site;
   $('fn-snippet').disabled=!site||!site.checks.domain_control||!site.checks.content_rights||!site.checks.after_ending_cta;
   if(!site){pane.append(el('p','fn-empty',t(language,'select')));return;}
   CHECKS.forEach((key,index)=>{
    const line=el('label','fn-check');
    const input=el('input');input.type='checkbox';input.checked=site.checks[key];
    input.addEventListener('change',()=>{site.checks[key]=input.checked;render();});
    const copy=el('span','',tvals[language].checks[index]+(REQUIRED.includes(key)?' *':''));
    line.append(input,copy);pane.append(line);
   });
  }
  function renderPilot(){
   const pane=$('fn-pilot');pane.replaceChildren();
   const top=shortlist(sites);
   $('fn-ready').textContent=top.length+' / 3';
   if(!top.length){pane.append(el('p','fn-empty',t(language,'shortEmpty')));return;}
   for(const item of top){
    const card=el('div','fn-pilot-row');
    card.append(el('strong','',String(item.rank).padStart(2,'0')));
    card.append(el('span','',item.domain+' · '+item.self_checks+'/8'));
    pane.append(card);
   }
  }
  function render(){renderList();renderDetails();renderPilot();$('fn-download').disabled=!sites.length;}
  function localization(){
   doc.documentElement.lang=language;
   doc.querySelectorAll('[data-fn-text]').forEach(n=>{const k=n.dataset.fnText;if(own(tvals[language],k))n.textContent=t(language,k);});
   doc.querySelectorAll('[data-fn-lang]').forEach(n=>{n.setAttribute('aria-pressed',String(n.dataset.fnLang===language));n.classList.toggle('active',n.dataset.fnLang===language);});
   $('fn-note').placeholder=t(language,'notesHint');render();
  }
  doc.querySelectorAll('[data-fn-lang]').forEach(n=>n.addEventListener('click',()=>{language=n.dataset.fnLang;localization();}));
  $('fn-template').addEventListener('click',()=>{
   const head='asset_id,verified_domain,project_name,genre,source_repository,verified_rights,status,integration_priority';
   const csv=head+'\n'+Array.from({length:43},(_,i)=>'FILM-'+String(i+1).padStart(2,'0')+',,,,,,unverified_missing_domain,').join('\n')+'\n';
   download('marcosa-network-43-sites.csv',csv,'text/csv;charset=utf-8');
  });
  $('fn-import').addEventListener('change',async ev=>{
   const file=ev.target.files&&ev.target.files[0];ev.target.value='';if(!file)return;
   try{
    if(file.size>262144)throw Error('CSV_SIZE');
    const list=importCsv(await file.text());
    sites=list;selected=sites[0]?.slot||null;render();
    say(list.length?'importDone':'csvNeeded',list.length?String(list.length):'');
   }catch(err){say('importFail',String(err.message).slice(0,80));}
  });
  $('fn-clear').addEventListener('click',()=>{
   if(sites.length&&typeof win.confirm==='function'&&!win.confirm(t(language,'reset')+'?'))return;
   sites=[];selected=null;render();say('empty');
  });
  $('fn-note').addEventListener('input',ev=>{
   const site=selectedSite();if(!site)return;
   site.note=ev.target.value.slice(0,MAX_TEXT);
  });
  $('fn-download').addEventListener('click',()=>{
   try{
    const payload=report(sites,new Date().toISOString());
    download('marcosa-film-network-evidence.json',JSON.stringify(payload,null,2)+'\n','application/json;charset=utf-8');
    say('reportDone');
   }catch(err){say('error');}
  });
  $('fn-snippet').addEventListener('click',()=>{
   try{
    const site=selectedSite();if(!site)throw Error('NO_SITE');
    download('marcosa-'+site.slot.toLowerCase()+'-ending.html',referral(site,language),'text/html;charset=utf-8');
    say('saved');
   }catch(err){say('choose');}
  });
  localization();
  function replaceSites(records){
    // Restore validated author *self-checks*, never server confirmations.
    // Validate the whole payload before modifying the current workspace.
    const normalized=report(records,new Date().toISOString()).sites.map(normalizeSite);
    sites=normalized;selected=sites[0]?.slot||null;render();
    return sites.length;
  }
  return Object.freeze({
    get sites(){return sites.map(normalizeSite);},
    get selected(){return selected;},
    get language(){return language;},
    replaceSites
  });
 }
 return Object.freeze({SCHEMA,CHECKS,REQUIRED,importCsv,newSite,normalizeSite,checked,eligible,shortlist,report,referral,mount});
});