import {readSeries} from './series.mjs';

/** Owner-only release management. Underlying posts are never deleted. */
export function handleSeriesEditor(ctx){
 const {db,route,method,body,user,viewer,check,send,atomic}=ctx;
 const match=route.match(/^\/api\/series\/([a-z][a-z0-9-]{2,47})\/episodes\/(order|[1-9][0-9]{0,14})$/);
 if(!match)return false;
 const [,slug,target]=match;
 const actor=user?.id||viewer?.id;
 check(actor,401,'Нужен вход');
 const season=readSeries(db,slug,actor);
 check(season,404,'Сезон не найден');
 check(actor===season.owner_id,403,'Только автор сезона может управлять выпусками');
 const reply=data=>send(ctx.res,200,data,{'Cache-Control':'private, no-store'});
 if(target==='order'){
  check(method==='PUT',405,'Метод недоступен');
  check(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===1&&
   Array.isArray(body.order),400,'Нужен полный порядок выпусков');
  const order=body.order;
  check(order.length<=500 && order.every(Number.isSafeInteger) && new Set(order).size===order.length,
   400,'Неверный порядок выпусков');
  const changed=atomic(()=>{
   const current=db.prepare('SELECT id,position FROM series_episodes WHERE series_id=? ORDER BY position').all(season.id);
   check(current.length===order.length && current.length<=500,409,'Состав выпусков изменился');
   const expected=new Set(current.map(x=>x.id));
   check(order.every(x=>expected.has(x)),409,'Чужой или отсутствующий выпуск');
   if(current.every((x,i)=>x.id===order[i]))return false;
   const offset=Math.max(0,...current.map(x=>x.position))+current.length+1;
   db.prepare('UPDATE series_episodes SET position=position+? WHERE series_id=?').run(offset,season.id);
   const update=db.prepare('UPDATE series_episodes SET position=? WHERE id=? AND series_id=?');
   for(const [i,id] of order.entries())check(update.run(i+1,id,season.id).changes===1,409,'Состав выпусков изменился');
   return true;
  });
  reply({updated:changed,order});return true;
 }
 check(['PATCH','DELETE'].includes(method),405,'Метод недоступен');
 const episodeId=Number(target);
 check(Number.isSafeInteger(episodeId)&&episodeId>0,400,'Неверный номер выпуска');
 const episode=db.prepare('SELECT id,title FROM series_episodes WHERE id=? AND series_id=?').get(episodeId,season.id);
 check(episode,404,'Выпуск не найден');
 if(method==='PATCH'){
  check(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===1&&
   typeof body.title==='string',400,'Ожидается название выпуска');
  const title=body.title.trim();
  check(title.length>=1&&title.length<=100,400,'Название от 1 до 100 символов');
  db.prepare('UPDATE series_episodes SET title=? WHERE id=? AND series_id=?').run(title,episodeId,season.id);
  reply({episodeId,title,updated:true});return true;
 }
 check(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===1&&
  body.confirm===true,400,'Подтвердите удаление связи выпуска');
 atomic(()=>{
  db.prepare('DELETE FROM series_episodes WHERE id=? AND series_id=?').run(episodeId,season.id);
  // Recompact positions without colliding with UNIQUE(series_id,position).
  const others=db.prepare('SELECT id,position FROM series_episodes WHERE series_id=? ORDER BY position').all(season.id);
  if(!others.length)return;
  const offset=Math.max(...others.map(x=>x.position))+others.length+1;
  db.prepare('UPDATE series_episodes SET position=position+? WHERE series_id=?').run(offset,season.id);
  const update=db.prepare('UPDATE series_episodes SET position=? WHERE id=? AND series_id=?');
  for(const [i,row] of others.entries())update.run(i+1,row.id,season.id);
 });
 reply({removed:true,episodeId,postPreserved:true});return true;
}
