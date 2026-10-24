/* MARCOSA R12 — independent, self-contained playable story export.
 * Every narrative field is validated by R8 before use. Author text is encoded
 * as Base64 JSON, and inserted in the standalone player only via textContent.
 * The exported HTML has a SHA-256-hashed inline player, restrictive CSP,
 * zero external assets, tracking, dependencies, publishing or payments.
 */
(function(root,factory){
  'use strict';
  const creator=typeof module==='object'&&module.exports?
    require('./creator.js'):(root&&root.MarcosaCreatorStudio);
  const api=factory(creator);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document){
    root.MarcosaPlayableExport=api;
    const boot=()=>{root.MarcosaPlayableRuntime=api.mount(root.document,root);};
    if(root.document.readyState==='loading')
      root.document.addEventListener('DOMContentLoaded',boot,{once:true});
    else boot();
  }
})(typeof window!=='undefined'?window:undefined,function(creator){
  'use strict';
  if(!creator)throw Error('CREATOR_ENGINE_REQUIRED');
  const SCHEMA='marcosa-standalone-playable/v1';
  const MAX_HTML_BYTES=180000;
  const THEMES=Object.freeze(['cosmos','ember','aurora']);
  const I18N={
    ru:{scene:'СЦЕНА',ending:'ФИНАЛ',choose:'ВЫБЕРИ СВОЙ ПУТЬ',back:'← НАЗАД',
      restart:'НАЧАТЬ СНОВА',finished:'ИСТОРИЯ ЗАВЕРШЕНА',chapter:'ГЛАВА',
      offline:'АВТОНОМНАЯ ИСТОРИЯ',badge:'4 ФИНАЛА · 2 РЕШЕНИЯ',
      disclaimer:'Авторский файл · права на содержание не проверены MARCOSA · не опубликовано платформой',
      keyboard:'Клавиши 1/2 — выбор · ← — назад · R — начать снова'},
    en:{scene:'SCENE',ending:'ENDING',choose:'CHOOSE YOUR PATH',back:'← BACK',
      restart:'START AGAIN',finished:'THE STORY ENDS HERE',chapter:'CHAPTER',
      offline:'OFFLINE INTERACTIVE STORY',badge:'4 ENDINGS · 2 CHOICES',
      disclaimer:'Author-created file · rights not independently verified · not published by MARCOSA',
      keyboard:'Keys 1/2 — choice · ← — back · R — restart'},
    zh:{scene:'场景',ending:'结局',choose:'选择你的道路',back:'← 返回',
      restart:'重新开始',finished:'故事结束',chapter:'章节',
      offline:'离线互动故事',badge:'4 种结局 · 2 次选择',
      disclaimer:'作者创建的独立文件 · 未经独立版权审核 · 非 MARCOSA 平台发布',
      keyboard:'按 1/2 选择 · ← 返回 · R 重新开始'}
  };
  const COPY={
    ru:{title:'СОЗДАТЬ СВОЮ МИНИ-ИГРУ',intro:'Преврати написанную историю в самостоятельный интерактивный HTML-файл. Получатель сможет открыть его офлайн и пройти все четыре финала — без сайта, установки и регистрации.',
      theme:'ОФОРМЛЕНИЕ ФАЙЛА',rights:'Подтверждаю, что имею права на сюжет и весь текст.',sponsor:'Я проверил маркировку рекламного или спонсорского содержания.',
      privacy:'В истории нет секретных сведений или чужих персональных данных.',
      preview:'ПРОВЕРИТЬ АВТОНОМНУЮ ИСТОРИЮ',download:'СКАЧАТЬ ИНТЕРАКТИВНЫЙ HTML',
      help:'Предпросмотр работает без публикации. Для скачивания необходимо подтвердить три пункта. После загрузки HTML можно переслать файл или разместить его на своём сайте.',
      security:'Никакой внешней загрузки, аналитики и подключения к MARCOSA. Файл не содержит паролей или данных из локального архива. Права на текст не проверены независимо.',
      ready:'Файл собран. Пройди обе развилки во встроенном безопасном предпросмотре.',
      downloaded:'Интерактивный HTML скачан. Это твой автономный файл, не публикация на MARCOSA.',
      rightsRequired:'Для скачивания подтверди авторские права, рекламу и отсутствие приватных сведений.',
      failed:'Не удалось собрать файл. Проверь все обязательные поля редактора.',
      unavailable:'Нужен HTTPS или localhost с WebCrypto для создания проверенного автономного файла.',
      noPreview:'Нажми «Проверить автономную историю», чтобы здесь появился настоящий плеер.',
      cosmos:'Звёздная ночь',ember:'Алый горизонт',aurora:'Северное сияние'},
    en:{title:'PUBLISH YOUR OWN MINI-GAME FILE',intro:'Turn your original narrative into a self-contained playable HTML file. Readers can explore all four endings offline — no login, server or installation needed.',
      theme:'FILE THEME',rights:'I own the story rights or have permission to use all content.',sponsor:'I have checked sponsorship and advertisement disclosure.',privacy:'The story does not contain private or secret information.',
      preview:'TEST STANDALONE STORY',download:'DOWNLOAD PLAYABLE HTML',
      help:'Preview does not publish anything. Confirm all three checks before download. You may share the file yourself or upload it to your own website.',
      security:'No external network calls, analytics or connection to MARCOSA. No passwords or local-vault records are included. Rights are not independently checked.',
      ready:'Offline HTML created. Explore both choices and every ending in the sandboxed player.',
      downloaded:'Playable HTML downloaded. This is your file, not a MARCOSA publication.',
      rightsRequired:'Check rights, sponsorship and privacy before downloading.',
      failed:'Could not generate the playable file. Complete the required editor fields.',
      unavailable:'HTTPS or localhost with WebCrypto is required to produce the verified standalone file.',
      noPreview:'Select “Test standalone story” to open the real playable preview.',
      cosmos:'Starry night',ember:'Crimson horizon',aurora:'Northern lights'},
    zh:{title:'生成离线互动小游戏',intro:'将原创故事导出为独立的互动 HTML 文件。读者无需账户或网络，就能体验四种结局。',
      theme:'文件主题',rights:'我拥有或已获许可使用故事全部内容。',sponsor:'我已检查赞助内容的标注。',privacy:'故事不含隐私或秘密数据。',
      preview:'预览离线互动故事',download:'下载可玩的 HTML',
      help:'预览不代表发布。下载前确认三个项目。可以自行分享文件或上传至自己的网站。',
      security:'文件不会联网或追踪用户，不包含密码和本地存储数据。平台未独立核实版权。',
      ready:'已生成离线文件，可在沙盒内测试所有结局。',
      downloaded:'已下载独立 HTML 文件，不代表在 MARCOSA 发布。',
      rightsRequired:'请先确认版权、赞助与隐私项目。',
      failed:'无法生成文件，请检查编辑器的必填内容。',
      unavailable:'需要 HTTPS 或 localhost 与 WebCrypto。',
      noPreview:'点击“预览离线互动故事”以开始体验。',
      cosmos:'星空之夜',ember:'深红地平线',aurora:'极光'}
  };
  const CSS=[
    '*{box-sizing:border-box}html{min-height:100%;scroll-behavior:smooth}',
    ':root{color-scheme:dark;--bg:#080f20;--panel:#101e35;--accent:#b94d70;--gold:#f2d2a4;--ink:#f1e5d4;--soft:#bfcddd}',
    'html[data-theme="ember"]{--bg:#170e21;--panel:#251a2a;--accent:#ee6b68;--gold:#ffd5b6}',
    'html[data-theme="aurora"]{--bg:#081b29;--panel:#102d36;--accent:#4eafab;--gold:#caefe0}',
    'body{margin:0;min-height:100vh;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:var(--ink);',
    'background:radial-gradient(ellipse at 70% 12%,#35415c66 0,transparent 40%),',
    'radial-gradient(ellipse at 8% 85%,#5c304744 0,transparent 35%),var(--bg)}',
    'body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.2;',
    'background-image:radial-gradient(circle,#fff 1px,transparent 1.6px);',
    'background-size:63px 79px;background-position:17px 23px}',
    '.wrap{position:relative;max-width:1160px;margin:0 auto;padding:34px clamp(16px,5vw,48px) 60px}',
    '.top{display:flex;justify-content:space-between;gap:15px;align-items:center;',
    'border-bottom:1px solid #b5a4a35b;padding-bottom:22px}',
    '.mark{font-size:14px;font-weight:900;letter-spacing:.24em;color:var(--gold)}',
    '.pill{padding:9px 14px;border:1px solid #cab78d8a;border-radius:99px;',
    'font:700 10px/1.3 ui-monospace,monospace;letter-spacing:.09em;color:var(--gold)}',
    '.hero{padding:46px 0 26px;max-width:930px}',
    '.eyebrow{font:800 11px/1.5 ui-monospace,monospace;letter-spacing:.21em;color:#a5e1dd}',
    'h1{margin:18px 0 13px;font:400 clamp(38px,5.8vw,77px)/1.1 Georgia,serif;',
    'letter-spacing:-.035em;overflow-wrap:anywhere;color:var(--gold)}',
    '.tagline{font-size:clamp(14px,1.6vw,18px);line-height:1.75;color:#c6d3df;max-width:790px}',
    '.book{border:1px solid #d6b99288;border-radius:20px;overflow:hidden;',
    'box-shadow:0 30px 100px #0007,inset 0 1px #fff2;',
    'background:linear-gradient(145deg,var(--panel),#0b1527)}',
    '.book:before{content:"";display:block;height:3px;',
    'background:linear-gradient(90deg,#ffffff00,var(--accent),var(--gold),#ffffff00)}',
    '.book-in{padding:clamp(23px,5vw,55px)}',
    '.step{display:flex;justify-content:space-between;gap:16px;align-items:center;',
    'font:800 11px ui-monospace,monospace;letter-spacing:.15em;color:#c6e1e3}',
    '.track{height:4px;border-radius:6px;background:#91a8bd40;overflow:hidden;margin:19px 0 35px}',
    '.bar{height:100%;width:33.333%;background:linear-gradient(90deg,#9ed8d2,var(--accent),var(--gold));transition:width .28s}',
    'h2{font:400 clamp(27px,3vw,44px)/1.22 Georgia,serif;margin:0 0 21px;',
    'color:#ffe9ca;letter-spacing:-.022em;overflow-wrap:anywhere}',
    '.body{color:#d6e0e9;font-size:clamp(15px,1.6vw,18px);line-height:1.95;',
    'white-space:pre-wrap;overflow-wrap:anywhere;max-width:900px}',
    '.question{font:400 clamp(20px,2vw,27px)/1.4 Georgia,serif;',
    'color:var(--gold);margin:31px 0 19px;overflow-wrap:anywhere}',
    '.choices{display:grid;gap:13px;margin-top:15px}',
    'button{font-family:inherit;cursor:pointer;transition:transform .17s,border-color .17s,background .17s}',
    '.choice{display:flex;align-items:center;gap:17px;text-align:left;',
    'border-radius:11px;border:1px solid #a8b4cd87;background:#22324c;',
    'padding:18px 21px;color:#fff2dd;font-size:15px;line-height:1.45}',
    '.choice:hover{transform:translateY(-2px);border-color:#f4ca9d;background:#35415a}',
    '.choice .letter{flex:none;border:1px solid #dab583b8;',
    'padding:8px 10px;border-radius:7px;color:#ffd29a;font:800 11px ui-monospace,monospace}',
    '.choice .value{flex:1;overflow-wrap:anywhere}',
    '.choice .arrow{color:#f8bc91;font-size:20px}',
    '.actions{display:flex;gap:12px;margin-top:27px;padding-top:23px;border-top:1px solid #b9c2d23a}',
    '.action{flex:1;min-height:51px;border-radius:9px;border:1px solid #95b5bd88;',
    'background:#13283b;color:#e5d9c6;font-weight:800;font-size:12px;letter-spacing:.06em}',
    '.action:hover:not(:disabled){background:#214258;border-color:#edd0a0}',
    '.action:disabled{opacity:.4;cursor:not-allowed}',
    'button:focus-visible{outline:3px solid #c9f9e4;outline-offset:3px}',
    '.ending{margin:15px 0 0;color:#9edecb;font:800 11px ui-monospace,monospace;letter-spacing:.14em}',
    '.feedback{margin-top:29px;padding:24px 20px;border:1px solid #cfbd9b73;border-radius:13px;background:#142438d9}',
    '.feedback h3{margin:0 0 9px;font:400 clamp(22px,2.2vw,29px) Georgia,serif;color:var(--gold)}',
    '.feedback p{margin:0 0 18px;color:#c6d5de;font-size:12px;line-height:1.7}',
    '.feedback fieldset{margin:0;padding:0;border:0;min-width:0}',
    '.feedback legend{font-size:12px;font-weight:750;color:#cfe3e5;margin-bottom:12px}',
    '.rating-options{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}',
    '.rating{min-height:46px;border:1px solid #a0b6ba80;border-radius:9px;background:#1d314a;color:#f6deba;font-size:17px;font-weight:800}',
    '.rating[aria-pressed="true"]{background:#edd2a6;color:#17263b;border-color:#fff1d6}',
    '.rating:hover{border-color:#f5d5a4}',
    '.feedback-export{margin-top:15px;width:100%;min-height:47px;border:1px solid #e9c69c;border-radius:9px;background:#dec395;color:#19283a;font-weight:850;font-size:12px}',
    '.feedback-export:disabled{opacity:.43;cursor:not-allowed}',
    '.feedback-status{min-height:18px;margin:12px 0 0!important;color:#afe1d5!important}',
    'footer{display:flex;align-items:center;gap:15px;justify-content:space-between;flex-wrap:wrap;',
    'padding:23px 0 0;color:#a7b7c6;font-size:11px;line-height:1.6}',
    '.tip{font:10px/1.6 ui-monospace,monospace;color:#c8bcae}',
    '[hidden]{display:none!important}',
    '@media(max-width:700px){.wrap{padding:17px 13px 35px}.top{padding-bottom:13px}',
    '.mark{font-size:12px}.pill{font-size:8px;padding:8px}.hero{padding:32px 8px 16px}',
    '.book{border-radius:13px}.book-in{padding:22px 17px}.choice{padding:14px 13px}',
    '.choice .letter{padding:7px}.action{font-size:11px}footer{padding:17px 6px}}',
    '@media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;',
    'transition:none!important;animation:none!important}}'
  ].join('\n');
  function to64(bytes){
    if(typeof Buffer!=='undefined'&&typeof Buffer.from==='function')
      return Buffer.from(bytes).toString('base64');
    let binary='';
    for(let i=0;i<bytes.length;i+=8192)
      binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return btoa(binary);
  }
  function authoredData(draft){
    const clean=creator.normalizeDraft(draft);
    return {schema:SCHEMA,language:clean.language,title:clean.title,tagline:clean.tagline,
      opening:clean.opening,branches:clean.branches,endings:clean.endings};
  }
  function portablePlayer(base64){
    'use strict';
    const $=id=>document.getElementById(id);
    const story=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(
      Uint8Array.from(atob(base64),char=>char.charCodeAt(0))));
    const translations={
      ru:{step:'СЦЕНА',ending:'ФИНАЛ',choose:'ВЫБЕРИ СВОЙ ПУТЬ',back:'← НАЗАД',again:'НАЧАТЬ СНОВА',
        finished:'ИСТОРИЯ ЗАВЕРШЕНА',offline:'АВТОНОМНАЯ ИСТОРИЯ',badge:'4 ФИНАЛА · 2 РЕШЕНИЯ',
        disclaimer:'Авторский файл · права на содержание не проверены MARCOSA · не опубликовано платформой',
        keyboard:'Клавиши 1/2 — выбор · ← — назад · R — начать снова',
        rateTitle:'КАК ТЕБЕ ЭТОТ ФИНАЛ?',ratePrompt:'Оцени впечатление от 1 до 5',
        rating:'Оценка',downloadFeedback:'СКАЧАТЬ ОТЗЫВ ДЛЯ АВТОРА',
        feedbackPrivacy:'Только оценка и выбранный финал. Без имени, IP, времени и личного текста. Файл остаётся у тебя, пока ты сам его не передашь.',
        feedbackDone:'Отзыв сохранён на устройстве. Отправь файл автору самостоятельно.'},
      en:{step:'SCENE',ending:'ENDING',choose:'CHOOSE YOUR PATH',back:'← BACK',again:'START AGAIN',
        finished:'THE STORY ENDS HERE',offline:'OFFLINE INTERACTIVE STORY',badge:'4 ENDINGS · 2 CHOICES',
        disclaimer:'Author-created file · rights not independently verified · not published by MARCOSA',
        keyboard:'Keys 1/2 — choice · ← — back · R — restart',
        rateTitle:'HOW DID THIS ENDING FEEL?',ratePrompt:'Rate this ending from 1 to 5',
        rating:'Rating',downloadFeedback:'DOWNLOAD FEEDBACK FOR AUTHOR',
        feedbackPrivacy:'Only the rating and ending path. No name, IP, timestamp or personal text. The file stays on your device unless you share it yourself.',
        feedbackDone:'Feedback saved on your device. Send the file to the author yourself.'},
      zh:{step:'场景',ending:'结局',choose:'选择你的道路',back:'← 返回',again:'重新开始',
        finished:'故事结束',offline:'离线互动故事',badge:'4 种结局 · 2 次选择',
        disclaimer:'作者创建的独立文件 · 未经独立版权审核 · 非 MARCOSA 平台发布',
        keyboard:'按 1/2 选择 · ← 返回 · R 重新开始',
        rateTitle:'你觉得这个结局如何？',ratePrompt:'给结局评分：1 至 5',
        rating:'评分',downloadFeedback:'下载给作者的反馈文件',
        feedbackPrivacy:'文件仅含评分及所选结局，不含姓名、IP、时间或个人文字。只有你主动分享后作者才会收到。',
        feedbackDone:'评分文件已保存到本设备，可自行发送给作者。'}
    };
    const ui=translations[story.language]||translations.ru;
    const history=[];
    let selectedRating=0,selectedPath=null;
    const text=(id,value)=>{$(id).textContent=String(value);};
    text('app-label',ui.offline);text('app-badge',ui.badge);
    text('app-title',story.title);text('app-tagline',story.tagline);
    text('app-disclaimer',ui.disclaimer);text('app-keyboard',ui.keyboard);
    text('play-back',ui.back);text('play-restart',ui.again);
    text('feedback-heading',ui.rateTitle);
    text('feedback-legend',ui.ratePrompt);
    text('feedback-description',ui.feedbackPrivacy);
    text('play-download-feedback',ui.downloadFeedback);
    const ratingButtons=[];
    for(let rating=1;rating<=5;rating++){
      const button=document.createElement('button');
      button.type='button';button.className='rating';
      button.id='play-rate-'+rating;button.textContent='★ '+rating;
      button.setAttribute('aria-label',ui.rating+' '+rating+' / 5');
      button.setAttribute('aria-pressed','false');
      button.addEventListener('click',()=>{
        if(history.length!==2)return;
        selectedRating=rating;
        selectedPath=history.join('');
        for(const node of ratingButtons)
          node.setAttribute('aria-pressed',String(node===button));
        $('play-download-feedback').disabled=false;
        text('play-feedback-status','');
      });
      ratingButtons.push(button);$('play-rating-options').append(button);
    }
    $('play-download-feedback').addEventListener('click',()=>{
      if(history.length!==2||selectedRating<1||selectedRating>5||
         !/^[0-9a-f]{64}$/.test(story.story_fingerprint))return;
      const report={
        schema:'marcosa-playtest-feedback/v1',
        story_fingerprint:story.story_fingerprint,
        path:history.join(''),rating:selectedRating
      };
      const blob=new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json;charset=utf-8'});
      const url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download='marcosa-playtest-'+report.path+'.json';
      document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),2000);
      text('play-feedback-status',ui.feedbackDone);
    });
    document.title=story.title+' — MARCOSA Story';
    function render(){
      let part;
      if(history.length===0){
        part={title:story.title,body:story.opening.scene,
          question:story.opening.question,choices:story.opening.choices,ending:false};
      }else if(history.length===1){
        const branch=story.branches[history[0]];
        part={title:story.title,body:branch.scene,
          question:branch.question,choices:branch.choices,ending:false};
      }else{
        const ending=story.endings[history[0]*2+history[1]];
        part={title:ending.title,body:ending.body,
          question:'',choices:[],ending:true};
      }
      const step=history.length+1;
      text('play-step',(part.ending?ui.ending:ui.step)+' '+step+' / 3');
      $('play-progress').setAttribute('aria-valuenow',String(step));
      $('play-bar').style.width=String(step/3*100)+'%';
      text('play-title',part.title);text('play-body',part.body);
      text('play-question',part.ending?ui.finished:part.question);
      $('play-question').hidden=part.ending;
      $('play-complete').hidden=!part.ending;
      text('play-complete',ui.finished);
      const area=$('play-choices');
      area.replaceChildren();
      for(const [i,value] of part.choices.entries()){
        const button=document.createElement('button');
        button.type='button';button.className='choice';button.id='play-choose-'+(i===0?'a':'b');
        const letter=document.createElement('span');
        letter.className='letter';letter.textContent=i===0?'A':'B';
        const caption=document.createElement('span');
        caption.className='value';caption.textContent=value;
        const arrow=document.createElement('span');
        arrow.className='arrow';arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');
        button.append(letter,caption,arrow);
        button.addEventListener('click',()=>{
          if(history.length>=2)return;
          history.push(i);render();
          $('play-step').focus({preventScroll:true});
        });
        area.append(button);
      }
      $('play-back').disabled=history.length===0;
      $('play-root').dataset.stage=String(step);
      const path=part.ending?history.join(''):null;
      if(path!==selectedPath){
        selectedRating=0;selectedPath=path;
        for(const button of ratingButtons)button.setAttribute('aria-pressed','false');
        text('play-feedback-status','');
      }
      $('play-feedback').hidden=!part.ending;
      $('play-download-feedback').disabled=!part.ending||!selectedRating;
    }
    $('play-back').addEventListener('click',()=>{if(history.length){history.pop();render();}});
    $('play-restart').addEventListener('click',()=>{history.length=0;render();});
    document.addEventListener('keydown',event=>{
      if(event.altKey||event.ctrlKey||event.metaKey||event.repeat)return;
      if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;
      if((event.key==='1'||event.key==='2')&&history.length<2){
        event.preventDefault();
        $('play-choose-'+(event.key==='1'?'a':'b'))?.click();
      }else if(event.key==='ArrowLeft'&&history.length){
        event.preventDefault();$('play-back').click();
      }else if(event.key.toLowerCase()==='r'){
        event.preventDefault();$('play-restart').click();
      }
    });
    render();
  }
  async function storyFingerprint(draft,provider){
    if(!provider||!provider.subtle||typeof provider.subtle.digest!=='function')
      throw Error('WEBCRYPTO_UNAVAILABLE');
    const normalized=authoredData(draft);
    const bytes=new TextEncoder().encode(JSON.stringify(normalized));
    const hash=new Uint8Array(await provider.subtle.digest('SHA-256',bytes));
    return Array.from(hash,x=>x.toString(16).padStart(2,'0')).join('');
  }
  async function buildPlayable(draft,options,provider){
    const content=authoredData(draft);
    const theme=options&&options.theme||'cosmos';
    if(!THEMES.includes(theme))throw Error('INVALID_PLAYABLE_THEME');
    if(!provider||!provider.subtle||typeof provider.subtle.digest!=='function')
      throw Error('WEBCRYPTO_UNAVAILABLE');
    content.story_fingerprint=await storyFingerprint(draft,provider);
    const json=JSON.stringify(content);
    const base64=to64(new TextEncoder().encode(json));
    const script='('+portablePlayer.toString()+')('+JSON.stringify(base64)+');';
    const hash=to64(new Uint8Array(await provider.subtle.digest('SHA-256',new TextEncoder().encode(script))));
    const csp="default-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'; object-src 'none'; img-src 'none'; font-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-"+hash+"'";
    const html=[
      '<!doctype html>','<html lang="'+content.language+'" data-theme="'+theme+'">',
      '<head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<meta name="referrer" content="no-referrer">',
      '<meta http-equiv="Content-Security-Policy" content="'+csp+'">',
      '<title>MARCOSA — Standalone Story</title><style>',CSS,'</style></head>',
      '<body><div class="wrap">',
      '<header class="top"><span class="mark">MARCOSA <span aria-hidden="true">✦</span> STORY</span>',
      '<span class="pill" id="app-badge"></span></header>',
      '<section class="hero"><p class="eyebrow" id="app-label"></p>',
      '<h1 id="app-title"></h1><p class="tagline" id="app-tagline"></p></section>',
      '<main class="book" id="play-root"><div class="book-in">',
      '<div class="step"><span id="play-step" tabindex="-1" aria-live="polite"></span>',
      '<span aria-hidden="true">01 / 02 / 03</span></div>',
      '<div class="track" id="play-progress" role="progressbar" aria-valuemin="1" aria-valuemax="3" aria-valuenow="1" aria-label="Story progress">',
      '<div class="bar" id="play-bar"></div></div>',
      '<h2 id="play-title"></h2><p class="body" id="play-body"></p>',
      '<p class="question" id="play-question"></p><div class="choices" id="play-choices" role="group" aria-label="Story choices"></div>',
      '<p class="ending" id="play-complete" hidden></p>',
      '<section class="feedback" id="play-feedback" aria-labelledby="feedback-heading" hidden>',
      '<h3 id="feedback-heading"></h3><p id="feedback-description"></p>',
      '<fieldset><legend id="feedback-legend"></legend>',
      '<div class="rating-options" id="play-rating-options"></div></fieldset>',
      '<button type="button" class="feedback-export" id="play-download-feedback" disabled></button>',
      '<p class="feedback-status" id="play-feedback-status" role="status" aria-live="polite"></p></section>',
      '<div class="actions"><button type="button" class="action" id="play-back" disabled></button>',
      '<button type="button" class="action" id="play-restart"></button></div>',
      '</div></main>',
      '<footer><span id="app-disclaimer"></span><span class="tip" id="app-keyboard"></span></footer>',
      '</div><noscript>This story requires JavaScript enabled in your browser.</noscript>',
      '<script>'+script+'</script></body></html>'
    ].join('\n');
    if(new TextEncoder().encode(html).length>MAX_HTML_BYTES)
      throw Error('PLAYABLE_TOO_LARGE');
    return html;
  }
  function filename(title){
    if(typeof title!=='string')throw Error('INVALID_PLAYABLE_FILENAME');
    const slug=title.normalize('NFKD').toLowerCase()
      .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,54);
    return 'marcosa-story-'+(slug||'original')+'.html';
  }
  function mount(doc,win){
    if(!doc.getElementById('mc-standalone'))return null;
    const $=id=>doc.getElementById(id);
    let language='ru',busy=false,lastPreview=null;
    const t=key=>(COPY[language]||COPY.ru)[key];
    const status=(key)=>{$('mc-standalone-feedback').textContent=t(key);};
    const available=()=>!!win.crypto?.subtle&&!!win.isSecureContext;
    const lock=flag=>{
      busy=flag;$('mc-standalone-preview').disabled=flag||!available();
      $('mc-standalone-download').disabled=flag||!available();
    };
    function refreshCopy(){
      language=win.MarcosaCreatorRuntime?.locale||'ru';
      doc.querySelectorAll('[data-mcs-text]').forEach(node=>{
        const key=node.dataset.mcsText;
        if(Object.prototype.hasOwnProperty.call(COPY[language]||COPY.ru,key))
          node.textContent=t(key);
      });
      const opts=$('mc-standalone-theme').options;
      for(const opt of opts)if(Object.prototype.hasOwnProperty.call(COPY[language]||COPY.ru,opt.value))
        opt.textContent=t(opt.value);
    }
    async function compile(download){
      if(busy||!available()){status('unavailable');return;}
      if(download&&(!$('mc-standalone-rights').checked||
        !$('mc-standalone-sponsor').checked||!$('mc-standalone-privacy').checked)){
        status('rightsRequired');return;
      }
      const runtime=win.MarcosaCreatorRuntime;
      lock(true);
      try{
        const raw=runtime.getEditedDraft();
        const html=await buildPlayable(raw,{theme:$('mc-standalone-theme').value},win.crypto);
        if(download){
          const blob=new Blob([html],{type:'text/html;charset=utf-8'});
          const url=URL.createObjectURL(blob),a=doc.createElement('a');
          a.href=url;a.download=filename(raw.title);
          doc.body.append(a);a.click();a.remove();
          win.setTimeout(()=>URL.revokeObjectURL(url),3000);
          status('downloaded');
        }else{
          $('mc-standalone-player').srcdoc=html;
          $('mc-standalone-empty').hidden=true;
          $('mc-standalone-player').hidden=false;
          lastPreview=html;status('ready');
        }
      }catch(err){status('failed');}
      finally{lock(false);}
    }
    $('mc-standalone-preview').addEventListener('click',()=>compile(false));
    $('mc-standalone-download').addEventListener('click',()=>compile(true));
    doc.querySelectorAll('[data-mc-lang]').forEach(node=>node.addEventListener('click',refreshCopy));
    refreshCopy();lock(false);
    if(!available())status('unavailable');
    return Object.freeze({compile,get available(){return available();},
      get previewHtml(){return lastPreview;}});
  }
  return Object.freeze({SCHEMA,MAX_HTML_BYTES,THEMES,COPY,I18N,authoredData,filename,
    portablePlayer,storyFingerprint,buildPlayable,mount});
});