/* MARCOSA R8 — local-first branching story creator.
 * 2 decisions / 4 endings. Strict allowlist schema, zero persistence/network.
 * Fictional draft editor only: no publication, accounts, payments or analytics.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document){
    root.MarcosaCreatorStudio=api;
    const start=()=>{root.MarcosaCreatorRuntime=api.mount(root.document,root);};
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});
    else start();
  }
})(typeof window!=='undefined'?window:undefined,function(){
  'use strict';
  const SCHEMA='marcosa-original-story/v1';
  const LANGS=Object.freeze(['ru','en','zh']);
  const SECTIONS=Object.freeze([
    {key:'identity',fields:['title','tagline']},
    {key:'opening',fields:['opening.scene','opening.question','opening.choices.0','opening.choices.1']},
    {key:'branch0',fields:['branches.0.scene','branches.0.question','branches.0.choices.0','branches.0.choices.1']},
    {key:'branch1',fields:['branches.1.scene','branches.1.question','branches.1.choices.0','branches.1.choices.1']},
    {key:'ending00',fields:['endings.0.title','endings.0.body']},
    {key:'ending01',fields:['endings.1.title','endings.1.body']},
    {key:'ending10',fields:['endings.2.title','endings.2.body']},
    {key:'ending11',fields:['endings.3.title','endings.3.body']}
  ]);
  const FIELDS=Object.freeze(SECTIONS.flatMap(s=>s.fields));
  const REVIEW_GATES=Object.freeze([
    'rights_independent_verification','sponsorship_disclosure','editorial_review',
    'accessibility','security_review','manual_publication_approval'
  ]);
  const UI={
    ru:{
      home:'ГЛАВНАЯ',stories:'ИГРАТЬ В ИСТОРИИ',eyebrow:'MARCOSA / CREATOR ENGINE · R8',
      heading:'Твоя история. Четыре разных финала.',intro:'Напиши собственный сюжет с двумя решениями и четырьмя финалами. Проверь развилки в плеере справа и выгрузи готовый JSON-черновик.',
      prototype:'ЛОКАЛЬНЫЙ ПРОТОТИП · НЕ ПУБЛИКУЕТСЯ',editor:'РЕДАКТОР ИСТОРИИ',preview:'ПРЕДПРОСМОТР',
      source:'СТАРТОВАЯ ДЕМОНСТРАЦИЯ',language:'ЯЗЫК ИСТОРИИ',fields:'Заполни сцены и решения. Нажми «Обновить предпросмотр», чтобы применить изменения.',
      apply:'ОБНОВИТЬ ПРЕДПРОСМОТР',download:'СКАЧАТЬ JSON',import:'ИМПОРТ JSON',reset:'СБРОСИТЬ ПРИМЕР',
      rights:'Подтверждаю право использовать этот текст. Независимая проверка прав ещё не проводилась.',
      disclose:'Обязуюсь явно обозначать спонсорство, если история будет рекламной.',
      statusReady:'Демонстрация загружена. Отредактируй текст или пройди четыре финала.',
      statusApplied:'Изменения применены. Проверь обе развилки в плеере.',
      statusDirty:'Текст изменён. Обнови предпросмотр перед экспортом.',
      statusNeedRights:'Для скачивания отметь оба условия, затем обнови предпросмотр.',
      statusExport:'Черновик JSON сохранён на устройство. Ничего не опубликовано.',
      statusImported:'JSON загружен локально. Подтверди права заново, прежде чем экспортировать.',
      statusImportError:'Не удалось импортировать: нужен корректный черновик MARCOSA R8 размером до 128 КБ.',
      statusError:'Проверь поле: ',statusReset:'Образец восстановлен. Несохранённые изменения удалены.',
      confirmReset:'Сбросить изменения и загрузить демонстрационный сюжет?',
      back:'← НАЗАД',again:'ЗАНОВО',step:'СЦЕНА',ending:'ФИНАЛ',
      map:'СТРУКТУРА СЮЖЕТА',mapStart:'СТАРТ',mapBranches:'2 ВЕТКИ',mapEnd:'4 ФИНАЛА',
      footer:'ЧЕРНОВИК · ФАЙЛ ОСТАЁТСЯ У ТЕБЯ · 0 ПЛАТЕЖЕЙ · 0 ТРЕКЕРОВ',
      sections:['01 / МИР И НАЗВАНИЕ','02 / ПЕРВАЯ СЦЕНА','03 / ПОСЛЕ ВЫБОРА A','04 / ПОСЛЕ ВЫБОРА B','05 / ФИНАЛ A → A','06 / ФИНАЛ A → B','07 / ФИНАЛ B → A','08 / ФИНАЛ B → B'],
      title:'Название истории',tagline:'О чём история',scene:'Сцена / повествование',question:'Вопрос зрителю',
      choice0:'Вариант A',choice1:'Вариант B',finalTitle:'Название финала',finalBody:'Что произошло в конце',
      ariaChoices:'Варианты решения',unverified:'Не опубликовано · права требуют проверки'
    },
    en:{
      home:'HOME',stories:'PLAY THE STORIES',eyebrow:'MARCOSA / CREATOR ENGINE · R8',
      heading:'Your story. Four different endings.',intro:'Write an original interactive story with two decisions and four endings. Explore each path in the player and export a portable JSON draft.',
      prototype:'LOCAL PREVIEW · NOT PUBLISHED',editor:'STORY EDITOR',preview:'INTERACTIVE PREVIEW',
      source:'FICTIONAL STARTER EXAMPLE',language:'STORY LANGUAGE',fields:'Write the scenes and choices, then apply your changes to the player.',
      apply:'UPDATE PREVIEW',download:'DOWNLOAD JSON',import:'IMPORT JSON',reset:'RESET DEMO',
      rights:'I have the right to use this material; independent rights verification has not yet occurred.',
      disclose:'I will clearly disclose sponsorship if this becomes branded content.',
      statusReady:'Example loaded. Edit the writing or explore all four endings.',
      statusApplied:'Changes applied. Test both branches in the player.',
      statusDirty:'Text changed. Update the preview before exporting.',
      statusNeedRights:'Check both conditions and update the preview before downloading.',
      statusExport:'JSON draft saved locally. Nothing has been published.',
      statusImported:'JSON imported locally. Reconfirm rights before exporting.',
      statusImportError:'Could not import: use a valid MARCOSA R8 draft under 128 KB.',
      statusError:'Check field: ',statusReset:'Example restored. Unsaved edits were cleared.',
      confirmReset:'Discard changes and restore the fictional example?',
      back:'← BACK',again:'RESTART',step:'SCENE',ending:'ENDING',
      map:'STORY STRUCTURE',mapStart:'START',mapBranches:'2 PATHS',mapEnd:'4 ENDINGS',
      footer:'DRAFT ONLY · YOUR FILE STAYS YOURS · 0 PAYMENTS · 0 TRACKERS',
      sections:['01 / TITLE AND IDEA','02 / OPENING SCENE','03 / AFTER CHOICE A','04 / AFTER CHOICE B','05 / ENDING A → A','06 / ENDING A → B','07 / ENDING B → A','08 / ENDING B → B'],
      title:'Story title',tagline:'Premise',scene:'Scene / narrative',question:'Question for the reader',
      choice0:'Option A',choice1:'Option B',finalTitle:'Ending title',finalBody:'What happens at the end',
      ariaChoices:'Story decisions',unverified:'Not published · rights require verification'
    },
    zh:{
      home:'首页',stories:'体验故事',eyebrow:'MARCOSA / 创作者引擎 · R8',
      heading:'你的故事，四个不同的结局。',intro:'编写包含两次选择和四种结局的原创互动故事。在右侧测试分支，并导出便携的 JSON 草稿。',
      prototype:'仅限本地预览 · 不会发布',editor:'故事编辑器',preview:'交互式预览',
      source:'虚构示例',language:'故事语言',fields:'填写场景和选项，然后更新预览。',
      apply:'更新预览',download:'下载 JSON',import:'导入 JSON',reset:'重置示例',
      rights:'我有权使用这些材料；尚未进行独立版权审查。',
      disclose:'如果内容涉及赞助，我承诺明确披露。',
      statusReady:'示例已加载。编辑文本或测试四种结局。',
      statusApplied:'修改已应用。请测试两个分支。',
      statusDirty:'文本已修改。导出前请更新预览。',
      statusNeedRights:'请勾选两项声明并更新预览后再下载。',
      statusExport:'草稿已保存到本地，未发布任何内容。',
      statusImported:'JSON 已在本地导入。导出前请再次确认权利。',
      statusImportError:'无法导入：必须是有效且小于 128 KB 的 MARCOSA R8 草稿。',
      statusError:'请检查字段：',statusReset:'示例已恢复，未保存的修改已清除。',
      confirmReset:'放弃修改并恢复虚构示例吗？',
      back:'← 返回',again:'重新开始',step:'场景',ending:'结局',
      map:'故事结构',mapStart:'开始',mapBranches:'2 条路径',mapEnd:'4 种结局',
      footer:'仅限草稿 · 文件属于你 · 0 付款 · 0 跟踪',
      sections:['01 / 标题与概念','02 / 开场场景','03 / 选择 A 之后','04 / 选择 B 之后','05 / 结局 A → A','06 / 结局 A → B','07 / 结局 B → A','08 / 结局 B → B'],
      title:'故事标题',tagline:'故事简介',scene:'场景叙述',question:'给读者的问题',
      choice0:'选项 A',choice1:'选项 B',finalTitle:'结局标题',finalBody:'结局内容',
      ariaChoices:'故事选项',unverified:'未发布 · 仍需核实内容权利'
    }
  };
  function demoDraft(){
    return {
      schema:SCHEMA,status:'draft_only',publication_state:'not_published',language:'ru',
      title:'Город последнего сигнала',
      tagline:'Четыре финала о доверии, смелости и праве выбирать.',
      opening:{
        scene:'Ночью над городом исчезает связь. На станции связи остаётся один слабый сигнал, способный вернуть людям голос. У тебя есть ровно два пути.',
        question:'Что ты сделаешь сначала?',
        choices:['Отправлю сигнал всему городу','Найду источник сбоя']
      },
      branches:[
        {
          scene:'Миллионы экранов вспыхивают. Люди слышат друг друга, но перегруженная система начинает перегреваться. Теперь от тебя зависит, кому доверить управление.',
          question:'Кому передать управление связью?',
          choices:['Открыть управление сообществу','Передать дежурной команде']
        },
        {
          scene:'Ты находишь старый управляющий модуль. Он может запустить сеть, но для этого потребуется либо открыть код, либо сохранить контроль в руках инженеров.',
          question:'Как поступить с найденным модулем?',
          choices:['Открыть код для всех','Сохранить закрытый протокол']
        }
      ],
      endings:[
        {title:'Город общих решений',body:'Сеть заработала снова. Горожане вместе определяют правила связи. Свобода принесла ответственность, и никто не остался без голоса.'},
        {title:'Смена на рассвете',body:'Дежурная команда удержала перегрузку. К рассвету связь вернулась, а руководство обязалось объяснить каждому своё решение.'},
        {title:'Открытый маяк',body:'Ты публикуешь устройство системы. Независимые инженеры находят ошибку, и сеть становится устойчивее благодаря совместной работе.'},
        {title:'Тихий контроль',body:'Протокол остаётся закрытым. Связь восстанавливается быстро, но теперь каждому приходится решать, можно ли доверять невидимым правилам.'}
      ],
      rights_self_attested:false,sponsorship_disclosure_committed:false,
      rights_independently_verified:false,manual_approval:false,tracking:false,payments:false,
      review_gates:[...REVIEW_GATES]
    };
  }
  const OWN=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
  function assertKeys(value,keys,label){
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_SHAPE:'+label);
    const actual=Object.keys(value).sort();
    if(actual.length!==keys.length||actual.some((k,i)=>k!==keys.slice().sort()[i]))
      throw Error('UNKNOWN_FIELD:'+label);
  }
  function clean(value,key,min,max){
    if(typeof value!=='string')throw Error('INVALID_FIELD:'+key);
    const text=value.trim();
    if(text.length<min||text.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))
      throw Error('INVALID_FIELD:'+key);
    return text;
  }
  function normalizeDraft(raw,requireAttestations=false){
    const all=['schema','status','publication_state','language','title','tagline','opening','branches',
      'endings','rights_self_attested','sponsorship_disclosure_committed',
      'rights_independently_verified','manual_approval','tracking','payments','review_gates'];
    assertKeys(raw,all,'draft');
    if(raw.schema!==SCHEMA||raw.status!=='draft_only'||raw.publication_state!=='not_published'||
       !LANGS.includes(raw.language)||raw.rights_independently_verified!==false||
       raw.manual_approval!==false||raw.tracking!==false||raw.payments!==false||
       typeof raw.rights_self_attested!=='boolean'||typeof raw.sponsorship_disclosure_committed!=='boolean')
      throw Error('INVALID_DRAFT_CONTRACT');
    if(!Array.isArray(raw.review_gates)||raw.review_gates.length!==REVIEW_GATES.length||
       raw.review_gates.some((gate,i)=>gate!==REVIEW_GATES[i]))throw Error('INVALID_REVIEW_GATES');
    if(requireAttestations&&(!raw.rights_self_attested||!raw.sponsorship_disclosure_committed))
      throw Error('RIGHTS_REQUIRED');
    assertKeys(raw.opening,['scene','question','choices'],'opening');
    if(!Array.isArray(raw.opening.choices)||raw.opening.choices.length!==2)throw Error('OPENING_CHOICES');
    if(!Array.isArray(raw.branches)||raw.branches.length!==2)throw Error('BRANCH_COUNT');
    if(!Array.isArray(raw.endings)||raw.endings.length!==4)throw Error('ENDING_COUNT');
    const scene=(x,key)=>{
      assertKeys(x,['scene','question','choices'],key);
      if(!Array.isArray(x.choices)||x.choices.length!==2)throw Error('CHOICE_COUNT:'+key);
      return {
        scene:clean(x.scene,key+'.scene',20,1100),
        question:clean(x.question,key+'.question',7,190),
        choices:x.choices.map((v,i)=>clean(v,key+'.choices.'+i,3,130))
      };
    };
    const end=(x,key)=>{
      assertKeys(x,['title','body'],key);
      return {title:clean(x.title,key+'.title',4,110),body:clean(x.body,key+'.body',20,1300)};
    };
    return {
      schema:SCHEMA,status:'draft_only',publication_state:'not_published',language:raw.language,
      title:clean(raw.title,'title',4,100),tagline:clean(raw.tagline,'tagline',12,260),
      opening:scene(raw.opening,'opening'),
      branches:raw.branches.map((s,i)=>scene(s,'branches.'+i)),
      endings:raw.endings.map((e,i)=>end(e,'endings.'+i)),
      rights_self_attested:raw.rights_self_attested,
      sponsorship_disclosure_committed:raw.sponsorship_disclosure_committed,
      rights_independently_verified:false,manual_approval:false,tracking:false,payments:false,
      review_gates:[...REVIEW_GATES]
    };
  }
  function exportDraft(raw){return JSON.stringify(normalizeDraft(raw,true),null,2)+'\n';}
  function parseDraftFile(text){
    if(typeof text!=='string'||text.length>131072)throw Error('INVALID_IMPORT_SIZE');
    return normalizeDraft(JSON.parse(text));
  }
  function readPath(data,path){
    return path.split('.').reduce((value,part)=>value==null?undefined:value[part],data);
  }
  function writePath(data,path,value){
    const parts=path.split('.'),last=parts.pop();
    const parent=parts.reduce((value,part)=>value[part],data);
    if(!OWN(parent,last))throw Error('UNKNOWN_PATH');
    parent[last]=value;
  }
  function atStep(draft,history){
    const story=normalizeDraft(draft);
    if(!Array.isArray(history)||history.length>2||history.some(v=>v!==0&&v!==1))
      throw Error('INVALID_HISTORY');
    if(history.length===0)
      return {index:0,title:story.title,body:story.opening.scene,
        question:story.opening.question,choices:story.opening.choices.slice(),ending:false};
    if(history.length===1){
      const branch=story.branches[history[0]];
      return {index:1,title:story.title,body:branch.scene,
        question:branch.question,choices:branch.choices.slice(),ending:false};
    }
    const ending=story.endings[history[0]*2+history[1]];
    return {index:2,title:ending.title,body:ending.body,
      question:'',choices:[],ending:true};
  }
  function takeChoice(history,choice){
    if(!Array.isArray(history)||history.length>=2||history.some(v=>v!==0&&v!==1)||
       (choice!==0&&choice!==1))throw Error('INVALID_CHOICE');
    return history.concat(choice);
  }
  function mount(doc,win){
    if(!doc.getElementById('mc-editor'))return null;
    const $=id=>doc.getElementById(id);
    const e=(tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
    let language='ru',current=normalizeDraft(demoDraft()),history=[],dirty=false;
    const t=()=>UI[language];
    const fieldId=key=>'mc-field-'+key.replace(/\./g,'-');
    const sectionId=(key)=>'mc-section-'+key;
    const titleFor=(key)=>{
      const last=key.split('.').pop();
      if(key==='title')return t().title;
      if(key==='tagline')return t().tagline;
      if(key.startsWith('endings.'))return last==='title'?t().finalTitle:t().finalBody;
      if(last==='scene')return t().scene;
      if(last==='question')return t().question;
      if(last==='0')return t().choice0;
      return t().choice1;
    };
    function buildFields(){
      const wrapper=$('mc-fields');wrapper.replaceChildren();
      SECTIONS.forEach((section,index)=>{
        const details=e('details','mc-section');details.id=sectionId(section.key);
        details.open=index===0||index===1;
        const summary=e('summary','mc-section-summary');
        const title=e('span','mc-section-title');title.id='mc-section-label-'+section.key;
        summary.append(title,e('span','mc-section-count',String(section.fields.length).padStart(2,'0')));
        details.append(summary);
        const body=e('div','mc-fields');
        for(const key of section.fields){
          const isLong=key.endsWith('.scene')||key.endsWith('.body')||key==='tagline';
          const label=e('label','mc-field');
          const caption=e('span','mc-field-label');caption.id='mc-label-'+fieldId(key);
          const control=e(isLong?'textarea':'input','mc-input');
          control.id=fieldId(key);
          control.name=key;
          control.required=true;
          if(isLong)control.rows=key.endsWith('.scene')?5:3;
          else control.type='text';
          const max=key==='title'?100:key==='tagline'?260:key.endsWith('.scene')?1100:
            key.endsWith('.body')?1300:key.endsWith('.question')?190:
            key.startsWith('endings.')?110:130;
          control.maxLength=max;
          control.autocomplete='off';
          control.addEventListener('input',()=>{
            dirty=true;$('mc-download').disabled=true;
            $('mc-dirty').hidden=false;message('statusDirty');
          });
          label.append(caption,control);
          body.append(label);
        }
        details.append(body);wrapper.append(details);
      });
    }
    function refreshCopy(){
      doc.documentElement.lang=language;
      doc.querySelectorAll('[data-mc-text]').forEach(node=>{
        const key=node.dataset.mcText;
        if(OWN(t(),key))node.textContent=t()[key];
      });
      SECTIONS.forEach((section,i)=>{
        $('mc-section-label-'+section.key).textContent=t().sections[i];
        for(const key of section.fields)$('mc-label-'+fieldId(key)).textContent=titleFor(key);
      });
      doc.querySelectorAll('[data-mc-lang]').forEach(b=>{
        const active=b.dataset.mcLang===language;
        b.classList.toggle('active',active);
        b.setAttribute('aria-pressed',String(active));
      });
      $('mc-choice-list').setAttribute('aria-label',t().ariaChoices);
      $('mc-map-start').textContent=t().mapStart;
      $('mc-map-branches').textContent=t().mapBranches;
      $('mc-map-end').textContent=t().mapEnd;
      $('mc-back').textContent=t().back;
      $('mc-restart').textContent=t().again;
      render();
    }
    function message(key,suffix=''){
      $('mc-feedback').textContent=t()[key]+suffix;
    }
    function fillForm(draft){
      const story=normalizeDraft(draft);
      for(const key of FIELDS)$(fieldId(key)).value=readPath(story,key);
      $('mc-story-language').value=story.language;
      $('mc-rights').checked=story.rights_self_attested;
      $('mc-disclose').checked=story.sponsorship_disclosure_committed;
    }
    function readForm(){
      const raw=demoDraft();
      raw.language=$('mc-story-language').value;
      raw.rights_self_attested=$('mc-rights').checked;
      raw.sponsorship_disclosure_committed=$('mc-disclose').checked;
      for(const key of FIELDS)writePath(raw,key,$(fieldId(key)).value);
      return normalizeDraft(raw);
    }
    function loadLocalDraft(raw){
      const restored=normalizeDraft(raw);
      // A restored/local version never carries forward old legal attestations.
      restored.rights_self_attested=false;
      restored.sponsorship_disclosure_committed=false;
      fillForm(restored);
      current=restored;history=[];dirty=false;
      $('mc-dirty').hidden=true;
      $('mc-download').disabled=true;
      render();message('statusImported');
      return normalizeDraft(restored);
    }
    function render(){
      const part=atStep(current,history);
      $('mc-play-index').textContent=String(part.index+1).padStart(2,'0')+' / 03';
      $('mc-progress-fill').style.width=String((part.index+1)/3*100)+'%';
      $('mc-progress').setAttribute('aria-valuenow',String(part.index+1));
      $('mc-play-kicker').textContent=part.ending?t().ending:t().step+' '+(part.index+1);
      $('mc-play-title').textContent=part.title;
      $('mc-play-copy').textContent=part.body;
      $('mc-play-question').hidden=part.ending;
      $('mc-play-question').textContent=part.question;
      $('mc-unverified').textContent=t().unverified;
      const list=$('mc-choice-list');list.replaceChildren();
      part.choices.forEach((choice,i)=>{
        const button=e('button','mc-choice');
        button.type='button';
        button.append(e('span','mc-choice-number',i===0?'A':'B'),e('span','mc-choice-label',choice),e('span','mc-choice-icon','↗'));
        button.addEventListener('click',()=>{history=takeChoice(history,i);render();});
        list.append(button);
      });
      $('mc-back').disabled=history.length===0;
      $('mc-play-card').dataset.step=part.index;
      $('mc-graph').dataset.position=history.length===0?'start':history.length===1?'branch':'end';
    }
    function apply(){
      try{
        current=readForm();history=[];dirty=false;
        $('mc-dirty').hidden=true;
        $('mc-download').disabled=!(current.rights_self_attested&&current.sponsorship_disclosure_committed);
        message($('mc-download').disabled?'statusNeedRights':'statusApplied');
        render();
        $('mc-preview').scrollIntoView({block:'start',behavior:'auto'});
      }catch(err){
        const path=String(err.message||'').split(':')[1]||'story';
        const input=$(fieldId(path));
        if(input){const section=input.closest('details');if(section)section.open=true;input.focus();}
        message('statusError',path);
        $('mc-download').disabled=true;
      }
    }
    function download(){
      try{
        if(dirty)throw Error('STALE_PREVIEW');
        const content=exportDraft(current);
        const blob=new Blob([content],{type:'application/json;charset=utf-8'});
        const href=URL.createObjectURL(blob),link=e('a');
        link.href=href;link.download='marcosa-original-story-draft.json';
        doc.body.append(link);link.click();link.remove();
        win.setTimeout(()=>URL.revokeObjectURL(href),1500);
        message('statusExport');
      }catch(err){message('statusNeedRights');}
    }
    async function importFile(event){
      const file=event.target.files&&event.target.files[0];
      event.target.value='';
      if(!file)return;
      try{
        if(file.size>131072)throw Error('INVALID_IMPORT_SIZE');
        const imported=parseDraftFile(await file.text());
        // A copied/imported file must never be treated as independently verified.
        imported.rights_self_attested=false;
        imported.sponsorship_disclosure_committed=false;
        fillForm(imported);current=imported;history=[];dirty=false;
        $('mc-download').disabled=true;$('mc-dirty').hidden=true;
        render();message('statusImported');
      }catch(err){message('statusImportError');}
    }
    buildFields();fillForm(current);
    $('mc-apply').addEventListener('click',apply);
    $('mc-download').addEventListener('click',download);
    $('mc-import').addEventListener('change',importFile);
    $('mc-rights').addEventListener('change',()=>{dirty=true;$('mc-download').disabled=true;$('mc-dirty').hidden=false;message('statusDirty');});
    $('mc-disclose').addEventListener('change',()=>{dirty=true;$('mc-download').disabled=true;$('mc-dirty').hidden=false;message('statusDirty');});
    $('mc-story-language').addEventListener('change',()=>{dirty=true;$('mc-download').disabled=true;$('mc-dirty').hidden=false;message('statusDirty');});
    $('mc-back').addEventListener('click',()=>{history=history.slice(0,-1);render();});
    $('mc-restart').addEventListener('click',()=>{history=[];render();});
    $('mc-reset').addEventListener('click',()=>{
      if(dirty&&typeof win.confirm==='function'&&!win.confirm(t().confirmReset))return;
      current=normalizeDraft(demoDraft());fillForm(current);
      history=[];dirty=false;$('mc-dirty').hidden=true;$('mc-download').disabled=true;
      render();message('statusReset');
    });
    doc.querySelectorAll('[data-mc-lang]').forEach(b=>b.addEventListener('click',()=>{
      const next=b.dataset.mcLang;if(!LANGS.includes(next))return;
      language=next;refreshCopy();
    }));
    refreshCopy();message('statusReady');$('mc-download').disabled=true;
    return Object.freeze({
      get preview(){return normalizeDraft(current);},
      get history(){return history.slice();},
      get locale(){return language;},
      get dirty(){return dirty;},
      getEditedDraft(){return readForm();},
      loadLocalDraft,apply,render
    });
  }
  return Object.freeze({SCHEMA,LANGS,SECTIONS,FIELDS,REVIEW_GATES,UI,demoDraft,
    normalizeDraft,exportDraft,parseDraftFile,readPath,writePath,atStep,takeChoice,mount});
});