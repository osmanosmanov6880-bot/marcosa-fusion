import {createHash} from 'node:crypto';
const actions=new Set([
 'series_created','series_updated','episode_attached','episode_renamed',
 'episodes_reordered','episode_removed','series_archived','series_restored'
]);
export const orderDigest=order=>createHash('sha256').update(JSON.stringify(order)).digest('hex');
export function initSeriesAudit(db){
 db.exec([
  'CREATE TABLE IF NOT EXISTS series_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,action TEXT NOT NULL,details_json TEXT NOT NULL,created_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS idx_series_audit_owner ON series_audit(series_id,id DESC)'
 ].join(';')+';');
}
export function logSeriesAction(db,{seriesId,actorId,action,details={},now}){
 if(!Number.isSafeInteger(seriesId)||seriesId<1||typeof actorId!=='string'||!actorId)throw Error('Invalid audit owner');
 if(!actions.has(action))throw Error('Unknown editorial audit action');
 if(!Number.isSafeInteger(now)||now<=0)throw Error('Invalid audit timestamp');
 const encoded=JSON.stringify(details);
 if(typeof encoded!=='string'||encoded.length>2048)throw Error('Audit details exceed limit');
 const owner=db.prepare('SELECT 1 FROM series WHERE id=? AND owner_id=?').get(seriesId,actorId);
 if(!owner)throw Error('Editorial audit actor is not the owner');
 db.prepare('INSERT INTO series_audit(series_id,actor_id,action,details_json,created_at) VALUES(?,?,?,?,?)')
  .run(seriesId,actorId,action,encoded,now);
}
export function exportSeriesAudit(db,userId){
 return db.prepare([
  'SELECT a.id,a.series_id AS seriesId,a.action,a.details_json AS detailsJson,a.created_at AS createdAt',
  'FROM series_audit a JOIN series s ON s.id=a.series_id',
  'WHERE s.owner_id=? ORDER BY a.id'
 ].join(' ')).all(userId);
}
export function handleSeriesAudit({db,res,route,method,viewer,user,query,check,send}){
 const matched=route.match(/^\/api\/series\/([a-z][a-z0-9-]{2,47})\/audit$/);
 if(!matched)return false;
 check(method==='GET',405,'Метод недоступен');
 const actor=(user||viewer)?.id;
 check(actor,401,'Нужен вход');
 const series=db.prepare('SELECT id FROM series WHERE slug=? AND owner_id=?').get(matched[1],actor);
 check(series,404,'История доступна только автору');
 const limitRaw=query?.get('limit')||'20',cursorRaw=query?.get('cursor')||'';
 check(/^[1-9][0-9]?$/.test(limitRaw)&&Number(limitRaw)<=50,400,'Лимит от 1 до 50');
 check(!cursorRaw||(/^[1-9][0-9]{0,14}$/.test(cursorRaw)&&Number.isSafeInteger(Number(cursorRaw))),400,'Неверный курсор');
 const limit=Number(limitRaw),cursor=cursorRaw?Number(cursorRaw):null;
 const rows=db.prepare([
  'SELECT id,action,details_json AS detailsJson,created_at AS createdAt FROM series_audit',
  'WHERE series_id=? AND (? IS NULL OR id<?) ORDER BY id DESC LIMIT ?'
 ].join(' ')).all(series.id,cursor,cursor,limit+1);
 const items=rows.slice(0,limit).map(row=>({id:row.id,action:row.action,
  details:JSON.parse(row.detailsJson),createdAt:row.createdAt}));
 send(res,200,{items,nextCursor:rows.length>limit?String(items.at(-1).id):null},
  {'Cache-Control':'private, no-store'});
 return true;
}
