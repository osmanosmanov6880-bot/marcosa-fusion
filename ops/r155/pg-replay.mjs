/**
 * R155 SQL replay from a verified synthetic, in-memory SQLite export.
 * No remote database connection, no Auth user creation, no real payment tables.
 * PostgreSQL rejects conflicting replays by exact per-row parity comparison.
 */
import {verifySyntheticR155Bundle} from './migration-bundle.mjs';

const insist=(value,message)=>{if(!value)throw Error(message);};
const names={
 worlds:{table:'marcosa_worlds',key:['id'],columns:[
  ['id','id','uuid'],['owner_id','ownerId','uuid'],['slug','slug','text'],['title','title','text'],
  ['description','description','text'],['visibility','visibility','text'],['created_at','createdAt','date']]},
 posts:{table:'marcosa_posts',key:['id'],columns:[
  ['id','id','uuid'],['world_id','worldId','uuid'],['author_id','authorId','uuid'],
  ['body','body','text'],['status','status','text'],['created_at','createdAt','date']]},
 seasons:{table:'marcosa_seasons',key:['id'],columns:[
  ['id','id','uuid'],['world_id','worldId','uuid'],['owner_id','ownerId','uuid'],
  ['slug','slug','text'],['title','title','text'],['description','description','text'],
  ['next_at','nextAt','date'],['archived_at','archivedAt','date'],['created_at','createdAt','date']]},
 episodes:{table:'marcosa_season_episodes',key:['id'],columns:[
  ['id','id','uuid'],['series_id','seriesId','uuid'],['post_id','postId','uuid'],
  ['position','position','number'],['title','title','text'],['created_at','createdAt','date']]},
 subscriptions:{table:'marcosa_season_subscriptions',key:['series_id','user_id'],columns:[
  ['series_id','seriesId','uuid'],['user_id','userId','uuid'],['muted','muted','boolean']]},
 bookmarks:{table:'marcosa_season_bookmarks',key:['episode_id','user_id'],columns:[
  ['episode_id','episodeId','uuid'],['user_id','userId','uuid'],['saved_at','savedAt','date']]},
 attendance:{table:'marcosa_season_attendance',key:['episode_id','viewer_id'],columns:[
  ['episode_id','episodeId','uuid'],['viewer_id','viewerId','uuid'],['first_at','firstAt','date']]},
 audit:{table:'marcosa_season_audit',key:['id'],columns:[
  ['id','id','uuid'],['series_id','seriesId','uuid'],['actor_id','actorId','uuid'],
  ['action','action','text'],['details','details','json'],['created_at','createdAt','date']]}
};
const order=Object.keys(names);
const quote=value=>{
 insist(typeof value==='string'&&!value.includes('\0')&&value.length<10000,'Invalid string in synthetic fixture');
 return "'"+value.replaceAll("'","''")+"'";
};
function literal(value,type){
 if(value===null){insist(type==='date','Only time fields may be null');return 'NULL';}
 if(type==='uuid'){insist(typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value),'Invalid target uuid');return quote(value)+'::uuid';}
 if(type==='text')return quote(value);
 if(type==='boolean'){insist(typeof value==='boolean','Invalid synthetic boolean');return value?'true':'false';}
 if(type==='number'){insist(Number.isSafeInteger(value)&&value>=0,'Invalid integer');return String(value);}
 if(type==='date'){
  insist(Number.isSafeInteger(value)&&value>=0&&value<=253402300799999,'Invalid source timestamp');
  return 'to_timestamp('+value+'::numeric/1000)';
 }
 if(type==='json'){insist(value&&typeof value==='object'&&!Array.isArray(value),'Invalid JSON audit');
  return quote(JSON.stringify(value))+'::jsonb';
 }
 throw Error('Unsupported SQL literal kind');
}
const temp=name=>'pg_temp.r155_expected_'+name;
const colList=spec=>spec.columns.map(c=>c[0]).join(',');
const joinCols=(alias,spec)=>spec.columns.map(c=>alias+'.'+c[0]).join(',');
const collisionCheck=(name,spec)=>{
 const expected=temp(name),table='public.'+spec.table;
 const join='USING ('+spec.key.join(',')+')';
 const a=joinCols('e',spec),b=joinCols('t',spec);
 const left='SELECT '+a+' FROM '+expected+' e';
 const right='SELECT '+b+' FROM '+table+' t JOIN '+expected+' e '+join;
 // Only compare the explicitly selected identity keys and content fields.
 // Different pre-existing user/world rows unrelated to migration are ignored.
 return " IF EXISTS(("+left+" EXCEPT "+right+")) THEN\n"+
  "  RAISE EXCEPTION 'R155 source/target mismatch for "+name+"';\n END IF;";
}
/** Generates only SQL text; execution is restricted to disposable CI Postgres. */
export function renderR155SyntheticSql(bundle){
 insist(verifySyntheticR155Bundle(bundle),'Unverified or altered R155 synthetic payload');
 insist(order.every(n=>Array.isArray(bundle.payload[n])),'Unsupported payload');
 const statements=[
  '-- R155 DISPOSABLE/TEST DATA ONLY. NEVER RUN AGAINST PRODUCTION.',
  '-- Requires reviewed PostgreSQL 17 reference schema + pre-created Auth identities.',
  'BEGIN;',
  "SET LOCAL statement_timeout='10000ms';",
  "DO $r155safe$ BEGIN IF current_database()<>'postgres' THEN RAISE EXCEPTION 'R155 refuses non-disposable database'; END IF; END $r155safe$;"
 ];
 for(const name of order){
  const spec=names[name],table='public.'+spec.table,cols=colList(spec),target=temp(name);
  statements.push('CREATE TEMP TABLE '+target.replace('pg_temp.','')+
   ' ON COMMIT DROP AS SELECT '+cols+' FROM '+table+' WHERE false;');
  const rows=bundle.payload[name];
  if(rows.length){
   const values=rows.map(row=>'('+spec.columns.map(([,field,type])=>literal(row[field],type)).join(',')+')');
   statements.push('INSERT INTO '+target+' ('+cols+') VALUES\n '+values.join(',\n ' )+';');
   statements.push('INSERT INTO '+table+' ('+cols+') SELECT '+cols+' FROM '+target+
    ' WHERE true ON CONFLICT DO NOTHING;');
  }
 }
 statements.push('DO $r155parity$ BEGIN');
 for(const name of order)statements.push(collisionCheck(name,names[name]));
 statements.push('END $r155parity$;');
 statements.push("SELECT 'R155 SYNTHETIC POSTGRES REPLAY AND ROWWISE PARITY PASS' AS result;");
 statements.push('COMMIT;');
 return statements.join('\n')+'\n';
}
