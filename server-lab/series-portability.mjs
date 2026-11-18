import {createHash} from 'node:crypto';

/**
 * Standalone R154 account-owned season archive: never includes other readers,
 * passwords, cookies, advertiser identities, raw contact lists or IP addresses.
 * SHA-256 detects accidental changes but is NOT a provenance signature.
 */
export const PORTABILITY_FORMAT='MARCOSA-R154-SEASON-PORTABILITY-v1';
const checksum=p=>createHash('sha256').update(JSON.stringify(p)).digest('hex');
const payloadKeys=['seasons','episodes','editorialEvents','subscriptions','bookmarks','voluntaryMarks'];
function ownPayload(db,ownerId) {
 const seasons=db.prepare([
  'SELECT s.id,s.slug,s.title,s.description,s.next_at AS nextAt,',
  's.archived_at AS archivedAt,s.created_at AS createdAt,w.slug AS world',
  'FROM series s JOIN worlds w ON w.id=s.world_id AND w.owner_id=s.owner_id',
  'WHERE s.owner_id=? ORDER BY s.id'
 ].join(' ')).all(ownerId);
 const episodes=db.prepare([
  'SELECT e.id,e.series_id AS seriesId,e.post_id AS postId,e.position,e.title,',
  'e.created_at AS createdAt,p.body AS sourceBody,p.status AS sourceStatus,',
  'f.minutes AS authorEffortMinutes',
  'FROM series_episodes e JOIN series s ON s.id=e.series_id AND s.owner_id=?',
  'JOIN posts p ON p.id=e.post_id AND p.author_id=s.owner_id AND p.world_id=s.world_id',
  'LEFT JOIN series_effort f ON f.episode_id=e.id',
  'ORDER BY e.series_id,e.position'
 ].join(' ')).all(ownerId);
 const editorialEvents=db.prepare([
  'SELECT a.id,a.series_id AS seriesId,a.action,a.details_json AS detailsJson,a.created_at AS createdAt',
  'FROM series_audit a JOIN series s ON s.id=a.series_id',
  'WHERE s.owner_id=? ORDER BY a.id'
 ].join(' ')).all(ownerId).map(r=>({...r,details:JSON.parse(r.detailsJson),detailsJson:undefined}));
 const subscriptions=db.prepare([
  'SELECT sub.series_id AS seriesId,sub.muted AS notificationsMuted',
  'FROM series_subscriptions sub WHERE sub.user_id=? ORDER BY sub.series_id'
 ].join(' ')).all(ownerId);
 const bookmarks=db.prepare([
  'SELECT b.episode_id AS episodeId,b.saved_at AS savedAt',
  'FROM series_episode_bookmarks b WHERE b.user_id=? ORDER BY b.episode_id'
 ].join(' ')).all(ownerId);
 const voluntaryMarks=db.prepare([
  'SELECT a.episode_id AS episodeId,a.first_at AS firstAt',
  'FROM series_attendance a WHERE a.viewer_id=? ORDER BY a.episode_id'
 ].join(' ')).all(ownerId);
 return{seasons,episodes,editorialEvents,subscriptions,bookmarks,voluntaryMarks};
}
export function buildSeasonPortability(db,ownerId,now=Date.now()){
 if(typeof ownerId!=='string'||!ownerId)throw Error('Owned actor required');
 if(!Number.isSafeInteger(now)||now<=0)throw Error('Invalid export timestamp');
 if(!db.prepare('SELECT 1 FROM users WHERE id=?').get(ownerId))throw Error('User no longer exists');
 const payload=ownPayload(db,ownerId);
 const signedPart={format:PORTABILITY_FORMAT,payload};
 return{...signedPart,checksumSha256:checksum(signedPart),generatedAt:new Date(now).toISOString(),
  integrity:'SHA256_UNKEYED_NOT_SIGNATURE',source:'isolated-local-SQLite',production:false,
  personIdentifiersOfOtherUsersIncluded:false};
}
export function verifySeasonPortability(pack){
 if(!pack||typeof pack!=='object'||pack.format!==PORTABILITY_FORMAT||
  typeof pack.checksumSha256!=='string'||!/^[a-f0-9]{64}$/.test(pack.checksumSha256)||
  pack.integrity!=='SHA256_UNKEYED_NOT_SIGNATURE'||pack.production!==false)return false;
 const payload=pack.payload;
 if(!payload||typeof payload!=='object'||Object.keys(payload).length!==payloadKeys.length||
  payloadKeys.some(key=>!Array.isArray(payload[key])))return false;
 return checksum({format:PORTABILITY_FORMAT,payload})===pack.checksumSha256;
}
export function handleSeasonPortability({db,res,route,method,viewer,user,check,send,now,query}){
 if(route!=='/api/me/series-portability')return false;
 check(method==='GET',405,'Метод недоступен');
 const actor=(user||viewer)?.id;
 check(actor,401,'Нужен вход');
 check(!query||[...query.keys()].length===0,400,'Экспорт не принимает параметры');
 const exportPack=buildSeasonPortability(db,actor,now());
 send(res,200,exportPack,{'Cache-Control':'private, no-store',
  'Content-Disposition':'attachment; filename="marcosa-seasons-r154.json"',
  'X-Content-Type-Options':'nosniff'});
 return true;
}
