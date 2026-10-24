/* MARCOSA R28 — all dynamic text uses textContent, never HTML parsing. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const state={me:null,worlds:[],cursor:null,reportPost:null};
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
 if(state.me){
  $('profile-line').textContent='@'+state.me.username+' · '+state.me.role+' · закрытое испытание';
  const container=$('my-worlds'),choose=$('post-world');
  clear(container);clear(choose);
  for(const world of state.worlds){
   const item=node('p',world.title+' / '+world.slug,'world-own');container.append(item);
   const option=node('option',world.title);option.value=world.id;choose.append(option);
  }
  await myPosts();
  if(state.me.role==='moderator')await reports();
 }
}
async function worlds(){
 const result=await api('/worlds');const wrap=$('world-list');clear(wrap);
 $('world-count').textContent=result.items.length+' миров';
 for(const world of result.items){
  const card=node('article','','world-card');
  card.append(node('span','WORLD / '+world.slug,'eyebrow'),node('h3',world.title));
  card.append(node('p',world.description||'Мир автора @'+world.owner));
  card.append(node('small','Создан @'+world.owner));
  wrap.append(card);
 }
 if(!result.items.length)wrap.append(node('p','Пока нет миров. Их создают приглашённые пользователи.'));
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
  report.addEventListener('click',()=>{state.reportPost=post.id;$('report-dialog').showModal();});
  actions.append(report);
 }
 card.append(actions);return card;
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
}
$('login-form').addEventListener('submit',event=>{
 event.preventDefault();const form=event.currentTarget;run(async()=>{
  const data=values(form);
  await api('/auth/login','POST',data);
  form.reset();await session();await feed(true);
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
 await api('/auth/logout','POST',{});await session();await feed(true);
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
  await api('/reports','POST',{...values(form),postId:state.reportPost});
  $('report-dialog').close();form.reset();state.reportPost=null;
 },'Жалоба отправлена модератору');
});
$('report-cancel').addEventListener('click',()=>$('report-dialog').close());
$('delete-form').addEventListener('submit',event=>{
 event.preventDefault();const form=event.currentTarget;run(async()=>{
  await api('/account','DELETE',values(form));
  form.reset();await session();await worlds();await feed(true);
 },'Все данные локального аккаунта удалены');
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
$('refresh').addEventListener('click',()=>run(()=>feed(true),'Лента обновлена'));
$('more').addEventListener('click',()=>run(()=>feed(false)));
$('reload-reports').addEventListener('click',()=>run(()=>reports()));
Promise.all([session(),worlds(),feed(true)])
 .then(()=>notice('Локальный сервер готов. Данные настоящие, но изолированы от production.'))
 .catch(e=>notice(e.message));
})();