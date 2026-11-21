/**
 * R155 offline migration REHEARSAL. Exports only disposable SQLite :memory:
 * fixtures; refuses file-backed source and implicit user identity mapping.
 * SHA-256 is an UNKEYED integrity checksum, NOT a provenance signature.
 */
import {createHash} from 'node:crypto';

export const R155_FORMAT='MARCOSA-R155-SYNTHETIC-SQLITE-PG17-v1';
const fail=message=>{throw Error(message);};
const requireOk=(condition,message)=>{if(!condition)fail(message);};
const uuidRegex=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const namespace=Buffer.from('155e0000000045558555000000000001','hex');
const keys=Object.freeze(['worlds','posts','seasons','episodes','subscriptions','bookmarks','attendance','audit']);
const tables={
 worlds:"SELECT id,owner_id,slug,title,description,visibility,created_at FROM worlds ORDER BY id",
 posts:"SELECT id,world_id,author_id,body,status,created_at FROM posts ORDER BY id",
 seasons:"SELECT id,world_id,owner_id,slug,title,description,next_at,archived_at,created_at FROM series ORDER BY id",
 episodes:"SELECT id,series_id,post_id,position,title,created_at FROM series_episodes ORDER BY id",
 subscriptions:"SELECT series_id,user_id,muted FROM series_subscriptions ORDER BY series_id,user_id",
 bookmarks:"SELECT episode_id,user_id,saved_at FROM series_episode_bookmarks ORDER BY episode_id,user_id",
 attendance:"SELECT episode_id,viewer_id,first_at FROM series_attendance ORDER BY episode_id,viewer_id",
 audit:"SELECT id,series_id,actor_id,action,details_json,created_at FROM series_audit ORDER BY id"
};
const canonical=p=>JSON.stringify(p);
const digest=p=>createHash('sha256').update(canonical(p)).digest('hex');
const requireUuid=(v,label)=>{requireOk(typeof v==='string'&&uuidRegex.test(v),label+' must be a valid UUID');return v;};
export function syntheticStableUuid(kind,id){
 requireOk(['world','post','season','episode','audit'].includes(kind),'Unknown synthetic ID domain');
 requireOk(typeof id==='string'||Number.isSafeInteger(id),'Invalid legacy source ID');
 const bytes=createHash('sha1').update(namespace).update(Buffer.from(kind+':'+String(id))).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|80; bytes[8]=(bytes[8]&63)|128;
 const h=bytes.toString('hex');
 return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
const epoch=n=>{
 if(n==null)return null;
 requireOk(Number.isSafeInteger(n)&&n>=0&&n<=253402300799999,'Invalid source epoch milliseconds');
 return n;
};
function bounded(db){
 const p=db.prepare('PRAGMA database_list').all().find(row=>row.name==='main');
 requireOk(p&&(!p.file||p.file===''),'Only disposable in-memory SQLite data can be rehearsed');
 requireOk(db.prepare('PRAGMA foreign_key_check').all().length===0,'SQLite foreign keys are invalid');
 const rows=Object.fromEntries(keys.map(name=>[name,db.prepare(tables[name]).all()]));
 requireOk(keys.reduce((sum,key)=>sum+rows[key].length,0)<=2000,'Synthetic rehearsal exceeds 2000 row budget');
 return rows;
}
/**
 * identityMap: explicit original SQLite user UUID -> verified TARGET auth UUID.
 * No auth accounts, passwords, tokens, sessions, emails or secret keys exported.
 */
export function buildSyntheticR155Bundle(db,{identityMap,syntheticOnly}={}){
 requireOk(syntheticOnly===true,'Real or unmarked sources are forbidden');
 requireOk(identityMap && Object.getPrototypeOf(identityMap)===Object.prototype,'Explicit identity bridge required');
 const users=db.prepare('SELECT id FROM users ORDER BY id').all().map(row=>row.id);
 requireOk(users.length>0&&users.length<=10,'Expected at most ten synthetic actors');
 requireOk(Object.keys(identityMap).length===users.length,'Every fixture user must have exactly one identity bridge');
 const targets=users.map(id=>requireUuid(identityMap[id],'Target Auth identity '+id));
 requireOk(new Set(targets).size===targets.length,'Identity bridge is not one-to-one');
 const user=id=>requireUuid(identityMap[id],'Missing verified Auth identity mapping');
 const rows=bounded(db);
 const worldId=id=>syntheticStableUuid('world',id);
 const postId=id=>syntheticStableUuid('post',id);
 const seasonId=id=>syntheticStableUuid('season',id);
 const episodeId=id=>syntheticStableUuid('episode',id);
 const sourceWorlds=new Set(rows.worlds.map(r=>r.id)),sourcePosts=new Set(rows.posts.map(r=>r.id));
 const sourceSeasons=new Set(rows.seasons.map(r=>r.id)),sourceEpisodes=new Set(rows.episodes.map(r=>r.id));
 const expected=(set,id,name)=>requireOk(set.has(id),'Unmapped foreign reference '+name+': '+id);
 const payload={
  worlds:rows.worlds.map(x=>({
   id:worldId(x.id),ownerId:user(x.owner_id),slug:x.slug,title:x.title,
   description:x.description??'',visibility:x.visibility,createdAt:epoch(x.created_at)
  })),
  posts:rows.posts.map(x=>{
   expected(sourceWorlds,x.world_id,'post.world');
   return{id:postId(x.id),worldId:worldId(x.world_id),authorId:user(x.author_id),
    body:x.body,status:x.status,createdAt:epoch(x.created_at)};
  }),
  seasons:rows.seasons.map(x=>{
   expected(sourceWorlds,x.world_id,'series.world');
   return{id:seasonId(x.id),worldId:worldId(x.world_id),ownerId:user(x.owner_id),
    slug:x.slug,title:x.title,description:x.description,nextAt:epoch(x.next_at),
    archivedAt:epoch(x.archived_at),createdAt:epoch(x.created_at)};
  }),
  episodes:rows.episodes.map(x=>{
   expected(sourceSeasons,x.series_id,'episode.series');expected(sourcePosts,x.post_id,'episode.post');
   return{id:episodeId(x.id),seriesId:seasonId(x.series_id),postId:postId(x.post_id),
    position:x.position,title:x.title,createdAt:epoch(x.created_at)};
  }),
  subscriptions:rows.subscriptions.map(x=>{
   expected(sourceSeasons,x.series_id,'subscription.series');
   return{seriesId:seasonId(x.series_id),userId:user(x.user_id),muted:Boolean(x.muted)};
  }),
  bookmarks:rows.bookmarks.map(x=>{
   expected(sourceEpisodes,x.episode_id,'bookmark.episode');
   return{episodeId:episodeId(x.episode_id),userId:user(x.user_id),savedAt:epoch(x.saved_at)};
  }),
  attendance:rows.attendance.map(x=>{
   expected(sourceEpisodes,x.episode_id,'attendance.episode');
   return{episodeId:episodeId(x.episode_id),viewerId:user(x.viewer_id),firstAt:epoch(x.first_at)};
  }),
  audit:rows.audit.map(x=>{
   expected(sourceSeasons,x.series_id,'audit.series');
   let details;try{details=JSON.parse(x.details_json);}catch{fail('Malformed audit JSON');}
   requireOk(details&&typeof details==='object'&&!Array.isArray(details),'Audit details must be an object');
   return{id:syntheticStableUuid('audit',x.id),seriesId:seasonId(x.series_id),
    actorId:user(x.actor_id),action:x.action,details,createdAt:epoch(x.created_at)};
  })
 };
 const meta={format:R155_FORMAT,mode:'SYNTHETIC_MEMORY_REHEARSAL_ONLY',payload};
 const bundle={...meta,checksumSha256:digest(meta),identityCount:targets.length,
  claims:{realAuthMigrated:false,financialDataMigrated:false,productionCutoverAuthorized:false,
   hostProofVerified:false,digestIsSignature:false}};
 requireOk(verifySyntheticR155Bundle(bundle),'Generated fixture fails local integrity');
 return bundle;
}
export function verifySyntheticR155Bundle(bundle){
 if(!bundle||bundle.format!==R155_FORMAT||bundle.mode!=='SYNTHETIC_MEMORY_REHEARSAL_ONLY'||
  !bundle.claims||bundle.claims.productionCutoverAuthorized!==false||
  bundle.claims.realAuthMigrated!==false||bundle.claims.financialDataMigrated!==false||
  bundle.claims.digestIsSignature!==false||typeof bundle.checksumSha256!=='string'||
  !/^[a-f0-9]{64}$/.test(bundle.checksumSha256))return false;
 const payload=bundle.payload;
 if(!payload||typeof payload!=='object'||Object.keys(payload).length!==keys.length||
   keys.some(key=>!Array.isArray(payload[key])||payload[key].length>2000))return false;
 if(digest({format:R155_FORMAT,mode:bundle.mode,payload})!==bundle.checksumSha256)return false;
 try{
  const unique=(name,idkey)=>{const a=payload[name].map(x=>x[idkey]);
   requireOk(a.every(x=>typeof x==='string'&&x.length>0)&&new Set(a).size===a.length,
    'Duplicate ID in '+name);
  };
  for(const name of ['worlds','posts','seasons','episodes','audit'])unique(name,'id');
  const world=new Map(payload.worlds.map(x=>[x.id,x]));
  const post=new Map(payload.posts.map(x=>[x.id,x]));
  const seasons=new Map(payload.seasons.map(x=>[x.id,x]));
  const episodes=new Map(payload.episodes.map(x=>[x.id,x]));
  const refs=new Set();
  for(const x of payload.worlds){
   requireUuid(x.id,'World');requireUuid(x.ownerId,'Owner');epoch(x.createdAt);
  }
  for(const x of payload.posts){
   requireUuid(x.id,'Post');requireUuid(x.authorId,'Post owner');epoch(x.createdAt);
   requireOk(world.has(x.worldId)&&world.get(x.worldId).ownerId===x.authorId,'Post tenant mismatch');
  }
  for(const x of payload.seasons){
   requireUuid(x.id,'Season');requireUuid(x.ownerId,'Season owner');epoch(x.createdAt);
   epoch(x.nextAt);epoch(x.archivedAt);
   requireOk(world.has(x.worldId)&&world.get(x.worldId).ownerId===x.ownerId,'Season tenant mismatch');
  }
  for(const x of payload.episodes){
   requireUuid(x.id,'Episode');epoch(x.createdAt);
   const s=seasons.get(x.seriesId),p=post.get(x.postId);
   requireOk(s&&p&&p.worldId===s.worldId&&p.authorId===s.ownerId&&p.status==='published',
    'Cross-tenant, private or draft episode');
   requireOk(Number.isSafeInteger(x.position)&&x.position>=1&&x.position<=500,'Invalid position');
   const position=x.seriesId+':'+x.position;
   requireOk(!refs.has(position),'Duplicate episode position');refs.add(position);
  }
  const relation=new Set();
  for(const x of payload.subscriptions){
   requireOk(seasons.has(x.seriesId),'Unknown subscription series');requireUuid(x.userId,'Subscriber');
   requireOk(typeof x.muted==='boolean','Mute flag must be boolean');
   const id=x.seriesId+':'+x.userId;requireOk(!relation.has(id),'Duplicate subscription');relation.add(id);
  }
  for(const name of ['bookmarks','attendance']){
   const uniq=new Set();
   for(const x of payload[name]){
    requireOk(episodes.has(x.episodeId),'Unmatched episode in '+name);
    const uid=name==='bookmarks'?x.userId:x.viewerId;requireUuid(uid,'Reader');
    epoch(name==='bookmarks'?x.savedAt:x.firstAt);
    const pair=x.episodeId+':'+uid;requireOk(!uniq.has(pair),'Duplicate reader state');uniq.add(pair);
   }
  }
  for(const x of payload.audit){
   const s=seasons.get(x.seriesId);
   requireOk(s&&x.actorId===s.ownerId,'Cross-tenant audit');
   epoch(x.createdAt);
   requireOk(x.details&&typeof x.details==='object'&&!Array.isArray(x.details),'Audit must be JSON object');
  }
  return true;
 }catch{return false;}
}
