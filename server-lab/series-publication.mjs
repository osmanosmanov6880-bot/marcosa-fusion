import {readSeries} from './series.mjs';
/** Owner-controlled season archival. Reader routes fail closed while archived. */
export function handleSeriesPublication({db,res,route,method,viewer,user,body,check,send,now,atomic}){
 const matched=route.match(/^\/api\/series\/([a-z][a-z0-9-]{2,47})\/publication$/);
 if(!matched)return false;
 check(['POST','DELETE'].includes(method),405,'Метод недоступен');
 const actor=(user||viewer)?.id;
 check(actor,401,'Нужен вход');
 check(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===0,
  400,'Неизвестные поля');
 const season=readSeries(db,matched[1],actor);
 check(season,404,'Сезон недоступен');
 check(season.owner_id===actor,403,'Только автор может снять сезон с публикации');
 const action=atomic(()=>{
  if(method==='DELETE'){
   const changes=db.prepare('UPDATE series SET archived_at=? WHERE id=? AND archived_at IS NULL').run(now(),season.id).changes;
   // Previously queued notifications must not remain visible after withdrawal.
   const remindersRemoved=db.prepare('DELETE FROM series_reminders WHERE series_id=?').run(season.id).changes;
   return{archived:true,changed:changes===1,remindersRemoved};
  }
  const changes=db.prepare('UPDATE series SET archived_at=NULL WHERE id=? AND archived_at IS NOT NULL').run(season.id).changes;
  // Subscribers remain subscribed, but old reminders are NOT backfilled.
  return{archived:false,changed:changes===1,notificationsBackfilled:false};
 });
 send(res,200,action,{'Cache-Control':'private, no-store'});
 return true;
}
