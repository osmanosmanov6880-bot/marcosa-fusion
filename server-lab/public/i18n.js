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