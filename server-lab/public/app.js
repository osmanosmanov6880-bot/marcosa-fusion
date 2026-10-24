/* MARCOSA R28 — all dynamic text uses textContent, never HTML parsing. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const state={me:null,worlds:[],worldCatalog:[],cursor:null,reportPost:null,reportComment:null};
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
async function run(action,success){
 try{await action();if(success)notice(success);}
 catch(error){notice(error.message||'Не удалось выполнить действие');}
}
async function session(){
 try{
  const result=await api('/auth/me');
  state.me=result.user;state.worlds=result.worlds;
 }catch{state.me=null;state.worlds=[];}
 $('identity').textContent=state.me?'@'+state.me.username:'Гость';
 document.body.dataset.mSession=state.me?'member':'guest';
 $('logout').hidden=!state.me;
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
  const container=$('my-worlds'),choose=$('post-world');
  clear(container);clear(choose);
  for(const world of state.worlds){
   const item=node('p',world.title+' / '+world.slug,'world-own');container.append(item);
   const option=node('option',world.title);option.value=world.id;choose.append(option);

  }
  await Promise.all([myPosts(),mySponsors(),receivedSponsors()]);
  if(state.me.role==='moderator')await Promise.all([reports(),reviewSponsors()]);
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
  card.append(node('span','WORLD / '+world.slug,'eyebrow'),node('h3',world.title));
  card.append(node('p',world.description||'Мир автора @'+world.owner));
  const stats=node('p',world.posts_count+' публикаций · '+world.followers_count+' подписчиков','world-stats');
  card.append(stats,node('small','Создан @'+world.owner));
  if(state.me&&world.owner!==state.me.username){
   const following=followInfo[i]?.followed===true;
   const btn=node('button',following?'✓ Подписан':'Подписаться',following?'ghost small following':'ghost small world-follow');
   btn.type='button';btn.setAttribute('aria-pressed',String(following));
   btn.addEventListener('click',()=>run(async()=>{
    await api('/worlds/'+encodeURIComponent(world.slug)+'/follow',following?'DELETE':'POST',{});
    await worlds();
   },following?'Подписка отменена':'Подписка сохранена'));
   card.append(btn);
  }
  const open=node('a','Открыть World ↗','world-open');
  open.href='#world-'+encodeURIComponent(world.slug);
  open.addEventListener('click',event=>{
   event.preventDefault();location.hash='world-'+world.slug;
   run(()=>openWorld(world.slug));
  });
  card.append(open);
  wrap.append(card);
 }
 if(!result.items.length)wrap.append(node('p','Пока нет миров. Их создают приглашённые пользователи.'));
}
async function openWorld(slug){
 if(!/^[a-z][a-z0-9-]{2,39}$/.test(slug))throw Error('Недопустимый адрес мира');
 const world=state.worldCatalog.find(w=>w.slug===slug);
 if(!world)throw Error('Мир не найден');
 const [posts,approved]=await Promise.all([
  api('/worlds/'+encodeURIComponent(slug)+'/posts'),
  api('/sponsors/approved')
 ]);
 const panel=$('world-detail');
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
   await discussion(postId,region);
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
 card.append(actions);
 if(!own||post.status==='published'){
  const thread=node('details','','discussion'),summary=node('summary','Обсуждение · '+Number(post.comments_count||0));
  const region=node('div','','comment-region');thread.append(summary,region);
  thread.addEventListener('toggle',()=>{if(thread.open)run(()=>discussion(post.id,region));});
  card.append(thread);
 }
 return card;
}
async function feed(reset=true){
 const params=new URLSearchParams({limit:'12'});
 if(!reset&&state.cursor)params.set('cursor',state.cursor);
 const result=await api('/posts?'+params.toString());
 const wrap=$('feed-list');if(reset)clear(wrap);
 for(const post of result.items)wrap.append(postCard(post));
 state.cursor=result.nextCursor;
 $('more').hidden=!state.cursor;
 if(reset&&!result.items.length)wrap.append(node('p','Пока нет публичных публикаций. Создай первую запись в своём мире.'));
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
  for(const [decision,label] of [['accept','Разрешить тестовый показ'],['reject','Отклонить предложение']]){
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
  await Promise.all([myPosts(),feed(true)]);
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
$('account-export').addEventListener('click',()=>run(async()=>{
 const data=await api('/account/export');
 const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
 const uri=URL.createObjectURL(blob);
 const link=node('a');link.href=uri;
 link.download='marcosa-account-'+new Date().toISOString().slice(0,10)+'.json';
 document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(uri),1500);
},'Экспорт подготовлен: храните файл в защищённом месте'));
$('world-close').addEventListener('click',()=>{
 $('world-detail').hidden=true;
 location.hash='worlds';
});
$('refresh').addEventListener('click',()=>run(()=>feed(true),'Лента обновлена'));
$('more').addEventListener('click',()=>run(()=>feed(false)));
$('reload-reports').addEventListener('click',()=>run(()=>reports()));
session().then(()=>Promise.all([worlds(),feed(true),sponsors()]))
 .then(()=>{
  notice('Локальный сервер готов. Данные настоящие, но изолированы от production.');
  const requested=location.hash.startsWith('#world-')?decodeURIComponent(location.hash.slice(7)):'';
  if(requested)run(()=>openWorld(requested));
 })
 .catch(e=>notice(e.message));
})();