(function () {
  'use strict';
  var api=globalThis.MarcosaR195Draft;
  var el=function(id){return document.getElementById(id);};
  var payload;
  try {payload=JSON.parse(el('r195-source').textContent);}
  catch (_) {return;}
  var reference={sourceCommit:payload.sourceCommit,
    assessmentSha256:payload.assessmentSha256,
    initialProgress:payload.initialProgress};
  var cards=Array.from(document.querySelectorAll('article.control'));
  var stateText={OPEN:'Не начато',IN_PROGRESS:'В работе',
    BLOCKED_LOCAL:'Есть препятствие',DONE_LOCAL:'Локально завершено'};
  var acts=[['START','В работу'],['BLOCK','Препятствие'],
    ['COMPLETE','Локально сделано'],['REOPEN','Открыть заново']];
  var docs;
  var status=el('r195-message'),query=el('r194-search'),
    filter=el('r194-filter'),ownerFilter=el('r195-owner');
  var locked=false;
  function say(s){status.textContent=s;}
  function download(name,contents,type) {
    var url=URL.createObjectURL(new Blob([contents],{type:type}));
    var a=document.createElement('a');a.href=url;a.download=name;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(function(){URL.revokeObjectURL(url);},1500);
  }
  function render(){
    cards.forEach(function(card){
      var id=card.id.slice('control-'.length);
      var label=card.querySelector('.r195-progress');
      if(!label)return;
      label.textContent='Моя задача: '+stateText[docs.progress[id]];
      card.querySelectorAll('button[data-r195-action]').forEach(function(b){
        b.disabled=locked||api.FROM[b.dataset.r195Action].indexOf(docs.progress[id])<0;
      });
    });
    var q=query.value.trim().toLocaleLowerCase('ru'),code=filter.value,
      owner=ownerFilter.value,count=0;
    cards.forEach(function(card){
      var id=card.id.slice('control-'.length);
      var sourceStatus=card.querySelector('.pill').classList;
      var matches=!q||card.textContent.toLocaleLowerCase('ru').includes(q);
      var statusMatch=code==='ALL'||
        (code==='BLOCKED'&&sourceStatus.contains('blocked'))||
        (code==='MISSING'&&sourceStatus.contains('missing'))||
        (code==='CLAIM_UNVERIFIED'&&sourceStatus.contains('claimed'))||
        (code==='OBSERVED_UNATTESTED'&&sourceStatus.contains('observed'))||
        (code==='LOCAL_DONE'&&docs.progress[id]==='DONE_LOCAL');
      var role=card.querySelector('.owner').textContent.trim();
      card.hidden=!(matches&&statusMatch&&(owner==='ALL'||owner===role));
      if(!card.hidden)count++;
    });
    el('r194-results').textContent='Показано направлений: '+count+' из '+api.IDS.length;
    el('r195-count').textContent=String(docs.events.length);
    var history=el('r195-history');history.replaceChildren();
    docs.events.slice(-12).reverse().forEach(function(event){
      var li=document.createElement('li');
      var strong=document.createElement('strong');
      strong.textContent=event.control;
      li.appendChild(strong);
      li.appendChild(document.createTextNode(' — '+event.action+
        ' · '+stateText[event.to]+' · '+new Date(event.atMs).toLocaleString('ru-RU')));
      history.appendChild(li);
    });
    if(!docs.events.length){
      var li=document.createElement('li');
      li.textContent='Пока нет новых действий. Исходная оценка сохранена отдельно.';
      history.appendChild(li);
    }
  }
  async function act(id,action){
    if(locked)return;
    locked=true;
    try{
      docs=await api.append(docs,reference,id,action);
      say('Событие проверено по SHA-256 и добавлено в локальную историю. Разрешение на запуск не выдано.');
    }catch(e){say('Действие отклонено: '+e.message);}
    finally{locked=false;render();}
  }
  async function importDraft(text){
    if(locked)return;
    locked=true;
    try{
      var parsed=await api.importText(text,reference);
      docs=parsed;
      say('Черновик v2 проверен по всем событиям, хешам и исходному SHA. Production остаётся NO-GO.');
    }catch(e){say('Импорт отклонён: '+e.message);}
    finally{locked=false;render();}
  }
  async function exportDraft(){
    if(locked)return;
    locked=true;
    try{
      await api.verify(docs,reference);
      var text=api.exportText(docs);
      el('r195-export-text').value=text;
      download('marcosa-r195-'+payload.sourceCommit.slice(0,8)+'-draft.json',
        text,'application/json;charset=utf-8');
      say('JSON-файл сохранён через браузер. Это локальный черновик, не свидетельство допуска.');
    }catch(e){say('Экспорт отклонён: '+e.message);}
    finally{locked=false;render();}
  }
  async function main(){
    docs=await api.create(reference);
    for(let i=0;i<cards.length;i++){
      const card=cards[i],id=card.id.slice('control-'.length);
      if(!api.IDS.includes(id))continue;
      var zone=document.createElement('div');zone.className='r195-controls';
      var label=document.createElement('span');
      label.className='r195-progress';label.setAttribute('aria-live','polite');
      zone.appendChild(label);
      var btns=document.createElement('div');btns.className='r195-buttons';
      acts.forEach(function(pair){
        var b=document.createElement('button');b.type='button';
        b.className='r195-action';b.textContent=pair[1];
        b.dataset.r195Action=pair[0];
        b.addEventListener('click',function(){void act(id,pair[0]);});
        btns.appendChild(b);
      });
      zone.appendChild(btns);
      card.appendChild(zone);
    }
    query.addEventListener('input',render);
    filter.addEventListener('change',render);
    ownerFilter.addEventListener('change',render);
    el('r195-export').addEventListener('click',function(){void exportDraft();});
    el('r195-import').addEventListener('click',function(){
      var selected=el('r195-file').files[0];
      if(!selected)void importDraft(el('r195-paste').value);
      else if(selected.size>70000||selected.size<250)
        say('Импорт отклонён: размер файла вне границ.');
      else void selected.text().then(importDraft).catch(function(){say('Не удалось прочитать файл.');});
    });
    el('r195-reset').addEventListener('click',function(){
      void api.create(reference).then(function(next){
        docs=next;render();say('Локальный черновик очищен. Исходная оценка не менялась.');
      }).catch(function(e){say(e.message);});
    });
    document.querySelectorAll('button[data-r195-owner]').forEach(function(b){
      b.addEventListener('click',function(){
        var owner=b.dataset.r195Owner;
        var packet=payload.handoffs.find(function(x){return x.owner===owner;});
        if(!packet)return;
        download('marcosa-r195-'+owner.toLowerCase()+'-handoff.csv',
          '\ufeff'+packet.csv,'text/csv;charset=utf-8');
        say('Файл задач '+owner+' скачан: только источник, действия и NO-GO.');
      });
    });
    render();
    say('Автономный режим. Данные не отправляются в сеть и не сохраняются без вашего скачивания.');
  }
  void main().catch(function(e){say('Проверка локального кабинета недоступна: '+e.message);});
})();
