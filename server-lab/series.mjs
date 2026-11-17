import { readFile } from 'node:fs/promises';

const slugPattern = /^[a-z][a-z0-9-]{2,47}$/;
const seriesQuery = `
 SELECT s.*, w.slug AS world, u.username AS author
 FROM series s
 JOIN users u ON u.id = s.owner_id
 JOIN worlds w ON w.id = s.world_id AND w.owner_id = s.owner_id
 LEFT JOIN profile_cards profile ON profile.user_id = s.owner_id
 WHERE (w.visibility = 'public' OR s.owner_id = $viewer)
 AND (coalesce(profile.visibility,'public') = 'public' OR s.owner_id = $viewer OR EXISTS (
  SELECT 1 FROM user_follows f WHERE f.follower_id = $viewer AND f.followed_id = s.owner_id AND f.status = 'active'
 ))
 AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
  (b.blocker_id = $viewer AND b.blocked_id = s.owner_id) OR (b.blocker_id = s.owner_id AND b.blocked_id = $viewer))
`;

export function initSeries(db) {
 db.exec(`
  CREATE TABLE IF NOT EXISTS series (
   id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE,
   world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
   owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
   description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=600), next_at INTEGER,
   created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS series_owner ON series(owner_id,id DESC);
  CREATE TABLE IF NOT EXISTS series_episodes (
   id INTEGER PRIMARY KEY AUTOINCREMENT, series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
   post_id INTEGER NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
   position INTEGER NOT NULL CHECK(position>0), title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
   created_at INTEGER NOT NULL, UNIQUE(series_id,position)
  );`);
}

export function readSeries(db, slug, viewerId = '') {
 return db.prepare(seriesQuery + ' AND s.slug = $slug').get({viewer: viewerId || '', slug});
}

export function visibleEpisodes(db, seriesId) {
 return db.prepare(`SELECT e.id,e.post_id,e.position,e.title,e.created_at,p.body FROM series_episodes e
  JOIN series s ON s.id=e.series_id JOIN posts p ON p.id=e.post_id AND p.author_id=s.owner_id AND p.world_id=s.world_id
  WHERE e.series_id=? AND p.status='published' ORDER BY e.position`).all(seriesId);
}

