/* MARCOSA R5 — transparent story-to-product journeys.
   Fictional demos only. Zero external dependencies, persistence, analytics or payments. */
(function (root, factory) {
  'use strict';
  const api=factory();
  if (typeof module==='object' && module.exports) module.exports=api;
  if (root && root.document) {
    root.MarcosaStoryPilot=api;
    const run=()=>api.mount(root.document,root);
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',run,{once:true});
    else run();
  }
})(typeof window!=='undefined'?window:undefined,function(){
  'use strict';
  const L=(ru,en,zh)=>Object.freeze({ru,en,zh});
  const STORIES=Object.freeze([
    {
      id:'last-minute',number:'01',theme:'time',symbol:'◷',
      title:L('Последняя минута','The last minute','最后一分钟'),
      tagline:L('История о времени, которое можно вернуть.','A story about getting time back.','一个关于找回时间的故事。'),
      category:L('ВРЕМЯ / РЕШЕНИЕ','TIME / DECISION','时间 / 决定'),
      steps:[
        {
          title:L('Город на паузе','A city on pause','暂停的城市'),
          body:L('Ты стоишь перед закрытой дверью. За ней — решение, которого ждут десятки людей. Каждая минута ожидания превращается в потерянную возможность.','You stand before a closed door. Behind it is a decision dozens of people are waiting for. Each passing minute becomes a missed opportunity.','你站在一扇紧闭的门前。门后是几十个人在等待的决定。每一分钟都可能错过机会。'),
          question:L('Как поступишь?','What will you do?','你会怎么做？'),
          choices:[L('Сократить очередь','Shorten the queue','缩短排队'),L('Выяснить, почему решение задержано','Find the source of the delay','找出拖延原因')]
        },
        {
          title:L('Цена одного решения','The cost of a decision','决定的代价'),
          body:L('Тебе предлагают быстрое решение, но никто не видит весь процесс. Полезный инструмент должен устранять проблему, а не скрывать её.','A quick fix is offered, but nobody sees the full process. A useful tool should solve the problem, not merely hide it.','有人提出快速修补方案，但没人看清整个流程。好的工具应该解决问题，而不是掩盖问题。'),
          question:L('Что важнее в следующем шаге?','What matters most now?','下一步最重要的是什么？'),
          choices:[L('Простой сервис для человека','A simple service for each person','为每个人提供简单服务'),L('Прозрачный процесс для команды','A transparent team process','透明的团队流程')]
        }
      ],
      endings:{
        '00':{title:L('Время возвращено','Time returned','时间归来'),body:L('Герой выбирает запись без очереди. Люди видят своё место и следующий шаг, но система не обещает чудес.','The character chooses a booking flow without a physical queue. People see their next step, without impossible promises.','主人公选择无需现场排队的预约流程。每个人都能看到下一步。'),product:'timeless',because:L('TIMELESS исследует электронные очереди и запись — конкретное продолжение темы ожидания.','TIMELESS prototypes queues and bookings: a relevant continuation of this waiting problem.','TIMELESS 探索预约和排队管理，与故事主题直接相关。')},
        '01':{title:L('Команда видит очередь','The team sees the queue','团队看见队列'),body:L('Люди получают понятные статусы, а команда — контроль исполнения. Ожидание превращается в управляемое дело.','People receive visible statuses, and the team can manage delivery. Waiting becomes an actionable case.','每个人看到进度，团队跟踪任务。等待变成可处理的工作。'),product:'waitos',because:L('WAITOS посвящён делам, срокам и документам: это честная тематическая рекомендация, а не обещание готового сервиса.','WAITOS covers cases, deadlines and documents; this is a topical recommendation, not a live-service claim.','WAITOS 涉及案件、期限和文件；这是主题推荐，并不表示服务已经上线。')},
        '10':{title:L('Вопрос к системе','Question the system','质询系统'),body:L('Ты находишь причины повторяющихся задержек. Прежде чем ускорять процессы, нужно научиться их проверять.','You uncover why delays repeat. Before automating, someone needs to examine the process itself.','你发现延误反复发生的原因。自动化之前，先要检查流程。'),product:'opspilot',because:L('OpsPilot — учебная лаборатория проверки процессов и закупок на синтетических данных.','OpsPilot is a synthetic-data operations review lab, useful for exploring procedural bottlenecks.','OpsPilot 使用模拟数据研究业务流程与审核。')},
        '11':{title:L('Право на ясность','A right to clarity','清晰的权利'),body:L('Решение не должно оставаться чёрным ящиком. Твоя история заканчивается проверяемыми действиями и сроками.','A decision should not be a black box. Your ending leaves an accountable, documented process.','决定不该是黑箱。这个结局指向透明、有记录的工作流程。'),product:'waitos',because:L('WAITOS — исследуемый контур контроля сроков и совместной работы.','WAITOS is a prototype for deadlines and collaborative case management.','WAITOS 是期限与协作案件管理的原型。')}
      }
    },
    {
      id:'signal',number:'02',theme:'signal',symbol:'◇',
      title:L('Сигнал истины','Signal of truth','真实的信号'),
      tagline:L('Когда уверенный голос ещё не означает правду.','When a confident voice is not proof.','自信的声音并不代表真实。'),
      category:L('ДОВЕРИЕ / ВЫБОР','TRUST / CHOICE','信任 / 选择'),
      steps:[
        {
          title:L('Обещание будущего','A promise about tomorrow','关于未来的承诺'),
          body:L('На огромном экране объявляют: «Эта технология решит всё». Зал аплодирует. Но доказательств никто ещё не видел.','A giant screen declares: “This technology will solve everything.” The crowd applauds, but nobody has seen the evidence.','巨大的屏幕宣称：“这项技术能解决一切。”观众鼓掌，却没人见过证据。'),
          question:L('На что обратишь внимание?','Where will you look first?','你会先关注什么？'),
          choices:[L('Проверю доказательства','Check the evidence','核查证据'),L('Спрошу, кому выгодно обещание','Ask who benefits','询问谁会获益')]
        },
        {
          title:L('Сила сомнения','The power of doubt','质疑的力量'),
          body:L('Ты находишь красивую презентацию и несколько противоречивых утверждений. Теперь нужна процедура — не просто мнение.','You find a beautiful presentation and several conflicting claims. What you need now is a process, not another opinion.','你找到漂亮的演示文稿和几项相互矛盾的陈述。现在需要流程，而不仅仅是意见。'),
          question:L('Кто должен увидеть результат?','Who should see the result?','谁应该看到结果？'),
          choices:[L('Человек, принимающий решение','The person making the decision','做决定的人'),L('Авторы рекламного обещания','The authors of the claim','承诺的发布者')]
        }
      ],
      endings:{
        '00':{title:L('Факты становятся видимыми','Evidence comes to light','证据浮现'),body:L('Герой составляет карту утверждений и отмечает, что доказано, а что ещё требует проверки.','The character maps assertions and separates demonstrated facts from untested claims.','主人公把陈述分组，区分已证实与待核查的内容。'),product:'proofos',because:L('ProofOS — исследовательский инструмент для сопоставления утверждений и доказательств.','ProofOS prototypes structured claims and evidence review.','ProofOS 探索陈述与证据核查。')},
        '01':{title:L('Согласование без иллюзий','Approval without illusions','不再盲目批准'),body:L('Вместо громкого обещания команда получает список вопросов, доказательств и открытых рисков.','Instead of a louder promise, the team receives questions, sources and unresolved risks.','团队不再扩大承诺，而是整理问题、来源和风险。'),product:'adverse-judge',because:L('ADVERSE JUDGE разрабатывает проверку рекламных утверждений и вариантов креативов.','ADVERSE JUDGE explores reviewing advertising claims and creative variants.','ADVERSE JUDGE 研究广告承诺与创意方案审核。')},
        '10':{title:L('Слова под контролем','Words under review','审视措辞'),body:L('Ты возвращаешь обещание его авторам: пусть расскажут о пределах технологии до публикации.','You return the promise to its authors and ask for its limitations before publication.','你要求发布者在公开前说明技术的局限。'),product:'adverse-judge',because:L('ADVERSE JUDGE изучает процедуру проверки маркетинговых обещаний.','ADVERSE JUDGE is an experimental workflow for reviewing marketing claims.','ADVERSE JUDGE 提供营销陈述审核原型。')},
        '11':{title:L('Публичная ответственность','Accountability by design','责任源于设计'),body:L('Команда учится отличать рекламную уверенность от доказательств. Внимание заслуживают факты.','The team learns to distinguish persuasive confidence from verified evidence.','团队学会区分营销自信与真实证据。'),product:'intentgraph-cosmic',because:L('IntentGraph Cosmic ONE включает прототипы рекламных согласований и отчётности.','IntentGraph Cosmic ONE includes experimental advertising approvals and reporting.','IntentGraph Cosmic ONE 包含广告审批与报告原型。')}
      }
    },
    {
      id:'world-zero',number:'03',theme:'world',symbol:'✦',
      title:L('Мир после титров','World after the credits','片尾之后的世界'),
      tagline:L('История может закончиться. Интерес — нет.','The story can end. Curiosity does not have to.','故事可以结束，好奇心不必结束。'),
      category:L('КИНО / СОЗДАНИЕ','CINEMA / CREATION','电影 / 创作'),
      steps:[
        {
          title:L('Последний кадр','The final frame','最后一帧'),
          body:L('Титры ещё не появились. Персонаж смотрит прямо на тебя: «Что ты построил бы на месте этого мира?»','The credits have not started. A character looks at you: “What would you build in this world?”','片尾字幕还没出现。角色看着你：“你会在这个世界里创造什么？”'),
          question:L('Какой путь выберешь?','Where does the story go?','故事将走向何方？'),
          choices:[L('Новый интерактивный сюжет','A new interactive storyline','新的互动剧情'),L('Необычная идея для бренда','An original brand idea','原创品牌创意')]
        },
        {
          title:L('Право на продолжение','The right to continue','继续的权利'),
          body:L('Каждый новый эпизод принадлежит автору. Реклама появляется только там, где зритель сам выбирает следующий шаг.','Each new episode belongs to its creator. Promotion appears only when viewers choose what to explore next.','新的篇章属于创作者。只有观众主动选择，品牌内容才会出现。'),
          question:L('Что для тебя ценнее?','What is most valuable?','你最看重什么？'),
          choices:[L('Выбор зрителя','Viewer agency','观众自主选择'),L('Инструменты автора','Creator tools','创作者工具')]
        }
      ],
      endings:{
        '00':{title:L('Истории соединяются','Stories connect','故事相互连接'),body:L('Зритель получает право открыть следующую развилку, а не навязанную рекламу.','The audience can choose the next branch instead of being interrupted by an ad.','观众可以选择下一个分支，而非被广告打断。'),product:'signal-worlds',because:L('SIGNAL WORLDS экспериментирует с интерактивным кино и передачей идей создателям рекламы.','SIGNAL WORLDS prototypes interactive cinema and creative handoffs.','SIGNAL WORLDS 研究互动电影与创意衔接。')},
        '01':{title:L('История как инструмент','A story as a tool','故事成为工具'),body:L('Авторы создают новые варианты сюжета и сохраняют контроль над тем, как их используют.','Creators build alternative scenes while keeping control over how their work is used.','创作者设计分支故事并保持使用控制权。'),product:'protocol-zero',because:L('PROTOCOL ZERO исследует наследуемые рекламные сюжеты и согласование материалов.','PROTOCOL ZERO prototypes inheritable interactive stories and campaign reviews.','PROTOCOL ZERO 探索互动故事分支与内容审批。')},
        '10':{title:L('Креатив без прерываний','Creative without interruptions','不打断的创意'),body:L('Бренд становится частью добровольно выбранного опыта, не выдавая рекламу за чужую историю.','A brand can support an opted-in experience without pretending its message is independent fiction.','品牌可以支持自愿参与的体验，而不把广告伪装为独立故事。'),product:'impossible-ai',because:L('IMPOSSIBLE AI — исследуемый конструктор интерактивных рекламных миров.','IMPOSSIBLE AI explores tools for interactive branded worlds.','IMPOSSIBLE AI 探索互动品牌世界制作工具。')},
        '11':{title:L('Семь способов удивить','Seven ways to surprise','七种惊喜'),body:L('Одна идея превращается в разные рекламные эксперименты — с пометкой о спонсорстве и выбором зрителя.','One idea becomes several creative experiments with clear sponsorship and viewer choice.','一个创意衍生出多种实验形式，并明确标注赞助。'),product:'impossible-ventures',because:L('Impossible Ventures объединяет семь экспериментальных рекламных концепций.','Impossible Ventures prototypes seven experimental advertising concepts.','Impossible Ventures 汇集七个实验性广告概念。')}
      }
    }
  ]);
  const PRODUCT_SLUGS=Object.freeze([
    'timeless','waitos','opspilot','proofos','adverse-judge','intentgraph-cosmic',
    'signal-worlds','protocol-zero','impossible-ai','impossible-ventures'
  ]);
  const I18N={
    ru:{home:'НАЗАД В MARCOSA',eyebrow:'MARCOSA / STORY CONTINUATION LAB · R5',hero:'Истории, после которых хочется действовать.',lead:'Три небольших интерактивных мира. Твои решения меняют финал и рекомендацию. Никаких навязанных рекламных переходов.',disclaimer:'Открытая демонстрация. Не реальные кино-сайты и не подтверждённые Worlds.',explore:'ВЫБРАТЬ ИСТОРИЮ',studio:'БРЕНД-СТУДИЯ',source:'ДЕМОНСТРАЦИЯ / БЕЗ ТРЕКИНГА',scene:'СЦЕНА',choice:'Выбери направление',ending:'ТВОЙ ФИНАЛ',why:'Почему рекомендовано',project:'СМОТРЕТЬ КАРТОЧКУ ПРОЕКТА ↗',campaign:'СОЗДАТЬ СВОЁ ПРОМО ↗',productNote:'Рекомендация основана только на двух выборах. Сервис и права на публикацию не подтверждены.',back:'НАЗАД',again:'ЗАНОВО',steps:'2 решения → 1 результат',chapter:'ЭПИЗОД',qa:'СОХРАНИТЬ ЛОКАЛЬНЫЙ QA-ОТЧЁТ',qaOn:'Включить локальные события для проверки сценария (не отправляются в интернет)',qaEmpty:'Включите локальную диагностику, затем пройдите историю.',qaReady:'Локальный отчёт доступен — без персональных идентификаторов.',studioEyebrow:'CREATOR / OWN-BRAND PILOT',studioTitle:'Преврати интерес в честный рекламный сценарий.',studioLead:'Создай заявку на короткую интерактивную историю для своего бренда. Это экспортируемый бриф — без публикации, денег и фальшивых показов.',brand:'Название бренда или проекта',audience:'Кому адресована история',goal:'Какую проблему должен решить сюжет',template:'Формат истории',productField:'Тематический проект',rights:'Я подтверждаю, что могу использовать предоставленные материалы и проверю права до публикации.',disclose:'Я согласен явно обозначать рекламный материал и не маскировать его под независимую историю.',generate:'СОЗДАТЬ ПРЕДЛОЖЕНИЕ',download:'СКАЧАТЬ БРИФ JSON',draft:'ЧЕРНОВИК / НЕ ОПУБЛИКОВАН',briefReady:'Бриф сформирован локально. Следующие этапы: права → сценарий → согласование → проверка → публикация.',briefError:'Заполни название (2–100 символов), аудиторию (4–160), задачу (12–320) и подтвердите два условия.',privacy:'Формы, история и отчёты обрабатываются только в этой вкладке. Нет cookies, платёжной системы, сетевых запросов и учёта зрителей.',credits:'ПРОТОТИП / НЕ PRODUCTION',noTelemetry:'0 сторонних трекеров · 0 оплат · 0 вымышленных просмотров'},
    en:{home:'BACK TO MARCOSA',eyebrow:'MARCOSA / STORY CONTINUATION LAB · R5',hero:'Stories that lead somewhere meaningful.',lead:'Three small interactive worlds. Your choices change the ending and the recommendation. No forced ad redirects.',disclaimer:'Public fictional demo. Not verified film websites or working Worlds.',explore:'CHOOSE A STORY',studio:'BRAND STUDIO',source:'DEMO / NO TRACKING',scene:'SCENE',choice:'Choose your direction',ending:'YOUR ENDING',why:'Why this fits',project:'EXPLORE PROJECT CARD ↗',campaign:'DRAFT YOUR OWN PROMO ↗',productNote:'Recommendation uses only your two choices. Live service and publication rights are unverified.',back:'BACK',again:'RESTART',steps:'2 decisions → 1 outcome',chapter:'EPISODE',qa:'DOWNLOAD LOCAL QA REPORT',qaOn:'Enable in-memory QA events (never transmitted)',qaEmpty:'Enable local QA, then complete a story.',qaReady:'Local report is ready — no personal identifiers.',studioEyebrow:'CREATOR / OWN-BRAND PILOT',studioTitle:'Turn attention into a transparent story proposal.',studioLead:'Create a brief for an interactive branded story. Export locally; no publication, billing or fabricated reach.',brand:'Brand or project name',audience:'Who should this help?',goal:'What problem should the story address?',template:'Story template',productField:'Relevant project',rights:'I confirm I may use these materials and will verify rights before publishing.',disclose:'I will label promotional content clearly and will not disguise advertising as independent storytelling.',generate:'GENERATE PROPOSAL',download:'DOWNLOAD BRIEF JSON',draft:'DRAFT / NOT PUBLISHED',briefReady:'Draft created locally. Next: rights → script → review → QA → publication.',briefError:'Enter brand (2–100 characters), audience (4–160), goal (12–320) and accept both conditions.',privacy:'Forms, stories and QA reports remain in this tab only. No cookies, payments, network requests or audience tracking.',credits:'PROTOTYPE / NOT PRODUCTION',noTelemetry:'0 third-party trackers · 0 payments · 0 invented views'},
    zh:{home:'返回 MARCOSA',eyebrow:'MARCOSA / 故事延续实验室 · R5',hero:'让故事通向真正有意义的选择。',lead:'三个互动故事。你的选择改变结局与推荐，没有强制广告跳转。',disclaimer:'公开虚构演示，并非已验证的电影网站或 Worlds。',explore:'选择故事',studio:'品牌工作室',source:'演示 / 不跟踪',scene:'场景',choice:'选择方向',ending:'你的结局',why:'推荐理由',project:'查看项目卡片 ↗',campaign:'创建宣传草稿 ↗',productNote:'推荐只根据两个选择。服务上线和发布权利尚未核实。',back:'返回',again:'重新开始',steps:'2 次决定 → 1 个结果',chapter:'章节',qa:'下载本地测试报告',qaOn:'启用仅在内存中的测试事件（不会上传）',qaEmpty:'先启用本地测试，再体验故事。',qaReady:'本地报告可下载，不含个人标识。',studioEyebrow:'创作者 / 自有品牌试点',studioTitle:'把注意力转化为透明的故事提案。',studioLead:'为品牌创作互动故事简报，仅本地导出，不发布、不收费、不虚构观看量。',brand:'品牌或项目名称',audience:'服务的观众是谁',goal:'故事要解决的问题',template:'故事模板',productField:'相关项目',rights:'我有权使用这些材料，并将在发布前核实权利。',disclose:'我会清楚标记品牌内容，不会伪装成独立故事。',generate:'生成提案',download:'下载 JSON 简报',draft:'草稿 / 未发布',briefReady:'本地草稿完成。下一步：权利、剧本、审核、测试、发布。',briefError:'请填写品牌（2–100 字符）、观众（4–160）、目标（12–320），并同意两项条款。',privacy:'表单、故事和测试报告仅存在于此标签页。没有 cookie、付款、网络请求或受众跟踪。',credits:'原型 / 非正式上线',noTelemetry:'0 第三方跟踪 · 0 付款 · 0 虚构浏览量'}
  };
  const loc=(x,lang)=>x&&typeof x==='object'?(x[lang]||x.en||x.ru||''):String(x||'');
  const getStory=id=>STORIES.find(s=>s.id===id)||null;
  function createState(storyId){
    if(!getStory(storyId))throw Error('UNKNOWN_STORY');
    return {storyId,answers:[]};
  }
  function advance(state,choice){
    const story=getStory(state&&state.storyId);
    if(!story||!Array.isArray(state.answers)||state.answers.length>2||!Number.isInteger(choice)||choice<0||choice>1)throw Error('INVALID_CHOICE');
    if(state.answers.length>=2)throw Error('STORY_ALREADY_COMPLETE');
    if(state.answers.some(x=>x!==0&&x!==1))throw Error('INVALID_HISTORY');
    return {storyId:state.storyId,answers:state.answers.concat(choice)};
  }
  function rewind(state){
    if(!getStory(state&&state.storyId)||!Array.isArray(state.answers))throw Error('INVALID_HISTORY');
    return {storyId:state.storyId,answers:state.answers.slice(0,-1)};
  }
  function outcome(state){
    const story=getStory(state&&state.storyId);
    if(!story||!Array.isArray(state.answers)||state.answers.length!==2||state.answers.some(x=>x!==0&&x!==1))return null;
    return story.endings[state.answers.join('')]||null;
  }
  function buildBrief(input){
    if(!input||typeof input!=='object')throw Error('INVALID_BRIEF');
    const brand=String(input.brand||'').trim();
    const audience=String(input.audience||'').trim();
    const goal=String(input.goal||'').trim();
    const story=getStory(input.storyId);
    if(brand.length<2||brand.length>100||audience.length<4||audience.length>160||
       goal.length<12||goal.length>320||!story||!PRODUCT_SLUGS.includes(input.product)||
       input.rightsAttested!==true||input.sponsorshipDisclosed!==true)throw Error('BRIEF_VALIDATION');
    return {
      schema:'marcosa-branded-story-brief/v1',status:'draft_only',publication_state:'not_published',
      brand,audience,goal,story_template:story.id,continuation_product:input.product,
      sponsorship_label_required:true,ownership_self_attested:true,
      rights_independently_verified:false,product_public_service_verified:false,
      network_measurement:false,tracking:false,payments:false,
      story_flow:['opening','viewer_decision_one','viewer_decision_two','optional_relevant_continuation'],
      review_gates:['content_rights','advertiser_identity','editorial_review','sponsorship_label',
        'domain_validation','accessibility_and_mobile','security_qa','manual_publication_approval'],
      success_measurement:'No engagement or conversion statistics exist for this draft. Discuss a compliant measurement plan separately.'
    };
  }
  const EVENT_TYPES=Object.freeze(['film_started','choice_selected','film_completed','recommendation_rendered','recommendation_clicked']);
  function createQaRecorder(){
    let enabled=false,events=[];
    return Object.freeze({
      enable(value){enabled=value===true;if(!enabled)events=[];},
      record(type,storyId,step,product){
        if(!enabled||!EVENT_TYPES.includes(type)||!getStory(storyId))return false;
        if(!Number.isInteger(step)||step<0||step>2)return false;
        if(events.length>=100)return false;
        const e={type,story_id:storyId,stage:step};
        if(type.startsWith('recommendation_')&&PRODUCT_SLUGS.includes(product))e.product_slug=product;
        events.push(e);return true;
      },
      report(){
        const counts={};for(const k of EVENT_TYPES)counts[k]=0;
        for(const e of events)counts[e.type]++;
        return {schema:'marcosa-story-qa/v1',status:'local_opt_in_demo_only',transmission:false,
          storage:'memory_only',scope:'single_tab_not_unique_people',counts,events:events.map(e=>({...e})),
          disclaimer:'Demo QA events, not verified audience impressions, conversion or user-level attribution.'};
      },
      get enabled(){return enabled;},
      get size(){return events.length;}
    });
  }
  function mount(doc,win){
    const stage=doc.getElementById('ms-stage');if(!stage)return null;
    const $=id=>doc.getElementById(id);
    const dict=()=>I18N[lang]||I18N.en;
    const catalog=win.MarcosaNetworkPreview?.products||[];
    const name=slug=>catalog.find(p=>p.slug===slug)?.name||slug;
    const qa=createQaRecorder();
    let lang='ru',state=createState('last-minute'),latestBrief=null;
    function make(tag,cls,text){const e=doc.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
    function download(filename,data){
      const blob=new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json;charset=utf-8'});
      const href=URL.createObjectURL(blob),a=make('a');
      a.href=href;a.download=filename;doc.body.append(a);a.click();a.remove();
      win.setTimeout(()=>URL.revokeObjectURL(href),1500);
    }
    function log(type,product){qa.record(type,state.storyId,state.answers.length,product);$('ms-qa-download').disabled=qa.size===0;}
    function renderCards(){
      const list=$('ms-story-list');list.replaceChildren();
      for(const story of STORIES){
        const active=story.id===state.storyId;
        const button=make('button','ms-story-card ms-theme-'+story.theme+(active?' is-selected':''));
        button.type='button';button.dataset.storyId=story.id;button.setAttribute('aria-pressed',String(active));
        button.append(make('span','ms-story-index',story.number+' / '+loc(story.category,lang)));
        button.append(make('span','ms-story-emblem',story.symbol));
        button.append(make('strong','',loc(story.title,lang)));
        button.append(make('span','ms-story-teaser',loc(story.tagline,lang)));
        button.addEventListener('click',()=>selectStory(story.id));
        list.append(button);
      }
    }
    function selectStory(id){
      state=createState(id);
      log('film_started');renderCards();renderStage();
    }
    function renderStage(){
      const story=getStory(state.storyId),step=state.answers.length,done=step===2;
      stage.dataset.theme=story.theme;
      $('ms-stage-number').textContent=story.number;
      $('ms-stage-progress').textContent=String(Math.min(step+1,3)).padStart(2,'0')+' / 03';
      $('ms-visual-symbol').textContent=story.symbol;
      $('ms-visual-title').textContent=loc(story.title,lang);
      $('ms-visual-description').textContent=loc(story.tagline,lang);
      $('ms-progress-fill').style.width=((step+1)/3*100)+'%';
      $('ms-episode-status').textContent=done?dict().ending:dict().chapter+' '+(step+1);
      $('ms-back').disabled=step===0;
      $('ms-restart').textContent=dict().again;
      const pane=$('ms-choices');pane.replaceChildren();
      $('ms-finish').hidden=!done;$('ms-narrative').hidden=done;
      if(done){
        const result=outcome(state);
        $('ms-end-title').textContent=loc(result.title,lang);
        $('ms-end-copy').textContent=loc(result.body,lang);
        $('ms-project-name').textContent=name(result.product);
        $('ms-project-reason').textContent=loc(result.because,lang);
        $('ms-project-link').href='./index.html#network-product='+encodeURIComponent(result.product);
        $('ms-campaign-link').href='./index.html#network-campaign='+encodeURIComponent(result.product);
        $('ms-project-link').textContent=dict().project;
        $('ms-campaign-link').textContent=dict().campaign;
        $('ms-result-note').textContent=dict().productNote;
        log('recommendation_rendered',result.product);
      }else{
        const chapter=story.steps[step];
        $('ms-chapter-title').textContent=loc(chapter.title,lang);
        $('ms-chapter-body').textContent=loc(chapter.body,lang);
        $('ms-chapter-question').textContent=loc(chapter.question,lang);
        chapter.choices.forEach((choice,index)=>{
          const b=make('button','ms-choice');
          b.type='button';b.append(make('span','ms-choice-count','0'+(index+1)));
          b.append(make('span','ms-choice-label',loc(choice,lang)));
          b.append(make('span','ms-choice-arrow','↗'));
          b.addEventListener('click',()=>{
            state=advance(state,index);log('choice_selected');
            if(state.answers.length===2)log('film_completed');
            renderStage();
          });pane.append(b);
        });
      }
    }
    function fillBriefOptions(){
      const select=$('ms-brief-story'),product=$('ms-brief-product');
      const prevStory=select.value,prevProduct=product.value;
      select.replaceChildren();product.replaceChildren();
      for(const s of STORIES){const o=make('option','',loc(s.title,lang));o.value=s.id;select.append(o);}
      for(const slug of PRODUCT_SLUGS){const o=make('option','',name(slug));o.value=slug;product.append(o);}
      select.value=getStory(prevStory)?prevStory:state.storyId;
      product.value=PRODUCT_SLUGS.includes(prevProduct)?prevProduct:'signal-worlds';
    }
    function switchLanguage(next){
      if(!I18N[next])return;lang=next;doc.documentElement.lang=lang;
      doc.querySelectorAll('[data-ms-i18n]').forEach(node=>{
        const key=node.dataset.msI18n;if(dict()[key])node.textContent=dict()[key];
      });
      doc.querySelectorAll('[data-ms-lang]').forEach(button=>{
        const active=button.dataset.msLang===lang;
        button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
      });
      renderCards();renderStage();fillBriefOptions();
    }
    $('ms-back').addEventListener('click',()=>{state=rewind(state);renderStage();});
    $('ms-restart').addEventListener('click',()=>selectStory(state.storyId));
    doc.querySelectorAll('[data-ms-lang]').forEach(button=>
      button.addEventListener('click',()=>switchLanguage(button.dataset.msLang)));
    $('ms-project-link').addEventListener('click',()=>{
      const result=outcome(state);if(result)log('recommendation_clicked',result.product);
    });
    $('ms-campaign-link').addEventListener('click',()=>{
      const result=outcome(state);if(result)log('recommendation_clicked',result.product);
    });
    $('ms-qa-opt').addEventListener('change',event=>{
      qa.enable(Boolean(event.target.checked));
      $('ms-qa-download').disabled=true;
      $('ms-qa-info').textContent=qa.enabled?dict().qaEmpty:dict().privacy;
    });
    $('ms-qa-download').addEventListener('click',()=>{
      if(qa.enabled && qa.size)download('marcosa-r5-local-qa.json',qa.report());
    });
    $('ms-brief-form').addEventListener('submit',event=>{
      event.preventDefault();latestBrief=null;
      $('ms-brief-download').disabled=true;
      try{
        latestBrief=buildBrief({
          brand:$('ms-brief-brand').value,audience:$('ms-brief-audience').value,
          goal:$('ms-brief-goal').value,storyId:$('ms-brief-story').value,
          product:$('ms-brief-product').value,rightsAttested:$('ms-brief-rights').checked,
          sponsorshipDisclosed:$('ms-brief-disclose').checked
        });
        $('ms-brief-preview').hidden=false;
        $('ms-brief-preview-brand').textContent=latestBrief.brand;
        $('ms-brief-preview-goal').textContent=latestBrief.goal;
        $('ms-brief-preview-product').textContent=name(latestBrief.continuation_product);
        $('ms-brief-feedback').textContent=dict().briefReady;
        $('ms-brief-download').disabled=false;
      }catch(err){
        $('ms-brief-preview').hidden=true;
        $('ms-brief-feedback').textContent=dict().briefError;
      }
    });
    $('ms-brief-download').addEventListener('click',()=>{
      if(latestBrief)download('marcosa-r5-branded-story-brief.json',latestBrief);
    });
    switchLanguage('ru');
    $('ms-qa-info').textContent=dict().privacy;
    $('ms-brief-preview').hidden=true;
    return Object.freeze({get state(){return {storyId:state.storyId,answers:state.answers.slice()};},
      get locale(){return lang;},selectStory,switchLanguage,getQaReport(){return qa.report();}});
  }
  return Object.freeze({STORIES,PRODUCT_SLUGS,I18N,getStory,createState,advance,rewind,outcome,
    buildBrief,createQaRecorder,mount});
});
