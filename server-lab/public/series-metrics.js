(async () => {
 const mount=document.querySelector('#series-tools[data-slug]');
 if (!mount || mount.dataset.member==='false') return;
 const path='/api/series/'+encodeURIComponent(mount.dataset.slug)+'/metrics';
 async function api(suffix,method='GET',body) {
  const response=await fetch(path+suffix,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  if (!response.ok) throw new Error('Не удалось загрузить или сохранить данные.');
  return response.json();
 }
 function element(tag,text) {
  const item=document.createElement(tag);
  if (text!==undefined) item.textContent=text;
  return item;
 }
 const section=element('section');
 const status=element('p'); status.setAttribute('role','status');
 function button(label,action) {
  const control=element('button',label); control.type='button';
  control.addEventListener('click',async()=>{
   control.disabled=true;
   try {await action();await draw();status.textContent='Сохранено';}
   catch (err){status.textContent=err.message;}
   finally {control.disabled=false;}
  }); return control;
 }
 async function draw(){
  const data=await api('/attendance');
  section.replaceChildren(element('h2',data.owner?'Отчёт автора':'Мои отметки'));
  if (data.owner) {
   const result=await api('');
   section.append(element('p','Возврат за 7 дней: '+result.return7d.returned+' из '+result.return7d.eligible+'. Считаем зрителей, отметивших первый выпуск минимум семь дней назад, а затем второй в течение семи дней.'));
   for (const e of result.episodes) {
    const label=element('label','Затраты на «'+e.title+'», минут ');
    const input=element('input');input.type='number';input.min='0';input.max='100000';input.step='1';input.required=true;input.value=e.minutes??'';
    label.append(input); section.append(element('p',e.title+' · Зрителей с добровольной отметкой: '+e.people),label,
     button('Сохранить минуты',async()=>{if(!input.reportValidity()) throw new Error('Укажите число минут');await api('/effort','POST',{episodeId:e.id,minutes:Number(input.value)});}));
   }
  } else {
   section.append(element('p','Отметка сохраняет время вашего первого подтверждения и включает его в сводку автора. Вы можете удалить все свои отметки сезона.'));
   for (const e of data.episodes) {
    const control=button(e.title+(e.marked?' · отмечено':' · я посмотрел выпуск'),()=>api('/attendance','POST',{episodeId:e.id,consent:true}));
    control.disabled=e.marked;section.append(control);
   }
   if (data.episodes.some(e=>e.marked)) section.append(button('Удалить мои отметки',()=>api('/attendance','DELETE',{})));
  }
 }
 try{await draw();mount.append(section,status);}
 catch(error){if(mount.dataset.member==='true'){status.textContent=error.message;mount.append(status);}}
})();