const escape = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function page(res, title, content, tools = false) {
 res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'});
 res.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} · MARCOSA</title><link rel="stylesheet" href="/style.css"><script defer src="/series.js"></script>${(tools?['votes','series-subscriptions','series-metrics','series-sponsor']:['series-subscriptions']).map(name=>'<script defer src="/'+name+'.js"></script>').join('')}</head><body class="page"><header class="topbar"><a href="/" class="brand">MARCOSA</a><a class="post-permalink" href="/series">Все сезоны</a></header><main class="panel">${content}<p role="status" id="series-notice"></p></main></body></html>`);
}

const formatDate = timestamp => new Date(timestamp).toISOString().slice(0,16).replace('T',' ')+' UTC';
const nextField = '<label>Следующий выпуск <input type="datetime-local" name="nextAt"></label>';
function createForm(worlds) {
 if (!worlds.length) return '<a href="/">Создать мир в кабинете</a>';
 return `<details><summary>Создать сезон</summary><form id="new-series" class="form-block">
 <label>Мир<select required name="worldId">${worlds.map(w=>`<option value="${escape(w.id)}">${escape(w.title)}</option>`).join('')}</select></label>
 <label>Название<input required name="title" maxlength="100"></label>
 <label>Адрес сезона<input required name="slug" pattern="[a-z][a-z0-9\\-]{2,47}" placeholder="my-season"></label>
 <label>О сезоне<textarea name="description" maxlength="600"></textarea></label>${nextField}
 <button>Создать сезон</button></form></details>`;
}
function episodeForm(db, season) {
 const posts = db.prepare(`SELECT p.id,p.body FROM posts p WHERE p.world_id=? AND p.author_id=? AND p.status='published'
  AND NOT EXISTS(SELECT 1 FROM series_episodes e WHERE e.post_id=p.id) ORDER BY p.id DESC LIMIT 100`).all(season.world_id,season.owner_id);
 const picker = posts.length ? `<form id="new-episode" class="form-block">
 <label>Публикация<select name="postId">${posts.map(p=>`<option value="${p.id}">${escape(p.body.slice(0,80))}</option>`).join('')}</select></label>
 <label>Название эпизода<input name="title" required maxlength="100"></label><button>Добавить эпизод</button></form>` :
 '<p>Сначала опубликуйте запись в этом мире. <a href="/">Открыть кабинет</a></p>';
 return `<details><summary>Редактировать сезон</summary>${picker}<form id="next-release" class="form-block">${nextField}<button>Обновить дату</button></form></details>`;
}

function describe(row) {
 return {id:row.id,slug:row.slug,title:row.title,description:row.description,world:row.world,author:row.author,nextAt:row.next_at};
}
function textField(value,max,check,optional=false) {
 if (optional && value === undefined) return '';
 check(typeof value==='string',400,'Ожидается текст');
 const trimmed=value.trim(); check((optional || trimmed.length>0) && trimmed.length<=max,400,'Проверьте длину текста');return trimmed;
}
function dateField(value,check) {
 if (value == null) return null;
 check(Number.isSafeInteger(value) && value>0 && value<253402300800000,400,'Неверная дата выпуска');
 return value;
}
export async function handleSeries(ctx) {
 const {db,res,route,method,body,user,viewer,send,check,now,atomic,query}=ctx;
 const viewerId=(typeof viewer==='string'?viewer:viewer?.id)||user?.id||'';
 const respond = (status, data) => send(res,status,data,{'Cache-Control':'private, no-store'});
 if (method==='GET' && route==='/series.js') {
  res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(await readFile(new URL('./public/series.js',import.meta.url)));return true;
 }
 const detail=route.match(/^\/(api\/)?series\/([a-z][a-z0-9-]{2,47})(?:\/(episodes))?$/);
 const catalog=route==='/series'||route==='/api/series';
 if (!detail && !catalog) return false;
 if (method==='GET' && catalog) {
  const raw=query.get('q')||'';
  check(raw.length<=72,400,'Поиск ограничен 72 символами');
  const search=raw.trim().normalize('NFC');
  // Stable keyset pagination: no private series should leak across pages.
  const cursorRaw=query.get('cursor')||'';
  check(!cursorRaw || (/^[1-9][0-9]{0,14}$/.test(cursorRaw) && Number.isSafeInteger(Number(cursorRaw))),400,'Неверный курсор сезонов');
  const cursor=cursorRaw?Number(cursorRaw):null;
  const pageSize=20;
  const rows=db.prepare(seriesQuery+` AND ($search='' OR instr(lower(s.title),lower($search))>0 OR instr(lower(s.description),lower($search))>0 OR instr(lower(u.username),lower($search))>0)
   AND ($cursor IS NULL OR s.id < $cursor)
   ORDER BY s.id DESC LIMIT $limit`).all({viewer:viewerId,search,cursor,limit:pageSize+1});
  const nextCursor=rows.length>pageSize?String(rows[pageSize-1].id):null;
  const items=rows.slice(0,pageSize);
  const episodeSummary=new Map();
  if(items.length){
   const placeholders=items.map(()=>'?').join(',');
   const episodes=db.prepare(`SELECT e.id,e.series_id FROM series_episodes e JOIN series s ON s.id=e.series_id
    JOIN posts p ON p.id=e.post_id AND p.author_id=s.owner_id AND p.world_id=s.world_id
    WHERE e.series_id IN (${placeholders}) AND p.status='published' ORDER BY e.series_id,e.position`).all(...items.map(item=>item.id));
   for(const episode of episodes){
    const summary=episodeSummary.get(episode.series_id)||{episodeCount:0,firstEpisodeId:episode.id};
    summary.episodeCount++;episodeSummary.set(episode.series_id,summary);
   }
  }
  const results=items.map(item=>({...describe(item),...(episodeSummary.get(item.id)||{episodeCount:0,firstEpisodeId:null})}));
  const nextPage=nextCursor?'/series?'+new URLSearchParams(search?{q:search,cursor:nextCursor}:{cursor:nextCursor}).toString():null;
  if(route==='/api/series') respond(200,{items:results,query:search,nextCursor});
  else {
   const worlds=viewerId?db.prepare('SELECT id,title FROM worlds WHERE owner_id=? ORDER BY created_at DESC').all(viewerId):[];
   const cards=results.map(s=>`<article class="post"><p class="eyebrow">@${escape(s.author)}</p><h2><a class="post-permalink" href="/series/${escape(s.slug)}">${escape(s.title)}</a></h2><p>${escape(s.description)}</p><p>Опубликовано выпусков: ${s.episodeCount}</p>${s.firstEpisodeId?`<a class="post-permalink" href="/series/${escape(s.slug)}#episode-${s.firstEpisodeId}">Начать с первого выпуска</a>`:'<span>Первый выпуск готовится</span>'}</article>`).join('');
   const empty=search?'По этому запросу доступных сезонов не найдено.':'Пока нет доступных сезонов.';
   page(res,'Авторские сезоны',`<h1>Авторские сезоны</h1><form method="get" action="/series" role="search"><label>Название, тема или автор <input name="q" maxlength="72" value="${escape(search)}"></label><button type="submit">Найти</button></form><section id="series-reminders"></section>${cards||`<p>${empty}</p>`}${nextPage?`<nav aria-label="Страницы сезонов"><a class="post-permalink" href="${escape(nextPage)}">Следующие сезоны</a></nav>`:''}${viewerId?createForm(worlds):'<a href="/">Войти в MARCOSA</a>'}`);
  }
  return true;
 }
 if(method==='POST' && route==='/api/series') {
  check(user,401,'Нужен вход');const title=textField(body.title,100,check),description=textField(body.description,600,check,true);
  check(typeof body.slug==='string' && slugPattern.test(body.slug),400,'Адрес должен содержать от 3 до 48 латинских букв, цифр или дефисов и начинаться с буквы');
  const nextAt=dateField(body.nextAt,check);
  check(typeof body.worldId==='string' && db.prepare('SELECT 1 FROM worlds WHERE id=? AND owner_id=?').get(body.worldId,user.id),404,'Мир не найден');
  const inserted=db.prepare('INSERT INTO series(slug,world_id,owner_id,title,description,next_at,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(slug) DO NOTHING').run(body.slug,body.worldId,user.id,title,description,nextAt,now());
  check(inserted.changes,409,'Адрес уже занят');respond(201,{id:Number(inserted.lastInsertRowid),slug:body.slug});return true;
 }
 if (!detail) return false;
 const [,api,slug,action]=detail;
 if(action && (!api || method!=='POST')) return false;
 const season=readSeries(db,slug,viewerId);check(season,404,'Сезон не найден');
 if (method==='GET') {
  const episodes=visibleEpisodes(db,season.id);
  if(api) respond(200,{series:describe(season),episodes,owner:viewerId===season.owner_id});
  else {
   const cards=episodes.map(e=>`<article class="post" id="episode-${e.id}" data-episode-id="${e.id}"><p class="eyebrow">Эпизод ${e.position}</p><h2>${escape(e.title)}</h2><p class="post-body">${escape(e.body)}</p><a class="post-permalink" href="/w/${escape(season.world)}#post-${e.post_id}">Обсудить выпуск</a><div data-episode-poll data-series="${escape(slug)}" data-episode="${e.id}"></div></article>`).join('');
   page(res,season.title,`<section id="series-tools" data-slug="${escape(slug)}" data-owner="${viewerId===season.owner_id}" data-member="${Boolean(viewerId)}"><p class="eyebrow"><a href="/u/${escape(season.author)}">@${escape(season.author)}</a></p><h1>${escape(season.title)}</h1><p>${escape(season.description)}</p>${season.next_at?`<p>Следующий выпуск · ${formatDate(season.next_at)}</p>`:''}${cards||'<p>Первый эпизод готовится.</p>'}</section>${viewerId===season.owner_id?episodeForm(db,season):''}`,true);
  }
  return true;
 }
 if (!api) return false;
 check(user,401,'Нужен вход');check(user.id===season.owner_id,403,'Только автор сезона');
 if(method==='PATCH' && !action) {
  check(Object.keys(body).length===1 && 'nextAt' in body,400,'Ожидается дата следующего выпуска');
  const nextAt=dateField(body.nextAt,check);db.prepare('UPDATE series SET next_at=? WHERE id=?').run(nextAt,season.id);
  respond(200,{nextAt});return true;
 }
 if(method==='POST' && action==='episodes') {
  const title=textField(body.title,100,check);
  check(Number.isSafeInteger(body.postId) && body.postId>0,400,'Неверный номер публикации');
  const episode=atomic(()=>{
   const post=db.prepare("SELECT id FROM posts WHERE id=? AND world_id=? AND author_id=? AND status='published'").get(body.postId,season.world_id,user.id);
   check(post,404,'Публикация не найдена');
   const existing=db.prepare('SELECT id,position,series_id,title FROM series_episodes WHERE post_id=?').get(body.postId);
   if(existing) {check(existing.series_id===season.id && existing.title===title,409,'Публикация уже добавлена');return {id:existing.id,position:existing.position,created:false};}
   const {position}=db.prepare('SELECT coalesce(max(position),0)+1 AS position FROM series_episodes WHERE series_id=?').get(season.id);
   const added=db.prepare('INSERT INTO series_episodes(series_id,post_id,position,title,created_at) VALUES(?,?,?,?,?)').run(season.id,body.postId,position,title,now());
   const id=Number(added.lastInsertRowid);ctx.onEpisode?.(db,season.id,id);return {id,position,created:true};
  });
  respond(episode.created?201:200,episode);return true;
 }
 return false;
}
