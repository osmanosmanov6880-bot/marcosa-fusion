/* MARCOSA R28 — all dynamic text uses textContent, never HTML parsing. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const state={me:null,worlds:[],worldCatalog:[],currentWorldSlug:null,worldOpenSerial:0,topicNames:new Map(),cursor:null,feedScope:'all',activityCursor:null,savedCursor:null,savedIds:new Set(),reportPost:null,reportComment:null,reportMessage:null,conversations:[],currentConversationId:null,messageCursor:null};
const i18n=()=>window.MARCOSA_LOCALE;
const localText=(key,fallback)=>i18n()?.t(key)||fallback;
const notice=message=>{$('notice').textContent=message;};
async function api(path,method='GET',data){
 const config={method,credentials:'same-origin',headers:{}};
 if(data!==undefined){config.headers['Content-Type']='application/json';config.body=JSON.stringify(data);}
 const res=await fetch('/api'+path,config);
 let result;try{result=await res.json();}catch{throw Error('Некорректный ответ сервера');}
 if(!res.ok)throw Error(result.error||'Сервер недоступен');
 return result;
}
async function refreshIncidentBanner(){
 const status=await api('/health'),banner=$('incident-banner');
 const media=status.publicMediaDelivery==='disabled',content=status.contentWrites==='disabled';
 const key=media&&content?'incident.both':content?'incident.content':media?'incident.media':null;
 if(!key){banner.hidden=true;banner.textContent='';delete banner.dataset.i18nDynamic;return;}
 banner.dataset.i18nDynamic=key;
 banner.textContent=localText(key,'Временная защита MARCOSA: некоторые действия приостановлены.');
 banner.hidden=false;
}
const node=(tag,text='',cls='')=>{
 const el=document.createElement(tag);
 if(cls)el.className=cls;
 el.textContent=String(text);return el;
};
const systemNode=(tag,key,text,cls='')=>{const el=node(tag,localText(key,text),cls);el.dataset.i18nDynamic=key;return el;};
const clear=element=>element.replaceChildren();
const values=form=>Object.fromEntries(new FormData(form).entries());
const coverUrl=slug=>'/api/worlds/'+encodeURIComponent(slug)+'/cover';
const privateCoverUrl=slug=>'/api/me/worlds/'+encodeURIComponent(slug)+'/cover';
async function sendCover(slug,file,confirmedRights){
 if(confirmedRights!==true)throw Error('Подтвердите законные права на текущую версию PNG');
 if(!file||file.type!=='image/png'||file.size<57||file.size>786432)
  throw Error('Выбери PNG до 768 KiB, без анимации');
 const response=await fetch(coverUrl(slug),{method:'POST',credentials:'same-origin',
  headers:{'Content-Type':'image/png','X-Marcosa-Rights-Attestation':'rights-v1'},body:file});
 let data;try{data=await response.json();}catch{throw Error('Не удалось получить ответ о загрузке');}
 if(!response.ok)throw Error(data.error||'Обложка не принята');
 return data;
}
async function run(action,success){
 try{await action();if(success)notice(success);}
 catch(error){notice(error.message||'Не удалось выполнить действие');}
}
// R87: all native form constraints get one accessible, localized error surface.
// This attaches to newly created forms too; validation itself remains native
// and server-side rules remain authoritative.
const formErrors=new WeakMap();
let formErrorSerial=0;
function formValidationSummary(form){
 let element=formErrors.get(form);
 if(!element){
  element=node('p','','form-validation-summary');
  element.id='marcosa-form-error-'+(++formErrorSerial);
  element.setAttribute('role','alert');
  element.setAttribute('tabindex','-1');
  element.hidden=true;
  form.prepend(element);
  formErrors.set(form,element);
 }
 return element;
}
function describeFormErrors(form,{focus=false}={}){
 const summary=formValidationSummary(form);
 const controls=Array.from(form.elements).filter(el=>
  el instanceof HTMLElement&&el.willValidate===true);
 const invalid=controls.filter(el=>!el.validity.valid);
 const problem=new Set(invalid);
 for(const field of controls){
  const references=(field.getAttribute('aria-describedby')||'')
   .split(/\s+/).filter(Boolean).filter(id=>id!==summary.id);
  if(problem.has(field)){
   field.setAttribute('aria-invalid','true');
   field.setAttribute('aria-describedby',[...references,summary.id].join(' '));
  }else{
   field.removeAttribute('aria-invalid');
   if(references.length)field.setAttribute('aria-describedby',references.join(' '));
   else field.removeAttribute('aria-describedby');
  }
 }
 if(!invalid.length){
  summary.hidden=true;summary.textContent='';delete summary.dataset.i18nDynamic;
  return;
 }
 summary.dataset.i18nDynamic='validation.checkFields';
 summary.textContent=localText('validation.checkFields',
  'Проверь выделенные поля: некоторые значения не соответствуют требованиям.');
 summary.hidden=false;
 if(focus)invalid[0].focus({preventScroll:false});
}
document.addEventListener('invalid',event=>{
 const form=event.target?.form;
 if(!form)return;
 // Prevent opaque native-language validation bubbles and focus the first
 // invalid field after the browser has emitted all invalid events.
 event.preventDefault();
 if(form.dataset.marcosaValidationScheduled==='1')return;
 form.dataset.marcosaValidationScheduled='1';
 queueMicrotask(()=>{
  delete form.dataset.marcosaValidationScheduled;
  if(form.isConnected)describeFormErrors(form,{focus:true});
 });
},true);
const refreshValidationAfterEdit=event=>{
 const form=event.target?.form;
 if(form&&formErrors.has(form))describeFormErrors(form);
};
document.addEventListener('input',refreshValidationAfterEdit,true);
document.addEventListener('change',refreshValidationAfterEdit,true);
async function loadTopics(){
 const data=await api('/world-topics');
 state.topicNames=new Map(data.items.map(item=>[item.id,item.title]));
 for(const [id,withAll] of [['world-edit-category',false],['world-new-category',false],['discover-category',true]]){
  const picker=$(id);clear(picker);
  if(withAll){const all=node('option',localText('topics.all','Все тематики'));all.value='';all.dataset.localeTopic='all';picker.append(all);}
  for(const item of data.items){
   const option=node('option',localText('topics.'+item.id,item.title));option.value=item.id;option.dataset.localeTopic=item.id;picker.append(option);
  }
 }
}
async function onboarding(){
 if(!state.me)return;
 const result=await api('/me/onboarding'),list=$('onboarding-steps');clear(list);
 $('onboarding-progress').value=result.completed;
 $('onboarding-counter').textContent=result.completed+' из '+result.total+' шагов';
 for(const step of result.steps){
  const li=node('li',(step.complete?'✓ ':'○ ')+step.title,step.complete?'onboarding-complete':'onboarding-pending');
  list.append(li);
 }
}
function clearIssuedInvite(){
 $('issued-invite-code').textContent='';
 $('issued-invite-result').hidden=true;
}
async function moderatorQueueHealth(){
 if(!state.me||state.me.role!=='moderator')return;
 const report=await api('/mod/queue-health');
 if(report.production!==false||report.source!=='verified-local-sqlite'||!Array.isArray(report.queues))
  throw Error('Нет подтверждённого локального отчёта модерации');
 const list=$('mod-queue-health-data');clear(list);
 for(const queue of report.queues){
  const item=node('div','','pilot-metric');
  item.append(node('strong',queue.pending+' открыто · '+queue.overdue+' просрочено'));
  item.append(node('span',queue.label+' · ориентир '+queue.targetHours+' ч'));
  item.append(node('span',queue.oldestAgeHours===null?'Очередь пуста':'Самое старое: '+queue.oldestAgeHours+' ч'));
  list.append(item);
 }
 const value=report.pendingTotal===0?'Очереди сейчас пусты':
  'Открыто: '+report.pendingTotal+' · после внутренних ориентиров: '+report.overdueTotal;
 $('mod-queue-health-status').textContent=value+' · '+new Date(report.generatedAt).toLocaleString('ru-RU')
  +' · только локальная SQLite. Это не договорной SLA.';
}
async function operatorReadiness(){
 if(!state.me||state.me.role!=='moderator')return;
 const response=await fetch('/api/mod/readiness',{credentials:'same-origin',cache:'no-store'});
 if(response.status!==200&&response.status!==503)throw Error('Диагностика базы недоступна');
 const report=await response.json();
 const kind=!report.readReady?'failed':report.writeReady&&report.publicMediaReady?'ok':'degraded';
 const keys={ok:'ops.readiness.ok',degraded:'ops.readiness.degraded',failed:'ops.readiness.failed'};
 const fallback={
  ok:'SQLite: целостность и связи подтверждены. Режимы действуют только в локальной лаборатории.',
  degraded:'SQLite целостна, но публикация или изображения ограничены.',
  failed:'Обнаружена проблема целостности SQLite. Восстановление требует независимой проверки.'
 };
 const target=$('mod-readiness-status');
 target.dataset.ready=String(report.readReady);
 target.dataset.i18nDynamic=keys[kind];
 target.textContent=localText(keys[kind],fallback[kind]);
}
async function pilotMetrics(){
 if(!state.me||state.me.role!=='moderator')return;
 const report=await api('/mod/pilot-metrics');
 const list=$('pilot-metrics-data');clear(list);
 const entries=[
  [localText('pilot.metrics.members','Аккаунтов участников'),report.members],
  [localText('pilot.metrics.invited','Регистраций по одноразовым кодам'),report.invitedMembers],
  [localText('pilot.metrics.published','Авторов с опубликованной историей'),report.publishedCreators],
  [localText('pilot.metrics.invitedPublished','Из приглашённых стали авторами'),report.invitedCreatorsPublished],
  [localText('pilot.metrics.publicWorlds','Публичных миров с контентом'),report.publicWorlds],
  [localText('pilot.metrics.replies','Ответов другим авторам'),report.repliesToOtherAuthors],
  [localText('pilot.metrics.follows','Подписок на миры'),report.followEdges],
  [localText('pilot.metrics.saved','Сохранённых публикаций'),report.savedReferences],
  [localText('pilot.metrics.issued','Выдано приглашений'),report.invitations.issued],
  [localText('pilot.metrics.redeemed','Погашено приглашений'),report.invitations.redeemed]
 ];
 for(const [label,count] of entries){
  const card=node('div','','pilot-metric');
  card.append(node('strong',String(count)),node('span',label));list.append(card);
 }
 const activation=report.invitedCreatorActivationRate===null?
  localText('pilot.metrics.noInvited','нет приглашённых'):
  Math.round(report.invitedCreatorActivationRate*100)+'% ('+report.invitedCreatorsPublished+'/'+report.invitedMembers+')';
 list.append(node('p',localText('pilot.metrics.activation','Активация приглашённых авторов: ')+activation,'pilot-metrics-note'));
 const r=report.retentionEvidence;
 const fmt=x=>x?.suppressed?
  localText('pilot.metrics.suppressed','скрыто: меньше пяти участников'):
  x?.eligible>0?Math.round(x.rate*100)+'% ('+x.returned+'/'+x.eligible+')':
  localText('pilot.metrics.unmeasured','не измерено (нет зрелой когорты)');
 list.append(node('p','D7: '+fmt(r?.d7)+' · D30: '+fmt(r?.d30),'pilot-metrics-note'));
 list.append(node('p',localText('pilot.metrics.basis','Источник: добровольные UTC-входы приглашённых участников локальной беты. Когорты менее пяти скрыты; отзыв согласия удаляет историю.'),'pilot-metrics-note'));
 list.append(node('p',localText('pilot.metrics.revenue','Показы рекламы и реальные доходы не подтверждены.'),'pilot-metrics-note'));
}
async function loadRetentionConsent(){
 if(!state.me)return;
 const r=await api('/me/retention-consent');
 $('retention-consent-status').textContent=r.consented?
  'Согласие действует с '+new Date(r.consentedAt).toLocaleDateString('ru-RU')+'. Ты можешь отозвать его и удалить историю.':
  'Выключено по умолчанию. Дни входа не сохраняются.';
 $('retention-enable').hidden=r.consented;
 $('retention-disable').hidden=!r.consented;
}
async function loadCoverReports(){
 if(!state.me)return;
 const result=await api('/me/cover-reports'),list=$('my-cover-reports');clear(list);
 const labels={open:'Ожидает проверки',upheld:'Обложка скрыта',dismissed:'Жалоба отклонена',withdrawn:'Файл заменён'};
 for(const a of result.items)list.append(node('p',a.slug+' · '+(labels[a.status]||a.status)+' · '+a.detail,'cover-appeal-row'));
 if(!result.items.length)list.append(node('p','Новых обращений по изображениям нет.','muted'));
}
async function loadCoverAppeals(){
 if(!state.me)return;
 const data=await api('/me/cover-appeals'),list=$('world-cover-appeals-list');clear(list);
 const labels={open:'Ожидает независимого решения',upheld:'Отклонение оставлено',reopened:'Возвращено на проверку',withdrawn:'Закрыто после замены или удаления'};
 for(const a of data.items){
  const row=node('p',a.slug+' · '+(labels[a.status]||a.status)+' · '+a.reason,'cover-appeal-row');
  list.append(row);
 }
 if(!data.items.length)list.append(node('p','Обращений по обложкам пока нет.','muted'));
}
async function reviewCoverReports(){
 if(!state.me||state.me.role!=='moderator')return;
 const result=await api('/mod/cover-reports'),list=$('mod-cover-reports');clear(list);
 for(const claim of result.items){
  const card=node('article','','mod-cover-item');
  card.append(node('strong',claim.title+' / @'+claim.owner),node('p','Причина: '+claim.reason+' · '+claim.detail,'muted'));
  for(const [decision,label] of [['upheld','Подтвердить жалобу и скрыть PNG'],['dismissed','Отклонить жалобу']]){
   const button=node('button',label,'ghost small');button.type='button';
   button.addEventListener('click',()=>run(async()=>{
    const outcome=await api('/mod/cover-reports/'+claim.id+'/resolve','POST',{decision});
    if(outcome.publicVisible!==(decision==='dismissed'))throw Error('Неверный статус');
    await Promise.all([reviewCoverReports(),reviewCovers(),worlds()]);
   },decision==='upheld'?'Публичная обложка скрыта, автор может обжаловать':'Жалоба отклонена; PNG остался опубликован'));
   card.append(button);
  }
  list.append(card);
 }
 if(!result.items.length)list.append(systemNode('p','dynamic.cover.reports.empty','Новых жалоб на изображения нет.','muted'));
}
async function reviewCoverAppeals(){
 if(!state.me||state.me.role!=='moderator')return;
 const data=await api('/mod/cover-appeals'),target=$('mod-cover-appeals-list');clear(target);
 for(const appeal of data.items){
  const row=node('article','','mod-cover-item');
  row.append(node('strong',appeal.title+' / @'+appeal.owner),
   node('p','Причина апелляции: '+appeal.reason,'muted'));
  for(const [decision,label] of [['reopened','Принять для повторной проверки'],['upheld','Оставить отклонение']]){
   const button=node('button',label,'ghost small');button.type='button';
   button.addEventListener('click',()=>run(async()=>{
    const result=await api('/mod/cover-appeals/'+appeal.id+'/resolve','POST',{decision});
    if(result.publicVisible)throw Error('Апелляция не должна публиковать PNG');
    await Promise.all([reviewCoverAppeals(),reviewCovers(),worlds()]);
   },decision==='reopened'?'Апелляция принята, материал снова на проверке':'Решение по апелляции сохранено'));
   row.append(button);
  }
  target.append(row);
 }
 if(!data.items.length)target.append(node('p','Новых апелляций для независимого рассмотрения нет.','muted'));
}
async function reviewCovers(){
 if(!state.me||state.me.role!=='moderator')return;
 const [result,audit]=await Promise.all([api('/mod/cover-queue'),api('/mod/cover-audit')]);
 const target=$('mod-cover-list');clear(target);
 const history=$('mod-cover-audit');clear(history);
 for(const item of audit.items){
  history.append(node('p',item.slug+' · '+(item.decision==='approved'?'Одобрено':'Отклонено')+' · '+(item.reviewer?'@'+item.reviewer:'проверяющий удалён')+' · '+new Date(item.reviewedAt).toLocaleString('ru-RU'),'audit-row'));
 }
 if(!audit.items.length)history.append(node('p','Решений по изображениям пока нет.','muted'));
 for(const item of result.items){
  const row=node('article','','mod-cover-item');
  row.append(node('strong',item.title+' · @'+item.owner),node('small',item.width+' × '+item.height+' px · ожидает рассмотрения'));
  const image=node('img','','mod-cover-image');
  image.src='/api/mod/worlds/'+encodeURIComponent(item.slug)+'/cover';
  image.alt='Обложка мира '+item.title+' на независимой проверке';
  image.loading='lazy';row.append(image);
  for(const [decision,title] of [['approved','Одобрить изображение'],['rejected','Отклонить']]){
   const button=node('button',title,decision==='approved'?'gold small':'ghost small');
   button.type='button';
   button.addEventListener('click',()=>run(async()=>{
    await api('/mod/worlds/'+encodeURIComponent(item.slug)+'/cover/review','POST',{decision});
    await Promise.all([reviewCovers(),worlds()]);
   },decision==='approved'?'Изображение одобрено и опубликовано':'Изображение отклонено'));
   row.append(button);
  }
  target.append(row);
 }
 if(!result.items.length)target.append(node('p','Новых изображений на рассмотрении нет.','muted'));
}
async function pilotInvites(){
 if(!state.me||state.me.role!=='moderator')return;
 const result=await api('/mod/invites'),list=$('invite-list');clear(list);
 for(const ticket of result.items){
  const row=node('div','','invite-row');
  const stateName=ticket.usedAt?'Использован':ticket.revokedAt?'Отозван':
   ticket.expiresAt<=Date.now()?'Истёк':'Ожидает регистрации';
  row.append(node('strong',ticket.label||'Приглашение без метки'),
   node('small',stateName+' · до '+new Date(ticket.expiresAt).toLocaleString('ru-RU')));
  if(ticket.usedBy)row.append(node('small','Зарегистрировался @'+ticket.usedBy));
  if(!ticket.usedAt&&!ticket.revokedAt&&ticket.expiresAt>Date.now()){
   const revoke=node('button','Отозвать','ghost small');revoke.type='button';
   revoke.addEventListener('click',()=>run(async()=>{
    await api('/mod/invites/'+ticket.id+'/revoke','POST',{});
    await pilotInvites();
   },'Одноразовое приглашение отозвано'));
   row.append(revoke);
  }
  list.append(row);
 }
 if(!result.items.length)list.append(systemNode('p','dynamic.invites.empty','Одноразовых приглашений ещё не было.','muted'));
}
async function loadSavedIds(){
 if(!state.me)return;
 const result=await api('/me/saved/ids');
 state.savedIds=new Set(result.ids);
}
async function saved(reset=true){
 if(!state.me)return;
 const params=new URLSearchParams();
 if(!reset&&state.savedCursor)params.set('cursor',state.savedCursor);
 const result=await api('/me/saved?'+params.toString());
 const list=$('saved-list');
 if(reset)clear(list);
 for(const post of result.items)list.append(postCard(post));
 await loadReactionSummaries(list);
 if(reset&&!result.items.length)list.append(systemNode('p','dynamic.saved.empty','В коллекции пока нет доступных публикаций.','muted'));
 state.savedCursor=result.nextCursor;
 $('saved-more').hidden=!state.savedCursor;
}
async function loadInsights(){
 if(!state.me)return;
 const data=await api('/me/insights'),wrap=$('creator-insights-list');clear(wrap);
 const t=data.totals;
 wrap.append(node('p',t.published+' опубликовано · '+t.drafts+' черновиков · '+t.followers+' подписок · '+t.replies+' ответов','insights-total'));
 for(const item of data.worlds){
  const div=node('div','','insight-entry');
  div.append(node('strong',item.title));
  div.append(node('small',item.published+' публикаций · '+item.followers+' подписчиков · '+item.replies+' ответов · '+item.uniqueResponders+' участников обсуждения'));
  wrap.append(div);
 }
}
async function loadOwnProfile(){
 if(!state.me)return;
 const result=await api('/me/profile'),profile=result.profile,form=$('profile-edit-form');
 form.elements.displayName.value=profile.displayName;
 form.elements.bio.value=profile.bio;
 form.elements.interests.value=profile.interests.join(', ');
 form.elements.website.value=profile.website;
 form.elements.visibility.value=profile.visibility;
 const line=$('profile-public-link');
 line.replaceChildren();
 line.append(node('span',localText(profile.visibility==='public'?'profile.publicLink':'profile.privateLink',profile.visibility==='public'?'Публичная ссылка:':'Профиль скрыт от посетителей · ссылка доступна владельцу:')));
 const link=node('a',location.origin+result.url);link.href=result.url;line.append(link);
}
async function loadPublicProfile(){
 const match=location.pathname.match(/^\/u\/([a-z][a-z0-9_]{2,23})$/);
 if(!match)return;
 document.body.dataset.profilePage='true';
 const result=await api('/people/'+encodeURIComponent(match[1])),person=result.person,panel=$('public-profile');
 panel.hidden=false;
 $('public-profile-handle').textContent='MARCOSA / @'+person.username;
 const isPrivate=person.visibility==='private'&&!person.displayName;
 $('public-profile-title').textContent=isPrivate?'Закрытый профиль':person.displayName||'@'+person.username;
 $('public-profile-private-note').hidden=!isPrivate;
 $('public-profile-bio').hidden=isPrivate;
 $('public-profile-bio').textContent=isPrivate?'':person.bio;
 const interests=$('public-profile-interests');clear(interests);
 interests.hidden=isPrivate;
 for(const value of person.interests||[])interests.append(node('span',value,'profile-interest'));
 const website=$('public-profile-website');
 website.hidden=isPrivate||!person.website;
 if(person.website&&!isPrivate){website.href=person.website;website.rel='noopener noreferrer';}
 const worlds=$('public-profile-worlds');clear(worlds);
 $('public-profile-worlds-heading').hidden=isPrivate;worlds.hidden=isPrivate;
 for(const world of result.worlds){
  const item=node('article','','profile-world');
  const link=node('a',world.title);link.href='/w/'+encodeURIComponent(world.slug);
  item.append(link,node('p',world.description||''),node('small',world.followers+' подписчиков'));
  worlds.append(item);
 }
 const posts=$('public-profile-posts');clear(posts);
 $('public-profile-posts-heading').hidden=isPrivate;posts.hidden=isPrivate;
 for(const post of result.posts){
  const card=node('article','','post profile-post');
  const context=node('a','Мир '+post.world,'eyebrow');context.href='/w/'+encodeURIComponent(post.world);
  card.append(context,node('p',post.body,'post-body'));
  posts.append(card);
 }
 $('public-profile-empty').hidden=isPrivate||Boolean(result.worlds.length||result.posts.length);
 $('public-profile-stats').hidden=isPrivate;
 $('public-profile-stats').dataset.i18nDynamicPrefix='profile.follow.stats';
 $('public-profile-stats').dataset.i18nSuffix=' '+(result.followers||0);
 $('public-profile-stats').textContent=localText('profile.follow.stats','Подписчики:')+' '+(result.followers||0);
 const follow=$('public-profile-follow'),relationship=result.relationship||{state:'none'};
 follow.classList.add('profile-follow-action');
 follow.hidden=!state.me||state.me.username===person.username;
 follow.dataset.state=relationship.state;
 follow.dataset.i18nDynamic=relationship.state==='active'?'profile.follow.active':relationship.state==='pending'?'profile.follow.pending':'profile.follow.action';
 follow.textContent=localText(follow.dataset.i18nDynamic,relationship.state==='active'?'Отписаться от автора':relationship.state==='pending'?'Запрос отправлен':'Отправить запрос на подписку');
 document.title=(isPrivate?'Закрытый профиль':person.displayName||'@'+person.username)+' · MARCOSA';
}
async function loadUserFollowing(){
 if(!state.me)return;
 const result=await api('/me/following'),list=$('user-following-list');clear(list);
 for(const item of result.items){
  const row=node('div','','follow-row'),link=node('a',item.displayName||'@'+item.username);link.href=item.url;
  row.append(link,item.status==='pending'?systemNode('small','profile.follow.outgoing','Запрос ожидает одобрения'):node('small','@'+item.username));
  if(item.status==='active'){
   const remove=systemNode('button','profile.follow.active','Отписаться от автора','ghost small');remove.type='button';
   remove.addEventListener('click',()=>run(async()=>{
    await api('/users/'+encodeURIComponent(item.username)+'/follow','DELETE',{});
    await Promise.all([loadUserFollowing(),feed(true)]);
   },'Подписка отменена'));
   row.append(remove);
  }else{
   const cancel=systemNode('button','profile.follow.cancelRequest','Отменить запрос','ghost small');cancel.type='button';
   cancel.addEventListener('click',()=>run(async()=>{
    await api('/users/'+encodeURIComponent(item.username)+'/follow','DELETE',{});
    await loadUserFollowing();
   },'Запрос отменён'));
   row.append(cancel);
  }
  list.append(row);
 }
 if(!result.items.length)list.append(systemNode('p','profile.follow.noFollowing','Ты пока не подписан на авторов.','muted'));
}
async function loadFollowRequests(){
 if(!state.me)return;
 const result=await api('/me/follow-requests'),list=$('user-follow-requests-list');clear(list);
 for(const item of result.items){
  const row=node('div','','follow-row'),link=node('a','@'+item.username);link.href='/u/'+encodeURIComponent(item.username);
  row.append(link);
  const approve=systemNode('button','profile.follow.approve','Одобрить','gold small');approve.type='button';
  approve.addEventListener('click',()=>run(async()=>{
   await api('/users/'+encodeURIComponent(item.username)+'/follow-request','POST',{decision:'accept'});
   await Promise.all([loadFollowRequests(),loadUserFollowing()]);
  },localText('profile.follow.accepted','Запрос одобрен')));
  const decline=systemNode('button','profile.follow.decline','Отклонить','ghost small');decline.type='button';
  decline.addEventListener('click',()=>run(async()=>{
   await api('/users/'+encodeURIComponent(item.username)+'/follow-request','POST',{decision:'decline'});
   await loadFollowRequests();
  },localText('profile.follow.rejected','Запрос отклонён')));
  row.append(approve,decline);list.append(row);
 }
 if(!result.items.length)list.append(systemNode('p','profile.follow.noRequests','Новых запросов нет.','muted'));
}
async function updatePublicFollow(){
 const button=$('public-profile-follow'),username=document.body.dataset.profileUser,stateName=button.dataset.state;
 if(!username)return;
 const result=stateName==='active'||stateName==='pending'
  ?await api('/users/'+encodeURIComponent(username)+'/follow','DELETE',{})
  :await api('/users/'+encodeURIComponent(username)+'/follow','POST',{});
 await loadPublicProfile();
 if(state.me)await Promise.all([loadUserFollowing(),feed(true)]);
}
async function searchPeople(value){
 const query=value.trim(),results=$('people-search-results');
 if(query.length<2)throw Error('Введи не менее двух символов');
 const result=await api('/people?q='+encodeURIComponent(query));clear(results);
 for(const person of result.items){
  const card=node('article','','people-result'),link=node('a',person.displayName||'@'+person.username);
  link.href=person.url;card.append(link,node('p','@'+person.username));
  if(person.bio)card.append(node('p',person.bio));
  results.append(card);
 }
 if(!result.items.length)results.append(systemNode('p','dynamic.people.empty','Публичных профилей не найдено.','muted'));
}

function syncCoverSettings(){
 const select=$('world-cover-select'),world=state.worlds.find(w=>w.slug===select.value);
 const image=$('world-cover-preview');
 image.hidden=!world?.hasCover;
 $('world-cover-delete').disabled=!world?.hasCover;
 if(world?.hasCover)image.src=privateCoverUrl(world.slug);
 else image.removeAttribute('src');
 const labels={pending:'В очереди на независимую проверку',approved:'Одобрено · видно посетителям',rejected:'Отклонено · видит только владелец'};
 $('world-cover-status').textContent=world?.hasCover?(labels[world.coverStatus]||'Статус требует проверки'):'У этого мира пока нет обложки';
 $('world-cover-appeal-form').hidden=world?.coverStatus!=='rejected';
}
function syncWorldSettings(){
 const form=$('world-settings-form'),slug=form.elements.slug.value;
 const world=state.worlds.find(x=>x.slug===slug);
 if(!world)return;
 form.elements.title.value=world.title;
 form.elements.description.value=world.description||'';
 form.elements.category.value=world.category||'general';
 form.elements.visibility.value=world.visibility||'public';
}
async function loadBlocks(){
 if(!state.me)return;
 const data=await api('/me/blocks');
 const list=$('blocked-users-list');clear(list);
 for(const person of data.items){
  const row=node('div','','blocked-user');
  row.append(node('strong','@'+person.username));
  const remove=node('button','Разблокировать','ghost small unblock-user');remove.type='button';
  remove.addEventListener('click',()=>run(async()=>{
   await api('/users/'+encodeURIComponent(person.username)+'/block','DELETE',{});
   await Promise.all([loadBlocks(),worlds(),feed(true),sponsors()]);
  },'Блокировка снята'));
  row.append(remove);list.append(row);
 }
 if(!data.items.length)list.append(systemNode('p','dynamic.blocks.empty','Ты пока никого не блокировал.','muted'));
}
function conversationTitle(conversation){
 if(conversation.kind==='group')return conversation.title||localText('messages.group','Групповая беседа');
 return conversation.members.filter(member=>member.username!==state.me?.username).map(member=>'@'+member.username).join(', ')
  ||localText('messages.direct','Личная переписка');
}
async function loadConversations(){
 const list=$('messages-list');clear(list);state.conversations=[];
 if(!state.me){state.currentConversationId=null;state.messageCursor=null;clear($('message-items'));$('message-thread').hidden=true;return;}
 const result=await api('/conversations');state.conversations=result.items;
 for(const conversation of result.items){
  const button=node('button','','message-conversation');button.type='button';
  button.setAttribute('aria-pressed',String(conversation.id===state.currentConversationId));
  const label=node('strong',conversationTitle(conversation));
  const stateText=conversation.requestState==='incoming_request'?localText('messages.incoming','Запрос на переписку'):
   conversation.requestState==='outgoing_request'?localText('messages.pending','Ожидает принятия'):
   conversation.kind==='group'?localText('messages.group','Групповая беседа'):localText('messages.direct','Личная переписка');
  const status=node('span',stateText);
  const preview=node('small',conversation.last_message||localText('messages.empty','Пока без сообщений'));
  const meta=node('small',conversation.unread_count?localText('messages.unread','Новых: ')+conversation.unread_count: '');
  button.append(label,status,preview,meta);
  button.addEventListener('click',()=>run(()=>openConversation(conversation.id)));
  list.append(button);
 }
 if(!result.items.length)list.append(systemNode('p','messages.noConversations','Создай личный запрос или групповую беседу.','muted'));
}
function renderMessage(message,{prepend=false}={}){
 const card=node('article','','message-item');card.dataset.own=String(message.username===state.me?.username);
 card.append(node('strong','@'+message.username),node('div',message.body));
 const time=node('time',new Date(message.created_at).toLocaleString());card.append(time);
 if(message.username!==state.me?.username){
  const report=node('button',localText('messages.report','Сообщить о проблеме в сообщении'),'ghost small');report.type='button';
  report.addEventListener('click',()=>{state.reportMessage=message.id;state.reportComment=null;state.reportPost=null;$('report-detail').required=true;$('report-dialog').showModal();});
  card.append(report);
 }
 if(prepend)$('message-items').prepend(card);else $('message-items').append(card);
}
async function openConversation(id,{cursor=null,older=false}={}){
 const conversation=state.conversations.find(item=>item.id===id);
 if(!conversation)throw Error('Беседа не найдена. Обнови список.');
 state.currentConversationId=id;
 const params=new URLSearchParams();if(cursor)params.set('cursor',cursor);else params.set('limit','30');
 const result=await api('/conversations/'+encodeURIComponent(id)+'/messages?'+params.toString());
 if(!older)clear($('message-items'));
 const items=result.items.slice().reverse();
 for(const message of items)renderMessage(message,{prepend:older});
 state.messageCursor=result.nextCursor;
 $('message-more').hidden=!state.messageCursor;
 $('message-thread').hidden=false;
 $('message-thread-title').textContent=conversationTitle(conversation);
 $('message-thread-state').textContent=conversation.requestState==='incoming_request'?localText('messages.incomingHelp','Это запрос. Просмотри первое сообщение, затем прими или отклони его.'):
  conversation.requestState==='outgoing_request'?localText('messages.pendingHelp','До принятия можно отправить только одно сообщение.'):
  localText('messages.privateHelp','Доступ есть только у участников этой беседы.');
 const incoming=conversation.requestState==='incoming_request';
 $('message-request-actions').hidden=!incoming;
 $('message-send-form').hidden=incoming||(conversation.requestState==='outgoing_request'&&result.items.length>0);
 if(conversation.requestState==='declined')$('message-send-form').hidden=true;
 if(!older){
  await api('/conversations/'+encodeURIComponent(id)+'/read','POST',{});
  await loadConversations();
 }
}
function resetMessageSurface(){
 state.currentConversationId=null;state.messageCursor=null;clear($('messages-list'));clear($('message-items'));
 $('message-thread').hidden=true;
}
async function loadNotificationSettings(){
 if(!state.me)return;
 const res=await api('/me/notification-settings'),form=$('notification-settings-form');
 for(const name of ['follows','comments','sponsorships'])
  form.elements[name].checked=res.settings[name];
 $('notification-settings-status').textContent='Сохранено на сервере · только уведомления в кабинете';
}
async function loadSecurity(){
 if(!state.me)return;
 const data=await api('/me/security');
 $('security-sessions').textContent='Активных сессий: '+data.activeSessions;
 $('security-expiry').textContent='Текущая сессия до: '+new Date(data.currentExpiresAt).toLocaleString('ru-RU');
}
async function session(){
 try{
  const result=await api('/auth/me');
  state.me=result.user;state.worlds=result.worlds;
 }catch{state.me=null;state.worlds=[];}
 $('identity').textContent=state.me?'@'+state.me.username:localText('auth.guest','Гость');
 document.body.dataset.mSession=state.me?'member':'guest';
 $('logout').hidden=!state.me;
 $('feed-following').disabled=!state.me;
 if(!state.me){
  $('security-sessions').textContent='Активные сессии: —';
  $('security-expiry').textContent='Срок текущего входа: —';
  $('security-revoke-form').reset();$('security-password-form').reset();
  $('world-cover-form').reset();
  $('world-cover-preview').hidden=true;
  $('world-cover-preview').removeAttribute('src');
  $('world-cover-delete').disabled=true;
  clearIssuedInvite();clear($('invite-list'));clear($('pilot-metrics-data'));clear($('mod-cover-list'));clear($('mod-cover-audit'));
   clear($('mod-queue-health-data'));
   $('mod-queue-health-status').textContent='Нет данных до входа модератора.';
  clear($('world-cover-appeals-list'));clear($('mod-cover-appeals-list'));clear($('my-cover-reports'));clear($('mod-cover-reports'));
  $('world-cover-appeal-form').reset();$('world-cover-appeal-form').hidden=true;
  clear($('onboarding-steps'));$('onboarding-progress').value=0;
  $('onboarding-counter').textContent='0 из 5 шагов';
  $('notification-settings-form').reset();
  $('notification-settings-status').textContent='Настройки доступны после входа';
  $('retention-consent-status').textContent='Недоступно без входа';
  $('retention-enable').hidden=false;$('retention-disable').hidden=true;
  clear($('blocked-users-list'));
  clear($('user-following-list'));clear($('user-follow-requests-list'));
  clear($('saved-list'));$('saved-more').hidden=true;
  state.savedCursor=null;state.savedIds=new Set();
  clear($('creator-insights-list'));
  state.feedScope='all';state.activityCursor=null;
  $('feed-all').setAttribute('aria-pressed','true');
  $('feed-following').setAttribute('aria-pressed','false');
  clear($('activity-list'));$('activity-count').textContent='0 новых';
  resetMessageSurface();
 }
 $('activity-panel').hidden=!state.me;
 $('guest-access').hidden=Boolean(state.me);
 $('member-access').hidden=!state.me;
 $('composer-panel').hidden=!state.me;
 $('messages-panel').hidden=!state.me;
 $('moderator').hidden=!state.me||state.me.role!=='moderator';
 $('sponsor-owner').hidden=!state.me;
 $('sponsor-moderation').hidden=!state.me||state.me.role!=='moderator';
 $('sponsor-inbox').hidden=!state.me;
 if(!state.me){clear($('my-sponsors'));clear($('received-sponsors'));clear($('sponsor-review-list'));}
 if(state.me){
  $('profile-line').textContent='@'+state.me.username+' · '+state.me.role+' · закрытое испытание';
  const container=$('my-worlds'),choose=$('post-world'),settings=$('world-settings-select'),coverChoose=$('world-cover-select');
  clear(container);clear(choose);clear(settings);clear(coverChoose);
  for(const world of state.worlds){
   const item=node('p',world.title+' / '+world.slug,'world-own');container.append(item);
   const option=node('option',world.title);option.value=world.id;choose.append(option);
   const editOption=node('option',world.title+' / '+world.slug);
   editOption.value=world.slug;settings.append(editOption);
   const coverOption=node('option',world.title+' / '+world.slug);
   coverOption.value=world.slug;coverChoose.append(coverOption);
  }
  if(state.worlds.length)syncWorldSettings();
  syncCoverSettings();
  await loadSavedIds();
  await Promise.all([myPosts(),mySponsors(),receivedSponsors(),activity(true),appeals(),loadInsights(),loadSecurity(),loadNotificationSettings(),loadBlocks(),saved(true),onboarding(),loadCoverAppeals(),loadRetentionConsent(),loadCoverReports(),loadConversations(),loadOwnProfile(),loadUserFollowing(),loadFollowRequests()]);
  if(state.me.role==='moderator')await Promise.all([reports(),reviewSponsors(),reviewAppeals(),pilotInvites(),pilotMetrics(),moderatorQueueHealth(),reviewCovers(),reviewCoverAppeals(),reviewCoverReports(),messageReports()]);
  else {clearIssuedInvite();clear($('invite-list'));clear($('pilot-metrics-data'));clear($('mod-cover-list'));clear($('mod-queue-health-data'));clear($('message-report-list'));}
 }
}
async function worlds(){
 const result=await api('/worlds'),wrap=$('world-list');clear(wrap);
 state.worldCatalog=result.items;
 $('world-count').textContent=result.items.length+' миров';
 const sponsorChoose=$('sponsor-world');clear(sponsorChoose);
 for(const world of result.items){
  if(!state.me||world.owner===state.me.username)continue;
  const ownTarget=node('option',world.title+' / @'+world.owner);
  // The world list has public slugs; get the actual ID via authenticated endpoint
  // below to keep public API and reviewer contract separate.
  ownTarget.value=world.id;
  sponsorChoose.append(ownTarget);
 }
 const targetsExist=Boolean(sponsorChoose.options.length);
 $('sponsor-form').querySelector('button[type="submit"]').disabled=!targetsExist;

 const followInfo=state.me?await Promise.all(result.items.map(w=>api('/worlds/'+encodeURIComponent(w.slug)+'/followers'))):[];
 for(const [i,world] of result.items.entries()){
  const card=node('article','','world-card');
  card.append(node('span','WORLD / '+world.slug,'eyebrow'));
  if(world.hasCover){
   const artwork=node('img','','world-cover-art');
   artwork.src=coverUrl(world.slug);artwork.alt='Обложка мира '+world.title;
   artwork.loading='lazy';artwork.decoding='async';card.append(artwork);
  }
  card.append(node('h3',world.title),
   node('span','ТЕМА / '+(state.topicNames.get(world.category)||'Все темы'),'world-topic-label'));
  card.append(node('p',world.description||'Мир автора @'+world.owner));
  const stats=node('p',world.posts_count+' публикаций · '+world.followers_count+' подписчиков','world-stats');
  card.append(stats,node('small','Создан @'+world.owner));
  if(state.me&&world.owner!==state.me.username){
   const following=followInfo[i]?.followed===true;
   const btn=systemNode('button',following?'dynamic.world.following':'dynamic.world.follow',following?'✓ Подписан':'Подписаться',following?'ghost small following':'ghost small world-follow');
   btn.type='button';btn.setAttribute('aria-pressed',String(following));
   btn.addEventListener('click',()=>run(async()=>{
    await api('/worlds/'+encodeURIComponent(world.slug)+'/follow',following?'DELETE':'POST',{});
    await Promise.all([worlds(),onboarding()]);
   },following?localText('dynamic.world.unfollowedStatus','Подписка отменена'):localText('dynamic.world.followedStatus','Подписка сохранена')));
   card.append(btn);
   const block=node('button',localText('dynamic.world.block','Заблокировать @')+world.owner,'ghost small block-user');
    block.dataset.i18nDynamicPrefix='dynamic.world.block';block.dataset.i18nSuffix=world.owner;
   block.type='button';
   block.addEventListener('click',()=>run(async()=>{
    if(!confirm('Заблокировать @'+world.owner+'? Подписки, уведомления и рекламные договорённости между вами будут остановлены.'))return;
    await api('/users/'+encodeURIComponent(world.owner)+'/block','POST',{});
    await Promise.all([worlds(),feed(true),loadBlocks(),sponsors()]);
   },'Автор заблокирован'));
   card.append(block);
  }
  const open=node('a',localText('worlds.open','Открыть World ↗'),'world-open');
  open.dataset.i18nDynamic='worlds.open';
  const onServerWorldPage=/^\/w\/[a-z][a-z0-9_-]{2,39}$/.test(location.pathname);
  open.href=onServerWorldPage?'/w/'+encodeURIComponent(world.slug):'#world-'+encodeURIComponent(world.slug);
  open.addEventListener('click',event=>{
   if(onServerWorldPage)return; // Full navigation updates server-rendered title/OG metadata.
   event.preventDefault();
   const hash='#world-'+world.slug;
   if(location.hash===hash)run(()=>openWorld(world.slug));
   else location.hash=hash;
  });
  card.append(open);
  wrap.append(card);
 }
 if(!result.items.length)wrap.append(systemNode('p','dynamic.worlds.empty','Пока нет миров. Их создают приглашённые пользователи.'));
}
async function discover(query){
 const category=$('discover-category').value;
 const found=await api('/discover?q='+encodeURIComponent(query)+(category?'&category='+encodeURIComponent(category):''));
 const area=$('discover-results');clear(area);area.hidden=false;
 area.append(node('h3','Результаты поиска: '+found.query));
 for(const world of found.worlds){
  const btn=node('button',world.title+' / @'+world.owner+' · '+(state.topicNames.get(world.category)||'Все темы')+' · '+world.posts_count+' историй','ghost discover-hit');
  btn.type='button';btn.addEventListener('click',()=>{
   const hash='#world-'+world.slug;
   if(location.hash===hash)run(()=>openWorld(world.slug));
   else location.hash=hash;
  });area.append(btn);
 }
 for(const post of found.posts)area.append(postCard(post));
 await loadReactionSummaries(area);
 if(!found.worlds.length&&!found.posts.length)area.append(systemNode('p','dynamic.discover.empty','По этому запросу нет опубликованных материалов.'));
}
async function openWorld(slug){
 if(!/^[a-z][a-z0-9_-]{2,39}$/.test(slug))throw Error('Недопустимый адрес мира');
 const serial=++state.worldOpenSerial;
 const [detail,posts,approved]=await Promise.all([
  api('/worlds/'+encodeURIComponent(slug)),
  api('/worlds/'+encodeURIComponent(slug)+'/posts'),
  api('/sponsors/approved')
 ]);
 if(serial!==state.worldOpenSerial)return; // Ignore stale load after close or newer navigation.
 const world=detail.world;
 state.currentWorldSlug=slug;
 const panel=$('world-detail');
 const cover=$('world-detail-cover');
 cover.hidden=!world.hasCover;
 if(world.hasCover)cover.src=coverUrl(slug);
 else cover.removeAttribute('src');
 $('world-detail-title').textContent=world.title;
 $('world-detail-description').textContent=world.description||'Цифровой мир автора @'+world.owner;
 $('world-detail-meta').textContent='@'+world.owner+' · '+world.followers_count+' подписчиков · '+world.posts_count+' публикаций';
 $('world-cover-report-panel').hidden=!(state.me&&state.me.username!==world.owner&&world.hasCover);
 const list=$('world-detail-posts');clear(list);
 for(const item of posts.items)list.append(postCard(item));
 await loadReactionSummaries(list);
 if(!posts.items.length)list.append(systemNode('p','dynamic.stories.empty','Здесь пока нет опубликованных историй.','muted'));
 if(posts.nextCursor)list.append(systemNode('p','dynamic.stories.more','Показаны последние 20 историй.','muted'));
 const spons=$('world-detail-sponsor');clear(spons);
 for(const proposal of approved.items.filter(x=>x.world===slug)){
  const card=node('article','','sponsor-item');
  card.append(node('span',proposal.disclosure,'pilot-disclosure'));
  card.append(node('strong',proposal.brand_name));
  card.append(node('p',proposal.headline,'sponsor-headline'));
  const link=systemNode('a','dynamic.site.open','Открыть сайт ↗','sponsor-link');
  link.href=proposal.landing_url;link.rel='noopener noreferrer';link.target='_blank';
  card.append(link);spons.append(card);
 }
 panel.hidden=false;
 const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 panel.scrollIntoView({behavior:reduce?'instant':'smooth',block:'start'});
 $('world-detail-title').focus({preventScroll:true});
}
async function discussion(postId,region){
 const list=await api('/posts/'+postId+'/comments');
 clear(region);
 for(const item of list.items){
  const row=node('div','','comment-item');
  const author=node('a','@'+item.username);author.href='/u/'+encodeURIComponent(item.username);
  row.append(author,node('p',item.body,'comment-copy'));
  if(state.me&&item.username!==state.me.username){
   const report=systemNode('button','dynamic.report.button','Пожаловаться','ghost small');report.type='button';
   report.addEventListener('click',()=>{
    state.reportComment=item.id;state.reportPost=null;state.reportMessage=null;$('report-detail').required=false;
    $('report-dialog').showModal();
   });
   row.append(report);
  }
  if(state.me&&item.username===state.me.username){
   const remove=systemNode('button','dynamic.delete.button','Удалить','ghost small');remove.type='button';
   remove.addEventListener('click',()=>run(async()=>{
    await api('/comments/'+item.id,'DELETE',{});
    await discussion(postId,region);
   },'Комментарий удалён'));
   row.append(remove);
  }
  region.append(row);
 }
 if(!list.items.length)region.append(systemNode('p','dynamic.comments.empty','Будь первым участником обсуждения.','muted'));
 if(list.nextCursor)region.append(systemNode('p','dynamic.comments.more','Показаны последние 20 комментариев.','muted'));
 if(!state.me)return;
 const form=node('form','','comment-form');
 const label=systemNode('label','dynamic.comments.reply','Твой ответ'),input=node('textarea');
 input.name='body';input.maxLength=800;input.required=true;input.rows=2;
 input.placeholder=localText('dynamic.comments.placeholder','Ответить по существу, до 800 символов');input.dataset.i18nPlaceholder='dynamic.comments.placeholder';
 label.append(input);
 const sendBtn=systemNode('button','dynamic.comments.send','Отправить ответ','gold small');sendBtn.type='submit';
 form.append(label,sendBtn);region.append(form);
 form.addEventListener('submit',event=>{
  event.preventDefault();const entry=event.currentTarget;
  run(async()=>{
   await api('/posts/'+postId+'/comments','POST',{body:entry.elements.body.value});
   await Promise.all([discussion(postId,region),onboarding()]);
  },'Ответ опубликован');
 });
}
const reactionCatalog={like:['reaction.like','Нравится'],insightful:['reaction.insightful','Полезно'],support:['reaction.support','Поддерживаю'],celebrate:['reaction.celebrate','Поздравляю']};
function renderReactionSummary(wrapper,summary){
 if(!wrapper||!summary)return;
 for(const button of wrapper.querySelectorAll('[data-reaction]')){
  const kind=button.dataset.reaction,count=Number(summary.counts?.[kind]||0),[key,label]=reactionCatalog[kind];
  button.dataset.i18nDynamicPrefix=key;
  button.dataset.i18nSuffix=count?' · '+count:'';
  button.textContent=localText(key,label)+button.dataset.i18nSuffix;
  button.setAttribute('aria-pressed',String(summary.mine===kind));
  button.classList.toggle('is-selected',summary.mine===kind);
 }
}
async function loadReactionSummaries(container){
 const wrappers=[...(container.matches?.('.post-reactions[data-post-id]')?[container]:[]),...container.querySelectorAll('.post-reactions[data-post-id]')];
 if(!wrappers.length)return;
 const unique=[...new Set(wrappers.map(item=>Number(item.dataset.postId)))].slice(0,30);
 if(!unique.length)return;
 const result=await api('/posts/reactions?ids='+unique.join(','));
 const byId=new Map(result.items.map(item=>[Number(item.postId),item]));
 for(const wrapper of wrappers)renderReactionSummary(wrapper,byId.get(Number(wrapper.dataset.postId)));
}
function postCard(post,own=false){
 const card=node('article','','post');
 card.dataset.postId=String(post.id);
 const byline=node('span','','eyebrow');
 if(own)byline.textContent='МОЯ ЗАПИСЬ / '+post.status;
 else{
  const author=node('a','@'+post.username);author.href='/u/'+encodeURIComponent(post.username);
  byline.append(author,document.createTextNode(' / '+post.world));
 }
 card.append(byline);
 card.append(node('p',post.body,'post-body'));
 if(post.status==='published'||!own){
  const reactions=node('div','','post-reactions');reactions.dataset.postId=String(post.id);reactions.setAttribute('role','group');reactions.setAttribute('aria-label','Реакции на публикацию');
  for(const [kind,[key,label]] of Object.entries(reactionCatalog)){
   const button=systemNode('button',key,label,'reaction-button');button.type='button';button.dataset.reaction=kind;
   if(!state.me||post.username===state.me.username)button.disabled=true;
   button.setAttribute('aria-pressed','false');
   button.addEventListener('click',()=>run(async()=>{
    const selected=button.getAttribute('aria-pressed')==='true';
    if(selected)await api('/posts/'+post.id+'/reaction','DELETE',{});
    else await api('/posts/'+post.id+'/reaction','POST',{reaction:kind});
    await loadReactionSummaries(card);
   },'Реакция обновлена'));
   reactions.append(button);
  }
  card.append(reactions);
 }
 const actions=node('div','','post-actions');
 if(own){
  if(post.status!=='hidden'){
   const toggle=systemNode('button',post.status==='draft'?'dynamic.posts.publish':'dynamic.posts.unpublish',post.status==='draft'?'Опубликовать':'Снять с публикации','ghost small');
   toggle.type='button';toggle.addEventListener('click',()=>run(async()=>{
    await api('/posts/'+post.id,'PATCH',{status:post.status==='draft'?'published':'draft'});
    await Promise.all([myPosts(),feed(true)]);
   },'Статус записи изменён'));actions.append(toggle);
  }
  const remove=systemNode('button','dynamic.delete.button','Удалить','ghost small');remove.type='button';
  remove.addEventListener('click',()=>run(async()=>{
   if(!confirm('Удалить запись без возможности восстановления?'))return;
   await api('/posts/'+post.id,'DELETE',{});
   await Promise.all([myPosts(),feed(true)]);
  },'Действие обработано'));actions.append(remove);
 }else if(state.me&&post.username!==state.me.username){
  const report=systemNode('button','dynamic.report.button','Пожаловаться','ghost small');report.type='button';
  report.addEventListener('click',()=>{state.reportPost=post.id;state.reportComment=null;state.reportMessage=null;$('report-detail').required=false;$('report-dialog').showModal();});
  actions.append(report);
 }
 if(!own&&state.me){
  const postId=Number(post.id);
  const toggle=systemNode('button',state.savedIds.has(postId)?'dynamic.posts.saved':'dynamic.posts.save',state.savedIds.has(postId)?'Сохранено ✓':'Сохранить','ghost small saved-toggle');
  toggle.type='button';toggle.setAttribute('aria-pressed',String(state.savedIds.has(postId)));
  toggle.addEventListener('click',()=>run(async()=>{
   const wasSaved=state.savedIds.has(postId);
   await api('/posts/'+postId+'/save',wasSaved?'DELETE':'POST',{});
   if(wasSaved)state.savedIds.delete(postId);else state.savedIds.add(postId);
   toggle.dataset.i18nDynamic=wasSaved?'dynamic.posts.save':'dynamic.posts.saved';
    toggle.textContent=localText(toggle.dataset.i18nDynamic,wasSaved?'Сохранить':'Сохранено ✓');
   toggle.setAttribute('aria-pressed',String(!wasSaved));
   await Promise.all([saved(true),onboarding()]);
  },state.savedIds.has(postId)?'Сохранение обновлено':'Публикация добавлена в твою коллекцию'));
  actions.append(toggle);
 }
 card.append(actions);
 if(!own||post.status==='published'){
  const thread=node('details','','discussion'),commentCount=Number(post.comments_count||0),summary=node('summary',localText('dynamic.discussion.title','Обсуждение')+' · '+commentCount);
   summary.dataset.i18nDynamicPrefix='dynamic.discussion.title';summary.dataset.i18nSuffix=' · '+commentCount;
  const region=node('div','','comment-region');thread.append(summary,region);
  thread.addEventListener('toggle',()=>{if(thread.open)run(()=>discussion(post.id,region));});
  card.append(thread);
 }
 return card;
}
async function appeals(){
 if(!state.me)return;
 const data=await api('/me/moderation');
 const target=$('appeal-list'),history=$('appeal-history');clear(target);clear(history);
 for(const hidden of data.hidden){
  const entry=node('article','','appeal-item');
  entry.append(node('strong',(hidden.kind==='post'?'Запись':'Комментарий')+' #'+hidden.id));
  entry.append(node('p',hidden.body,'appeal-copy'));
  const latest=data.appeals.find(x=>hidden.kind==='post'?x.post_id===hidden.id:x.comment_id===hidden.id);
  if(latest?.status==='open'){
   entry.append(node('span','Апелляция в очереди независимой проверки','muted'));
  }else{
   const form=node('form','','appeal-form');
   const label=node('label','Почему материал следует восстановить?');
   const reason=node('textarea');reason.name='reason';reason.required=true;reason.minLength=12;reason.maxLength=1000;reason.rows=3;
   label.append(reason);
   const submit=node('button','Отправить апелляцию','ghost small');submit.type='submit';
   form.append(label,submit);
   form.addEventListener('submit',event=>{
    event.preventDefault();const text=reason.value;
    run(async()=>{await api('/appeals','POST',{kind:hidden.kind,subjectId:hidden.id,reason:text});await appeals();},'Апелляция отправлена');
   });
   entry.append(form);
  }
  target.append(entry);
 }
 if(!data.hidden.length)target.append(node('p','Скрытых материалов нет.','muted'));
 for(const item of data.appeals){
  const status={open:'На рассмотрении',upheld:'Решение о скрытии подтверждено',restored:'Материал восстановлен'}[item.status]||'Неизвестно';
  const entry=node('div','','appeal-record');
  entry.append(node('strong',status),node('p',item.reason),node('small',new Date(item.created_at).toLocaleString('ru-RU')));
  history.append(entry);
 }
 if(!data.appeals.length)history.append(systemNode('p','dynamic.appeals.empty','Обращений ещё не было.','muted'));
}
async function reviewAppeals(){
 if(!state.me||state.me.role!=='moderator')return;
 const [queue,log]=await Promise.all([api('/mod/appeals'),api('/mod/moderation-audit')]);
 const list=$('appeal-review-list'),audit=$('moderation-audit');clear(list);clear(audit);
 for(const appeal of queue.items){
  const item=node('article','','appeal-item');
  item.append(node('strong','@'+appeal.appellant+' · '+(appeal.post_id?'Запись':'Комментарий')+' #'+(appeal.post_id||appeal.comment_id)));
  item.append(node('p',appeal.subject_body,'appeal-copy'),node('p','Обоснование: '+appeal.reason));
  for(const [decision,label] of [['restored','Восстановить'],['upheld','Оставить скрытым']]){
   const btn=node('button',label,'ghost small');btn.type='button';
   btn.addEventListener('click',()=>run(async()=>{
    await api('/mod/appeals/'+appeal.id+'/resolve','POST',{decision});
    await Promise.all([reviewAppeals(),reports(),feed(true)]);
   },'Независимое решение сохранено'));
   item.append(btn);
  }
  list.append(item);
 }
 if(!queue.items.length)list.append(node('p','Ожидающих обращений нет.','muted'));
 for(const row of log.items.slice(0,20)){
  audit.append(node('p','@'+row.moderator+' · '+row.action+' · '+(row.post_id?'запись #'+row.post_id:'комментарий #'+row.comment_id),'audit-row'));
 }
 if(!log.items.length)audit.append(node('p','В журнале пока нет решений.','muted'));
}
async function activity(reset=true){
 if(!state.me)return;
 const params=new URLSearchParams();
 if(!reset&&state.activityCursor)params.set('cursor',state.activityCursor);
 const result=await api('/me/activity?'+params.toString());
 const target=$('activity-list');
 if(reset)clear(target);
 const labels={new_follow:'подписался на твой мир',post_comment:'прокомментировал твою запись',sponsor_proposal:'предложил тестовое размещение',sponsor_accepted:'принял предложение',sponsor_rejected:'отклонил предложение',sponsor_approved:'заявка прошла модерацию',sponsor_revoked:'отозвал рекламное согласие'};
 for(const event of result.items){
  const line=node('article','','activity-item');
  line.append(node('strong','@'+event.actor+' · '+(labels[event.kind]||'действие в мире')));
  if(event.world)line.append(node('span','World / '+event.world));
  line.append(node('small',new Date(event.created_at).toLocaleString('ru-RU')+(event.read_at?'':' · НОВОЕ')));
  target.append(line);
 }
 if(reset&&!result.items.length)target.append(systemNode('p','dynamic.activity.empty','Пока нет событий от других участников.','muted'));
 $('activity-count').textContent=result.unreadCount+' новых';
 state.activityCursor=result.nextCursor;
 $('activity-more').hidden=!state.activityCursor;
}
async function feed(reset=true){
 const params=new URLSearchParams({limit:'12'});
 if(!reset&&state.cursor)params.set('cursor',state.cursor);
 const result=await api((state.feedScope==='following'?'/feed/following?':'/posts?')+params.toString());
 const wrap=$('feed-list');if(reset)clear(wrap);
 for(const post of result.items)wrap.append(postCard(post));
 await loadReactionSummaries(wrap);
 state.cursor=result.nextCursor;
 $('more').hidden=!state.cursor;
 if(reset&&!result.items.length){
  const key=state.feedScope==='following'?'dynamic.feed.following.empty':'dynamic.feed.public.empty';
  const message=state.feedScope==='following'?'В подписках пока нет опубликованных записей. Подпишись на интересный World.':'Пока нет публичных публикаций. Создай первую запись в своём мире.';
  wrap.append(systemNode('p',key,message));
 }
}
async function myPosts(){
 const result=await api('/me/posts'),wrap=$('my-posts');clear(wrap);
 for(const post of result.items)wrap.append(postCard(post,true));
 await loadReactionSummaries(wrap);
 if(!result.items.length)wrap.append(systemNode('p','dynamic.drafts.empty','Черновиков пока нет.'));
}
async function sponsors(){
 const result=await api('/sponsors/approved');
 const panel=$('sponsor-showcase');clear(panel);
 if(!result.items.length){
  panel.append(systemNode('p','dynamic.sponsors.empty','Одобренных пилотных заявок нет. Показы рекламы и оплаты не ведутся.','muted'));
  return;
 }
 for(const proposal of result.items){
  const card=node('article','','sponsor-item');
  card.append(node('span',proposal.disclosure,'pilot-disclosure'));
  card.append(node('strong',proposal.brand_name));
  card.append(node('p',proposal.headline,'sponsor-headline'));
  card.append(node('small','Тема: '+proposal.world+' · без реальных платежей'));
  const link=systemNode('a','dynamic.sponsors.openBrand','Открыть сайт бренда ↗','sponsor-link');
  link.href=proposal.landing_url;
  link.target='_blank';link.rel='noopener noreferrer';
  card.append(link);panel.append(card);
 }
}
async function receivedSponsors(){
 if(!state.me)return;
 const data=await api('/me/received-sponsors');
 const panel=$('received-sponsors');clear(panel);
 for(const x of data.items){
  const card=node('article','','report sponsor-review');
  card.append(node('strong',x.brand_name+' → '+x.world));
  card.append(node('p',x.headline));
  card.append(node('small','Заявитель @'+x.applicant+' · '+x.landing_url));
  if(['pending_creator','pending_review','approved'].includes(x.status)){
   const withdraw=systemNode('button','dynamic.sponsors.withdrawConsent','Отозвать согласие','ghost small');withdraw.type='button';
   withdraw.addEventListener('click',()=>run(async()=>{
    await api('/sponsors/'+x.id+'/withdraw','POST',{});
    await Promise.all([receivedSponsors(),sponsors()]);
   },'Согласие отозвано'));
   card.append(withdraw);
  }
  if(x.status==='pending_creator')for(const [decision,label] of [['accept','Разрешить тестовый показ'],['reject','Отклонить предложение']]){
   const button=node('button',label,'ghost small');button.type='button';
   button.addEventListener('click',()=>run(async()=>{
    await api('/sponsors/'+x.id+'/creator-decision','POST',{decision});
    await receivedSponsors();
   },decision==='accept'?'Согласие сохранено, ожидает независимой проверки':'Предложение отклонено'));
   card.append(button);
  }
  panel.append(card);
 }
 if(!data.items.length)panel.append(systemNode('p','dynamic.sponsors.received.empty','Владельцам твоих миров заявок пока нет.','muted'));
}
async function mySponsors(){
 if(!state.me)return;
 const data=await api('/me/sponsors'),list=$('my-sponsors');clear(list);
 for(const x of data.items){
  const row=node('div','','sponsor-status');
  row.append(node('strong',x.brand_name+' · '+x.world),node('span','Статус: '+x.status));
  if(['pending_creator','pending_review','approved'].includes(x.status)){
   const withdraw=systemNode('button','dynamic.sponsors.withdrawRequest','Отозвать заявку','ghost small');withdraw.type='button';
   withdraw.addEventListener('click',()=>run(async()=>{
    await api('/sponsors/'+x.id+'/withdraw','POST',{});
    await Promise.all([mySponsors(),sponsors()]);
   },'Заявка отозвана'));
   row.append(withdraw);
  }
  list.append(row);
 }
 if(!data.items.length)list.append(systemNode('p','dynamic.sponsors.mine.empty','Заявок пока нет.','muted'));
}
async function reviewSponsors(){
 if(!state.me||state.me.role!=='moderator')return;
 const data=await api('/mod/sponsors'),panel=$('sponsor-review-list');clear(panel);
 for(const proposal of data.items){
  const card=node('article','','report sponsor-review');
  card.append(node('strong',proposal.brand_name+' · '+proposal.world),node('p',proposal.headline));
  const destination=node('p',proposal.landing_url,'muted');card.append(destination);
  card.append(node('small','Заявитель: @'+proposal.applicant+' · не проверена юридическая принадлежность бренда'));
  for(const [choice,title] of [['approved','Одобрить только тест'],['rejected','Отклонить']]){
   const button=node('button',title,'ghost small');button.type='button';
   button.addEventListener('click',()=>run(async()=>{
    await api('/mod/sponsors/'+proposal.id+'/review','POST',{decision:choice});
    await Promise.all([reviewSponsors(),sponsors()]);
   },choice==='approved'?'Тестовое размещение рассмотрено':'Заявка отклонена'));
   card.append(button);
  }
  panel.append(card);
 }
 if(!data.items.length)panel.append(systemNode('p','dynamic.sponsors.review.empty','Нет ожидающих заявок.','muted'));
}
async function reports(){
 if(!state.me||state.me.role!=='moderator')return;
 const result=await api('/mod/reports'),wrap=$('report-list');clear(wrap);
 for(const item of result.items){
  const row=node('article','','report');
  row.append(node('strong','Пост #'+item.post_id+' · '+item.reason),node('p',item.detail||'Без комментария'));
  const hide=systemNode('button','dynamic.moderation.hidePost','Скрыть запись','ghost small');hide.type='button';
  hide.addEventListener('click',()=>run(async()=>{
   await api('/mod/posts/'+item.post_id+'/hide','POST',{});
   await Promise.all([reports(),feed(true)]);
  },'Публикация скрыта'));row.append(hide);wrap.append(row);
 }
 if(!result.items.length)wrap.append(systemNode('p','dynamic.moderation.reports.empty','Новых жалоб нет.'));
 const commentData=await api('/mod/comment-reports');
 const commentPanel=$('comment-report-list');clear(commentPanel);
 for(const item of commentData.items){
  const row=node('article','','report');
  row.append(node('strong','Комментарий #'+item.comment_id+' · '+item.reason));
  row.append(node('p',item.body));
  const hide=systemNode('button','dynamic.moderation.hideComment','Скрыть оскорбительный комментарий','ghost small');
  hide.type='button';hide.addEventListener('click',()=>run(async()=>{
   await api('/mod/comments/'+item.comment_id+'/hide','POST',{});
   await Promise.all([reports(),feed(true)]);
  },'Комментарий скрыт'));
  row.append(hide);commentPanel.append(row);
 }
 if(!commentData.items.length)commentPanel.append(systemNode('p','dynamic.moderation.comments.empty','Нет новых жалоб на комментарии.','muted'));

}
async function messageReports(){
 if(!state.me||state.me.role!=='moderator')return;
 const result=await api('/mod/message-reports'),panel=$('message-report-list');clear(panel);
 for(const item of result.items){
  const card=node('article','','report');
  card.append(node('strong','Сообщение #'+item.message_id+' · '+item.reason),node('p',item.body),node('small',item.detail));
  const hide=node('button','Скрыть сообщение','ghost small');hide.type='button';
  hide.addEventListener('click',()=>run(async()=>{
   await api('/mod/messages/'+item.message_id+'/hide','POST',{});
   await messageReports();await loadConversations();
   if(state.currentConversationId)await openConversation(state.currentConversationId);
  },'Сообщение скрыто, решение сохранено в журнале'));
  card.append(hide);panel.append(card);
 }
 if(!result.items.length)panel.append(systemNode('p','messages.noReports','Нет новых жалоб на переписку.','muted'));
}
$('discover-form').addEventListener('submit',event=>{
 event.preventDefault();const form=event.currentTarget;
 run(()=>discover(form.elements.q.value.trim()),'Поиск завершён');
});
$('discover-clear').addEventListener('click',()=>{
 $('discover-form').reset();clear($('discover-results'));$('discover-results').hidden=true;
});
$('people-search-form').addEventListener('submit',event=>{
 event.preventDefault();run(()=>searchPeople(event.currentTarget.elements.q.value),'Поиск авторов завершён');
});
$('login-form').addEventListener('submit',event=>{
 event.preventDefault();const form=event.currentTarget;run(async()=>{
  const data=values(form);
  await api('/auth/login','POST',data);
  form.reset();await session();await Promise.all([worlds(),feed(true),sponsors()]);
 },'Вход выполнен');
});
$('register-form').addEventListener('submit',event=>{
 event.preventDefault();const form=event.currentTarget;run(async()=>{
  const data=values(form);await api('/auth/register','POST',data);
  $('login-form').elements.email.value=data.email;
  form.reset();await worlds();
 },'Локальный профиль создан. Теперь войдите.');
});
$('logout').addEventListener('click',()=>run(async()=>{
 await api('/auth/logout','POST',{});
 if(document.body.dataset.profilePage==='true'){location.reload();return;}
 await session();await Promise.all([worlds(),feed(true),sponsors()]);
},'Вы вышли.'));
$('world-settings-select').addEventListener('change',syncWorldSettings);
$('world-cover-select').addEventListener('change',syncCoverSettings);
$('world-cover-form').addEventListener('submit',event=>{
 event.preventDefault();
 const form=event.currentTarget,slug=form.elements.slug.value,file=form.elements.cover.files?.[0],rights=form.elements.rightsAttestation.checked;
 run(async()=>{
  const saved=await sendCover(slug,file,rights);
   if(saved.rightsDeclarationRecorded!==true)throw Error('Сервер не подтвердил заявление о правах');
  form.elements.cover.value='';form.elements.rightsAttestation.checked=false;
  await session();await worlds();
  $('world-cover-select').value=slug;syncCoverSettings();
  $('world-cover-status').textContent='PNG принят · '+saved.width+' × '+saved.height+' px · метаданные удалены · ожидает модерации';
 },'Обложка отправлена на независимую проверку');
});
$('world-cover-report-form').addEventListener('submit',event=>{
 event.preventDefault();const form=event.currentTarget;
 run(async()=>{
  const slug=state.currentWorldSlug;
  if(!slug)throw Error('Выбери публичный World');
  await api('/worlds/'+encodeURIComponent(slug)+'/cover/report','POST',values(form));
  form.reset();await loadCoverReports();$('world-cover-report-panel').open=false;
 },'Жалоба на изображение передана независимому модератору');
});
$('world-cover-appeal-form').addEventListener('submit',event=>{
 event.preventDefault();
 const form=event.currentTarget,slug=$('world-cover-select').value,reason=form.elements.reason.value;
 run(async()=>{
  await api('/me/cover-appeals','POST',{slug,reason});
  form.reset();await loadCoverAppeals();
 },'Апелляция отправлена другому независимому модератору');
});
$('world-cover-delete').addEventListener('click',()=>run(async()=>{
 const slug=$('world-cover-select').value;
 if(!slug||!confirm('Удалить обложку этого World?'))return;
 await api('/worlds/'+encodeURIComponent(slug)+'/cover','DELETE',{});
 await session();await worlds();
 $('world-cover-select').value=slug;syncCoverSettings();
},'Обложка удалена'));
$('world-settings-form').addEventListener('submit',event=>{
 event.preventDefault();const form=event.currentTarget;
 const {slug,title,description,category,visibility}=values(form);
 run(async()=>{
  await api('/worlds/'+encodeURIComponent(slug),'PATCH',{title,description,category,visibility});
  await session();await worlds();
 },'Оформление мира сохранено — данные видны посетителям.');
});
$('profile-edit-form').addEventListener('submit',event=>{
 event.preventDefault();const form=event.currentTarget;
 run(async()=>{
  const data=values(form);data.interests=data.interests.split(',').map(value=>value.trim()).filter(Boolean);
  await api('/me/profile','PATCH',data);
  await loadOwnProfile();
 },localText('profile.saveDone','Профиль сохранён.'));
});
$('public-profile-follow').addEventListener('click',()=>run(updatePublicFollow));
$('user-following-refresh').addEventListener('click',()=>run(loadUserFollowing));
$('user-follow-requests-refresh').addEventListener('click',()=>run(loadFollowRequests));
$('world-form').addEventListener('submit',event=>{
 event.preventDefault();const form=event.currentTarget;run(async()=>{
  await api('/worlds','POST',values(form));
  form.reset();await session();await worlds();
 },'Новый мир создан');
});
$('post-form').addEventListener('submit',event=>{
 event.preventDefault();const form=event.currentTarget;
 const data=values(form),submit=event.submitter;
 data.status=submit?.value==='published'?'published':'draft';
 run(async()=>{
  await api('/posts','POST',data);form.elements.body.value='';
  await Promise.all([myPosts(),feed(true),onboarding()]);
 },data.status==='published'?'Запись опубликована':'Черновик сохранён');
});
$('report-form').addEventListener('submit',event=>{
 event.preventDefault();const form=event.currentTarget;run(async()=>{
  if(state.reportMessage){
   await api('/messages/'+state.reportMessage+'/report','POST',values(form));
  }else if(state.reportComment){
   await api('/comments/'+state.reportComment+'/report','POST',{reason:values(form).reason});
  }else{
   await api('/reports','POST',{...values(form),postId:state.reportPost});
  }
  $('report-dialog').close();form.reset();form.elements.detail.required=false;state.reportPost=null;state.reportComment=null;state.reportMessage=null;
 },'Жалоба отправлена модератору');
});
$('report-cancel').addEventListener('click',()=>{state.reportPost=null;state.reportComment=null;state.reportMessage=null;$('report-detail').required=false;$('report-dialog').close();});
$('delete-form').addEventListener('submit',event=>{
 event.preventDefault();const form=event.currentTarget;run(async()=>{
  await api('/account','DELETE',values(form));
  form.reset();await session();await worlds();await feed(true);
 },'Все данные локального аккаунта удалены');
});
$('sponsor-form').addEventListener('submit',event=>{
 event.preventDefault();const form=event.currentTarget;
 run(async()=>{
  await api('/sponsors/proposals','POST',values(form));
  form.reset();await mySponsors();
 },'Заявка получена: только ручная проверка, без платежей и размещений');
});
$('saved-more').addEventListener('click',()=>run(()=>saved(false)));
$('blocks-refresh').addEventListener('click',()=>run(loadBlocks,'Список блокировок обновлён'));
$('notification-settings-form').addEventListener('submit',event=>{
 event.preventDefault();const form=event.currentTarget;
 const settings=Object.fromEntries(['follows','comments','sponsorships'].map(k=>[k,form.elements[k].checked]));
 run(async()=>{
  await api('/me/notification-settings','PATCH',settings);
  await Promise.all([loadNotificationSettings(),activity(true)]);
 },'Предпочтения уведомлений сохранены');
});
$('security-refresh').addEventListener('click',()=>run(loadSecurity,'Состояние входов обновлено'));
$('security-revoke-form').addEventListener('submit',event=>{
 event.preventDefault();
 const form=event.currentTarget;
 run(async()=>{
  await api('/me/security/revoke-others','POST',values(form));
  form.reset();await loadSecurity();
 },'Остальные сессии завершены');
});
$('security-password-form').addEventListener('submit',event=>{
 event.preventDefault();const form=event.currentTarget;
 run(async()=>{
  await api('/me/security/change-password','POST',values(form));
  form.reset();await session();
  await Promise.all([worlds(),feed(true),sponsors()]);
 },'Пароль обновлён. Все сессии завершены — войди с новым паролем.');
});
$('account-export').addEventListener('click',()=>run(async()=>{
 const data=await api('/account/export');
 const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
 const uri=URL.createObjectURL(blob);
 const link=node('a');link.href=uri;
 link.download='marcosa-account-'+new Date().toISOString().slice(0,10)+'.json';
 document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(uri),1500);
},'Экспорт подготовлен: храните файл в защищённом месте'));
$('world-share').addEventListener('click',()=>run(async()=>{
 const slug=state.currentWorldSlug;
 if(!slug)throw Error('Сначала открой мир для публикации ссылки');
 const link=location.origin+'/w/'+encodeURIComponent(slug);
 try{
  await navigator.clipboard.writeText(link);
  notice('Постоянная ссылка на World скопирована');
 }catch{
  notice('Ссылка на твой World: '+link);
 }
}));
function closeWorldAndRestoreFocus(){
 ++state.worldOpenSerial; // Cancel late API responses before moving keyboard focus.
 const previousSlug=state.currentWorldSlug;
 $('world-detail').hidden=true;state.currentWorldSlug=null;
 const opener=Array.from(document.querySelectorAll('#world-list .world-open'))
  .find(link=>['#world-'+encodeURIComponent(previousSlug||''),'/w/'+encodeURIComponent(previousSlug||'')].includes(link.getAttribute('href')));
 (opener||$('worlds')).focus({preventScroll:true});
}
$('world-close').addEventListener('click',()=>{
 // Leave a server-rendered World without re-opening it on reload.
 if(/^\/w\/[a-z][a-z0-9_-]{2,39}$/.test(location.pathname))
  history.replaceState(null,'','/#worlds');
 else if(location.hash!=='#worlds')history.replaceState(null,'','#worlds');
 closeWorldAndRestoreFocus();
});
window.addEventListener('hashchange',()=>{
 const requested=location.hash.startsWith('#world-')?decodeURIComponent(location.hash.slice(7)):'';
 if(requested)run(()=>openWorld(requested));
 else if(!$('world-detail').hidden){
  if(/^\/w\/[a-z][a-z0-9_-]{2,39}$/.test(location.pathname))
   history.replaceState(null,'','/#worlds');
  closeWorldAndRestoreFocus();
 }else ++state.worldOpenSerial;
});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&!$('world-detail').hidden
    &&$('world-detail').contains(document.activeElement)
    &&!$('report-dialog')?.open){
  event.preventDefault();$('world-close').click();
 }
});
for(const [id,scope] of [['feed-all','all'],['feed-following','following']]){
 $(id).addEventListener('click',()=>run(async()=>{
  if(scope==='following'&&!state.me)throw Error('Сначала войди в аккаунт');
  state.feedScope=scope;
  $('feed-all').setAttribute('aria-pressed',String(scope==='all'));
  $('feed-following').setAttribute('aria-pressed',String(scope==='following'));
  await feed(true);
 }));
}
$('insights-refresh').addEventListener('click',()=>run(()=>loadInsights(),'Статистика обновлена'));
$('activity-read').addEventListener('click',()=>run(async()=>{await api('/me/activity/read','POST',{});await activity(true);},'События отмечены прочитанными'));
$('activity-more').addEventListener('click',()=>run(()=>activity(false)));
$('messages-refresh').addEventListener('click',()=>run(loadConversations,'Список бесед обновлён'));
$('direct-message-form').addEventListener('submit',event=>{
 event.preventDefault();const form=event.currentTarget;
 run(async()=>{
  const result=await api('/conversations','POST',{kind:'direct',username:form.elements.username.value.trim()});
  form.reset();await loadConversations();await openConversation(result.id);
 },'Запрос на переписку готов');
});
$('group-message-form').addEventListener('submit',event=>{
 event.preventDefault();const form=event.currentTarget;
 run(async()=>{
  const participants=form.elements.participants.value.split(',').map(value=>value.trim()).filter(Boolean);
  const result=await api('/conversations','POST',{kind:'group',title:form.elements.title.value.trim(),participants});
  form.reset();await loadConversations();await openConversation(result.id);
 },'Групповая беседа создана');
});
$('message-send-form').addEventListener('submit',event=>{
 event.preventDefault();const form=event.currentTarget;
 run(async()=>{
  if(!state.currentConversationId)throw Error('Сначала выбери беседу');
  await api('/conversations/'+encodeURIComponent(state.currentConversationId)+'/messages','POST',{body:form.elements.body.value});
  form.reset();await loadConversations();await openConversation(state.currentConversationId);
 },'Сообщение добавлено');
});
$('message-more').addEventListener('click',()=>run(async()=>{
 if(!state.currentConversationId||!state.messageCursor)return;
 await openConversation(state.currentConversationId,{cursor:state.messageCursor,older:true});
}));
$('message-accept').addEventListener('click',()=>run(async()=>{
 if(!state.currentConversationId)throw Error('Запрос больше не выбран');
 await api('/conversations/'+encodeURIComponent(state.currentConversationId)+'/accept','POST',{});
 await loadConversations();await openConversation(state.currentConversationId);
},'Запрос принят'));
$('message-decline').addEventListener('click',()=>run(async()=>{
 if(!state.currentConversationId)throw Error('Запрос больше не выбран');
 await api('/conversations/'+encodeURIComponent(state.currentConversationId)+'/decline','POST',{});
 resetMessageSurface();await loadConversations();
},'Запрос отклонён, его первое сообщение удалено'));
$('refresh').addEventListener('click',()=>run(()=>feed(true),'Лента обновлена'));
$('more').addEventListener('click',()=>run(()=>feed(false)));
$('issue-invite-form').addEventListener('submit',event=>{
 event.preventDefault();const form=event.currentTarget;
 run(async()=>{
  clearIssuedInvite();
  const data=values(form);data.expiresHours=Number(data.expiresHours);
  const result=await api('/mod/invites','POST',data);
  $('issued-invite-code').textContent=result.code;
  $('issued-invite-result').hidden=false;
  await pilotInvites();
 },'Одноразовый код создан. Он показан только сейчас.');
});
$('invite-clear').addEventListener('click',clearIssuedInvite);
$('invite-refresh').addEventListener('click',()=>run(pilotInvites,'Список приглашений обновлён'));
$('pilot-metrics-refresh').addEventListener('click',()=>run(pilotMetrics,'Показатели пересчитаны из базы'));
$('mod-queue-health-refresh').addEventListener('click',()=>run(moderatorQueueHealth,'Реальные очереди пересчитаны из SQLite'));
$('mod-readiness-refresh').addEventListener('click',()=>run(operatorReadiness));
$('retention-enable').addEventListener('click',()=>run(async()=>{
 await api('/me/retention-consent','POST',{consent:true});await loadRetentionConsent();
},'Согласие сохранено. До этого дня посещения не учитывались.'));
$('retention-disable').addEventListener('click',()=>run(async()=>{
 await api('/me/retention-consent','DELETE',{});await loadRetentionConsent();
},'Согласие отозвано, история учёта входов удалена.'));
$('mod-cover-refresh').addEventListener('click',()=>run(reviewCovers,'Очередь проверки изображений обновлена'));
$('mod-cover-appeals-refresh').addEventListener('click',()=>run(reviewCoverAppeals,'Очередь апелляций обновлена'));
$('mod-cover-reports-refresh').addEventListener('click',()=>run(reviewCoverReports,'Очередь жалоб на изображения обновлена'));
$('reload-reports').addEventListener('click',()=>run(async()=>{await Promise.all([reports(),reviewAppeals(),pilotInvites(),reviewCovers(),reviewCoverAppeals(),reviewCoverReports(),moderatorQueueHealth()]);}));
window.addEventListener('marcosa:locale-change',()=>{
 // Locale changes update application-owned controls only; never translate user data.
 if(!state.me)$('identity').textContent=localText('auth.guest','Гость');
 const knownReady=[
  'Локальный сервер готов. Данные настоящие, но изолированы от production.',
  'Local server ready. Data is real but isolated from production.'
 ];
 if(knownReady.includes($('notice').textContent))notice(localText('notice.ready',knownReady[0]));
 for(const el of document.querySelectorAll('[data-i18n-dynamic]')){
  el.textContent=localText(el.dataset.i18nDynamic,el.textContent);
 }
 for(const el of document.querySelectorAll('[data-i18n-dynamic-prefix]')){
  el.textContent=localText(el.dataset.i18nDynamicPrefix,'')+el.dataset.i18nSuffix;
 }
 for(const el of document.querySelectorAll('[data-i18n-placeholder]')){
  el.placeholder=localText(el.dataset.i18nPlaceholder,el.placeholder);
 }
 for(const el of document.querySelectorAll('option[data-locale-topic]')){
  el.textContent=localText('topics.'+el.dataset.localeTopic,el.textContent);
 }
 if(state.me){
  $('message-send-body').placeholder=localText('messages.sendPlaceholder','Напиши сообщение участникам беседы');
  const selected=state.currentConversationId;
  loadConversations().then(()=>selected?openConversation(selected):undefined).catch(()=>{});
 }
 if(state.me?.role==='moderator')pilotMetrics().catch(()=>{});
});
document.querySelector('.skip-navigation').addEventListener('click',()=>$('main-content').focus({preventScroll:true}));
if(document.body.dataset.profilePage==='true'){
 api('/auth/me').then(result=>{state.me=result.user;$('identity').textContent='@'+state.me.username;$('logout').hidden=false;})
  .catch(()=>{state.me=null;}).then(()=>loadPublicProfile()).catch(e=>notice(e.message));
}else Promise.all([loadTopics(),refreshIncidentBanner()]).then(()=>session()).then(()=>Promise.all([worlds(),feed(true),sponsors()]))
 .then(()=>{
  notice(localText('notice.ready','Локальный сервер готов. Данные настоящие, но изолированы от production.'));
  const route=location.pathname.match(/^\/w\/([a-z][a-z0-9_-]{2,39})$/);
  const requested=location.hash.startsWith('#world-')?decodeURIComponent(location.hash.slice(7)):(route?.[1]||'');
  if(requested)run(()=>openWorld(requested));
 })
 .catch(e=>notice(e.message));
})();
