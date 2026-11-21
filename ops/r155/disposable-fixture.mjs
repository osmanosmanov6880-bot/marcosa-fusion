/**
 * R155 synthetic fixture ONLY. Local loopback Node/SQLite, no real users.
 * Assembles R155 export and SQL replay to a create-only file for PG17 CI.
 */
import {createApp} from '../../server-lab/server.mjs';
import {buildSyntheticR155Bundle} from './migration-bundle.mjs';
import {renderR155SyntheticSql} from './pg-replay.mjs';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const TEST_AUTH=Object.freeze({
 writer:'15550000-0000-4555-8555-000000000001',
 reader:'15550000-0000-4555-8555-000000000002'
});
export async function createR155SyntheticFixture(){
 const app=createApp({databasePath:':memory:',inviteCode:'r155-synthetic-fixture-invite'});
 await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+app.server.address().port;
 async function req(path,{cookie='',method='GET',body}={}){
  const response=await fetch(base+'/api'+path,{method,headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const json=await response.json();
  if(!response.ok)throw Error('Fixture HTTP '+method+' '+path+': '+response.status+' '+json.error);
  return{json,cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 async function actor(name){
  const auth={username:name,email:name+'@example.invalid',
   password:'synthetic-no-real-account-password-r155',inviteCode:'r155-synthetic-fixture-invite'};
  await req('/auth/register',{method:'POST',body:auth});
  const login=await req('/auth/login',{method:'POST',body:auth});
  const me=(await req('/auth/me',{cookie:login.cookie})).json;
  return{cookie:login.cookie,worldId:me.worlds[0].id,userId:me.user.id};
 }
 try{
  const writer=await actor('r155samplewriter'),reader=await actor('r155samplereader');
  const makeSeason=async(slug,title)=>{
   await req('/series',{method:'POST',cookie:writer.cookie,
    body:{worldId:writer.worldId,slug,title,description:'Only synthetic migration data'}});
  };
  await makeSeason('r155-sample-open','Open creator chapter');
  await makeSeason('r155-sample-archive','Archived creator chapter');
  const addEpisode=async(slug,title)=>{
   const post=(await req('/posts',{method:'POST',cookie:writer.cookie,
    body:{worldId:writer.worldId,status:'published',body:"It's a 100% synthetic rehearsal: "+title}})).json;
   const episode=(await req('/series/'+slug+'/episodes',{method:'POST',cookie:writer.cookie,
    body:{postId:post.id,title}})).json;
   return episode.id;
  };
  const first=await addEpisode('r155-sample-open','Initial open chapter');
  await addEpisode('r155-sample-archive','Original hidden after archive');
  await req('/series/r155-sample-open/subscription',{method:'POST',cookie:reader.cookie,body:{}});
  await req('/series/r155-sample-open/episodes/'+first+'/bookmark',{method:'POST',cookie:reader.cookie,body:{}});
  await req('/series/r155-sample-open/metrics/attendance',{method:'POST',cookie:reader.cookie,body:{episodeId:first,consent:true}});
  await req('/series/r155-sample-open/notifications',{method:'DELETE',cookie:reader.cookie,body:{}});
  await req('/series/r155-sample-open',{method:'PATCH',cookie:writer.cookie,body:{description:'Revised source description'}});
  await req('/series/r155-sample-archive/publication',{method:'DELETE',cookie:writer.cookie,body:{}});
  const identityMap={[writer.userId]:TEST_AUTH.writer,[reader.userId]:TEST_AUTH.reader};
  const bundle=buildSyntheticR155Bundle(app.db,{identityMap,syntheticOnly:true});
  return{bundle,sql:renderR155SyntheticSql(bundle),sourceCounts:
   Object.fromEntries(Object.entries(bundle.payload).map(([name,rows])=>[name,rows.length]))};
 }finally{await app.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const filename=process.argv[2];
  if(!filename||!filename.startsWith(process.env.RUNNER_TEMP+'/'))
   throw Error('R155 synthetic output must be inside GitHub RUNNER_TEMP');
  const {bundle,sql,sourceCounts}=await createR155SyntheticFixture();
  writeFileSync(filename,sql,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({format:bundle.format,checksumSha256:bundle.checksumSha256,
   sourceCounts,sqlFileCreated:true,realUserData:false,productionAuthorized:false}));
 }catch(e){console.error('R155 SYNTHETIC REHEARSAL FAILED: '+e.message);process.exitCode=1;}
}
