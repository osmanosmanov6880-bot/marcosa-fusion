(async()=>{
 const panel=document.querySelector('#series-tools[data-slug]');
 const library=document.getElementById('series-bookmarks');
 if(!panel&&!library)return;
 const status=document.createElement('p');status.setAttribute('role','status');
 async function request(url,method='GET'){
  const response=await fetch(url,method==='GET'?{}:{method,headers:{'Content-Type':'application/json'},body:'{}'});
  if(response.status===401)return null;
  if(!response.ok)throw Error('Не удалось загрузить или сохранить закладку.');
  return response.json();
 }
 try{
  if(panel){
   if(panel.dataset.member!=='true')return;
   const slug=encodeURIComponent(panel.dataset.slug);
   for(const card of panel.querySelectorAll('article[data-episode-id]')){
    const episodeId=Number(card.dataset.episodeId);
    if(!Number.isSafeInteger(episodeId))continue;
    const url='/api/series/'+slug+'/episodes/'+episodeId+'/bookmark';
    const initial=await request(url);if(!initial)return;
    let saved=Boolean(initial.saved);
    const button=document.createElement('button');button.type='button';
    function paint(){button.textContent=saved?'Убрать из сохранённого':'Сохранить выпуск';
     button.setAttribute('aria-pressed',String(saved));}
    paint();
    button.onclick=async()=>{
     button.disabled=true;
     try{const outcome=await request(url,saved?'DELETE':'POST');
      saved=Boolean(outcome.saved);paint();status.textContent=saved?'Выпуск сохранён.':'Закладка удалена.';
     }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
    };
    card.append(button);
   }
   panel.append(status);
  }else{
   const title=document.createElement('h2');title.textContent='Сохранённые выпуски';
   library.append(title);
   const list=document.createElement('ul');library.append(list);
   const more=document.createElement('button');more.type='button';more.textContent='Загрузить ещё закладки';
   let cursor=null;
   async function load(){
    const data=await request('/api/me/series-bookmarks'+(cursor?'?cursor='+encodeURIComponent(cursor):''));
    if(!data){library.replaceChildren();return;}
    for(const item of data.items){
     const li=document.createElement('li'),link=document.createElement('a');
     link.href='/series/'+encodeURIComponent(item.slug)+'#episode-'+item.episodeId;
     link.textContent=item.seriesTitle+' · '+item.position+'. '+item.episodeTitle;
     const remove=document.createElement('button');remove.type='button';remove.textContent='Удалить закладку';
     remove.onclick=async()=>{
      remove.disabled=true;
      try{
       await request('/api/series/'+encodeURIComponent(item.slug)+'/episodes/'+item.episodeId+'/bookmark','DELETE');
       li.remove();status.textContent='Закладка удалена.';
      }catch(error){status.textContent=error.message;remove.disabled=false;}
     };
     li.append(link,remove);list.append(li);
    }
    cursor=data.nextCursor;more.hidden=!cursor;
   }
   more.onclick=async()=>{more.disabled=true;try{await load();}catch(err){status.textContent=err.message;}finally{more.disabled=false;}};
   await load();library.append(more,status);
  }
 }catch(error){status.textContent=error.message;(panel||library).append(status);}
})();
