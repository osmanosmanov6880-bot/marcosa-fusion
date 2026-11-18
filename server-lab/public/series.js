'use strict';
const slug = document.querySelector('#series-tools')?.dataset.slug;
const notice = document.getElementById('series-notice');

function attach(id, path, method, makeBody, saved) {
 const form = document.getElementById(id);
 if (!form) return;
 form.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = form.querySelector('button');
  if (submit.disabled) return;
  submit.disabled = true;
  try {
   const response = await fetch(path, {
    method, credentials:'same-origin', headers:{'Content-Type':'application/json'},
    body:JSON.stringify(makeBody(Object.fromEntries(new FormData(form))))
   });
   const result = await response.json();
   if (!response.ok) throw Error(result.error || 'Не удалось сохранить изменения');
   saved(result);
  } catch(error) { notice.textContent=error.message; }
  finally { submit.disabled=false; }
 });
}
const dateValue = raw => raw ? new Date(raw).getTime() : null;
attach('new-series','/api/series','POST',data=>({...data,nextAt:dateValue(data.nextAt)}),
 result=>location.assign('/series/'+encodeURIComponent(result.slug)));
if(slug) {
 const path='/api/series/'+encodeURIComponent(slug);
 attach('new-episode',path+'/episodes','POST',data=>({...data,postId:Number(data.postId)}),()=>location.reload());
 attach('series-meta',path,'PATCH',data=>data,()=>location.reload());
 attach('next-release',path,'PATCH',data=>({nextAt:dateValue(data.nextAt)}),()=>location.reload());
 const editor=document.getElementById('episode-editor');
 if(editor) {
  let entries=JSON.parse(editor.dataset.episodes||'[]');
  const call=async(endpoint,method,body)=>{
   const res=await fetch(endpoint,{method,credentials:'same-origin',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   const data=await res.json();
   if(!res.ok)throw Error(data.error||'Не удалось изменить выпуск');
   return data;
  };
  const manage=async(job)=>{
   try {await job();location.reload();}
   catch(error){notice.textContent=error.message;}
  };
  const holder=document.createElement('ol');
  for(const [i,episode] of entries.entries()){
   const item=document.createElement('li'),label=document.createElement('label');
   label.textContent='Выпуск '+episode.position+' · название ';
   const input=document.createElement('input');input.value=episode.title;input.maxLength=100;input.required=true;
   label.append(input);item.append(label);
   const endpoint=path+'/episodes/'+episode.id;
   const button=(title,action)=>{
    const control=document.createElement('button');control.type='button';control.textContent=title;
    control.onclick=async()=>{
     control.disabled=true;await manage(action);control.disabled=false;
    };return control;
   };
   item.append(button('Переименовать',async()=>call(endpoint,'PATCH',{title:input.value})));
   if(i) item.append(button('Выше',async()=>{
    const order=entries.map(e=>e.id);[order[i-1],order[i]]=[order[i],order[i-1]];
    await call(path+'/episodes/order','PUT',{order});
   }));
   if(i<entries.length-1) item.append(button('Ниже',async()=>{
    const order=entries.map(e=>e.id);[order[i],order[i+1]]=[order[i+1],order[i]];
    await call(path+'/episodes/order','PUT',{order});
   }));
   item.append(button('Убрать из сезона',async()=>{
    if(!confirm('Убрать выпуск из сезона? Сам пост останется, отметки и напоминания этого выпуска исчезнут.'))return;
    await call(endpoint,'DELETE',{confirm:true});
   }));
   holder.append(item);
  }
  editor.append(holder);
 }

}

const publication=document.getElementById('series-publication');
if(publication&&slug){
 publication.addEventListener('submit',async event=>{
  event.preventDefault();
  const archived=publication.dataset.archived==='true';
  if(!archived&&!confirm('Скрыть весь сезон от читателей? Напоминания будут удалены.'))return;
  const button=publication.querySelector('button');button.disabled=true;
  try{
   const response=await fetch('/api/series/'+encodeURIComponent(slug)+'/publication',{
    method:archived?'POST':'DELETE',headers:{'Content-Type':'application/json'},body:'{}'
   });
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'Не удалось изменить публикацию.');
   location.reload();
  }catch(error){notice.textContent=error.message;button.disabled=false;}
 });
}

const history=document.getElementById('series-publication');
if(history&&slug){
 const section=document.createElement('section');
 const heading=document.createElement('h3');heading.textContent='История изменений сезона';
 section.append(heading);
 const list=document.createElement('ol');section.append(list);
 const more=document.createElement('button');more.type='button';more.textContent='Показать ранние изменения';
 let cursor=null;
 const labels={
  series_created:'Сезон создан',series_updated:'Сведения сезона изменены',
  episode_attached:'Выпуск добавлен',episode_renamed:'Название выпуска изменено',
  episodes_reordered:'Порядок выпусков обновлён',episode_removed:'Выпуск исключён',
  series_archived:'Сезон снят с публикации',series_restored:'Сезон возвращён'
 };
 async function loadHistory(){
  const result=await fetch('/api/series/'+encodeURIComponent(slug)+'/audit'+(cursor?'?cursor='+cursor:''));
  if(!result.ok)throw Error('Не удалось загрузить историю изменений.');
  const data=await result.json();
  for(const event of data.items){
   const li=document.createElement('li');
   li.textContent=(labels[event.action]||'Изменение')+' · '+
    new Date(event.createdAt).toLocaleString('ru-RU');
   list.append(li);
  }
  cursor=data.nextCursor;more.hidden=!cursor;
 }
 more.onclick=async()=>{more.disabled=true;try{await loadHistory();}catch(e){notice.textContent=e.message;}finally{more.disabled=false;}};
 section.append(more);
 history.after(section);
 void loadHistory().catch(e=>{notice.textContent=e.message;});
}
