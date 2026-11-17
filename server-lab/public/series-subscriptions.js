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
   const response=await fetch('/api/me/series-reminders');
   if(response.status===401)return;
   if(!response.ok)throw Error('Не удалось загрузить новые эпизоды.');
   const {items}=await response.json();
   const heading=document.createElement('h2');heading.textContent='Новые эпизоды по подписке';
   inbox.append(heading);
   if(!items.length){status.textContent='Здесь появятся выпуски сезонов, на которые вы подписались.';inbox.append(status);}
   const list=document.createElement('ul');
   for(const item of items){
    const li=document.createElement('li'),link=document.createElement('a');
    link.href='/w/'+encodeURIComponent(item.world)+'#post-'+item.postId;
    link.textContent=item.seriesTitle+' · '+item.position+'. '+item.episodeTitle;
    li.append(link);list.append(li);
   }
   inbox.append(list);
  }
 }catch(error){status.textContent=error.message;(panel||inbox).append(status);}
})();
