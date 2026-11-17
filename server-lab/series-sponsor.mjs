import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readSeries} from './series.mjs';

export function initSponsor(db){
 db.exec(`
 CREATE TABLE IF NOT EXISTS season_placements(
  id INTEGER PRIMARY KEY, series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  proposal_id INTEGER NOT NULL REFERENCES sponsor_proposals(id) ON DELETE CASCADE,
  attached_at INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  UNIQUE(series_id,proposal_id));
 CREATE UNIQUE INDEX IF NOT EXISTS one_season_partner ON season_placements(series_id) WHERE active=1;
 CREATE TABLE IF NOT EXISTS season_partner_visits(
  placement_id INTEGER NOT NULL REFERENCES season_placements(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(placement_id,user_id));
 CREATE TABLE IF NOT EXISTS season_partner_results(
  placement_id INTEGER NOT NULL REFERENCES season_placements(id) ON DELETE CASCADE,
  reference_hash TEXT NOT NULL, cancelled INTEGER NOT NULL DEFAULT 0 CHECK(cancelled IN (0,1)),
  PRIMARY KEY(placement_id,reference_hash));`);
}

export async function handleSponsor({db,req,res,route,method,viewer,user,body,send,check,now,atomic}){
 if(method==='GET'&&route==='/series-sponsor.js'){
  const script=await readFile(new URL('./public/series-sponsor.js',import.meta.url));
  res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(script);return true;
 }
 const match=route.match(/^\/api\/series\/([a-z0-9_-]+)\/sponsor(?:\/(attach|detach|click|outcome|cancel))?$/);
 if(!match)return false;
 const [,slug,action]=match;
 check(method===(action?'POST':'GET'),405,'Метод недоступен');
 const actor=(user||viewer)?.id||'';
 const series=readSeries(db,slug,actor);
 check(series,404,'Сезон недоступен');
 const owner=series.owner_id===actor;
 // Author consent, world visibility, advertiser block and independent review
 // are evaluated for every request, even after a placement has been attached.
 const eligible=`FROM sponsor_proposals p JOIN worlds w ON w.id=p.world_id
 JOIN users reviewer ON reviewer.id=p.reviewer_id AND reviewer.role='moderator'
 WHERE p.world_id=? AND w.visibility='public' AND p.status='approved'
 AND reviewer.id<>p.owner_id AND reviewer.id<>w.owner_id AND NOT EXISTS
 (SELECT 1 FROM user_blocks b WHERE (b.blocker_id=p.owner_id AND b.blocked_id IN (?,w.owner_id))
 OR (b.blocked_id=p.owner_id AND b.blocker_id IN (?,w.owner_id)))`;
 const eligibleParams=[series.world_id,actor,actor];
 const raw=db.prepare('SELECT id,proposal_id FROM season_placements WHERE series_id=? AND active=1').get(series.id);
 const partner=raw&&db.prepare('SELECT p.id,p.brand_name,p.headline,p.landing_url,p.owner_id '+eligible+' AND p.id=?').get(...eligibleParams,raw.proposal_id);
 const advertiser=Boolean(partner&&partner.owner_id===actor);
 if(!action){
  const choices=owner?db.prepare('SELECT p.id,p.brand_name,p.headline '+eligible+' ORDER BY p.id DESC LIMIT 100').all(...eligibleParams):[];
  const report=partner&&(owner||advertiser)?db.prepare(`SELECT
   (SELECT count(*) FROM season_partner_visits WHERE placement_id=?) AS uniqueMembers,
   count(*) AS confirmed, coalesce(sum(cancelled),0) AS cancelled,
   count(*)-coalesce(sum(cancelled),0) AS netConfirmed FROM season_partner_results WHERE placement_id=?`).get(raw.id,raw.id):null;
  const placement=partner?{id:raw.id,brand:partner.brand_name,headline:partner.headline,url:partner.landing_url}:null;
  send(res,200,{placement,owner,advertiser,member:Boolean(actor),choices,report,detachId:owner&&raw?raw.id:null,paid:false},{'Cache-Control':'private, no-store'});return true;
 }
 check(actor,401,'Требуется вход');
 if(action==='attach'){
  check(owner,403,'Размещение выбирает автор сезона');
  check(Number.isSafeInteger(body.proposalId)&&db.prepare('SELECT 1 '+eligible+' AND p.id=?').get(...eligibleParams,body.proposalId),400,'Выберите согласованное предложение этого мира');
  atomic(()=>{
   db.prepare('UPDATE season_placements SET active=0 WHERE series_id=? AND active=1 AND proposal_id<>?').run(series.id,body.proposalId);
   db.prepare('INSERT INTO season_placements(series_id,proposal_id,attached_at) VALUES(?,?,?) ON CONFLICT(series_id,proposal_id) DO UPDATE SET active=1').run(series.id,body.proposalId,now());
  });
 }else{
  check(raw&&raw.id===body.placementId,409,'Размещение изменилось');
  if(action==='detach'){
   check(owner,403,'Размещение отключает автор сезона');
   db.prepare('UPDATE season_placements SET active=0 WHERE id=?').run(raw.id);
  }else{
   check(partner,404,'Размещение недоступно');
   if(action==='click'){
    if(!owner&&!advertiser)db.prepare('INSERT OR IGNORE INTO season_partner_visits VALUES(?,?)').run(raw.id,actor);
    send(res,200,{url:partner.landing_url});return true;
   }
   check(advertiser,403,'Результаты подтверждает рекламодатель');
   check(typeof body.reference==='string'&&/^[a-zA-Z0-9_-]{4,80}$/.test(body.reference),400,'Введите код операции из 4–80 латинских букв, цифр или дефисов');
   const key=createHash('sha256').update(raw.id+':'+body.reference).digest('hex');
   if(action==='outcome')db.prepare('INSERT OR IGNORE INTO season_partner_results(placement_id,reference_hash) VALUES(?,?)').run(raw.id,key);
   else check(db.prepare('UPDATE season_partner_results SET cancelled=1 WHERE placement_id=? AND reference_hash=?').run(raw.id,key).changes,404,'Код подтверждения не найден');
  }
 }
 send(res,200,{ok:true,paid:false});return true;
}
