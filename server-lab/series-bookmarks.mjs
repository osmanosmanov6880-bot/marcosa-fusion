import {readFile} from 'node:fs/promises';
import {readSeries,visibleEpisodes} from './series.mjs';
const script=new URL('./public/series-bookmarks.js',import.meta.url);
export function initSeriesBookmarks(db) {
 db.exec([
  'CREATE TABLE IF NOT EXISTS series_episode_bookmarks(episode_id INTEGER NOT NULL REFERENCES series_episodes(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,saved_at INTEGER NOT NULL,PRIMARY KEY(episode_id,user_id))',
  'CREATE INDEX IF NOT EXISTS idx_series_episode_bookmarks_user ON series_episode_bookmarks(user_id,episode_id DESC)'
 ].join(';')+';');
}
export function exportReaderBookmarks(db,actor) {
 return db.prepare('SELECT episode_id AS episodeId,saved_at AS savedAt FROM series_episode_bookmarks WHERE user_id=? ORDER BY episode_id').all(actor);
}
/** Only visible and published chapters may be saved; self-only erase always works. */
export async function handleSeriesBookmarks({db,res,route,method,body,viewer,user,send,check,now,query}){
 if(route==='/series-bookmarks.js' && method==='GET'){
  res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store'});
  res.end(await readFile(script));return true;
 }
 const actor=(user||viewer)?.id;
 const reply=(status,data)=>send(res,status,data,{'Cache-Control':'private, no-store'});
 if(route==='/api/me/series-bookmarks'){
  check(method==='GET',405,'Метод недоступен');
  check(actor,401,'Нужен вход');
  const limitRaw=query?.get('limit')||'20',cursorRaw=query?.get('cursor')||'';
  check(/^[1-9][0-9]?$/.test(limitRaw)&&Number(limitRaw)<=50,400,'Лимит от 1 до 50');
  check(!cursorRaw||(/^[1-9][0-9]{0,14}$/.test(cursorRaw)&&Number.isSafeInteger(Number(cursorRaw))),400,'Неверный курсор');
  const limit=Number(limitRaw),cursor=cursorRaw?Number(cursorRaw):null;
  const sql=[
   'SELECT e.id AS episodeId,e.title AS episodeTitle,e.position,s.slug,s.title AS seriesTitle,w.slug AS world,b.saved_at AS savedAt',
   'FROM series_episode_bookmarks b JOIN series_episodes e ON e.id=b.episode_id',
   'JOIN series s ON s.id=e.series_id',
   "JOIN posts p ON p.id=e.post_id AND p.author_id=s.owner_id AND p.world_id=s.world_id AND p.status='published'",
   'JOIN worlds w ON w.id=s.world_id AND w.owner_id=s.owner_id',
   'LEFT JOIN profile_cards pc ON pc.user_id=s.owner_id',
   'WHERE b.user_id=? AND (? IS NULL OR b.episode_id<?)',
   "AND (w.visibility='public' OR s.owner_id=?)",
   "AND (COALESCE(pc.visibility,'public')='public' OR s.owner_id=? OR EXISTS(",
   " SELECT 1 FROM user_follows f WHERE f.follower_id=b.user_id AND f.followed_id=s.owner_id AND f.status='active'))",
   'AND NOT EXISTS(SELECT 1 FROM user_blocks bl WHERE',
   ' (bl.blocker_id=b.user_id AND bl.blocked_id=s.owner_id) OR (bl.blocker_id=s.owner_id AND bl.blocked_id=b.user_id))',
   'ORDER BY b.episode_id DESC LIMIT ?'
  ].join(' ');
  const rows=db.prepare(sql).all(actor,cursor,cursor,actor,actor,limit+1);
  const items=rows.slice(0,limit);
  reply(200,{items,nextCursor:rows.length>limit?String(items.at(-1).episodeId):null});return true;
 }
 const match=route.match(/^\/api\/series\/([a-z][a-z0-9-]{2,47})\/episodes\/([1-9][0-9]{0,14})\/bookmark$/);
 if(!match)return false;
 check(['GET','POST','DELETE'].includes(method),405,'Метод недоступен');
 check(actor,401,'Нужен вход');
 const episodeId=Number(match[2]);
 check(Number.isSafeInteger(episodeId),400,'Неверный номер выпуска');
 if(method==='DELETE'){
  check(body && typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===0,400,'Неизвестные поля');
  const changes=db.prepare([
   'DELETE FROM series_episode_bookmarks WHERE episode_id=? AND user_id=?',
   'AND EXISTS(SELECT 1 FROM series_episodes e JOIN series s ON s.id=e.series_id',
   'WHERE e.id=series_episode_bookmarks.episode_id AND s.slug=?)'
  ].join(' ')).run(episodeId,actor,match[1]).changes;
  reply(200,{saved:false,removed:changes===1});return true;
 }
 const season=readSeries(db,match[1],actor);
 check(season,404,'Сезон недоступен');
 check(visibleEpisodes(db,season.id).some(e=>e.id===episodeId),404,'Выпуск недоступен');
 if(method==='POST'){
  check(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===0,400,'Неизвестные поля');
  const changes=db.prepare('INSERT OR IGNORE INTO series_episode_bookmarks(episode_id,user_id,saved_at) VALUES(?,?,?)').run(episodeId,actor,now()).changes;
  reply(200,{saved:true,added:changes===1});return true;
 }
 reply(200,{saved:Boolean(db.prepare('SELECT 1 FROM series_episode_bookmarks WHERE episode_id=? AND user_id=?').get(episodeId,actor))});
 return true;
}
