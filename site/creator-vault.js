/* MARCOSA R9 — LOCAL project vault, immutable draft revisions, manual review handoff.
 * IndexedDB is used ONLY following explicit author Save. No autosave, networking,
 * third-party packages, user identities, payments or publication endpoints.
 * Browser site-data deletion removes local drafts: export backups separately.
 */
(function(root,factory){
  'use strict';
  const engine=typeof module==='object'&&module.exports?require('./creator.js'):(root&&root.MarcosaCreatorStudio);
  const api=factory(engine);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document){
    root.MarcosaLocalVault=api;
    const boot=()=>{root.MarcosaLocalVaultRuntime=api.mount(root.document,root);};
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});
    else boot();
  }
})(typeof window!=='undefined'?window:undefined,function(engine){
  'use strict';
  if(!engine)throw Error('CREATOR_ENGINE_REQUIRED');
  const DB='marcosa-local-vault-r9';
  const STORE='draft_projects';
  const WORKSPACE_SCHEMA='marcosa-local-workspace/v1';
  const REVIEW_SCHEMA='marcosa-review-packet/v1';
  const MAX_PROJECTS=8,MAX_VERSIONS=15;
  const CHECK_KEYS=Object.freeze(['authorship','sponsorship','editorial','privacy']);
  const RECORD_KEYS=Object.freeze(['schema','id','title','updated_at','revisions']);
  const REV_KEYS=Object.freeze(['revision','created_at','note','draft']);
  const COPY_KEYS=Object.freeze(['language',...engine.FIELDS]);
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const I18N={
    ru:{
      section:'ЛОКАЛЬНЫЙ АРХИВ ПРОЕКТОВ',intro:'Создавай несколько историй, сохраняй версии вручную, сравнивай изменения и передавай JSON на независимую проверку. Данные остаются в этом браузере.',
      storage:'ТОЛЬКО ЭТО УСТРОЙСТВО',limit:'До 8 проектов · 15 редакций в каждом',warning:'Внимание: это не облачная копия. Очистка данных сайта, другой браузер или приватный режим могут уничтожить сохранённые версии. Не храни здесь конфиденциальные материалы. Скачивай резервный JSON.',
      saveTitle:'НАЗВАНИЕ ПРОЕКТА',noteTitle:'ЧТО ИЗМЕНИЛОСЬ',notePlaceholder:'Например: улучшены финалы и диалоги',save:'СОХРАНИТЬ НОВУЮ ВЕРСИЮ',fork:'НОВЫЙ ПРОЕКТ ИЗ ТЕКСТА',projects:'СОХРАНЁННЫЕ ПРОЕКТЫ',versions:'ИСТОРИЯ ВЕРСИЙ',
      empty:'Здесь пока нет проектов — сохрани первый.',none:'Выбери проект, чтобы увидеть версии.',open:'ОТКРЫТЬ',restore:'ВОССТАНОВИТЬ',compare:'СРАВНИТЬ',remove:'УДАЛИТЬ ПРОЕКТ',changeNone:'Изменений между редакциями нет.',base:'Первая редакция: пока не с чем сравнивать.',changed:'Изменено полей: ',v:'Версия',archived:'Последние 15 версий',
      review:'ПАКЕТ НА РУЧНУЮ МОДЕРАЦИЮ',reviewLead:'Чек-лист автора — не одобрение редактора. Проверку прав, безопасности и разрешение на публикацию должен выполнить независимый человек.',
      rights:'Я автор материала или имею право использовать его.',sponsor:'Я проверил, что реклама/спонсорство обозначены явно, если они есть.',editorial:'Я вычитал тексты и проверил все четыре финала.',privacy:'Я проверил, что в тексте нет личных или секретных данных.',
      export:'ЭКСПОРТ ПАКЕТА ДЛЯ ПРОВЕРКИ',reviewFoot:'Экспорт не публикует историю. Независимая проверка прав, редактура и ручное разрешение остаются обязательными.',
      available:'Локальный архив доступен. Версии сохраняются только после нажатия кнопки.',unavailable:'Локальное хранилище этого браузера недоступно. Используй скачивание JSON в редакторе.',
      saved:'Версия сохранена на этом устройстве. Для резервной копии скачай JSON.',opened:'Проект открыт. Подтверди права заново перед экспортом.',restored:'Редакция восстановлена в редактор. Сохрани её новой версией, чтобы продолжить историю.',forked:'Текущий текст станет отдельным проектом при следующем сохранении.',
      deleted:'Проект и все его локальные версии удалены.',reviewReady:'Пакет для независимой модерации выгружен в JSON. Ничего не опубликовано.',
      reviewBlocked:'Для передачи на проверку сохрани текущую версию, отметь все пункты и не изменяй текст после сохранения.',
      invalid:'Проверь все обязательные поля редактора и сохрани корректный черновик.',error:'Операция не удалась. Проверь доступность хранилища и свободное место.',
      limitError:'Достигнут лимит проектов (8) или превышено число допустимых редакций.',stale:'Другая вкладка изменила этот проект. Открой последнюю версию перед новым сохранением.',
      deleteConfirm:'Безвозвратно удалить проект и все версии с этого устройства?',discardConfirm:'Есть несохранённые изменения. Заменить содержимое редактора сохранённой версией?',
      noVersion:'Нет сохранённой версии для независимой проверки.',noCompare:'Первая версия',modified:'Несохранённые изменения',
      outcome:'Не опубликовано · никакой модерации ещё не проводилось'
    },
    en:{
      section:'LOCAL PROJECT VAULT',intro:'Keep multiple stories, save deliberate revisions, compare changes and export a handoff file for independent human review. Everything stays in this browser.',
      storage:'THIS DEVICE ONLY',limit:'Up to 8 projects · 15 versions each',warning:'Not a cloud backup. Clearing site data, using another browser or private mode may erase local drafts. Avoid sensitive material. Download independent JSON backups.',
      saveTitle:'PROJECT NAME',noteTitle:'WHAT CHANGED',notePlaceholder:'Example: refined the endings',save:'SAVE NEW REVISION',fork:'NEW PROJECT FROM THIS STORY',projects:'SAVED PROJECTS',versions:'VERSION HISTORY',
      empty:'No saved projects yet. Save your first revision.',none:'Select a project to see versions.',open:'OPEN',restore:'RESTORE',compare:'COMPARE',remove:'DELETE PROJECT',changeNone:'No field changes between revisions.',base:'First version — nothing to compare yet.',changed:'Fields changed: ',v:'Version',archived:'Last 15 versions',
      review:'MANUAL REVIEW HANDOFF',reviewLead:'Author self-checks are not an editorial approval. Rights, safety and publication must be independently verified by people.',
      rights:'I wrote this material or have permission to use it.',sponsor:'I have checked sponsorship is clearly labeled when applicable.',editorial:'I have proofread and tested all four endings.',privacy:'I checked the story does not contain private or secret data.',
      export:'EXPORT REVIEW HANDOFF',reviewFoot:'Export does not publish anything. Independent rights checks, editorial review and manual approval are still required.',
      available:'Local vault is available. Revisions are saved only when you click Save.',unavailable:'Local browser storage is unavailable. Use the editor’s downloadable JSON instead.',
      saved:'Revision saved on this device. Download JSON for an independent backup.',opened:'Project opened. Reconfirm your rights before exporting.',restored:'Revision restored into the editor. Save it as a new revision to continue.',forked:'The next save will create a separate project from this text.',
      deleted:'Project and its local revisions deleted.',reviewReady:'Independent-review JSON handoff exported. Nothing was published.',
      reviewBlocked:'Save the current revision, check every item and do not edit after saving before review export.',
      invalid:'Complete all mandatory editor fields before saving.',error:'Operation failed. Check browser storage availability and free space.',
      limitError:'Local vault project limit reached or revision exceeds limits.',stale:'Another tab changed this project. Re-open its latest revision before saving.',
      deleteConfirm:'Permanently delete the project and all versions from this device?',discardConfirm:'Unsaved changes will be replaced. Restore the saved story?',
      noVersion:'No saved revision exists for independent review.',noCompare:'First revision',modified:'Unsaved changes',
      outcome:'Not published · no independent review has occurred'
    },
    zh:{
      section:'本地项目档案',intro:'管理多个故事，手动保存版本，比较改动，并导出独立人工审核文件。数据只存放在此浏览器。',
      storage:'仅此设备',limit:'最多 8 个项目 · 每个 15 个版本',warning:'这不是云备份。清除网站数据、换浏览器或使用隐私模式可能会丢失草稿。不要储存敏感信息，请单独下载 JSON 备份。',
      saveTitle:'项目名称',noteTitle:'修改备注',notePlaceholder:'例如：完善了结局',save:'保存新版本',fork:'从当前故事新建项目',projects:'已保存项目',versions:'版本历史',
      empty:'没有项目。请保存第一个版本。',none:'请选择一个项目查看版本。',open:'打开',restore:'恢复',compare:'比较',remove:'删除项目',changeNone:'两个版本没有字段差异。',base:'第一版，暂无比较对象。',changed:'更改的字段：',v:'版本',archived:'保留最近 15 个版本',
      review:'人工审核文件',reviewLead:'作者自检不等于编辑批准。版权、安全与发布均需人工独立核实。',
      rights:'我拥有内容版权或已获得使用许可。',sponsor:'适用时已明确标注赞助内容。',editorial:'我已校对文字并测试四个结局。',privacy:'内容中没有个人隐私或秘密数据。',
      export:'导出人工审核文件',reviewFoot:'导出并不发布。仍需独立版权审查、编辑审查和人工批准。',
      available:'本地档案可用。仅点击保存时记录版本。',unavailable:'无法访问浏览器本地存储。请使用编辑器的 JSON 导出。',
      saved:'版本已保存至本设备。请另存 JSON 备份。',opened:'项目已打开。导出前请重新确认权限。',restored:'旧版本已恢复至编辑器。继续修改时请保存为新版本。',forked:'下次保存会基于当前故事创建独立项目。',
      deleted:'项目及其本地版本已删除。',reviewReady:'已导出人工审核 JSON，未发布任何内容。',
      reviewBlocked:'请保存当前版本，确认全部检查项，并确保保存后没有改动。',
      invalid:'请完成编辑器所有必填字段。',error:'操作失败。请检查存储权限与剩余空间。',
      limitError:'达到项目限制或版本数量限制。',stale:'其他标签页已修改项目。请先打开最新版本。',
      deleteConfirm:'从本设备永久删除该项目及其所有版本吗？',discardConfirm:'未保存的修改将被覆盖。是否恢复已保存版本？',
      noVersion:'没有可审核的保存版本。',noCompare:'第一版',modified:'未保存更改',
      outcome:'未发布 · 未经独立审核'
    }
  };
  const exact=(object,keys,label)=>{
    if(!object||typeof object!=='object'||Array.isArray(object))throw Error('INVALID_'+label);
    const actual=Object.keys(object).sort(),wanted=keys.slice().sort();
    if(actual.length!==wanted.length||actual.some((x,i)=>x!==wanted[i]))throw Error('UNKNOWN_'+label);
  };
  const iso=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&
    Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
  const validId=value=>typeof value==='string'&&/^mc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
  const title=value=>{
    if(typeof value!=='string'||value.trim().length<4||value.trim().length>100)throw Error('INVALID_PROJECT_TITLE');
    return value.trim();
  };
  const note=value=>{
    if(typeof value!=='string'||value.length>140||/[\u0000-\u001f]/.test(value))throw Error('INVALID_REVISION_NOTE');
    return value.trim();
  };
  const storeStory=draft=>{
    const clean=engine.normalizeDraft(draft);
    clean.rights_self_attested=false;
    clean.sponsorship_disclosure_committed=false;
    return clean;
  };
  function normalizeRecord(raw){
    exact(raw,RECORD_KEYS,'WORKSPACE_RECORD');
    if(raw.schema!==WORKSPACE_SCHEMA||!validId(raw.id)||!iso(raw.updated_at)||
      !Array.isArray(raw.revisions)||!raw.revisions.length||raw.revisions.length>MAX_VERSIONS)
      throw Error('INVALID_WORKSPACE_RECORD');
    const versions=raw.revisions.map((entry,i)=>{
      exact(entry,REV_KEYS,'REVISION');
      if(!Number.isSafeInteger(entry.revision)||entry.revision<1||
        (i>0&&entry.revision!==raw.revisions[i-1].revision+1)||!iso(entry.created_at))
        throw Error('INVALID_REVISION');
      const cleaned=storeStory(entry.draft);
      // Persisted files must not claim a prior consent as still active.
      if(entry.draft.rights_self_attested!==false||entry.draft.sponsorship_disclosure_committed!==false)
        throw Error('STORED_CONSENT_IS_NOT_VALID');
      return {revision:entry.revision,created_at:entry.created_at,note:note(entry.note),draft:cleaned};
    });
    const final=versions[versions.length-1];
    const cleanTitle=title(raw.title);
    if(cleanTitle!==final.draft.title||raw.updated_at!==final.created_at)
      throw Error('INCONSISTENT_WORKSPACE_RECORD');
    return {schema:WORKSPACE_SCHEMA,id:raw.id,title:cleanTitle,updated_at:raw.updated_at,revisions:versions};
  }
  function createRecord(raw,{id,created_at,note:message='' }){
    if(!validId(id)||!iso(created_at))throw Error('INVALID_REVISION_METADATA');
    const draft=storeStory(raw);
    return normalizeRecord({
      schema:WORKSPACE_SCHEMA,id,title:draft.title,updated_at:created_at,
      revisions:[{revision:1,created_at,note:note(message),draft}]
    });
  }
  function appendRecord(previous,raw,{created_at,note:message='',expected_revision}){
    const record=normalizeRecord(previous);
    if(!iso(created_at))throw Error('INVALID_REVISION_METADATA');
    const last=record.revisions[record.revisions.length-1].revision;
    if(expected_revision!==last)throw Error('STALE_VERSION');
    // Same millisecond saves must preserve an ordered monotone version number.
    const when=Date.parse(created_at)<=Date.parse(record.updated_at)?
      new Date(Date.parse(record.updated_at)+1).toISOString():created_at;
    const draft=storeStory(raw);
    return normalizeRecord({
      ...record,title:draft.title,updated_at:when,
      revisions:record.revisions.concat({revision:last+1,created_at:when,note:note(message),draft}).slice(-MAX_VERSIONS)
    });
  }
  function diffDrafts(left,right){
    const a=storeStory(left),b=storeStory(right);
    return COPY_KEYS.filter(key=>engine.readPath(a,key)!==engine.readPath(b,key))
      .map(key=>({field:key,before:engine.readPath(a,key),after:engine.readPath(b,key)}));
  }
  function reviewPacket(raw,checks,{requested_at}){
    const record=normalizeRecord(raw);
    exact(checks,CHECK_KEYS,'REVIEW_CHECKS');
    if(CHECK_KEYS.some(k=>checks[k]!==true)||!iso(requested_at))throw Error('REVIEW_CHECKS_REQUIRED');
    const current=record.revisions[record.revisions.length-1];
    return {
      schema:REVIEW_SCHEMA,status:'prepared_for_manual_review',publication_state:'not_published',
      requested_at,source:{project_id:record.id,revision:current.revision,created_at:current.created_at},
      self_checklist:{...checks},
      rights_independently_verified:false,editorially_approved:false,security_verified:false,
      approved_for_publication:false,payments:false,tracking:false,
      mandatory_review_gates:engine.REVIEW_GATES.slice(),
      story:storeStory(current.draft),
      disclaimer:'LOCAL EXPORT ONLY. Self-attestations are not independent approval. No publication occurred.'
    };
  }
  const label=(lang,key)=>I18N[lang]&&I18N[lang][key]||I18N.ru[key]||key;
  const summarize=record=>{
    const clean=normalizeRecord(record),last=clean.revisions[clean.revisions.length-1];
    return {id:clean.id,title:clean.title,updated_at:clean.updated_at,count:clean.revisions.length,version:last.revision};
  };
  const makeId=crypto=>{
    if(!crypto)throw Error('CRYPTO_UNAVAILABLE');
    if(typeof crypto.randomUUID==='function')return 'mc-'+crypto.randomUUID();
    if(typeof crypto.getRandomValues!=='function')throw Error('CRYPTO_UNAVAILABLE');
    const data=new Uint8Array(16);crypto.getRandomValues(data);
    data[6]=(data[6]&15)|64;data[8]=(data[8]&63)|128;
    const h=[...data].map(v=>v.toString(16).padStart(2,'0')).join('');
    return 'mc-'+[h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');
  };

  function createVault(indexedDB,crypto){
    if(!indexedDB)throw Error('STORAGE_UNAVAILABLE');
    function open(){
      return new Promise((resolve,reject)=>{
        const request=indexedDB.open(DB,1);
        request.onupgradeneeded=()=>{
          const db=request.result;
          if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'});
        };
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error||Error('STORAGE_OPEN_FAILED'));
        request.onblocked=()=>reject(Error('STORAGE_BLOCKED'));
      });
    }
    async function run(mode,operation){
      const db=await open();
      return new Promise((resolve,reject)=>{
        let value,problem=null;
        let tx;
        try{tx=db.transaction(STORE,mode);}catch(e){db.close();reject(e);return;}
        tx.oncomplete=()=>{db.close();resolve(value);};
        tx.onerror=()=>{db.close();reject(problem||tx.error||Error('STORAGE_FAILED'));};
        tx.onabort=()=>{db.close();reject(problem||tx.error||Error('STORAGE_ABORTED'));};
        const done=result=>{value=result;};
        const fail=e=>{problem=e;try{tx.abort();}catch(err){reject(e);}};
        try{operation(tx.objectStore(STORE),done,fail);}
        catch(e){fail(e);}
      });
    }
    return Object.freeze({
      async list(){
        return run('readonly',(store,done,fail)=>{
          const request=store.getAll();
          request.onsuccess=()=>{
            try{done(request.result.map(normalizeRecord).sort((a,b)=>b.updated_at.localeCompare(a.updated_at)));}
            catch(e){fail(e);}
          };
        });
      },
      async get(id){
        if(!validId(id))throw Error('INVALID_PROJECT_ID');
        return run('readonly',(store,done,fail)=>{
          const request=store.get(id);
          request.onsuccess=()=>{
            try{done(request.result?normalizeRecord(request.result):null);}
            catch(e){fail(e);}
          };
        });
      },
      async save({id=null,expected_revision=null,draft,message='',time=new Date().toISOString()}){
        // Validate before opening a transaction; never save partial or unbounded input.
        const clean=storeStory(draft),comment=note(message);
        if(!iso(time)||(id!==null&&!validId(id)))throw Error('INVALID_SAVE');
        return run('readwrite',(store,done,fail)=>{
          if(id===null){
            const count=store.count();
            count.onsuccess=()=>{
              try{
                if(count.result>=MAX_PROJECTS)throw Error('PROJECT_LIMIT');
                const fresh=createRecord(clean,{id:makeId(crypto),created_at:time,note:comment});
                const add=store.add(fresh);
                add.onsuccess=()=>done(fresh);
              }catch(e){fail(e);}
            };
          }else{
            const get=store.get(id);
            get.onsuccess=()=>{
              try{
                if(!get.result)throw Error('PROJECT_NOT_FOUND');
                const next=appendRecord(get.result,clean,{created_at:time,note:comment,expected_revision});
                const put=store.put(next);
                put.onsuccess=()=>done(next);
              }catch(e){fail(e);}
            };
          }
        });
      },
      async remove(id){
        if(!validId(id))throw Error('INVALID_PROJECT_ID');
        return run('readwrite',(store,done)=>{
          const del=store.delete(id);
          del.onsuccess=()=>done(true);
        });
      },
      async restoreRecords(records){
        // One transaction: reject malformed, oversized, or duplicate-ID backups before
        // any writes; preserve existing projects even when a backup ID has diverged.
        if(!Array.isArray(records)||records.length>MAX_PROJECTS)
          throw Error('INVALID_BACKUP_PROJECT_COUNT');
        const incoming=records.map(normalizeRecord);
        if(new Set(incoming.map(x=>x.id)).size!==incoming.length)
          throw Error('DUPLICATE_BACKUP_IDS');
        return run('readwrite',(store,done,fail)=>{
          const existingRequest=store.getAll();
          existingRequest.onsuccess=()=>{
            try{
              const originals=existingRequest.result.map(normalizeRecord);
              const lookup=new Map(originals.map(x=>[x.id,x]));
              const used=new Set(originals.concat(incoming).map(x=>x.id));
              const additions=[];
              let skipped=0,conflicts=0;
              for(const incomingRecord of incoming){
                let project=incomingRecord;
                if(lookup.has(project.id)){
                  if(JSON.stringify(lookup.get(project.id))===JSON.stringify(project)){
                    skipped++;continue;
                  }
                  // Collision = independent copy, NEVER overwrite either history.
                  let newId;
                  for(let attempt=0;attempt<10;attempt++){
                    const candidate=makeId(crypto);
                    if(!used.has(candidate)){newId=candidate;used.add(candidate);break;}
                  }
                  if(!newId)throw Error('RESTORE_RANDOM_ID_COLLISION');
                  project={...project,id:newId};
                  conflicts++;
                }
                additions.push(normalizeRecord(project));
              }
              if(originals.length+additions.length>MAX_PROJECTS)
                throw Error('PROJECT_LIMIT');
              for(const project of additions)store.add(project);
              done({added:additions.length,skipped,conflicts,
                total:originals.length+additions.length});
            }catch(err){fail(err);}
          };
        });
      }
    });
  }
  function mount(doc,win){
    if(!doc.getElementById('mc-vault'))return null;
    const runtime=win.MarcosaCreatorRuntime;
    if(!runtime)throw Error('CREATOR_RUNTIME_NOT_READY');
    const $=id=>doc.getElementById(id);
    const e=(tag,cls,content)=>{
      const n=doc.createElement(tag);if(cls)n.className=cls;
      if(content!==undefined)n.textContent=content;
      return n;
    };
    let language=runtime.locale,active=null,records=[],unsaved=false,busy=false,storage=null;
    const t=key=>label(language,key),last=record=>record.revisions[record.revisions.length-1];
    const checks=()=>Object.fromEntries(CHECK_KEYS.map(key=>[key,$('mc-review-'+key).checked]));
    function status(key,additional=''){
      $('mc-vault-feedback').textContent=t(key)+(additional?': '+additional:'');
    }
    function lock(flag){busy=flag;$('mc-save-revision').disabled=flag||!storage;$('mc-delete-project').disabled=flag||!active;}
    function resetChecks(){
      for(const k of CHECK_KEYS)$('mc-review-'+k).checked=false;
      syncReview();
    }
    function editedMatchesLatest(){
      if(!active||unsaved||!runtime)return false;
      try{
        const current=storeStory(runtime.getEditedDraft());
        return JSON.stringify(current)===JSON.stringify(last(active).draft);
      }catch(err){return false;}
    }
    function syncReview(){
      const okay=!!active&&editedMatchesLatest()&&CHECK_KEYS.every(k=>$('mc-review-'+k).checked);
      $('mc-export-review').disabled=!okay||busy;
      $('mc-current-version').textContent=active?'v'+last(active).revision+' / '+active.title:t('none');
      $('mc-unsaved-label').hidden=!unsaved;
    }
    function makeButton(text,cls,handler){
      const button=e('button','mc-vault-button '+(cls||''),text);
      button.type='button';button.addEventListener('click',handler);return button;
    }
    function prettyDate(value){
      try{return new Date(value).toLocaleString(language==='zh'?'zh-CN':language==='en'?'en-GB':'ru-RU',{
        year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'
      });}catch(err){return value;}
    }
    function renderProjects(){
      const list=$('mc-project-list');list.replaceChildren();
      if(!records.length)list.append(e('p','mc-vault-empty',t('empty')));
      for(const record of records){
        const box=e('article','mc-project-card'+(active&&active.id===record.id?' selected':''));
        const info=e('div','mc-project-info');
        info.append(e('strong','',record.title),e('small','',prettyDate(record.updated_at)+' · '+t('v')+' '+last(record).revision));
        box.append(info,makeButton(t('open'),'mc-vault-open',()=>openProject(record)));
        list.append(box);
      }
    }
    function showDiff(entry){
      const pane=$('mc-revision-diff');pane.replaceChildren();
      if(!active)return;
      const idx=active.revisions.findIndex(r=>r.revision===entry.revision);
      if(idx<=0){pane.append(e('p','',t('base')));return;}
      const before=active.revisions[idx-1].draft;
      const diffs=diffDrafts(before,entry.draft);
      pane.append(e('strong','',t('changed')+diffs.length));
      if(!diffs.length){pane.append(e('p','',t('changeNone')));return;}
      const ul=e('ul','mc-diff-list');
      for(const diff of diffs){
        const li=e('li','');
        li.append(e('strong','',diff.field));
        const cut=value=>String(value).replace(/\s+/g,' ').slice(0,90);
        li.append(e('p','',cut(diff.before)+' → '+cut(diff.after)));
        ul.append(li);
      }
      pane.append(ul);
    }
    function renderVersions(){
      const pane=$('mc-version-list');pane.replaceChildren();
      $('mc-delete-project').disabled=!active||busy;
      if(!active){pane.append(e('p','mc-vault-empty',t('none')));$('mc-revision-diff').replaceChildren();syncReview();return;}
      for(const entry of active.revisions.slice().reverse()){
        const row=e('article','mc-version-row');
        const noteText=entry.note?' · '+entry.note:'';
        const description=e('div','mc-version-info');
        description.append(e('strong','',t('v')+' '+entry.revision),e('span','',prettyDate(entry.created_at)+noteText));
        const actions=e('div','mc-version-actions');
        actions.append(makeButton(t('compare'),'mc-vault-secondary',()=>showDiff(entry)),
          makeButton(t('restore'),'mc-vault-secondary',()=>restore(entry)));
        row.append(description,actions);pane.append(row);
      }
      syncReview();
    }
    function render(){
      renderProjects();renderVersions();syncReview();
    }
    async function refresh(){
      if(!storage)return;
      records=await storage.list();
      if(active)active=records.find(x=>x.id===active.id)||null;
      render();
    }
    function markUnsaved(){
      unsaved=true;
      resetChecks();
      syncReview();
    }
    async function openProject(record){
      if(unsaved&&typeof win.confirm==='function'&&!win.confirm(t('discardConfirm')))return;
      const current=await storage.get(record.id);
      if(!current){await refresh();return;}
      active=current;runtime.loadLocalDraft(last(current).draft);
      $('mc-project-name').value=current.title;
      $('mc-version-note').value='';
      unsaved=false;resetChecks();await refresh();status('opened');
    }
    function restore(entry){
      if(unsaved&&typeof win.confirm==='function'&&!win.confirm(t('discardConfirm')))return;
      runtime.loadLocalDraft(entry.draft);
      $('mc-project-name').value=entry.draft.title;
      unsaved=entry.revision!==last(active).revision;
      resetChecks();render();status('restored');
      $('mc-editor').scrollIntoView({block:'start',behavior:'auto'});
    }
    function problemKey(err){
      const v=String(err&&err.message||'');
      if(v==='PROJECT_LIMIT')return 'limitError';
      if(v==='STALE_VERSION')return 'stale';
      if(/INVALID_|UNKNOWN_|RIGHTS_REQUIRED|DRAFT_/.test(v))return 'invalid';
      return 'error';
    }
    async function save(){
      if(busy||!storage)return;
      lock(true);
      try{
        const draft=runtime.getEditedDraft();
        draft.title=title($('mc-project-name').value);
        const comment=$('mc-version-note').value;
        const record=await storage.save({
          id:active?active.id:null,
          expected_revision:active?last(active).revision:null,
          draft,message:comment
        });
        // Bring the editor and actual saved content into sync only after durable IDB commit.
        runtime.loadLocalDraft(record.revisions[record.revisions.length-1].draft);
        // Saved R9 versions are always unpublished and keep no prior checkmark.
        active=record;unsaved=false;$('mc-version-note').value='';
        resetChecks();await refresh();status('saved');
      }catch(err){status(problemKey(err));}
      finally{lock(false);syncReview();}
    }
    async function remove(){
      if(!active||busy||!storage)return;
      if(typeof win.confirm==='function'&&!win.confirm(t('deleteConfirm')))return;
      lock(true);
      try{await storage.remove(active.id);active=null;unsaved=true;resetChecks();await refresh();status('deleted');}
      catch(err){status('error');}
      finally{lock(false);syncReview();}
    }
    function download(name,data){
      const text=JSON.stringify(data,null,2)+'\n';
      const blob=new Blob([text],{type:'application/json;charset=utf-8'});
      const href=URL.createObjectURL(blob),link=e('a');
      link.href=href;link.download=name;doc.body.append(link);link.click();link.remove();
      win.setTimeout(()=>URL.revokeObjectURL(href),2000);
    }
    function exportForReview(){
      try{
        if(!active||!editedMatchesLatest()||!CHECK_KEYS.every(k=>checks()[k]))throw Error('REVIEW_BLOCKED');
        const packet=reviewPacket(active,checks(),{requested_at:new Date().toISOString()});
        download('marcosa-manual-review-v'+last(active).revision+'.json',packet);
        resetChecks();status('reviewReady');
      }catch(err){status('reviewBlocked');syncReview();}
    }
    function refreshLocale(){
      language=runtime.locale;
      doc.querySelectorAll('[data-mcv-text]').forEach(node=>{
        const key=node.dataset.mcvText;
        if(own(I18N[language]||I18N.ru,key))node.textContent=t(key);
      });
      $('mc-version-note').placeholder=t('notePlaceholder');
      render();
    }
    $('mc-vault').addEventListener('input',event=>{
      if(event.target.id==='mc-project-name')markUnsaved();
    });
    $('mc-editor').addEventListener('input',event=>{
      if(event.target.matches('input,textarea'))markUnsaved();
    });
    $('mc-editor').addEventListener('change',event=>{
      if(event.target.matches('input,select,textarea'))markUnsaved();
    });
    $('mc-reset').addEventListener('click',()=>{markUnsaved();active=null;render();});
    $('mc-import').addEventListener('change',()=>{markUnsaved();active=null;render();});
    $('mc-save-revision').addEventListener('click',save);
    $('mc-create-project').addEventListener('click',()=>{
      if(unsaved&&typeof win.confirm==='function'&&!win.confirm(t('discardConfirm')))return;
      active=null;unsaved=true;$('mc-project-name').value=runtime.preview.title;
      resetChecks();render();status('forked');
    });
    $('mc-delete-project').addEventListener('click',remove);
    $('mc-export-review').addEventListener('click',exportForReview);
    for(const key of CHECK_KEYS)$('mc-review-'+key).addEventListener('change',syncReview);
    doc.querySelectorAll('[data-mc-lang]').forEach(b=>b.addEventListener('click',refreshLocale));
    $('mc-project-name').value=runtime.preview.title;
    if(win.indexedDB){
      try{storage=createVault(win.indexedDB,win.crypto);}
      catch(err){storage=null;}
    }
    if(!storage){$('mc-save-revision').disabled=true;status('unavailable');render();}
    else{
      refresh().then(()=>status('available')).catch(()=>{
        storage=null;$('mc-save-revision').disabled=true;status('unavailable');render();
      });
    }
    refreshLocale();
    return Object.freeze({
      get activeProject(){return active?normalizeRecord(active):null;},
      get unsaved(){return unsaved;},
      get readyForReview(){return !!active&&editedMatchesLatest()&&CHECK_KEYS.every(k=>checks()[k]);},
      refresh,save,exportForReview,restore
    });
  }
  return Object.freeze({
    DB,STORE,WORKSPACE_SCHEMA,REVIEW_SCHEMA,MAX_PROJECTS,MAX_VERSIONS,CHECK_KEYS,
    storeStory,normalizeRecord,createRecord,appendRecord,diffDrafts,reviewPacket,
    summarize,createVault,mount
  });
});