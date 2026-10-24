/* MARCOSA R13 — offline, voluntary playtest feedback analysis.
 * Reports must be supplied by readers manually; no network, cookies, IDs,
 * names, telemetry or persistent browser storage. Counts are REPORTS,
 * never verified unique people. The dashboard resets if the story changes.
 */
(function(root,factory){
  'use strict';
  const standalone=typeof module==='object'&&module.exports?
    require('./creator-standalone.js'):(root&&root.MarcosaPlayableExport);
  const api=factory(standalone);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document){
    root.MarcosaPlaytest=api;
    const start=()=>{root.MarcosaPlaytestRuntime=api.mount(root.document,root);};
    if(root.document.readyState==='loading')
      root.document.addEventListener('DOMContentLoaded',start,{once:true});
    else start();
  }
})(typeof window!=='undefined'?window:undefined,function(standalone){
  'use strict';
  if(!standalone)throw Error('STANDALONE_ENGINE_REQUIRED');
  const SCHEMA='marcosa-playtest-feedback/v1';
  const SUMMARY_SCHEMA='marcosa-playtest-summary/v1';
  const PATHS=Object.freeze(['00','01','10','11']);
  const MAX_FILE_BYTES=2048,MAX_BATCH=100,MAX_REPORTS=300;
  const MATCH=/^[0-9a-f]{64}$/;
  const textBytes=value=>new TextEncoder().encode(value).length;
  const isPlain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  function validateReport(raw){
    if(!isPlain(raw))throw Error('INVALID_FEEDBACK');
    const expected=['schema','story_fingerprint','path','rating'].sort();
    const actual=Object.keys(raw).sort();
    if(actual.length!==expected.length||actual.some((x,i)=>x!==expected[i]))
      throw Error('UNKNOWN_FEEDBACK_FIELD');
    if(raw.schema!==SCHEMA||!MATCH.test(raw.story_fingerprint)||
       !PATHS.includes(raw.path)||!Number.isInteger(raw.rating)||
       raw.rating<1||raw.rating>5)
      throw Error('INVALID_FEEDBACK');
    return Object.freeze({
      schema:SCHEMA,story_fingerprint:raw.story_fingerprint,
      path:raw.path,rating:raw.rating
    });
  }
  function parseReport(source){
    if(typeof source!=='string'||textBytes(source)>MAX_FILE_BYTES)
      throw Error('FEEDBACK_TOO_LARGE');
    let parsed;
    try{parsed=JSON.parse(source);}catch(err){throw Error('INVALID_FEEDBACK_JSON');}
    return validateReport(parsed);
  }
  function aggregate(reports,storyFingerprint){
    if(!Array.isArray(reports)||reports.length>MAX_REPORTS||
       !MATCH.test(storyFingerprint))throw Error('INVALID_ANALYSIS');
    const rows=PATHS.map(path=>({path,count:0,total:0,distribution:[0,0,0,0,0]}));
    for(const source of reports){
      const item=validateReport(source);
      if(item.story_fingerprint!==storyFingerprint)
        throw Error('DIFFERENT_STORY');
      const row=rows[PATHS.indexOf(item.path)];
      row.count++;row.total+=item.rating;row.distribution[item.rating-1]++;
    }
    return {
      schema:SUMMARY_SCHEMA,story_fingerprint:storyFingerprint,
      imported_reports:reports.length,
      overall_average:reports.length?
        Math.round(rows.reduce((n,x)=>n+x.total,0)/reports.length*100)/100:null,
      endings:rows.map(row=>({
        path:row.path,count:row.count,
        average:row.count?Math.round(row.total/row.count*100)/100:null,
        distribution:row.distribution
      })),
      limitation:'Self-selected, unverified file submissions. Files may be duplicated. Counts are reports, not unique readers. No network collection.'
    };
  }
  const COPY={
    ru:{
      title:'ТЕСТИРОВАНИЕ ИСТОРИИ',intro:'Раздай созданный HTML читателям. После финала каждый может добровольно скачать оценку (1–5) и отправить тебе JSON. Загрузи полученные файлы сюда, чтобы увидеть средние оценки по четырём финалам.',
      import:'ЗАГРУЗИТЬ ФАЙЛЫ ОТЗЫВОВ JSON',clear:'ОЧИСТИТЬ СТАТИСТИКУ',
      download:'СКАЧАТЬ СВОДКУ JSON',all:'ВСЕ ОЦЕНКИ',count:'Файлов отзывов',
      average:'Средняя оценка',none:'Нет данных',per:'финал',sample:'Отзывов',
      initial:'Загрузи добровольно присланные файлы отзывов, чтобы увидеть результат.',
      added:'Файлы проверены и добавлены: ',invalid:'Неверный файл отзыва или превышен лимит. Ничего не импортировано.',
      wrong:'Этот отзыв относится к другой редакции истории. Смешивать оценки разных сюжетов нельзя.',
      stale:'Текст истории изменился — прежние оценки скрыты. Загрузи отзывы для новой редакции.',
      empty:'Сначала загрузи хотя бы один файл отзыва.',
      cleared:'Отчёты удалены из памяти этой вкладки.',
      exported:'Анонимная сводка скачана на устройство.',
      caution:'Оценки собираются ТОЛЬКО по желанию игроков и только вручную: файл не отправляется автоматически. Без аккаунтов и идентификаторов нельзя проверить уникальность участников или достоверность оценок. Не используй эти числа как доказательство реального спроса.',
      cap:'Не более 100 файлов за раз, 300 оценок в одной вкладке. Не сохраняется в облако или браузерную базу. Никаких имён, IP, времени и свободного текста.'
    },
    en:{
      title:'OFFLINE STORY PLAYTEST',intro:'Share the exported HTML with readers. At an ending, each person can voluntarily download a 1–5 rating file and send it to you. Import these JSON files to see feedback for all four endings.',
      import:'IMPORT FEEDBACK JSON FILES',clear:'CLEAR LOCAL RESULTS',
      download:'DOWNLOAD SUMMARY JSON',all:'ALL RATINGS',count:'Feedback files',
      average:'Average rating',none:'No data',per:'ending',sample:'Reports',
      initial:'Import feedback files sent voluntarily by your readers.',
      added:'Validated feedback files added: ',invalid:'Invalid feedback file or limit exceeded. Nothing was imported.',
      wrong:'This feedback belongs to another story revision. Reports for different versions cannot be mixed.',
      stale:'You changed the story. Prior results were hidden; import feedback for the updated version.',
      empty:'Import at least one feedback file first.',
      cleared:'Feedback was cleared from this tab.',
      exported:'Anonymous summary downloaded to your device.',
      caution:'All feedback is voluntary and manually shared — never automatically sent. With no accounts or identifiers, unique readers or truthful submissions cannot be verified. These ratings do not prove market demand.',
      cap:'Up to 100 files per batch and 300 per tab. No cloud or browser persistence. No names, IPs, timestamps or free-text notes.'
    },
    zh:{
      title:'离线故事测试',intro:'将导出的 HTML 分享给读者。读者在结局后可自愿下载 1–5 分反馈 JSON 并发送给你。在此导入文件，查看四个结局的评分。',
      import:'导入评分 JSON 文件',clear:'清空本地结果',
      download:'下载汇总 JSON',all:'全部评分',count:'反馈文件数',
      average:'平均评分',none:'暂无数据',per:'结局',sample:'反馈数',
      initial:'导入读者自愿发送的反馈文件以查看结果。',
      added:'已验证并导入文件：',invalid:'反馈文件无效或超出数量限制。没有导入任何数据。',
      wrong:'该反馈属于另一版本故事，不能混合不同版本的评分。',
      stale:'故事已修改。旧评分已隐藏，请为新版本导入反馈。',
      empty:'请先导入至少一个评分文件。',
      cleared:'本页内存中的评分已清除。',
      exported:'匿名汇总已下载至本设备。',
      caution:'反馈完全自愿，由读者自行发送，不会自动上传。没有账户或标识符，无法确认参与人数和评分真实性。数据并非市场需求证明。',
      cap:'每次最多 100 个文件，每页最多 300 条评分。不使用云端或浏览器持久化。无姓名、IP、时间或自由文本。'
    }
  };
  function mount(doc,win){
    if(!doc.getElementById('mc-playtest'))return null;
    const $=id=>doc.getElementById(id);
    const e=(tag,cls,contents)=>{
      const n=doc.createElement(tag);
      if(cls)n.className=cls;
      if(contents!==undefined)n.textContent=contents;
      return n;
    };
    const input=$('mc-playtest-files');
    const runtime=win.MarcosaCreatorRuntime;
    let records=[],fingerprint=null,language='ru',busy=false;
    const t=key=>(COPY[language]||COPY.ru)[key];
    const status=(key,suffix='')=>{$('mc-playtest-status').textContent=t(key)+suffix;};
    function clearData(key){
      records=[];fingerprint=null;
      if(key)status(key);
      render();
    }
    function render(){
      const summary=fingerprint&&records.length?aggregate(records,fingerprint):null;
      $('mc-playtest-count').textContent=String(summary?.imported_reports||0);
      $('mc-playtest-average').textContent=summary&&summary.overall_average!==null?
        summary.overall_average.toFixed(2)+' / 5':'— / 5';
      $('mc-playtest-export').disabled=!summary||busy;
      const root=$('mc-playtest-results');root.replaceChildren();
      for(const [index,path] of PATHS.entries()){
        const item=e('div','mc-playtest-ending');
        const descriptor=e('div','mc-playtest-caption');
        const label=e('strong','',String.fromCharCode(65+Number(path[0]))+' → '+
          String.fromCharCode(65+Number(path[1])));
        let endingTitle='';
        try{endingTitle=runtime.getEditedDraft().endings[index].title;}
        catch(err){endingTitle='';}
        const title=e('span','mc-playtest-ending-title',endingTitle);
        descriptor.append(label,title);
        const stat=summary?.endings[index];
        const n=stat?.count||0;
        const score=e('div','mc-playtest-score',n?
          stat.average.toFixed(2)+' / 5 · '+n+' '+t('sample'):t('none'));
        const bar=e('div','mc-playtest-bar');
        bar.setAttribute('role','progressbar');
        bar.setAttribute('aria-label',path+' rating');
        bar.setAttribute('aria-valuemin','0');
        bar.setAttribute('aria-valuemax','5');
        bar.setAttribute('aria-valuenow',String(stat?.average||0));
        const fill=e('span','');
        fill.style.width=String(stat?.average?stat.average/5*100:0)+'%';
        bar.append(fill);
        item.append(descriptor,score,bar);root.append(item);
      }
    }
    function updateCopy(){
      language=runtime?.locale||'ru';
      doc.querySelectorAll('[data-mcp-text]').forEach(node=>{
        const key=node.dataset.mcpText;
        if(Object.prototype.hasOwnProperty.call(COPY[language]||COPY.ru,key))
          node.textContent=t(key);
      });
      render();
    }
    const currentFingerprint=()=>{
      if(!win.crypto?.subtle||!win.isSecureContext)
        throw Error('WEBCRYPTO_UNAVAILABLE');
      return standalone.storyFingerprint(runtime.getEditedDraft(),win.crypto);
    };
    async function importFiles(){
      const files=Array.from(input.files||[]);
      input.value='';
      if(!files.length)return;
      if(busy)return;
      if(files.length>MAX_BATCH||records.length+files.length>MAX_REPORTS){
        status('invalid');return;
      }
      busy=true;
      $('mc-playtest-export').disabled=true;
      try{
        const before=await currentFingerprint();
        if(fingerprint&&fingerprint!==before)clearData('stale');
        const batch=[];
        for(const file of files){
          if(file.size>MAX_FILE_BYTES)throw Error('FEEDBACK_TOO_LARGE');
          const item=parseReport(await file.text());
          if(item.story_fingerprint!==before)throw Error('DIFFERENT_STORY');
          batch.push(item);
        }
        const after=await currentFingerprint();
        if(before!==after)throw Error('STORY_CHANGED_WHILE_LOADING');
        records=records.concat(batch);fingerprint=before;
        render();status('added',String(batch.length));
      }catch(err){
        const reason=String(err.message||'');
        status(reason==='DIFFERENT_STORY'?'wrong':'invalid');
      }finally{busy=false;render();}
    }
    function exportSummary(){
      if(!records.length||!fingerprint){status('empty');return;}
      const report=aggregate(records,fingerprint);
      const blob=new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json;charset=utf-8'});
      const url=URL.createObjectURL(blob),link=e('a');
      link.href=url;link.download='marcosa-playtest-summary.json';
      doc.body.append(link);link.click();link.remove();
      win.setTimeout(()=>URL.revokeObjectURL(url),2000);
      status('exported');
    }
    input.addEventListener('change',importFiles);
    $('mc-playtest-export').addEventListener('click',exportSummary);
    $('mc-playtest-clear').addEventListener('click',()=>clearData('cleared'));
    $('mc-editor').addEventListener('input',()=>{
      if(records.length)clearData('stale');
    });
    $('mc-editor').addEventListener('change',()=>{
      if(records.length)clearData('stale');
    });
    doc.querySelectorAll('[data-mc-lang]').forEach(node=>node.addEventListener('click',updateCopy));
    updateCopy();render();status('initial');
    return Object.freeze({
      get count(){return records.length;},
      get fingerprint(){return fingerprint;},
      get summary(){return fingerprint&&records.length?aggregate(records,fingerprint):null;},
      importFiles,clearData,exportSummary
    });
  }
  return Object.freeze({SCHEMA,SUMMARY_SCHEMA,PATHS,MAX_FILE_BYTES,MAX_BATCH,MAX_REPORTS,COPY,
    validateReport,parseReport,aggregate,mount});
});