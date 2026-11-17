(async()=>{
 const panel=document.querySelector('#series-tools[data-slug]'),inbox=document.getElementById('series-reminders');
 if(!panel&&!inbox)return;
 const status=document.createElement('p');
 status.setAttribute('role','status');
 try{
  if(panel){
   const path='/api/series/'+encodeURIComponent(panel.dataset.slug)+'/subscription';
   const response=await fetch(path);
   if(response.status===401)return;
   if(!response.ok)throw Error('Не удалось загрузить подписку.');
   const initial=await response.json();
   if(initial.own)return;
   const button=document.createElement('button');
   let subscribed=initial.subscribed;
   function refresh(){
    button.textContent=subscribed?'Отписаться от новых эпизодов':'Подписаться на новые эпизоды';
    button.setAttribute('aria-pressed',String(subscribed));
   }
   refresh();
   button.type='button';panel.append(button,status);
   button.addEventListener('click',async()=>{
    button.disabled=true;
    try{
     const changed=await fetch(path,{method:subscribed?'DELETE':'POST',headers:{'Content-Type':'application/json'},body:'{}'});
     if(!changed.ok)throw Error('Не удалось изменить подписку.');
     subscribed=(await changed.json()).subscribed;
     refresh(); status.textContent=subscribed?'Новые эпизоды появятся в разделе «Сезоны».':'Подписка отменена.';
    }catch(error){status.textContent=error.message;}
    finally{button.disabled=false;}
   });
  }else{
   const [response,continueResponse]=await Promise.all([
    fetch('/api/me/series-reminders'),fetch('/api/me/series-continue')
   ]);
   if(response.status===401)return;
   if(!response.ok)throw Error('Не удалось загрузить новые эпизоды.');
   const initial=await response.json();
   const heading=document.createElement('h2');heading.textContent='Новые эпизоды по подписке';
   inbox.append(heading);
   const controls=document.createElement('div');
   const list=document.createElement('ul');
   const all=document.createElement('button');all.type='button';
   all.textContent='Скрыть все напоминания';
   const more=document.createElement('button');more.type='button';
   more.textContent='Показать ещё';
   let nextCursor=initial.nextCursor;
   let shown=0;
   function refresh(){
    all.hidden=shown===0;
    more.hidden=!nextCursor;
   }
   function addReminder(item){
    const li=document.createElement('li'),link=document.createElement('a');
    link.href='/w/'+encodeURIComponent(item.world)+'#post-'+item.postId;
    link.textContent=item.seriesTitle+' · '+item.position+'. '+item.episodeTitle;
    const dismiss=document.createElement('button');
    dismiss.type='button';dismiss.textContent='Скрыть';
    dismiss.setAttribute('aria-label','Скрыть напоминание о выпуске '+item.episodeTitle);
    dismiss.addEventListener('click',async()=>{
     dismiss.disabled=true;
     try{
      const result=await fetch('/api/me/series-reminders/'+item.episodeId,{
       method:'DELETE',headers:{'Content-Type':'application/json'},body:'{}'
      });
      if(!result.ok)throw Error('Не удалось скрыть напоминание.');
      li.remove();shown--;refresh();status.textContent='Напоминание скрыто.';
     }catch(error){status.textContent=error.message;dismiss.disabled=false;}
    });
    li.append(link,dismiss);list.append(li);shown++;refresh();
   }
   all.addEventListener('click',async()=>{
    all.disabled=true;
    try{
     const response=await fetch('/api/me/series-reminders',{
      method:'DELETE',headers:{'Content-Type':'application/json'},body:'{}'
     });
     if(!response.ok)throw Error('Не удалось скрыть все напоминания.');
     list.replaceChildren();shown=0;nextCursor=null;refresh();
     status.textContent='Все напоминания скрыты.';
    }catch(error){status.textContent=error.message;}
    finally{all.disabled=false;}
   });
   more.addEventListener('click',async()=>{
    more.disabled=true;
    try{
     const response=await fetch('/api/me/series-reminders?cursor='+encodeURIComponent(nextCursor));
     if(!response.ok)throw Error('Не удалось загрузить следующую страницу.');
     const page=await response.json();
     for(const item of page.items)addReminder(item);
     nextCursor=page.nextCursor;refresh();
    }catch(error){status.textContent=error.message;}
    finally{more.disabled=false;}
   });
   for(const item of initial.items)addReminder(item);
   refresh();controls.append(all,more);inbox.append(controls,list);
   if(!initial.items.length){status.textContent='Здесь появятся выпуски сезонов, на которые вы подписались.';}
   if(continueResponse.ok){
    const progress=await continueResponse.json();
    const title=document.createElement('h2');title.textContent='Продолжить чтение';inbox.append(title);
    if(!progress.items.length){
     const empty=document.createElement('p');
     empty.textContent='Все доступные выпуски отмечены или подписок пока нет.';inbox.append(empty);
    }
    const reading=document.createElement('ul');
    for(const item of progress.items){
     const li=document.createElement('li'),link=document.createElement('a');
     link.href='/series/'+encodeURIComponent(item.slug)+'#episode-'+item.episodeId;
     link.textContent=item.seriesTitle+' · '+item.position+'. '+item.episodeTitle;
     li.append(link);reading.append(li);
    }
    inbox.append(reading);
   }else if(continueResponse.status!==401)throw Error('Не удалось загрузить продолжение чтения.');
   inbox.append(status);
  }
 }catch(error){status.textContent=error.message;(panel||inbox).append(status);}
})();
