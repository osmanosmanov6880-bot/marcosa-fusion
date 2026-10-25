/* MARCOSA R69 — private, measured moderation queue-health indicators.
 * Local SQLite only: not production SLA monitoring, not inferred decisions.
 * Only fixed SQL templates below, never user-provided table identifiers.
 */
const HOUR=3600000;
const QUEUES=Object.freeze([
 Object.freeze({id:'cover_uploads',label:'Обложки на проверке',table:'world_covers',when:"review_status='pending'",clock:'updated_at',targetHours:24}),
 Object.freeze({id:'cover_public_reports',label:'Жалобы на публичные обложки',table:'world_cover_reports',when:"status='open'",clock:'created_at',targetHours:24}),
 Object.freeze({id:'cover_appeals',label:'Апелляции по обложкам',table:'world_cover_appeals',when:"status='open'",clock:'created_at',targetHours:72}),
 Object.freeze({id:'post_reports',label:'Жалобы на публикации',table:'reports',when:"status='open'",clock:'created_at',targetHours:24}),
 Object.freeze({id:'comment_reports',label:'Жалобы на комментарии',table:'comment_reports',when:"status='open'",clock:'created_at',targetHours:24}),
 Object.freeze({id:'content_appeals',label:'Апелляции на публикации/комментарии',table:'moderation_appeals',when:"status='open'",clock:'created_at',targetHours:72}),
 Object.freeze({id:'sponsor_reviews',label:'Рекламные заявки на проверке',table:'sponsor_proposals',when:"status='pending_review'",clock:'created_at',targetHours:72})
]);
export function measureModerationQueues(db,clock){
 if(!Number.isSafeInteger(clock)||clock<0)throw Error('R69 requires a safe nonnegative UTC millisecond timestamp');
 let pending=0,overdue=0;
 const items=QUEUES.map(def=>{
  const threshold=clock-def.targetHours*HOUR;
  const sql='SELECT count(*) AS pending,'
   +' coalesce(sum(CASE WHEN '+def.clock+'<=? THEN 1 ELSE 0 END),0) AS overdue,'
   +' min('+def.clock+') AS oldestAt'
   +' FROM '+def.table+' WHERE '+def.when;
  const r=db.prepare(sql).get(threshold);
  const count=Number(r.pending),expired=Number(r.overdue);
  if(!Number.isSafeInteger(count)||!Number.isSafeInteger(expired)||expired>count)throw Error('R69 queue count was inconsistent');
  pending+=count;overdue+=expired;
  const age=r.oldestAt===null?null:Math.round(Math.max(0,clock-r.oldestAt)/HOUR*10)/10;
  return{id:def.id,label:def.label,pending:count,overdue:expired,oldestAgeHours:age,targetHours:def.targetHours};
 });
 return{
  source:'verified-local-sqlite',
  production:false,
  generatedAt:new Date(clock).toISOString(),
  scope:'moderator-aggregate-only',
  targets:'internal laboratory triage targets, not legal or contractual SLAs',
  coverage:'Open queues only; excludes unavailable deleted records, cannot certify human review capacity',
  pendingTotal:pending,
  overdueTotal:overdue,
  overdueRate:pending?overdue/pending:null,
  queues:items
 };
}
