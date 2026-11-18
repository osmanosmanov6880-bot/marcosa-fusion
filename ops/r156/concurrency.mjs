/**
 * MARCOSA R156 isolated PostgreSQL 17 concurrency acceptance.
 * Only a throwaway CI database on loopback; never talks to a real user database.
 * Two independent psql sessions race optimistic edits; SKIP LOCKED must not
 * block on a separate worker's in-flight claim. No messages are delivered.
 */
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

export function assertDisposableR156Environment(env){
 if(env.GITHUB_ACTIONS!=='true' ||
  env.GITHUB_REPOSITORY!=='osmanosmanov6880-bot/marcosa-fusion' ||
  env.PGHOST!=='127.0.0.1'||env.PGPORT!=='5432'||
  env.PGDATABASE!=='postgres'||env.PGUSER!=='postgres'||
  typeof env.RUNNER_TEMP!=='string'||!env.RUNNER_TEMP.startsWith('/'))
  throw Error('R156 requires isolated GitHub Actions PG17 service on localhost');
 return true;
}
const ACTOR='15600000-0000-4156-8156-000000000001';
const SERIES='15600000-0000-4156-8156-000000000301';
const RACE='15600000-0000-4156-8156-000000000303';
const EPISODE='15600000-0000-4156-8156-000000000402';
const CAROL='15600000-0000-4156-8156-000000000003';
function runSql(query,{allowFail=false}={}){
 return new Promise((resolve,reject)=>{
  const process=spawn('psql',['-X','-v','ON_ERROR_STOP=1','-Atc',query],{
   env:globalThis.process.env,stdio:['ignore','pipe','pipe'],timeout:20000
  });
  let stdout='',stderr='';
  process.stdout.setEncoding('utf8');process.stderr.setEncoding('utf8');
  process.stdout.on('data',v=>stdout+=v);
  process.stderr.on('data',v=>stderr+=v);
  process.on('error',reject);
  process.on('close',code=>{
   if(code!==0&&!allowFail)reject(Error('R156 SQL failed: '+stderr.slice(-450)));
   else resolve({ok:code===0,stdout:stdout.trim(),stderr:stderr.slice(-900)});
  });
 });
}
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
export async function runR156Concurrency(){
 assertDisposableR156Environment(process.env);
 await runSql("SELECT current_setting('server_version_num')::int>=170000 AND current_database()='postgres';")
  .then(x=>{if(x.stdout!=='t')throw Error('Expected disposable PG17');});
 await runSql("INSERT INTO public.marcosa_seasons(id,world_id,owner_id,slug,title) VALUES("+
  "'"+RACE+"','15600000-0000-4156-8156-000000000101','"+ACTOR+
  "','r156-race-series','Race baseline');");
 const edit=(name,uuid)=>[
  'SET ROLE marcosa_r156_writer;',
  "SELECT set_config('request.jwt.claim.sub','"+ACTOR+"',false);",
  "SELECT marcosa_private.r156_edit_series('"+ACTOR+"','"+RACE+"',0,"+
   "'"+name+"','only synthetic data','"+uuid+"');"
 ].join('\n');
 const edits=await Promise.all([
  runSql(edit('Winner A','15600000-0000-4156-8156-000000000970'),{allowFail:true}),
  runSql(edit('Winner B','15600000-0000-4156-8156-000000000971'),{allowFail:true})
 ]);
 if(edits.filter(x=>x.ok).length!==1 ||
  !edits.some(x=>!x.ok&&x.stderr.includes('stale season revision')))
  throw Error('R156 concurrent CAS edits did not result in exactly one commit');
 const result=await runSql(
  "SELECT concat(revision,':',"+
  "(SELECT count(*) FROM public.marcosa_season_audit WHERE series_id='"+RACE+"'),':',"+
  "(SELECT count(*) FROM marcosa_private.r156_commands WHERE request_key IN("+
  "'15600000-0000-4156-8156-000000000970','15600000-0000-4156-8156-000000000971')))"+
  " FROM public.marcosa_seasons WHERE id='"+RACE+"';");
 if(result.stdout!=='1:1:1')
  throw Error('R156 failed concurrent revision/audit/idempotency atomicity: '+result.stdout);
 // Synthetic admin resets an archived test fixture ONLY to exercise eligibility.
 await runSql("UPDATE public.marcosa_seasons SET archived_at=NULL WHERE id='"+SERIES+"';"+
  "UPDATE public.marcosa_season_subscriptions SET muted=false WHERE series_id='"+SERIES+
   "' AND user_id='"+CAROL+"';"+
  "INSERT INTO marcosa_private.r156_outbox(series_id,episode_id,user_id) VALUES('"+
   SERIES+"','"+EPISODE+"','"+CAROL+"') ON CONFLICT DO NOTHING;");
 const pending=await runSql("SELECT count(*) FROM marcosa_private.r156_outbox WHERE state='pending';");
 if(pending.stdout!=='1')throw Error('R156 expected exactly one disposable SKIP LOCKED job');
 const hold=runSql("BEGIN;SET application_name='r156_hold_worker';"+
  "SELECT id FROM marcosa_private.r156_outbox WHERE state='pending' FOR UPDATE;"+
  "SELECT pg_sleep(3);COMMIT;");
 let locked=false;
 for(let i=0;i<26;i++){
  await sleep(100);
  const waiting=await runSql("SELECT count(*) FROM pg_stat_activity WHERE "+
   "application_name='r156_hold_worker' AND state='active' AND query LIKE '%pg_sleep%';");
  if(waiting.stdout==='1'){locked=true;break;}
 }
 if(!locked){await hold;throw Error('R156 failed to establish actual row lock');}
 const begin=Date.now();
 const skipped=await runSql("SET ROLE marcosa_r156_dispatcher;"+
  "SELECT count(*) FROM marcosa_private.r156_claim('worker_skiplock',10,60);");
 const elapsedMs=Date.now()-begin;
 if(!skipped.stdout.endsWith('\n0')&&!skipped.stdout.endsWith('\r\n0')&&skipped.stdout!=='0')
  throw Error('R156 worker double-claimed a locked job: '+skipped.stdout);
 if(elapsedMs>1800)throw Error('R156 SKIP LOCKED waited for row lock: '+elapsedMs+'ms');
 await hold;
 const claimed=await runSql("SET ROLE marcosa_r156_dispatcher;"+
  "SELECT count(*) FROM marcosa_private.r156_claim('worker_after',10,60);");
 if(!claimed.stdout.endsWith('\n1')&&!claimed.stdout.endsWith('\r\n1')&&claimed.stdout!=='1')
  throw Error('R156 unlocked job not claimable: '+claimed.stdout);
 const none=await runSql("SET ROLE marcosa_r156_dispatcher;"+
  "SELECT count(*) FROM marcosa_private.r156_claim('worker_duplicate',10,60);");
 if(!none.stdout.endsWith('\n0')&&!none.stdout.endsWith('\r\n0')&&none.stdout!=='0')
  throw Error('R156 concurrent worker saw already-leased job');
 // Restore the synthetic episode fixture's pre-test archived state before
 // pg_dump; a transient test-only reopen must never alter recovery assertions.
 await runSql("UPDATE public.marcosa_seasons SET archived_at=now() WHERE id='"+SERIES+"';");
 return{
  contract:'MARCOSA-R156-PG17-CONCURRENCY-v1',
  concurrentOptimisticEdits:'one committed, one rejected',
  revisionAuditCommandCounts:result.stdout,
  skipLockedWaitMs:elapsedMs,
  simultaneousDeliveryClaims:1,
  externalMessagesSent:0,
  liveAccountsAccessed:false,productionDeploymentAuthorized:false
 };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const result=await runR156Concurrency();
  const path=join(process.env.RUNNER_TEMP,'marcosa-r156-concurrency-proof.json');
  writeFileSync(path,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  process.stdout.write(JSON.stringify(result)+'\n');
 }catch(error){process.stderr.write('R156 CONCURRENCY FAIL: '+error.message+'\n');process.exitCode=1;}
}
