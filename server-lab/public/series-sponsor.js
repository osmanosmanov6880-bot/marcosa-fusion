(async()=>{
 const host=document.querySelector('#series-tools[data-slug]');
 if(!host)return;
 const base='/api/series/'+encodeURIComponent(host.dataset.slug)+'/sponsor';
 const panel=document.createElement('section');
 host.append(panel);
 const element=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node};
 const message=element('p','');message.setAttribute('role','status');
 async function request(action,payload){
  const result=await fetch(action?base+'/'+action:base,action?{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}:{credentials:'same-origin'});
  const data=await result.json();
  if(!result.ok)throw Error(data.error||'Запрос не выполнен');
  return data;
 }
 function button(label,act){
  const control=element('button',label);control.type='button';
  control.onclick=async()=>{control.disabled=true;try{await act()}catch(error){message.textContent=error.message}finally{control.disabled=false}};
  return control;
 }
 async function render(){
  const {placement,owner,advertiser,member,choices,report,detachId}=await request('');
  panel.replaceChildren(message);message.textContent='';
  if(placement){
   panel.append(element('h3','Партнёр сезона'),element('small','Реклама · тестовое размещение без оплаты'),element('h4',placement.brand),element('p',placement.headline));
   const url=new URL(placement.url);
   if(url.protocol==='https:'){
    const link=element('a','Перейти на '+url.hostname);link.href=url.href;link.rel='sponsored noreferrer';
    if(member)link.onclick=async event=>{
     if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
     event.preventDefault();
     try{const result=await request('click',{placementId:placement.id});location.assign(result.url)}catch(error){message.textContent=error.message}
    };
    panel.append(link);
   }
  }
  if(owner&&choices.length){
   const label=element('label','Согласованное предложение ');
   const select=element('select','');
   for(const item of choices){const option=element('option',item.brand_name+' · '+item.headline);option.value=item.id;select.append(option)}
   label.append(select);panel.append(label,button('Разместить в сезоне',async()=>{await request('attach',{proposalId:Number(select.value)});await render()}));
  }
  if(detachId)panel.append(button('Убрать партнёра',async()=>{
   // Withdrawal of a proposal also removes its public card.
   await request('detach',{placementId:detachId});await render()
  }));
  if(report)panel.append(element('h4','Отчёт по размещению'),element('p','Участники, выбравшие переход: '+report.uniqueMembers+' · Подтверждено партнёром: '+report.confirmed+' · Отменено: '+report.cancelled+' · Осталось: '+report.netConfirmed));
  if(advertiser){
   const label=element('label','Внутренний код результата без персональных данных '),input=element('input','');
   input.maxLength=80;label.append(input);panel.append(label);
   for(const [action,title] of [['outcome','Подтвердить результат'],['cancel','Отменить результат']]){
    panel.append(button(title,async()=>{await request(action,{placementId:placement.id,reference:input.value.trim()});await render();message.textContent='Результат сохранён'}));
   }
  }
 }
 try{await render()}catch(error){panel.replaceChildren(message);message.textContent=error.message}
})();
