import {readFileSync} from 'node:fs';
import {readSeries} from './series.mjs';
import {nextUnreadEpisodes} from './series-continue.mjs';

const script=readFileSync(new URL('./public/series-subscriptions.js',import.meta.url),'utf8');

export function initSubscriptions(db){
 db.exec(`
 CREATE TABLE IF NOT EXISTS series_subscriptions(
  series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(series_id,user_id)
 );
 CREATE TABLE IF NOT EXISTS series_reminders(
  episode_id INTEGER NOT NULL REFERENCES series_episodes(id) ON DELETE CASCADE,
  series_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY(episode_id,user_id),
  FOREIGN KEY(series_id,user_id) REFERENCES series_subscriptions(series_id,user_id) ON DELETE CASCADE
 );
 CREATE INDEX IF NOT EXISTS series_reminders_person ON series_reminders(user_id,episode_id DESC);
 CREATE TRIGGER IF NOT EXISTS series_unsubscribe_on_block AFTER INSERT ON user_blocks BEGIN
  DELETE FROM series_subscriptions WHERE
   (user_id=NEW.blocker_id AND series_id IN(SELECT id FROM series WHERE owner_id=NEW.blocked_id)) OR
   (user_id=NEW.blocked_id AND series_id IN(SELECT id FROM series WHERE owner_id=NEW.blocker_id));
 END;
 `);
}

export function onEpisode(db,seriesId,episodeId){
 db.prepare(`INSERT OR IGNORE INTO series_reminders(episode_id,series_id,user_id)
 SELECT e.id,e.series_id,sub.user_id FROM series_episodes e
 JOIN series s ON s.id=e.series_id JOIN worlds w ON w.id=s.world_id
 JOIN posts p ON p.id=e.post_id AND p.world_id=w.id AND p.author_id=s.owner_id
 JOIN series_subscriptions sub ON sub.series_id=e.series_id
 LEFT JOIN profile_cards pc ON pc.user_id=s.owner_id
 WHERE e.series_id=? AND e.id=? AND p.status='published' AND w.visibility='public'
 AND (COALESCE(pc.visibility,'public')='public' OR EXISTS
 (SELECT 1 FROM user_follows f WHERE f.follower_id=sub.user_id AND f.followed_id=s.owner_id AND f.status='active'))
 AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
 (b.blocker_id=s.owner_id AND b.blocked_id=sub.user_id) OR
 (b.blocker_id=sub.user_id AND b.blocked_id=s.owner_id))`).run(seriesId,episodeId);
}

export function handleSubscriptions({db,res,route,method,viewer,user,send,check,body}){
 if(method==='GET'&&route==='/series-subscriptions.js'){
  res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8'});
  res.end(script);
  return true;
 }
 const actor=(user||viewer)?.id;
 const reply=(status,data)=>send(res,status,data,{'Cache-Control':'private, no-store'});
 if(method==='GET'&&route==='/api/me/series-continue'){
  check(actor,401,'Нужен вход');
  reply(200,{items:nextUnreadEpisodes(db,actor),source:'voluntary-checkins'});return true;
 }
 if(method==='GET'&&route==='/api/me/series-reminders'){
  check(actor,401,'Нужен вход');
  const items=db.prepare(`SELECT s.slug,s.title AS seriesTitle,e.title AS episodeTitle,
   e.id AS episodeId,e.position,e.post_id AS postId,w.slug AS world
   FROM series_reminders r JOIN series s ON s.id=r.series_id
   JOIN series_episodes e ON e.id=r.episode_id AND e.series_id=s.id
   JOIN posts p ON p.id=e.post_id AND p.world_id=s.world_id AND p.author_id=s.owner_id
   JOIN worlds w ON w.id=s.world_id LEFT JOIN profile_cards pc ON pc.user_id=s.owner_id
   WHERE r.user_id=? AND p.status='published' AND w.visibility='public'
   AND (COALESCE(pc.visibility,'public')='public' OR EXISTS(SELECT 1 FROM user_follows f
   WHERE f.follower_id=r.user_id AND f.followed_id=s.owner_id AND f.status='active'))
   AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_id=r.user_id AND b.blocked_id=s.owner_id)
   OR (b.blocked_id=r.user_id AND b.blocker_id=s.owner_id))
   ORDER BY r.episode_id DESC LIMIT 50`).all(actor);
  reply(200,{items});return true;
 }
 const dismiss=route.match(/^\/api\/me\/series-reminders\/([1-9][0-9]{0,14})$/);
 if(dismiss){
  check(method==='DELETE',405,'Метод недоступен');
  check(actor,401,'Нужен вход');
  check(body&&Object.keys(body).length===0,400,'Неизвестные поля');
  const episodeId=Number(dismiss[1]);
  check(Number.isSafeInteger(episodeId),400,'Неверный номер выпуска');
  db.prepare('DELETE FROM series_reminders WHERE episode_id=? AND user_id=?').run(episodeId,actor);
  reply(200,{dismissed:true});return true;
 }
 const match=route.match(/^\/api\/series\/([a-z0-9-]{1,80})\/subscription$/);
 if(!match||!['GET','POST','DELETE'].includes(method))return false;
 check(actor,401,'Нужен вход');
 const slug=match[1];
 if(method!=='GET')check(body&&Object.keys(body).length===0,400,'Неизвестные поля');
 if(method==='DELETE'){
  db.prepare('DELETE FROM series_subscriptions WHERE user_id=? AND series_id=(SELECT id FROM series WHERE slug=?)').run(actor,slug);
  reply(200,{subscribed:false});return true;
 }
 const series=readSeries(db,slug,actor);
 check(series,404,'Сезон недоступен');
 const own=actor===series.owner_id;
 if(method==='POST'){
  check(!own,403,'Это ваш сезон');
  db.prepare('INSERT OR IGNORE INTO series_subscriptions(series_id,user_id) VALUES(?,?)').run(series.id,actor);
 }
 const subscribed=!!db.prepare('SELECT 1 FROM series_subscriptions WHERE series_id=? AND user_id=?').get(series.id,actor);
 reply(200,{subscribed,own});
 return true;
}
