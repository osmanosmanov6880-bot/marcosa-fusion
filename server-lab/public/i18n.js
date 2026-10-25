/* MARCOSA R71 — English beta of the public/entry UI.
 * Text is authored locally. We never machine-translate user content, World
 * titles/descriptions, drafts, messages or media captions.
 * No remote translation provider, tracking, network calls or HTML injection.
 */
(()=>{
'use strict';
const CATALOG=Object.freeze({
 'locale.label':['Язык','Language'],
 'nav.skip':['Перейти к основному содержанию','Skip to main content'],
 'feed.tabsAria':['Показать публикации','Show posts'],
 'hero.lead':['Мир начинается','A world begins'],
 'hero.tail':['с тебя.','with you.'],
 'hero.description':['Настоящие пользовательские аккаунты, персональные миры, публикации и модерация — в закрытом локальном испытании. Не коммерческий сервис и не публичная соцсеть.','Real accounts, personal Worlds, posts and moderation in a closed local test. Not a commercial service or a public social network.'],
 'hero.discover':['Исследовать миры','Explore Worlds'],
 'auth.heading':['Твой доступ','Your access'],
 'auth.warning':['Только локальный сервер. Вход и регистрации не связаны с опубликованной MARCOSA.','Local server only. These accounts are not connected to any published MARCOSA service.'],
 'auth.login':['Войти','Sign in'],
 'auth.email':['Почта','Email'],
 'auth.password':['Пароль','Password'],
 'auth.password.long':['Пароль (не менее 12 символов)','Password (at least 12 characters)'],
 'auth.login.button':['Войти в свой мир','Enter your World'],
 'auth.invite.heading':['Создать аккаунт по приглашению','Create an invite-only account'],
 'auth.invite.code':['Код приглашения','Invitation code'],
 'auth.invite.username':['Имя мира (латиница)','World username (Latin letters)'],
 'auth.register.button':['Создать локальный профиль','Create local profile'],
 'auth.signout':['Выйти','Sign out'],
 'auth.guest':['Гость','Guest'],
 'auth.worlds':['Мои миры','My Worlds'],
 'worlds.lead':['Настоящие','Real'],
 'worlds.tail':['миры.','Worlds.'],
 'worlds.search.label':['Поиск опубликованных миров и историй','Search published Worlds and stories'],
 'worlds.search.placeholder':['Тема, мир, история','Topic, World, story'],
 'worlds.search.category':['Фильтр по тематике миров','Filter Worlds by topic'],
 'worlds.search.button':['Найти','Search'],
 'worlds.search.reset':['Сбросить','Clear'],
 'worlds.close':['← Все миры','← All Worlds'],
 'worlds.share':['Скопировать ссылку на этот World','Copy link to this World'],
 'worlds.cover.alt':['Изображение обложки публичного мира','Public World cover image'],
 'worlds.stories':['Истории этого мира','Stories from this World'],
 'worlds.open':['Открыть World ↗','Open World ↗'],
 'worlds.report.heading':['Пожаловаться на изображение этого мира','Report this World cover'],
 'worlds.report.info':['Обоснованное обращение попадает только в закрытую очередь. Жалоба не скрывает изображение автоматически. Нужен независимый модератор.','A substantiated report enters a private queue. A report does not hide an image automatically; an independent moderator reviews it.'],
 'worlds.report.reason':['Причина','Reason'],
 'worlds.report.description':['Описание нарушения','Describe the issue'],
 'worlds.report.placeholder':['Опиши конкретную проблему с изображением','Explain the specific problem with this image'],
 'worlds.report.send':['Передать жалобу на независимую проверку','Submit for independent review'],
 'worlds.report.copyright':['Предполагаемое нарушение авторских прав','Suspected copyright infringement'],
 'worlds.report.privacy':['Нарушение приватности','Privacy violation'],
 'worlds.report.abuse':['Оскорбительный или опасный материал','Abusive or harmful content'],
 'worlds.report.impersonation':['Выдача себя за другое лицо','Impersonation'],
 'worlds.report.other':['Другая обоснованная причина','Other substantiated concern'],
 'feed.lead':['Лента','People’s'],
 'feed.tail':['людей.','feed.'],
 'feed.all':['Все публикации','All posts'],
 'feed.following':['Мои подписки','Following'],
 'feed.refresh':['Обновить','Refresh'],
 'feed.more':['Ещё публикации','Load more posts'],
 'composer.lead':['Твоя','Your'],
 'composer.tail':['публикация.','post.'],
 'composer.world':['Мир для публикации','World to publish in'],
 'composer.text':['Текст','Text'],
 'composer.placeholder':['Что полезного ты хочешь сказать?','What would you like to share?'],
 'composer.draft':['В мои черновики','Save as draft'],
 'composer.publish':['Опубликовать в ленту','Publish to feed'],
 'composer.mine':['Мои публикации и черновики','My posts and drafts'],
 'activity.lead':['Моя','My'],
 'activity.tail':['активность.','activity.'],
 'trust.heading':['Принципы доверия','Built on trust'],
 'trust.one':['Личная ответственность','Personal accountability'],
 'trust.one.detail':['У каждой записи есть реальный автор и принадлежащий ему мир.','Every post belongs to an actual account and its World.'],
 'trust.two':['Никаких фальшивых счётчиков','No fake counters'],
 'trust.two.detail':['Публикации берутся из SQLite лаборатории. Черновики видит только автор.','Posts come from the laboratory SQLite database. Drafts are private to their author.'],
 'trust.three':['Модерация','Moderation'],
 'trust.three.detail':['Жалобы доступны независимой роли модератора; чужие записи нельзя редактировать.','Reports are reviewed by independent moderators; other people’s posts cannot be edited.'],
 'sponsor.lead':['Партнёры','World'],
 'sponsor.tail':['миров.','partners.'],
 'sponsor.info':['Прозрачные заявки на тестовое размещение. Оплаты, купленных показов и действующих рекламных кампаний здесь нет.','Transparent proposals for test placements. No payments, purchased impressions or live advertising campaigns exist here.'],
 'sponsor.apply':['Предложить рекламу в другом World','Propose a placement in another World'],
 'sponsor.no.payments':['Заявку должен сначала одобрить владелец World, затем независимый модератор. Денег и показов в лаборатории нет.','The World owner approves a proposal first, then an independent moderator. This laboratory has no payments or advertising impressions.'],
 'sponsor.send':['Отправить на проверку','Submit for review'],
 'safety.warning':['Лаборатория не имеет подтверждения почты, восстановления аккаунта, долговременной защиты от атак и production-инфраструктуры. Для публичного запуска нужен отдельный аудит.','The lab has no verified email, account recovery, production infrastructure or mature attack protection. An independent audit is required before launch.'],
 'topics.all':['Все тематики','All topics'],
 'topics.general':['Все темы','All subjects'],
 'topics.art':['Искусство','Art'],
 'topics.technology':['Технологии','Technology'],
 'topics.business':['Бизнес','Business'],
 'topics.education':['Образование','Education'],
 'topics.lifestyle':['Стиль жизни','Lifestyle'],
 'topics.travel':['Путешествия','Travel'],
 "worlds.edit.heading":["Редактировать оформление моего мира","Edit my World appearance"],
 "worlds.edit.warning":["Публичный адрес и владелец сохраняются. Название и описание обновляются на сервере и сразу видны посетителям.","Your public address and ownership stay unchanged. Names and descriptions update on the server and are immediately visible to visitors."],
 "worlds.edit.select":["Выбери мир","Choose a World"],
 "worlds.edit.title":["Название мира","World title"],
 "worlds.edit.description":["Описание","Description"],
 "worlds.edit.category":["Тематика мира","World category"],
 "worlds.edit.save":["Сохранить изменения","Save changes"],
 "cover.heading":["Обложка мира — твоя визуальная история","Your World cover — your visual story"],
 "cover.warning":["Загрузи собственную фотографию в PNG. Принимаются RGB/RGBA без анимации до 1600 px и 768 KiB. Сервер удаляет метаданные. Обложка становится публичной только после независимого рассмотрения модератором; до этого она доступна только тебе и проверяющему. Права на изображение должны принадлежать тебе.","Upload your own PNG. Non-animated RGB/RGBA up to 1600 px and 768 KiB is accepted. The server strips metadata. The cover becomes public only after independent moderator approval; until then, only you and the reviewer can see it. You must own the rights to the image."],
 "cover.choose":["Выбери свой мир","Choose your World"],
 "cover.file":["Файл PNG","PNG file"],
 "cover.save":["Сохранить обложку мира","Save World cover"],
 "cover.delete":["Удалить обложку выбранного мира","Delete selected World cover"],
 "cover.appeal.heading":["Попросить независимый пересмотр отклонённой обложки","Request independent review of a rejected cover"],
 "cover.appeal.submit":["Подать апелляцию по обложке","Submit cover appeal"],
 "cover.storage.info":["Обложка хранится только в локальной испытательной базе.","The cover is stored only in the local test database."],
 "cover.reports.mine":["Мои обращения по публичным изображениям","My public image reports"],
 "cover.reports.warning":["Жалобы на изображения других миров видишь только ты. После проверки независимым модератором обложка может быть скрыта; автор сохраняет право апелляции.","Only you can see the reports you submit about other Worlds. An independent moderator may hide a cover after review; the creator may appeal."],
 "onboarding.heading":["Первые пять шагов в MARCOSA","Your first five steps in MARCOSA"],
 "onboarding.warning":["Прогресс считается по настоящим действиям твоего аккаунта, а не по выдуманным просмотрам.","Progress comes from your actual account activity, not invented views."],
 "onboarding.count":["0 из 5 шагов","0 of 5 steps"],
 "retention.heading":["Добровольное измерение возвращаемости в закрытой бете","Opt-in return-visit measurement in the closed beta"],
 "retention.warning":["По умолчанию выключено. Только после твоего согласия сервер запоминает дни UTC, когда ты входишь в локальную MARCOSA. Никаких IP, текста публикаций или кликов. D7/D30 рассчитываются только агрегированно для согласившихся приглашённых участников. Отзыв удаляет все записи дней; это не публичная аналитика.","Off by default. Only with your consent does the local server record the UTC dates on which you sign in. No IP addresses, post texts or clicks. D7/D30 are calculated only as aggregate metrics for consenting invited members. Withdrawing consent deletes the recorded dates; these are not public analytics."],
 "retention.disabled":["Учёт выключен.","Measurement is off."],
 "retention.enable":["Разрешить учёт дней входа","Allow sign-in day measurement"],
 "retention.disable":["Отозвать согласие и удалить историю","Withdraw consent and erase history"],
 "insights.heading":["Статистика моих миров","My World insights"],
 "insights.refresh":["Обновить статистику","Refresh insights"],
 "insights.warning":["Только реальные записи, подписки и ответы из локальной базы. Без выдуманных рекламных охватов и доходов.","Only real posts, follows and replies from the local database. No fictional ad reach or revenue."],
 "worlds.create.heading":["Создать дополнительный мир","Create another World"],
 "worlds.create.title":["Название","Title"],
 "worlds.create.slug":["Адрес / slug","Address / slug"],
 "worlds.create.submit":["Создать мир","Create World"],
 "saved.heading":["Моя коллекция сохранённых публикаций","My saved posts"],
 "saved.warning":["Сохраняй полезные истории из ленты. Коллекция видна только тебе; скрытые модерацией и заблокированные публикации не показываются.","Save useful posts from the feed. Only you can see this collection; moderated or blocked posts are not displayed."],
 "saved.more":["Показать ещё сохранённые","Show more saved posts"],
 "notify.heading":["Управление вниманием и уведомлениями","Notifications and attention"],
 "notify.warning":["Выбирай, о каких новых действиях получать уведомления в личном кабинете. Это не email и не push. Ранее созданные события остаются в твоей истории.","Choose which new activities you want to see in your account. These are not email or push notifications. Existing events remain in your history."],
 "notify.followers":["Новые подписчики моих миров","New followers of my Worlds"],
 "notify.comments":["Комментарии к моим публикациям","Comments on my posts"],
 "notify.sponsors":["Рекламные предложения и решения","Advertising proposals and decisions"],
 "notify.save":["Сохранить предпочтения","Save preferences"],
 "notify.current":["Настройки читаются из личного профиля.","Settings are loaded from your personal profile."],
 "appeals.mine":["Мои обращения","My appeals"],
 "appeals.warning":["Если материал скрыт по ошибке, можно запросить независимую проверку. Апелляцию не рассматривает тот, кто скрыл публикацию.","If your content was hidden by mistake, you can request an independent review. The original moderator cannot review the appeal."],
 "appeals.history":["История обращений","Appeal history"],
 "blocks.heading":["Блокировки и защита сообщества","Blocks and community safety"],
 "blocks.warning":["Заблокированные участники исключаются из твоей ленты и поиска. Подписки, личные уведомления и рекламные соглашения между вами прекращаются. Общедоступные записи могут оставаться доступными без входа.","Blocked members are excluded from your feed and search. Follows, personal notifications and advertising agreements between you end. Public posts may remain visible to signed-out visitors."],
 "blocks.refresh":["Обновить список блокировок","Refresh blocked members"],
 "security.heading":["Безопасность аккаунта","Account security"],
 "security.warning":["Управляй своими входами и паролем. Эта версия работает только в локальной защищённой лаборатории MARCOSA.","Manage your sign-ins and password. This version operates only in the isolated MARCOSA laboratory."],
 "security.sessions":["Активные сессии: —","Active sessions: —"],
 "security.sessionExpires":["Срок текущего входа: —","Current session expires: —"],
 "security.email":["Проверка электронной почты и восстановление пароля ещё не подключены.","Email verification and password recovery are not yet connected."],
 "security.refresh":["Обновить безопасность","Refresh security"],
 "security.otherSessions":["Завершить другие входы","End other sign-ins"],
 "security.otherSessionsWarning":["Этот браузер останется в системе. Остальные сессии будут отозваны.","This browser stays signed in. Other sessions will be revoked."],
 "security.currentPassword":["Текущий пароль","Current password"],
 "security.signoutOthers":["Выйти на других устройствах","Sign out on other devices"],
 "security.changePassword":["Изменить пароль","Change password"],
 "security.changePasswordWarning":["После смены пароля все устройства, включая это, будут выведены из аккаунта.","Changing your password signs out every device, including this one."],
 "security.newPassword":["Новый пароль (12–128 символов)","New password (12–128 characters)"],
 "security.submitPassword":["Обновить пароль и завершить все сессии","Update password and end all sessions"],
 "account.export":["Выгрузить мои данные (JSON)","Export my data (JSON)"],
 "account.delete.heading":["Удалить локальный аккаунт и все данные","Delete local account and all data"],
 "account.delete.warning":["Необратимо удаляет миры, записи, сессии и жалобы этого пользователя на данном сервере.","Permanently deletes this user's Worlds, posts, sessions and reports from this server."],
 "account.delete.confirm":["Введите DELETE","Type DELETE"],
 "account.delete.submit":["Удалить навсегда","Delete permanently"],
 "activity.warning":["Только реальные действия других участников. История видна лишь владельцу аккаунта.","Only real activity by other members. This history is visible only to its account owner."],
 "activity.count":["0 новых","0 new"],
 "activity.read":["Прочитано","Mark as read"],
 "activity.more":["Ещё события","More activity"],
 "mod.postReports":["Жалобы на публикации","Post reports"],
 "mod.commentReports":["Жалобы на комментарии","Comment reports"],
 "mod.appeals":["Независимые апелляции","Independent appeals"],
 "mod.audit":["Журнал решений модераторов","Moderator decision log"],
 "mod.invites.heading":["Одноразовые приглашения для закрытой беты","Single-use invitations for the closed beta"],
 "mod.invites.warning":["Доступно только модератору локального сервера. Случайный код отображается один раз, хранится только его SHA-256. Не отправляй коды в публичные чаты.","Available only to local moderators. The random code is shown once; only its SHA-256 is stored. Never share invitation codes publicly."],
 "mod.invites.label":["Метка участника (не почта)","Participant label (not email)"],
 "mod.invites.expires":["Срок действия, часов","Expires after (hours)"],
 "mod.invites.issue":["Создать одноразовый код","Create single-use code"],
 "mod.invites.code":["Код — доступен только сейчас, сохрани конфиденциально","Code — visible only now; keep it private"],
 "mod.invites.hide":["Скрыть секрет","Hide secret"],
 "mod.invites.refresh":["Обновить список без секретов","Refresh list without secrets"],
 "mod.queue.heading":["Контроль открытых очередей модерации","Moderation queue health"],
 "mod.queue.warning":["Только реальные записи SQLite. Ориентиры 24/72 часа не являются юридическими сроками или SLA. Без имён жалобщиков, текстов жалоб и персональных данных.","Only real SQLite records. Internal 24/72-hour targets are neither legal deadlines nor SLAs. No reporter identities, complaint texts or personal data."],
 "mod.queue.empty":["Нет данных до входа модератора.","No data until a moderator signs in."],
 "mod.queue.refresh":["Обновить реальные очереди","Refresh live queues"],
 "mod.pilot.heading":["Пилот: проверенные показатели","Pilot: verified metrics"],
 "mod.pilot.warning":["D7/D30 считаются только для добровольной пригласительной когорты после 7/30 дней и честных событий входа. До созревания когорты указано «не измерено».","D7/D30 include only consenting invited cohorts after 7/30 real days and actual sign-in events. Until a cohort matures, its retention remains unmeasured."],
 "mod.pilot.refresh":["Пересчитать показатели","Recalculate metrics"],
 "mod.cover.heading":["Независимая проверка изображений миров","Independent World cover review"],
 "mod.cover.warning":["Новые PNG не становятся публичными, пока другой модератор не одобрит их. Обложку своего World нельзя рассматривать самостоятельно.","New PNG images remain private until another moderator approves them. You cannot review the cover of your own World."],
 "mod.cover.audit":["Журнал решений по изображениям","Cover decision log"],
 "mod.cover.refresh":["Обновить очередь изображений","Refresh image queue"],
 "mod.cover.appeals":["Апелляции на решения об изображениях","Cover moderation appeals"],
 "mod.cover.appealsWarning":["Рассмотреть может только другой независимый модератор. Принятая апелляция возвращает PNG в очередь, но не публикует его автоматически.","Only a different independent moderator may review an appeal. A successful appeal returns the PNG to the queue, but does not publish it automatically."],
 "mod.cover.appealsRefresh":["Обновить обращения","Refresh appeals"],
 "mod.cover.reportsHeading":["Жалобы на опубликованные изображения","Published image reports"],
 "mod.cover.reportsWarning":["Независимая проверка: жалобщик, владелец и первоначальный проверяющий не могут решать эту жалобу. Подтверждённая жалоба немедленно скрывает PNG.","The reporter, owner and original reviewer cannot decide the complaint. Upholding a report hides the PNG immediately."],
 "mod.cover.reportsRefresh":["Обновить очередь жалоб на изображения","Refresh published image reports"],
 "mod.refreshAll":["Обновить модерацию","Refresh moderation"],
 "sponsor.target":["World, где хочется разместиться","World for the proposed placement"],
 "sponsor.brandName":["Название бренда","Brand name"],
 "sponsor.proposal":["Прозрачное предложение","Transparent proposal"],
 "sponsor.url":["Публичный HTTPS-сайт","Public HTTPS website"],
 "sponsor.inbox":["Предложения моим мирам","Proposals for my Worlds"],
 "sponsor.review":["Проверка заявок","Proposal review"],
 "footer.local":["© MARCOSA / LOCAL ENGINEERING EDITION. Публичный сайт и этот исследовательский сервер — разные среды.","© MARCOSA / LOCAL ENGINEERING EDITION. The public website and this research server are separate environments."],
 "report.problem":["Сообщить о проблеме","Report a problem"],
 "report.private":["Жалобу увидит только модератор этого сервера.","Only a moderator of this server will see the report."],
 "report.spam":["Спам","Spam"],
 "report.abuse":["Оскорбления","Abuse"],
 "report.other":["Другое","Other"],
 "report.comment":["Комментарий","Comment"],
 "report.cancel":["Отмена","Cancel"],
 "report.submit":["Отправить жалобу","Submit report"],
 'notice.connecting':['Проверка соединения…','Connecting to local server…'],
 'notice.ready':['Локальный сервер готов. Данные настоящие, но изолированы от production.','Local server ready. Data is real but isolated from production.']
});
const STORAGE='marcosa.ui.language.r71';
const valid=v=>v==='ru'||v==='en';
const translate=(key,lang)=>CATALOG[key]?.[lang==='en'?1:0]??key;
function stored(){
 try{const v=window.localStorage.getItem(STORAGE);return valid(v)?v:null;}
 catch{return null;}
}
const requested=new URLSearchParams(location.search).get('lang');
let language=valid(requested)?requested:(stored()||'ru');
// Snapshot trusted HTML while this defer script runs BEFORE app.js loads any
// accounts, World titles, drafts or posts. Never auto-translate user content.
const byRussian=new Map(Object.entries(CATALOG).map(([key,pair])=>[pair[0],key]));
const staticNodes=[],staticAttributes=[];
const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
while(walker.nextNode()){
 const node=walker.currentNode,tag=node.parentElement?.tagName;
 if(!tag||['SCRIPT','STYLE','NOSCRIPT','TEXTAREA'].includes(tag))continue;
 const value=node.nodeValue,trimmed=value.trim(),key=byRussian.get(trimmed);
 if(!key)continue;
 const at=value.indexOf(trimmed);
 staticNodes.push({node,key,prefix:value.slice(0,at),suffix:value.slice(at+trimmed.length)});
}
for(const element of document.querySelectorAll('[placeholder],[aria-label],[alt]')){
 for(const attr of ['placeholder','aria-label','alt']){
  const key=byRussian.get(element.getAttribute(attr));
  if(key)staticAttributes.push({element,attr,key});
 }
}
const translateStatic=()=>{
 document.documentElement.lang=language;
 for(const {node,key,prefix,suffix} of staticNodes){
  if(node.isConnected)node.nodeValue=prefix+translate(key,language)+suffix;
 }
 for(const {element,attr,key} of staticAttributes){
  if(element.isConnected)element.setAttribute(attr,translate(key,language));
 }
 const select=document.getElementById('language-switch');
 if(select)select.value=language;
 if(location.pathname==='/'||location.pathname==='/index.html')
  document.title=language==='en'?'MARCOSA — Local Worlds Lab (English beta)':'MARCOSA — Лаборатория социальных миров R28';
};
const setLanguage=value=>{
 if(!valid(value))throw Error('Unsupported language; choose ru or en');
 language=value;
 try{window.localStorage.setItem(STORAGE,value);}catch{} // Disabled browser storage must not block accessibility.
 translateStatic();
 window.dispatchEvent(new CustomEvent('marcosa:locale-change',{detail:{locale:language}}));
 return language;
};
const keyFor=text=>{
 for(const [key,pair] of Object.entries(CATALOG)){
  if(pair[0]===text||pair[1]===text)return key;
 }
 return null;
};
window.MARCOSA_LOCALE=Object.freeze({
 get current(){return language;},
 t:key=>translate(key,language),
 keyFor,
 setLanguage,
 apply:translateStatic,
 catalogKeys:()=>Object.keys(CATALOG) // diagnostics only, no secrets or content.
});
translateStatic(); // Early snapshot limits translation strictly to template-owned text.
document.addEventListener('DOMContentLoaded',()=>{
 document.getElementById('language-switch')?.addEventListener('change',event=>setLanguage(event.target.value));
});
})();