/**
 * R158: shell-free psql integration adapter for disposable GitHub PostgreSQL 17.
 * Fresh transaction/connection per command. NOT a production TLS/pool driver.
 */
import {spawn} from 'node:child_process';
import {CommandStoreError} from '../r157/pg-command-store.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const repo='osmanosmanov6880-bot/marcosa-fusion';
export const R158_OPERATIONS=Object.freeze(['edit','reorder','publish','publication','subscription','bookmark','attendance']);
const check=(yes,msg)=>{if(!yes)throw Error(msg);};
function id(value){check(typeof value==='string'&&uuid.test(value),'Invalid UUID');return "'"+value.toLowerCase()+"'::uuid";}
function textLiteral(value,max=100){
 check(typeof value==='string'&&value.length<=max&&!value.includes('\0'),'Invalid text');
 return "convert_from(decode('"+Buffer.from(value,'utf8').toString('hex')+"','hex'),'UTF8')";
}
function revision(value){check(Number.isSafeInteger(value)&&value>=0&&value<1000000000000,'Invalid revision');return String(value)+'::bigint';}
function flag(value){check(typeof value==='boolean','Invalid boolean');return value?'true':'false';}
function order(value){
 check(Array.isArray(value)&&value.length>=1&&value.length<=500,'Invalid episode order');
 const ids=value.map(id);check(new Set(ids).size===ids.length,'Duplicate episode order');
 return 'ARRAY['+ids.join(',')+']::uuid[]';
}
function commandSql({actorId,name,data,key}){
 check(R158_OPERATIONS.includes(name)&&data&&typeof data==='object'&&!Array.isArray(data),'Unknown command');
 const actor=id(actorId),request=id(key);
 const callArgs={
  edit:()=>[actor,id(data.seriesId),revision(data.revision),textLiteral(data.title),textLiteral(data.description,600),request],
  reorder:()=>[actor,id(data.seriesId),revision(data.revision),order(data.order),request],
  publish:()=>[actor,id(data.seriesId),id(data.postId),id(data.episodeId),textLiteral(data.title),revision(data.revision),request],
  publication:()=>[actor,id(data.seriesId),flag(data.publish),revision(data.revision),request],
  subscription:()=>{
   check(['join','mute','unmute','leave'].includes(data.mode),'Invalid subscription mode');
   return[actor,id(data.seriesId),textLiteral(data.mode,12),request];
  },
  bookmark:()=>[actor,id(data.episodeId),flag(data.save),request],
  attendance:()=>[actor,id(data.episodeId),flag(data.present),request]
 };
 return 'marcosa_private.r156_'+({edit:'edit_series',reorder:'reorder_episodes',publish:'publish_episode',
  publication:'publication',subscription:'subscription',bookmark:'bookmark',attendance:'attendance'}[name])+
  '('+callArgs[name]().join(',')+')';
}
export function requireR158Disposable(env=process.env){
 check(env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===repo,
  'R158 integration runs only inside authorized GitHub Actions');
 check(env.PGHOST==='127.0.0.1'&&env.PGPORT==='5432'&&env.PGDATABASE==='postgres'&&
  env.PGUSER==='marcosa_r158_ci'&&typeof env.PGPASSWORD==='string'&&env.PGPASSWORD.length>=12,
  'R158 requires a disposable non-superuser loopback PG17 role');
 return{PATH:env.PATH||'/usr/bin:/bin',HOME:env.RUNNER_TEMP||'/tmp',
  PGHOST:env.PGHOST,PGPORT:env.PGPORT,PGDATABASE:env.PGDATABASE,
  PGUSER:env.PGUSER,PGPASSWORD:env.PGPASSWORD,PGCONNECT_TIMEOUT:'3',
  PGOPTIONS:'-c application_name=marcosa_r158_ci_only'};
}
export async function runR158Sql(sql,{env=process.env,timeoutMs=9000}={}){
 const safeEnv=requireR158Disposable(env);
 check(typeof sql==='string'&&sql.length>0&&sql.length<=120000,'R158 SQL safety budget exceeded');
 return new Promise((resolve,reject)=>{
  const child=spawn('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1',
   '-v','VERBOSITY=sqlstate'],{env:safeEnv,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='',ended=false;
  const finish=(err,result)=>{
   if(ended)return;ended=true;clearTimeout(timer);
   if(err)reject(err);else resolve(result);
  };
  const timer=setTimeout(()=>{child.kill('SIGKILL');finish(Error('R158 database timeout'));},timeoutMs);
  child.stdout.on('data',bytes=>{stdout+=bytes.toString('utf8');if(stdout.length>65536)child.kill('SIGKILL');});
  child.stderr.on('data',bytes=>{stderr+=bytes.toString('utf8');if(stderr.length>65536)child.kill('SIGKILL');});
  child.on('error',error=>finish(Error('R158 database process unavailable',{cause:error})));
  child.on('close',code=>{
   if(code===0&&stdout.length<=65536)finish(null,{stdout,stderr});
   else finish(Object.assign(Error('R158 database statement rejected'),{
    code:code||1,sqlstate:stderr.match(/\b(?:42501|23505|23503|23514|P0001|40001|40P01)\b/)?.[0]||null
   }));
  });
  child.stdin.on('error',()=>{});
  child.stdin.end(sql);
 });
}
function extract(stdout,prefix){
 const lines=stdout.split(/\r?\n/).map(x=>x.trim()).filter(x=>x.startsWith(prefix));
 if(lines.length!==1)throw Error('Unexpected isolated PostgreSQL response');
 return lines[0].slice(prefix.length);
}
export function createR158SessionChecker({env=process.env}={}){
 requireR158Disposable(env);
 return async({sub,sessionId,expiresAt})=>{
  try{
   if(!Number.isSafeInteger(expiresAt)||expiresAt<=0)return false;
   const sql=[
    'BEGIN;',
    "SET LOCAL statement_timeout='3500ms';",
    'SET LOCAL ROLE marcosa_r158_session_reader;',
    "SELECT 'R158_SESSION:'||CASE WHEN EXISTS(",
    ' SELECT 1 FROM marcosa_private.r158_sessions s',
    ' WHERE s.user_id='+id(sub)+' AND s.session_id='+id(sessionId),
    ' AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()',
    ' AND s.expires_at>=to_timestamp('+expiresAt+'::bigint)) THEN',
    " 'active' ELSE 'revoked' END;",
    'COMMIT;'
   ].join('\n');
   const result=await runR158Sql(sql,{env});
   return extract(result.stdout,'R158_SESSION:')==='active';
  }catch{return false;}
 };
}
export function createR158CommandStore({env=process.env}={}){
 requireR158Disposable(env);
 return Object.freeze({
  async execute({actorId,name,data,key}={}){
   let statement;
   try{statement=commandSql({actorId,name,data,key});}
   catch{throw new CommandStoreError('Invalid command contract',400);}
   try{
    const sql=[
     'BEGIN;',
     "SET LOCAL statement_timeout='4000ms';",
     "SET LOCAL idle_in_transaction_session_timeout='6000ms';",
     'SET LOCAL ROLE marcosa_r156_writer;',
     "SELECT set_config('request.jwt.claim.sub',"+textLiteral(actorId,36)+',true);',
     "SELECT 'R158_RESULT:'||("+statement+")::text;",
     'COMMIT;'
    ].join('\n');
    const response=await runR158Sql(sql,{env});
    const parsed=JSON.parse(extract(response.stdout,'R158_RESULT:'));
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Invalid PostgreSQL response');
    return parsed;
   }catch(error){
    if(error.sqlstate==='42501')throw new CommandStoreError('Forbidden',403);
    if(['23505','23503','23514','P0001','40001','40P01'].includes(error.sqlstate))
     throw new CommandStoreError('Command conflicts with state',409);
    throw new CommandStoreError('Database operation unavailable',503);
   }
  }
 });
}
