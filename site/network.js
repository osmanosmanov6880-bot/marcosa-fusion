/* MARCOSA Network OS R2 public preview.
   Source-based catalogue and browser-only creative planning.
   Does NOT connect to Supabase, track visitors, buy ads or publish sites. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    root.MarcosaNetworkPreview = api;
    if (root.document.readyState === 'loading')
      root.document.addEventListener('DOMContentLoaded', function () { api.mount(root.document); }, { once: true });
    else api.mount(root.document);
  }
})(typeof window !== 'undefined' ? window : undefined, function () {
  'use strict';
  const rows = [
    ['PRD-001','ados-network','AdOS Network','adtech','v17.0.0','Пилотная рекламная сеть: кабинеты, инвентарь и управление размещениями.','Advertising inventory and placement workflows.'],
    ['PRD-002','impossible-ai','IMPOSSIBLE AI','creative','v0.1.0','Конструктор интерактивных рекламных миров и кампаний.','AI-assisted interactive advertising worlds.'],
    ['PRD-003','intentgraph-cosmic','IntentGraph Cosmic ONE','adtech','v4.5','Согласования рекламы, отчёты и кинематографический интерфейс.','Ad approval and reporting workflows.'],
    ['PRD-004','intentmesh','IntentMesh','adtech','v2.9','Прототип аналитики намерений и эффективности взаимодействий.','Intent and media intelligence prototype.'],
    ['PRD-005','kvalora','KVALORA','adtech','v0.17','Контролируемые кампании и проверка партнёрских заявок.','Controlled lead-quality campaigns.'],
    ['PRD-006','opspilot','OpsPilot Spectrum','operations','v2.2','Учебная лаборатория проверки закупок на синтетических данных.','Synthetic purchase-review lab and interactive cinema.'],
    ['PRD-007','outcomemesh','OutcomeMesh','adtech','v0.15','Резервирование рекламных размещений и контроль исполнения.','Campaign reservations and fulfilment controls.'],
    ['PRD-008','proofos','ProofOS','trust','v0.12','Проверка утверждений, доказательств и документов.','Evidence and assertion-review workflows.'],
    ['PRD-009','signal-worlds','SIGNAL WORLDS','creative','v1.0','Интерактивное кино с передачей идей в рекламный кабинет.','Interactive cinema and creative handoffs.'],
    ['PRD-010','timeless','TIMELESS Ω','operations','v0.21','Очереди, онлайн-запись и управление временем ожидания.','Queues, bookings and waiting automation.'],
    ['PRD-011','universa-work','UNIVERSA WORK','trust','v0.30','Учебные задания и проверяемая оценка навыков.','Learning tasks and verifiable skills.'],
    ['PRD-012','waitos','WAITOS GLOBAL','operations','v1.9','Ожидаемые решения, дела, документы и сроки команд.','Cases, documents, deadlines and teamwork.'],
    ['PRD-013','impossible-ventures','Impossible Ventures','creative','GitHub','Семь экспериментальных рекламных вселенных.','Seven experimental ad universes.'],
    ['PRD-014','case-zero','Internet v Humanity / CASE ZERO','creative','GitHub','Интерактивные веб-истории с разными финалами.','Branching cinematic experiences.'],
    ['PRD-015','protocol-zero','PROTOCOL ZERO','creative','GitHub','Наследуемые рекламные сюжеты и коммерческие согласования.','Inherited ad stories and campaign reviews.'],
    ['PRD-016','adverse-judge','ADVERSE JUDGE','trust','GitHub','Проверка рекламных обещаний и вариантов креативов.','Review and evidence of advertising claims.']
  ];
  const products = Object.freeze(rows.map(function (r) {
    return Object.freeze({id:r[0],slug:r[1],name:r[2],group:r[3],version:r[4],description_ru:r[5],description_en:r[6],live:false});
  }));
  const labels = {
    ru:{all:'Все',creative:'Кино и креатив',adtech:'Реклама и AdTech',operations:'Бизнес и процессы',trust:'Доверие и знания',noResults:'Ничего не найдено',count:'результатов',view:'Подробнее',less:'Свернуть',detail:'Исходники известны, но публичный сервис, права и платежи не подтверждены.',plan:'Подготовить объявление',invalid:'Исправьте данные перед экспортом.',done:'Черновик скачан; никакая публикация не выполнялась.',empty:'Заполните название и описание.'},
    en:{all:'All',creative:'Cinema & creative',adtech:'Advertising',operations:'Operations',trust:'Trust & learning',noResults:'No projects found',count:'results',view:'Details',less:'Hide',detail:'Source recorded; live service, rights and payments are not confirmed.',plan:'Draft promotion',invalid:'Please correct the fields.',done:'Draft downloaded; nothing has been published.',empty:'Fill in title and description.'},
    zh:{all:'全部',creative:'电影与创意',adtech:'广告技术',operations:'商业运营',trust:'信任与学习',noResults:'没有找到项目',count:'项',view:'详情',less:'收起',detail:'已有源码记录，服务上线、版权和支付尚未核验。',plan:'制作宣传草稿',invalid:'请更正输入。',done:'草稿已下载，未进行发布。',empty:'请填写标题和描述。'}
  };
  const translations = {
    en:{topline:'Independent digital worlds, connected',demoTag:'Public source preview · no payments',headline:'Discover what comes next.',lead:'Interactive stories and independent products in one discovery space. Each product remains independently owned.',seeProducts:'Explore projects ↗',buildCampaign:'Create promotional draft',productsMetric:'source-backed projects',filmMetric:'film sites awaiting review',paymentsMetric:'verified payments in this preview',tabProducts:'Projects',tabFilms:'Film network',tabCampaign:'Creative lab',tabAbout:'Principles',catalogKicker:'CURATED DIRECTORY',catalogTitle:'Many products. One discovery point.',notLive:'These are projects with known source code, not an inventory of live services.',searchLabel:'Search projects',searchPlaceholder:'Name, field or use case',noResults:'No projects match your search.',filmTitle:'43 stories, a potential discovery network',filmMissing:'Film sites still need review',filmDetail:'No verified list of 43 film domains is available. Owners, rights and deployment must be checked before linking.',openWorlds:'View MARCOSA principles ↗',campaignTitle:'Draft your own product promotion',campaignNote:'Drafts stay in your browser and can be downloaded as JSON. No ads are published, no payments or tracking.',chooseProduct:'Product to promote',headlineA:'Headline A',copyA:'Description A',headlineB:'Headline B (optional)',copyB:'Description B (with headline)',exportDraft:'Download draft JSON ↓',previewTitle:'PREVIEW · AFTER STORY',previewEmpty:'Add your product description.',previewLink:'Discover the project ↗',rawCounters:'No verified impressions, sign-ups or sales; A/B describes alternative text only.',aboutTitle:'Connected discovery, independent ownership.',principle1Title:'Products stay independent',principle1:'Each project retains its source code, domain, data and governance.',principle2Title:'The story comes first',principle2:'Recommendations should be voluntary and placed after an ending, without interrupting the story.',principle3Title:'Evidence before metrics',principle3:'No invented visitors, sales, attribution or approvals.',footerStatus:'Public code preview · not production'},
    zh:{topline:'独立数字世界，共同探索',demoTag:'公开源码演示 · 无付款',headline:'探索新的可能。',lead:'互动故事与独立数字产品汇聚一处，每个项目仍独立运行。',seeProducts:'探索项目 ↗',buildCampaign:'创建宣传草稿',productsMetric:'有源码记录的项目',filmMetric:'待审核的电影站点',paymentsMetric:'已验证的付款',tabProducts:'项目',tabFilms:'电影网络',tabCampaign:'创意实验室',tabAbout:'原则',catalogKicker:'项目目录',catalogTitle:'独立产品，共同发现。',notLive:'这些是已有源码的项目，不代表服务已经上线。',searchLabel:'搜索项目',searchPlaceholder:'名称、类别或用途',noResults:'没有找到项目。',filmTitle:'43 个故事，一个潜在网络',filmMissing:'电影站点仍待审核',filmDetail:'没有可信的 43 个域名清单，版权与所有权必须单独确认。',openWorlds:'查看 MARCOSA 原则 ↗',campaignTitle:'制作产品宣传草稿',campaignNote:'所有草稿仅在浏览器中处理；不发布广告、不付款、不追踪。',chooseProduct:'选择产品',headlineA:'标题 A',copyA:'描述 A',headlineB:'标题 B（可选）',copyB:'描述 B（与标题配对）',exportDraft:'下载 JSON 草稿 ↓',previewTitle:'预览 · 故事结束后',previewEmpty:'输入产品描述。',previewLink:'了解项目 ↗',rawCounters:'没有已核实的展示、注册或收入，A/B 只是文案候选。',aboutTitle:'互相发现，独立管理。',principle1Title:'产品保持独立',principle1:'每个项目拥有自己的源码、域名、数据和管理机制。',principle2Title:'故事优先',principle2:'推荐应出现在结束后，由用户自愿选择，不打断体验。',principle3Title:'先有证据再有指标',principle3:'不虚构访客、收入、转化或批准状态。',footerStatus:'公开源码演示 · 非正式上线'}
  };
  function csvRows(text) {
    if (typeof text !== 'string' || text.length > 262144) throw Error('CSV_SIZE');
    const result=[]; let cell='',row=[],quote=false;
    for (let i=0;i<text.length;i++) {
      const c=text[i];
      if (quote) {if (c==='"'&&text[i+1]==='"'){cell+='"';i++;} else if(c==='"')quote=false;else cell+=c;}
      else if(c==='"'){if(cell.trim())throw Error('CSV_QUOTE');quote=true;}
      else if(c===','){row.push(cell);cell='';}
      else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))result.push(row);row=[];cell='';}
      else cell+=c;
    }
    if(quote)throw Error('CSV_UNTERMINATED_QUOTE');
    row.push(cell);if(row.some(x=>x.trim()))result.push(row);
    if(result.length>45)throw Error('CSV_TOO_MANY_ROWS');
    return result;
  }
  function checkDomain(raw) {
    const str=String(raw||'').trim();
    if(!str || /\s/.test(str))throw Error('INVALID_DOMAIN');
    const url=new URL(str.match(/^https:\/\//i)?str:'https://'+str);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.port||url.pathname!=='/')throw Error('INVALID_DOMAIN');
    const host=url.hostname.toLowerCase();
    if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.startsWith('[')||/^\d+\.\d+\.\d+\.\d+$/.test(host)||!host.includes('.')||!/^[a-z0-9.-]+$/.test(host))throw Error('INVALID_DOMAIN');
    return host;
  }
  function parseFilmImport(text){
    const rows=csvRows(text);
    if(!rows.length)return [];
    const header=rows[0].map(x=>x.trim().replace(/^\uFEFF/,'').toLowerCase());
    const idx=header.indexOf('verified_domain');
    if(idx<0)throw Error('MISSING_COLUMN_verified_domain');
    const idxName=header.indexOf('project_name');
    const idxAsset=header.indexOf('asset_id');
    const seen=new Set(),out=[];
    for(let i=1;i<rows.length;i++){
      const raw=rows[i][idx]||'';if(!raw.trim())continue;
      const domain=checkDomain(raw);
      if(seen.has(domain))throw Error('DUPLICATE_DOMAIN_'+domain);
      seen.add(domain);
      out.push({asset_id:(rows[i][idxAsset]||'FILM-'+String(i).padStart(2,'0')).trim(),domain,project_name:(rows[i][idxName]||'').trim(),verified:false,rights_verified:false});
    }
    if(out.length>43)throw Error('TOO_MANY_FILMS');
    return out;
  }
  function htmlEsc(text){return String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function movieSnippet(p){return '<aside aria-label="Продолжить историю" style="padding:24px;border:1px solid #d8c5a1;border-radius:12px;background:#10151d;color:#f8f7f2">' +
    '<p style="color:#a4dfd2;font-size:12px">MARCOSA / SELF-DECLARED DEMO</p>'+
    '<h2>'+htmlEsc(p.message)+'</h2><p>'+htmlEsc(p.product_name)+'</p>'+
    '<a style="color:#e1c590" href="https://marcosa.club/#network" rel="noopener noreferrer">Открыть MARCOSA ↗</a>'+
    '</aside>';
  }
  function mount(doc){
    const d=doc.getElementById('mn-dialog');if(!d)return;
    const $=id=>doc.getElementById(id);
    const $$=query=>Array.from(d.querySelectorAll(query));
    let language='ru',category='all',query='',tab='products',filmRows=[],latestFilm=null,returnFocus=null;
    const el=(tag,cls,txt)=>{const e=doc.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e;};
    const label=k=>(labels[language]||labels.ru)[k]||labels.ru[k]||k;
    function download(name,txt,mime){
      const a=doc.createElement('a'),blob=new Blob([txt],{type:mime}),url=URL.createObjectURL(blob);
      a.href=url;a.download=name;doc.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
    }
    function open(trigger){returnFocus=trigger||doc.activeElement;if(!d.open&&typeof d.showModal==='function')d.showModal();else d.setAttribute('open','');showTab(tab);}
    function close(){if(d.open&&typeof d.close==='function')d.close();else d.removeAttribute('open');if(returnFocus&&returnFocus.focus)returnFocus.focus();}
    function showTab(name){
      if(!['products','films','campaign','about'].includes(name))return;
      tab=name;$$('.mn-pane').forEach(e=>e.hidden=e.id!=='mn-pane-'+name);
      $$('[data-mn-tab]').forEach(e=>{const active=e.dataset.mnTab===name;e.classList.toggle('is-current',active);e.setAttribute('aria-pressed',String(active));});
    }
    function fillProducts(){
      const sels=[$('mn-product-select'),$('mn-film-product')];
      for(const sel of sels){const value=sel.value;sel.replaceChildren();for(const p of products){const o=el('option','',p.name);o.value=p.slug;sel.append(o);}if(products.some(p=>p.slug===value))sel.value=value;}
    }
    function categories(){
      const parent=$('mn-categories');parent.replaceChildren();
      for(const group of ['all','creative','adtech','operations','trust']){
        const b=el('button','mn-chip'+(group===category?' active':''),label(group));b.type='button';b.setAttribute('aria-pressed',String(group===category));
        b.addEventListener('click',()=>{category=group;categories();cards();});parent.append(b);
      }
    }
    function cards(){
      const filtered=products.filter(p=>(category==='all'||p.group===category)&&(!query||[p.name,p.slug,p.description_ru,p.description_en].join(' ').toLocaleLowerCase().includes(query)));
      $('mn-grid').replaceChildren();
      $('mn-results').textContent=filtered.length+' '+label('count');$('mn-empty').hidden=filtered.length>0;
      for(const p of filtered){
        const card=el('article','mn-card');const top=el('div','mn-card-top');
        top.append(el('span','mn-card-mark',p.name.slice(0,2).toUpperCase()));top.append(el('span','mn-card-tag',label(p.group)));card.append(top);
        card.append(el('h4','',p.name));card.append(el('p','',language==='ru'?p.description_ru:p.description_en));
        const foot=el('div','mn-card-bottom');foot.append(el('span','mn-card-version',p.version));
        const more=el('button','mn-card-action',label('view')+' ↗');more.type='button';more.setAttribute('aria-expanded','false');foot.append(more);card.append(foot);
        const details=el('div','mn-card-details');details.hidden=true;details.append(el('p','',label('detail')));
        const promo=el('button','',label('plan')+' ↗');promo.type='button';promo.addEventListener('click',()=>{$('mn-product-select').value=p.slug;showTab('campaign');previewCampaign();});details.append(promo);card.append(details);
        more.addEventListener('click',()=>{details.hidden=!details.hidden;more.textContent=(details.hidden?label('view'):label('less'))+' ↗';more.setAttribute('aria-expanded',String(!details.hidden));});
        $('mn-grid').append(card);
      }
    }
    function previewCampaign(){
      const p=products.find(x=>x.slug===$('mn-product-select').value);
      $('mn-preview-headline').textContent=$('mn-headline-a').value.trim()||p?.name||'MARCOSA';
      $('mn-preview-copy').textContent=$('mn-copy-a').value.trim()||p?.description_ru||'';
    }
    function applyLanguage(){
      const dict=translations[language]||{};
      d.lang=language;
      $$('[data-mn-text]').forEach(e=>{if(dict[e.dataset.mnText])e.textContent=dict[e.dataset.mnText];});
      $$('[data-mn-placeholder]').forEach(e=>{if(dict[e.dataset.mnPlaceholder])e.placeholder=dict[e.dataset.mnPlaceholder];});
      $$('[data-mn-lang]').forEach(e=>{const active=e.dataset.mnLang===language;e.classList.toggle('selected',active);e.setAttribute('aria-pressed',String(active));});
      categories();cards();previewCampaign();
    }
    function templateCSV(){
      const headings='asset_id,verified_domain,project_name,genre,source_repository,verified_rights,status,integration_priority';
      const rows=Array.from({length:43},(_,i)=>'FILM-'+String(i+1).padStart(2,'0')+',,,,,,unverified_missing_domain,');
      download('marcosa-film-sites-template.csv',headings+'\n'+rows.join('\n')+'\n','text/csv;charset=utf-8');
    }
    function renderFilmRows(){
      const parent=$('mn-film-list');parent.replaceChildren();
      $('mn-film-quantity').textContent=filmRows.length+' / 43';
      const sel=$('mn-film-source');sel.replaceChildren();
      for(const row of filmRows){
        parent.append(el('span','',row.domain+' · не подтверждён'));
        const o=el('option','',row.domain);o.value=row.domain;sel.append(o);
      }
      sel.disabled=!filmRows.length;$('mn-film-prepare').disabled=!filmRows.length;
      latestFilm=null;$('mn-film-download-json').disabled=true;$('mn-film-download-html').disabled=true;
      $('mn-film-preview').textContent=filmRows.length?'Выберите фильм и продукт, затем подтвердите права и сформируйте черновик.':'Импортируйте CSV с вашими реальными доменами.';
    }
    $('mn-close').addEventListener('click',close);
    d.addEventListener('click',e=>{if(e.target===d)close();});
    doc.querySelectorAll('[data-mn-open]').forEach(b=>b.addEventListener('click',()=>open(b)));
    $$('[data-mn-tab]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.mnTab)));
    $$('[data-mn-goto]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.mnGoto)));
    $$('[data-mn-lang]').forEach(b=>b.addEventListener('click',()=>{language=b.dataset.mnLang;applyLanguage();}));
    $('mn-search').addEventListener('input',e=>{query=e.target.value.trim().toLocaleLowerCase();cards();});
    $('mn-show-worlds').addEventListener('click',()=>showTab('about'));
    $('mn-product-select').addEventListener('change',previewCampaign);
    $('mn-headline-a').addEventListener('input',previewCampaign);
    $('mn-copy-a').addEventListener('input',previewCampaign);
    $('mn-campaign-form').addEventListener('submit',e=>{
      e.preventDefault();
      const a=$('mn-headline-a').value.trim(),dA=$('mn-copy-a').value.trim(),b=$('mn-headline-b').value.trim(),dB=$('mn-copy-b').value.trim();
      if(!a||!dA||Boolean(b)!==Boolean(dB)){$('mn-form-feedback').textContent=label('invalid');return;}
      const p=products.find(x=>x.slug===$('mn-product-select').value);
      const payload={schema:'marcosa-house-promo/v1',status:'draft_only',product:p?.slug||null,
        variant_a:{headline:a,description:dA},variant_b:b?{headline:b,description:dB}:null,tracking:false,payments:false,live:false,
        copyright_review_required:true,film_domain_verified:false};
      download('marcosa-own-promo-'+p.slug+'.json',JSON.stringify(payload,null,2)+'\n','application/json;charset=utf-8');
      $('mn-form-feedback').textContent=label('done');
    });
    $('mn-film-template').addEventListener('click',templateCSV);
    $('mn-film-reset').addEventListener('click',()=>{filmRows=[];$('mn-film-csv').value='';renderFilmRows();$('mn-film-status').textContent='Импорт очищен.';});
    $('mn-film-csv').addEventListener('change',async e=>{
      const f=e.target.files?.[0];if(!f)return;
      if(f.size>262144){$('mn-film-status').textContent='CSV превышает 256 KB';return;}
      try{filmRows=parseFilmImport(await f.text());$('mn-film-status').textContent='Загружено доменов: '+filmRows.length+'. Права не проверены.';renderFilmRows();}
      catch(error){filmRows=[];renderFilmRows();$('mn-film-status').textContent='Ошибка CSV: '+String(error.message).slice(0,140);}
    });
    $('mn-film-form').addEventListener('submit',e=>{
      e.preventDefault();
      const domain=$('mn-film-source').value;
      const row=filmRows.find(r=>r.domain===domain);
      const p=products.find(x=>x.slug===$('mn-film-product').value);
      const message=$('mn-film-message').value.trim();
      if(!row||!p||message.length<10||message.length>160||!$('mn-film-own').checked||!$('mn-film-rights').checked){
        $('mn-film-feedback').textContent='Выберите домен и продукт, проверьте текст и подтвердите свои права.';return;
      }
      latestFilm={schema:'marcosa-film-referral/v1',status:'draft_only',film_id:row.asset_id,film_domain:domain,product:p.slug,
        product_name:p.name,message,ownership_self_attested:true,rights_self_attested:true,
        domain_independently_verified:false,commercial_approved:false,tracking:false,live:false};
      $('mn-film-preview').textContent=movieSnippet(latestFilm);
      $('mn-film-download-json').disabled=false;$('mn-film-download-html').disabled=false;
      $('mn-film-feedback').textContent='Черновик подготовлен; домен и права требуют независимой проверки.';
    });
    $('mn-film-download-json').addEventListener('click',()=>{if(latestFilm)download('marcosa-film-referral.json',JSON.stringify(latestFilm,null,2)+'\n','application/json;charset=utf-8');});
    $('mn-film-download-html').addEventListener('click',()=>{if(latestFilm)download('marcosa-referral-card.html',movieSnippet(latestFilm)+'\n','text/html;charset=utf-8');});
    $('mn-product-count').textContent=products.length;$('mn-film-count').textContent='43';
    fillProducts();categories();cards();renderFilmRows();applyLanguage();showTab('products');
    if(root?.location?.hash==='#network')open();
    root?.addEventListener?.('hashchange',()=>{if(root.location.hash==='#network')open();});
  }
  return Object.freeze({products,film_slots:43,parseFilmImport,checkDomain,htmlEsc,movieSnippet,mount});
});
