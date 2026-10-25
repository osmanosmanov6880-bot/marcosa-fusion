/* MARCOSA R28 — all dynamic text uses textContent, never HTML parsing. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const state={me:null,worlds:[],worldCatalog:[],currentWorldSlug:null,topicNames:new Map(),cursor:null,feedScope:'all',activityCursor:null,savedCursor:null,savedIds:new Set(),reportPost:null,reportComment:null};
const notice=message=>{$('notice').textContent=message;};
async function api(path,method='GET',data){
 const config={method,credentials:'same-origin',headers:{}};
 if(data!==undefined){config.headers['Content-Type']='application/json';config.body=JSON.stringify(data);}
 const res=await fetch('/api'+path,config);
 let result;try{result=await res.json();}catch{throw Error('Некорректный ответ сервера');}
 if(!res.ok)throw Error(result.error||'Сервер недоступен');
 return result;
}
const node=(tag,text='',cls='')=>{
 const el=document.createElement(tag);
 if(cls)el.className=cls;
 el.textContent=String(text);return el;
};
const clear=element=>element.replaceChildren();
const values=form=>Object.fromEntries(new FormData(form).entries());
const coverUrl=slug=>'/api/worlds/'+encodeURIComponent(slug)+'/cover';
const privateCoverUrl=slug=>'/api/me/worlds/'+encodeURIComponent(slug)+'/cover';
async function sendCover(slug,file){
 if(!file||file.type!=='image/png'||file.size<57||file.size>786432)
  throw Error('Выбери PNG до 768 KiB, без анимации');
 const response=await fetch(coverUrl(slug),{method:'POST',credentials:'same-origin',
  headers:{'Content-Type':'image/png'},body:file});
 let data;try{data=await response.json();}catch{throw Error('Не удалось получить ответ о загрузке');}
 if(!response.ok)throw Error(data.error||'Обложка не принята');
 return data;
}
async function run(action,success){
 try{await action();if(success)notice(success);}
 catch(error){notice(error.message||'Не удалось выполнить действие');}
}
async function loadTopics(){
 const data=await api('/world-topics');
 state.topicNames=new Map(data.items.map(item=>[item.id,item.title]));
 for(const [id,withAll] of [['world-edit-category',false],['world-new-category',false],['discover-category',true]]){
  const picker=$(id);clear(picker);
  if(withAll){const all=node('option','Все тематики');all.value='';picker.append(all);}
  for(const item of data.items){
   const option=node('option',item.title);option.value=item.id;picker.append(option);
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
async function pilotMetrics(){
 if(!state.me||state.me.role!=='moderator')return;
 const report=await api('/mod/pilot-metrics');
 const list=$('pilot-metrics-data');clear(list);
 const entries=[
  ['Аккаунтов участников',report.members],
  ['Регистраций по одноразовым кодам',report.invitedMembers],
  ['Авторов с опубликованной историей',report.publishedCreators],
  ['Из приглашённых стали авторами',report.invitedCreatorsPublished],
  ['Публичных миров с контентом',report.publicWorlds],
  ['Ответов другим авторам',report.repliesToOtherAuthors],
  ['Подписок на миры',report.followEdges],
  ['Сохранённых публикаций',report.savedReferences],
  ['Выдано приглашений',report.invitations.issued],
  ['Погашено приглашений',report.invitations.redeemed]
 ];
 for(const [label,count] of entries){
  const card=node('div','','pilot-metric');
  card.append(node('strong',String(count)),node('span',label));
  list.append(card);
 }
 const activation=report.invitedCreatorActivationRate===null?'нет приглашённых':
  Math.round(report.invitedCreatorActivationRate*100)+'% ('+report.invitedCreatorsPublished+'/'+report.invitedMembers+')';
 list.append(node('p','Активация приглашённых авторов: '+activation,'pilot-metrics-note'));
 list.append(node('p','D7/D30: не измерены · Рекламные показы и выручка: не измерены','pilot-metrics-note'));
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
 if(!result.items.length)list.append(node('p','Одноразовых приглашений ещё не было.','muted'));
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
 if(reset&&!result.items.length)list.append(node('p','В коллекции пока нет доступных публикаций.','muted'));
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
 if(!data.items.length)list.append(node('p','Ты пока никого не блокировал.','muted'));
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
 $('identity').textContent=state.me?'@'+state.me.username:'Гость';
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
  clear($('world-cover-appeals-list'));clear($('mod-cover-appeals-list'));
  $('world-cover-appeal-form').reset();$('world-cover-appeal-form').hidden=true;
  clear($('onboarding-steps'));$('onboarding-progress').value=0;
  $('onboarding-counter').textContent='0 из 5 шагов';
  $('notification-settings-form').reset();
  $('notification-settings-status').textContent='Настройки доступны после входа';
  clear($('blocked-users-list'));
  clear($('saved-list'));$('saved-more').hidden=true;
  state.savedCursor=null;state.savedIds=new Set();
  clear($('creator-insights-list'));
  state.feedScope='all';state.activityCursor=null;
  $('feed-all').setAttribute('aria-pressed','true');
  $('feed-following').setAttribute('aria-pressed','false');
  clear($('activity-list'));$('activity-count').textContent='0 новых';
 }
 $('activity-panel').hidden=!state.me;
 $('guest-access').hidden=Boolean(state.me);
 $('member-access').hidden=!state.me;
 $('composer-panel').hidden=!state.me;
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
  await Promise.all([myPosts(),mySponsors(),receivedSponsors(),activity(true),appeals(),loadInsights(),loadSecurity(),loadNotificationSettings(),loadBlocks(),saved(true),onboarding(),loadCoverAppeals()]);
  if(state.me.role==='moderator')await Promise.all([reports(),reviewSponsors(),reviewAppeals(),pilotInvites(),pilotMetrics(),reviewCovers(),reviewCoverAppeals()]);
  else {clearIssuedInvite();clear($('invite-list'));clear($('pilot-metrics-data'));clear($('mod-cover-list'));}
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
   const btn=node('button',following?'✓ Подписан':'Подписаться',following?'ghost small following':'ghost small world-follow');
   btn.type='button';btn.setAttribute('aria-pressed',String(following));
   btn.addEventListener('click',()=>run(async()=>{
    await api('/worlds/'+encodeURIComponent(world.slug)+'/follow',following?'DELETE':'POST',{});
    await Promise.all([worlds(),onboarding()]);
   },following?'Подписка отменена':'Подписка сохранена'));
   card.append(btn);
   const block=node('button','Заблокировать @'+world.owner,'ghost small block-user');
   block.type='button';
   block.addEventListener('click',()=>run(async()=>{
    if(!confirm('Заблокировать @'+world.owner+'? Подписки, уведомления и рекламные договорённости между вами будут остановлены.'))return;
    await api('/users/'+encodeURIComponent(world.owner)+'/block','POST',{});
    await Promise.all([worlds(),feed(true),loadBlocks(),sponsors()]);
   },'Автор заблокирован'));
   card.append(block);
  }
  const open=node('a','Открыть World ↗','world-open');
  open.href='#world-'+encodeURIComponent(world.slug);
  open.addEventListener('click',event=>{
   event.preventDefault();
   const hash='#world-'+world.slug;
   if(location.hash===hash)run(()=>openWorld(world.slug));
   else location.hash=hash;
  });
  card.append(open);
  wrap.append(card);
 }
 if(!result.items.length)wrap.append(node('p','Пока нет миров. Их создают приглашённые пользователи.'));
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
 if(!found.worlds.length&&!found.posts.length)area.append(node('p','По этому запросу нет опубликованных материалов.'));
}
async function openWorld(slug){
 if(!/^[a-z][a-z0-9-]{2,39}$/.test(slug))throw Error('Недопустимый адрес мира');
 const [detail,posts,approved]=await Promise.all([
  api('/worlds/'+encodeURIComponent(slug)),
  api('/worlds/'+encodeURIComponent(slug)+'/posts'),
  api('/sponsors/approved')
 ]);
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
 const list=$('world-detail-posts');clear(list);
 for(const item of posts.items)list.append(postCard(item));
 if(!posts.items.length)list.append(node('p','Здесь пока нет опубликованных историй.','muted'));
 if(posts.nextCursor)list.append(node('p','Показаны последние 20 историй.','muted'));
 const spons=$('world-detail-sponsor');clear(spons);
 for(const proposal of approved.items.filter(x=>x.world===slug)){
  const card=node('article','','sponsor-item');
  card.append(node('span',proposal.disclosure,'pilot-disclosure'));
  card.append(node('strong',proposal.brand_name));
  card.append(node('p',proposal.headline,'sponsor-headline'));
  const link=node('a','Открыть сайт ↗','sponsor-link');
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
  row.append(node('strong','@'+item.username),node('p',item.body,'comment-copy'));
  if(state.me&&item.username!==state.me.username){
   const report=node('button','Пожаловаться','ghost small');report.type='button';
   report.addEventListener('click',()=>{
    state.reportComment=item.id;state.reportPost=null;
    $('report-dialog').showModal();
   });
   row.append(report);
  }
  if(state.me&&item.username===state.me.username){
   const remove=node('button','Удалить','ghost small');remove.type='button';
   remove.addEventListener('click',()=>run(async()=>{
    await api('/comments/'+item.id,'DELETE',{});
    await discussion(postId,region);
   },'Комментарий удалён'));
   row.append(remove);
  }
  region.append(row);
 }
 if(!list.items.length)region.append(node('p','Будь первым участником обсуждения.','muted'));
 if(list.nextCursor)region.append(node('p','Показаны последние 20 комментариев.','muted'));
 if(!state.me)return;
 const form=node('form','','comment-form');
 const label=node('label','Твой ответ'),input=node('textarea');
 input.name='body';input.maxLength=800;input.required=true;input.rows=2;
 input.placeholder='Ответить по существу, до 800 символов';
 label.append(input);
 const sendBtn=node('button','Отправить ответ','gold small');sendBtn.type='submit';
 form.append(label,sendBtn);region.append(form);
 form.addEventListener('submit',event=>{
  event.preventDefault();const entry=event.currentTarget;
  run(async()=>{
   await api('/posts/'+postId+'/comments','POST',{body:entry.elements.body.value});
   await Promise.all([discussion(postId,region),onboarding()]);
  },'Ответ опубликован');
 });
}
function postCard(post,own=false){
 const card=node('article','','post');
 card.append(node('span',own?'МОЯ ЗАПИСЬ / '+post.status:'@'+post.username+' / '+post.world,'eyebrow'));
 card.append(node('p',post.body,'post-body'));
 const actions=node('div','','post-actions');
 if(own){
  if(post.status!=='hidden'){
   const toggle=node('button',post.status==='draft'?'Опубликовать':'Снять с публикации','ghost small');
   toggle.type='button';toggle.addEventListener('click',()=>run(async()=>{
    await api('/posts/'+post.id,'PATCH',{status:post.status==='draft'?'published':'draft'});
    await Promise.all([myPosts(),feed(true)]);
   },'Статус записи изменён'));actions.append(toggle);
  }
  const remove=node('button','Удалить','ghost small');remove.type='button';
  remove.addEventListener('click',()=>run(async()=>{
   if(!confirm('Удалить запись без возможности восстановления?'))return;
   await api('/posts/'+post.id,'DELETE',{});
   await Promise.all([myPosts(),feed(true)]);
  },'Действие обработано'));actions.append(remove);
 }else if(state.me&&post.username!==state.me.username){
  const report=node('button','Пожаловаться','ghost small');report.type='button';
  report.addEventListener('click',()=>{state.reportPost=post.id;state.reportComment=null;$('report-dialog').showModal();});
  actions.append(report);
 }
 if(!own&&state.me){
  const postId=Number(post.id);
  const toggle=node('button',state.savedIds.has(postId)?'Сохранено ✓':'Сохранить','ghost small saved-toggle');
  toggle.type='button';toggle.setAttribute('aria-pressed',String(state.savedIds.has(postId)));
  toggle.addEventListener('click',()=>run(async()=>{
   const wasSaved=state.savedIds.has(postId);
   await api('/posts/'+postId+'/save',wasSaved?'DELETE':'POST',{});
   if(wasSaved)state.savedIds.delete(postId);else state.savedIds.add(postId);
   toggle.textContent=wasSaved?'Сохранить':'Сохранено ✓';
   toggle.setAttribute('aria-pressed',String(!wasSaved));
   await Promise.all([saved(true),onboarding()]);
  },state.savedIds.has(postId)?'Сохранение обновлено':'Публикация добавлена в твою коллекцию'));
  actions.append(toggle);
 }
 card.append(actions);
 if(!own||post.status==='published'){
  const thread=node('details','','discussion'),summary=node('summary','Обсуждение · '+Number(post.comments_count||0));
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
 if(!data.appeals.length)history.append(node('p','Обращений ещё не было.','muted'));
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
 if(reset&&!result.items.length)target.append(node('p','Пока нет событий от других участников.','muted'));
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
 state.cursor=result.nextCursor;
 $('more').hidden=!state.cursor;
 if(reset&&!result.items.length)wrap.append(node('p',state.feedScope==='following'?'В подписках пока нет опубликованных записей. Подпишись на интересный World.':'Пока нет публичных публикаций. Создай первую запись в своём мире.'));
}
async function myPosts(){
 const result=await api('/me/posts'),wrap=$('my-posts');clear(wrap);
 for(const post of result.items)wrap.append(postCard(post,true));
 if(!result.items.length)wrap.append(node('p','Черновиков пока нет.'));
}
async function sponsors(){
 const result=await api('/sponsors/approved');
 const panel=$('sponsor-showcase');clear(panel);
 if(!result.items.length){
  panel.append(node('p','Одобренных пилотных заявок нет. Показы рекламы и оплаты не ведутся.','muted'));
  return;
 }
 for(const proposal of result.items){
  const card=node('article','','sponsor-item');
  card.append(node('span',proposal.disclosure,'pilot-disclosure'));
  card.append(node('strong',proposal.brand_name));
  card.append(node('p',proposal.headline,'sponsor-headline'));
  card.append(node('small','Тема: '+proposal.world+' · без реальных платежей'));
  const link=node('a','Открыть сайт бренда ↗','sponsor-link');
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
   const withdraw=node('button','Отозвать согласие','ghost small');withdraw.type='button';
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
 if(!data.items.length)panel.append(node('p','Владельцам твоих миров заявок пока нет.','muted'));
}
async function mySponsors(){
 if(!state.me)return;
 const data=await api('/me/sponsors'),list=$('my-sponsors');clear(list);
 for(const x of data.items){
  const row=node('div','','sponsor-status');
  row.append(node('strong',x.brand_name+' · '+x.world),node('span','Статус: '+x.status));
  if(['pending_creator','pending_review','approved'].includes(x.status)){
   const withdraw=node('button','Отозвать заявку','ghost small');withdraw.type='button';
   withdraw.addEventListener('click',()=>run(async()=>{
    await api('/sponsors/'+x.id+'/withdraw','POST',{});
    await Promise.all([mySponsors(),sponsors()]);
   },'Заявка отозвана'));
   row.append(withdraw);
  }
  list.append(row);
 }
 if(!data.items.length)list.append(node('p','Заявок пока нет.','muted'));
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
 if(!data.items.length)panel.append(node('p','Нет ожидающих заявок.','muted'));
}
async function reports(){
 if(!state.me||state.me.role!=='moderator')return;
 const result=await api('/mod/reports'),wrap=$('report-list');clear(wrap);
 for(const item of result.items){
  const row=node('article','','report');
  row.append(node('strong','Пост #'+item.post_id+' · '+item.reason),node('p',item.detail||'Без комментария'));
  const hide=node('button','Скрыть запись','ghost small');hide.type='button';
  hide.addEventListener('click',()=>run(async()=>{
   await api('/mod/posts/'+item.post_id+'/hide','POST',{});
   await Promise.all([reports(),feed(true)]);
  },'Публикация скрыта'));row.append(hide);wrap.append(row);
 }
 if(!result.items.length)wrap.append(node('p','Новых жалоб нет.'));
 const commentData=await api('/mod/comment-reports');
 const commentPanel=$('comment-report-list');clear(commentPanel);
 for(const item of commentData.items){
  const row=node('article','','report');
  row.append(node('strong','Комментарий #'+item.comment_id+' · '+item.reason));
  row.append(node('p',item.body));
  const hide=node('button','Скрыть оскорбительный комментарий','ghost small');
  hide.type='button';hide.addEventListener('click',()=>run(async()=>{
   await api('/mod/comments/'+item.comment_id+'/hide','POST',{});
   await Promise.all([reports(),feed(true)]);
  },'Комментарий скрыт'));
  row.append(hide);commentPanel.append(row);
 }
 if(!commentData.items.length)commentPanel.append(node('p','Нет новых жалоб на комментарии.','muted'));

}
$('discover-form').addEventListener('submit',event=>{
 event.preventDefault();const form=event.currentTarget;
 run(()=>discover(form.elements.q.value.trim()),'Поиск завершён');
});
$('discover-clear').addEventListener('click',()=>{
 $('discover-form').reset();clear($('discover-results'));$('discover-results').hidden=true;
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
 await api('/auth/logout','POST',{});await session();await Promise.all([worlds(),feed(true),sponsors()]);
},'Вы вышли.'));
$('world-settings-select').addEventListener('change',syncWorldSettings);
$('world-cover-select').addEventListener('change',syncCoverSettings);
$('world-cover-form').addEventListener('submit',event=>{
 event.preventDefault();
 const form=event.currentTarget,slug=form.elements.slug.value,file=form.elements.cover.files?.[0];
 run(async()=>{
  const saved=await sendCover(slug,file);
  form.elements.cover.value='';
  await session();await worlds();
  $('world-cover-select').value=slug;syncCoverSettings();
  $('world-cover-status').textContent='PNG принят · '+saved.width+' × '+saved.height+' px · метаданные удалены · ожидает модерации';
 },'Обложка отправлена на независимую проверку');
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
 const {slug,title,description,category}=values(form);
 run(async()=>{
  await api('/worlds/'+encodeURIComponent(slug),'PATCH',{title,description,category});
  await session();await worlds();
 },'Оформление мира сохранено — данные видны посетителям.');
});
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
  if(state.reportComment){
   await api('/comments/'+state.reportComment+'/report','POST',{reason:values(form).reason});
  }else{
   await api('/reports','POST',{...values(form),postId:state.reportPost});
  }
  $('report-dialog').close();form.reset();state.reportPost=null;state.reportComment=null;
 },'Жалоба отправлена модератору');
});
$('report-cancel').addEventListener('click',()=>{state.reportPost=null;state.reportComment=null;$('report-dialog').close();});
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
 const link=location.origin+location.pathname+'#world-'+slug;
 try{
  await navigator.clipboard.writeText(link);
  notice('Постоянная ссылка на World скопирована');
 }catch{
  notice('Ссылка на твой World: '+link);
 }
}));
function closeWorldAndRestoreFocus(){
 const previousSlug=state.currentWorldSlug;
 $('world-detail').hidden=true;state.currentWorldSlug=null;
 const opener=Array.from(document.querySelectorAll('#world-list .world-open'))
  .find(link=>link.getAttribute('href')==='#world-'+encodeURIComponent(previousSlug||''));
 (opener||$('worlds')).focus({preventScroll:true});
}
$('world-close').addEventListener('click',()=>{
 // Replace the URL fragment without native hash navigation stealing focus.
 if(location.hash!=='#worlds')history.replaceState(null,'','#worlds');
 closeWorldAndRestoreFocus();
});
window.addEventListener('hashchange',()=>{
 const requested=location.hash.startsWith('#world-')?decodeURIComponent(location.hash.slice(7)):'';
 if(requested)run(()=>openWorld(requested));
 else if(!$('world-detail').hidden)closeWorldAndRestoreFocus();
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
$('mod-cover-refresh').addEventListener('click',()=>run(reviewCovers,'Очередь проверки изображений обновлена'));
$('mod-cover-appeals-refresh').addEventListener('click',()=>run(reviewCoverAppeals,'Очередь апелляций обновлена'));
$('reload-reports').addEventListener('click',()=>run(async()=>{await Promise.all([reports(),reviewAppeals(),pilotInvites(),reviewCovers(),reviewCoverAppeals()]);}));
document.querySelector('.skip-navigation').addEventListener('click',()=>$('main-content').focus({preventScroll:true}));
loadTopics().then(()=>session()).then(()=>Promise.all([worlds(),feed(true),sponsors()]))
 .then(()=>{
  notice('Локальный сервер готов. Данные настоящие, но изолированы от production.');
  const requested=location.hash.startsWith('#world-')?decodeURIComponent(location.hash.slice(7)):'';
  if(requested)run(()=>openWorld(requested));
 })
 .catch(e=>notice(e.message));
})();