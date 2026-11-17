import {readFile} from 'node:fs/promises';
import {readSeries, visibleEpisodes} from './series.mjs';

const week = 7 * 24 * 60 * 60 * 1000;
const script = new URL('./public/series-metrics.js', import.meta.url);

export function initMetrics(db) {
 db.exec(`
  CREATE TABLE IF NOT EXISTS series_attendance (
   episode_id INTEGER NOT NULL REFERENCES series_episodes(id) ON DELETE CASCADE,
   viewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   first_at INTEGER NOT NULL, PRIMARY KEY(episode_id, viewer_id)
  );
  CREATE INDEX IF NOT EXISTS idx_series_attendance_viewer ON series_attendance(viewer_id);
  CREATE TABLE IF NOT EXISTS series_test_accounts (
   user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS series_effort (
   episode_id INTEGER PRIMARY KEY REFERENCES series_episodes(id) ON DELETE CASCADE,
   minutes INTEGER NOT NULL CHECK(minutes BETWEEN 0 AND 100000)
  );
 `);
}

export function exportAttendance(db, userId) {
 return db.prepare('SELECT episode_id AS episodeId, first_at AS firstAt FROM series_attendance WHERE viewer_id=? ORDER BY episode_id').all(userId);
}

function report(db, series, now, episodes) {
 const marks = db.prepare(`
  SELECT e.position, a.viewer_id, a.first_at FROM series_attendance a
  JOIN series_episodes e ON e.id=a.episode_id JOIN posts p ON p.id=e.post_id
  WHERE e.series_id=? AND p.status='published' AND a.viewer_id<>?
   AND NOT EXISTS(SELECT 1 FROM series_test_accounts t WHERE t.user_id=a.viewer_id)
   AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_id=? AND b.blocked_id=a.viewer_id)
                 OR (b.blocker_id=a.viewer_id AND b.blocked_id=?))
 `).all(series.id, series.owner_id, series.owner_id, series.owner_id);
 const checkins = new Map(episodes.map(e => [e.position, new Map()]));
 for (const {position,viewer_id,first_at} of marks) checkins.get(position)?.set(viewer_id,first_at);
 const first = checkins.get(1) || new Map();
 const second = checkins.get(2);
 let eligible=0, returned=0;
 if (second) {
  for (const [id,time] of first) {
   if (time + week > now) continue;
   eligible++;
   const later=second.get(id);
   if (later > time && later <= time + week) returned++;
  }
 }
 const effort = new Map(db.prepare('SELECT e.id, f.minutes FROM series_episodes e JOIN series_effort f ON f.episode_id=e.id WHERE e.series_id=?').all(series.id).map(r=>[r.id,r.minutes]));
 return {
  episodes: episodes.map(e=>({id:e.id,title:e.title,position:e.position,people:checkins.get(e.position).size,minutes:effort.get(e.id)??null})),
  return7d:{eligible,returned,rate:eligible ? returned/eligible : null}
 };
}

export async function handleMetrics(ctx) {
 const {db,method,route,user,viewer,check,send,res,body,now}=ctx;
 if (method==='GET' && route==='/series-metrics.js') {
  res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});
  res.end(await readFile(script)); return true;
 }
 // Allow a reader to withdraw exactly ONE voluntary mark even after losing access.
 const single=route.match(/^\/api\/series\/([a-z][a-z0-9-]{2,47})\/metrics\/attendance\/([1-9][0-9]{0,14})$/);
 if(single){
  check(method==='DELETE',405,'Метод недоступен');
  const actor=user||viewer;
  check(actor?.id,401,'Войдите в аккаунт');
  check(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===0,
   400,'Удаление не принимает дополнительные поля');
  const episodeId=Number(single[2]);
  check(Number.isSafeInteger(episodeId),400,'Неверный номер эпизода');
  const removed=db.prepare(`DELETE FROM series_attendance WHERE episode_id=? AND viewer_id=?
   AND EXISTS(SELECT 1 FROM series_episodes e JOIN series s ON s.id=e.series_id
   WHERE e.id=series_attendance.episode_id AND s.slug=?)`).run(episodeId,actor.id,single[1]).changes;
  send(res,200,{removed:true,erased:removed===1},{'Cache-Control':'private, no-store'});return true;
 }
 const routeMatch=route.match(/^\/api\/series\/([a-z0-9-]+)\/metrics(?:\/(attendance|effort))?$/);
 if (!routeMatch) return false;
 const [,slug,action] = routeMatch;
 const actor = user || viewer;
 check(actor?.id,401,'Войдите в аккаунт');
 const erase=action==='attendance' && method==='DELETE';
 // Members can revoke their own marks even after losing access to the season.
 if (erase) {
  check(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===0,
   400,'Удаление не принимает дополнительные поля');
  db.prepare('DELETE FROM series_attendance WHERE viewer_id=? AND episode_id IN (SELECT e.id FROM series_episodes e JOIN series s ON s.id=e.series_id WHERE s.slug=?)').run(actor.id,slug);
  send(res,200,{removed:true});return true;
 }
 const series=readSeries(db,slug,actor.id);
 check(series,404,'Сезон недоступен');
 const owner=series.owner_id===actor.id;
 const episodes=visibleEpisodes(db,series.id);
 if (!action && method==='GET') {
  check(owner,403,'Отчёт доступен автору');
  send(res,200,report(db,series,now(),episodes));return true;
 }
 if (action==='attendance' && method==='GET') {
  const attended=db.prepare('SELECT a.episode_id AS id FROM series_attendance a JOIN series_episodes e ON e.id=a.episode_id WHERE e.series_id=? AND a.viewer_id=?').all(series.id,actor.id);
  const selected=new Set(attended.map(e=>e.id));
  send(res,200,{owner,episodes:episodes.map(e=>({id:e.id,title:e.title,position:e.position,marked:selected.has(e.id)}))});return true;
 }
 check(method==='POST' && ['attendance','effort'].includes(action),405,'Метод недоступен');
 check(Number.isSafeInteger(body.episodeId) && episodes.some(e=>e.id===body.episodeId),404,'Выпуск недоступен');
 if (action==='effort') {
  check(owner,403,'Трудозатраты доступны автору');
  check(Number.isInteger(body.minutes) && body.minutes>=0 && body.minutes<=100000,400,'Укажите минуты от 0 до 100000');
  db.prepare('INSERT INTO series_effort(episode_id,minutes) VALUES(?,?) ON CONFLICT(episode_id) DO UPDATE SET minutes=excluded.minutes').run(body.episodeId,body.minutes);
 } else {
  check(!owner && body.consent===true,400,'Требуется согласие зрителя');
  db.prepare('INSERT INTO series_attendance(episode_id,viewer_id,first_at) VALUES(?,?,?) ON CONFLICT DO NOTHING').run(body.episodeId,actor.id,now());
 }
 send(res,200,{saved:true});return true;
}
