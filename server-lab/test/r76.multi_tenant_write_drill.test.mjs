import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';

/**
 * R76 independent local multi-tenant WRITE acceptance (not 12 real beta users).
 * Tests the real HTTP handlers, real persistent SQLite, idempotent relationships,
 * blocked accounts, cross-owner write denial, consent, export and account erasure.
 */
test('R76 twelve isolated real-HTTP accounts, multi-user writes and persistent privacy',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'marcosa-r76-'));
 const file=join(folder,'real-write-cohorts.sqlite');
 const password='R76-local-safe-password-2026',invite='R76-independent-invite-only';
 let clock=Date.parse('2026-10-25T10:00:00Z');
 let lab=null,base='';
 let requests=0;
 function countSql(sql,...values){return lab.db.prepare(sql).get(...values).n;}
 async function boot(){
  lab=createApp({databasePath:file,inviteCode:invite,now:()=>clock});
  await new Promise(ok=>lab.server.listen(0,'127.0.0.1',ok));
  base='http://127.0.0.1:'+lab.server.address().port;
 }
 async function request(path,{method='GET',cookie,json,from=base}={}){
  const headers={};
  if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=from;headers['Content-Type']='application/json';}
  const reply=await fetch(base+'/api'+path,{method,headers,
   ...(json===undefined?{}:{body:JSON.stringify(json)})});
  ++requests;
  return{status:reply.status,data:await reply.json(),
   cookie:reply.headers.get('set-cookie')?.split(';')[0]||null};
 }
 async function register(i){
  const username='user76_'+String(i).padStart(2,'0');
  const email=username+'@example.invalid';
  const created=await request('/auth/register',{method:'POST',json:{username,email,password,inviteCode:invite}});
  assert.equal(created.status,201,'User '+username+' must be registered once');
  const login=await request('/auth/login',{method:'POST',json:{email,password}});
  assert.equal(login.status,200);
  assert.ok(login.cookie?.startsWith('marcosa_session='));
  const profile=await request('/auth/me',{cookie:login.cookie});
  assert.equal(profile.status,200);
  assert.equal(profile.data.user.username,username);
  assert.equal(profile.data.worlds.length,1);
  assert.match(profile.data.worlds[0].slug,/^[a-z][a-z0-9-]{2,39}$/,
   'Allowed underscore username must not create unrouteable World slug');
  assert.equal(created.data.world,profile.data.worlds[0].slug);
  const direct=await request('/worlds/'+profile.data.worlds[0].slug,{cookie:login.cookie});
  assert.equal(direct.status,200,'New default World must be accessible by direct route');
  return{username,email,cookie:login.cookie,id:profile.data.user.id,world:profile.data.worlds[0]};
 }
 try{
  await boot();
  const members=[];
  // Lab throttles at 8 signups/10min per loopback IP; avoid cheating by
  // changing the IP or deleting rate records. Advance injected TEST CLOCK.
  for(let i=0;i<12;i++){
   if(i===8)clock+=11*60000;
   members.push(await register(i));
  }
  assert.equal(countSql('SELECT count(*) AS n FROM users'),12);
  assert.equal(countSql('SELECT count(*) AS n FROM worlds'),12);
  assert.equal(countSql('SELECT count(*) AS n FROM beta_retention_days'),0,
   'Simulated logins must not imply consent or fake retention');
  const postIds=[];
  for(const [i,owner] of members.entries()){
   let reply=await request('/worlds/'+owner.world.slug,{method:'PATCH',cookie:owner.cookie,
    json:{description:'A distinct, real local World created by test account '+i+'.'}});
   assert.equal(reply.status,200);
   const a=await request('/posts',{method:'POST',cookie:owner.cookie,
    json:{worldId:owner.world.id,body:'Original R76 message from '+owner.username,status:'published'}});
   assert.equal(a.status,201);
   postIds.push(a.data.id);
   const draft=await request('/posts',{method:'POST',cookie:owner.cookie,
    json:{worldId:owner.world.id,body:'PRIVATE DRAFT from '+owner.username,status:'draft'}});
   assert.equal(draft.status,201);
  }
  assert.equal(countSql("SELECT count(*) AS n FROM posts WHERE status='published'"),12);
  assert.equal(countSql("SELECT count(*) AS n FROM posts WHERE status='draft'"),12);
  // Every account follows and replies to a DIFFERENT creator, so this tests
  // actual relational writes and notification ownership rather than mocks.
  for(let i=0;i<12;i++){
   const owner=members[i],target=members[(i+1)%12];
   let x=await request('/worlds/'+target.world.slug+'/follow',
     {method:'POST',cookie:owner.cookie,json:{}});
   assert.equal(x.status,201);
   x=await request('/worlds/'+target.world.slug+'/follow',
     {method:'POST',cookie:owner.cookie,json:{}});
   assert.equal(x.status,200,'Duplicate follow must be idempotent');
   x=await request('/posts/'+postIds[(i+1)%12]+'/comments',
     {method:'POST',cookie:owner.cookie,json:{body:'Thoughtful real SQLite reply from '+owner.username}});
   assert.equal(x.status,201);
  }
  assert.equal(countSql('SELECT count(*) AS n FROM world_follows'),12);
  assert.equal(countSql("SELECT count(*) AS n FROM comments WHERE status='published'"),12);
  // Cross-tenant attempts must fail, and an unchanged owner post remains.
  const original=lab.db.prepare('SELECT body,status FROM posts WHERE id=?').get(postIds[1]);
  let denied=await request('/posts',{method:'POST',cookie:members[0].cookie,json:{
   worldId:members[1].world.id,body:'An illegal cross-tenant write',status:'published'}});
  assert.equal(denied.status,403);
  denied=await request('/posts/'+postIds[1],{method:'PATCH',cookie:members[0].cookie,
   json:{body:'Malicious edit'}});
  assert.equal(denied.status,404);
  denied=await request('/worlds/'+members[1].world.slug,{method:'PATCH',
   cookie:members[0].cookie,json:{title:'Hijacked World'}});
  assert.equal(denied.status,404);
  assert.deepEqual(lab.db.prepare('SELECT body,status FROM posts WHERE id=?').get(postIds[1]),original);

  // A real block cancels an existing follow, stops cross-user comments,
  // and filters the signed-in feed/search, but public guest posts remain
  // accessible (the app intentionally has PUBLIC published content).
  let x=await request('/users/'+members[1].username+'/block',
   {method:'POST',cookie:members[0].cookie,json:{}});
  assert.equal(x.status,201);
  assert.equal(countSql("SELECT count(*) AS n FROM world_follows WHERE user_id=? AND world_id=?",
   members[0].id,members[1].world.id),0);
  x=await request('/posts/'+postIds[1]+'/comments',
   {method:'POST',cookie:members[0].cookie,json:{body:'Blocked interaction'}});assert.equal(x.status,403);
  const personalized=await request('/posts',{cookie:members[0].cookie});
  assert.equal(personalized.status,200);
  assert.equal(personalized.data.items.some(i=>i.username===members[1].username),false);
  const guest=await request('/posts');
  assert.equal(guest.status,200);
  assert.equal(guest.data.items.some(i=>i.username===members[1].username),true);

  // Real voluntary consent is opt-in, scoped to ONE account. An unrelated
  // member never acquires synthetic D7/D30 history in this laboratory.
  let consent=await request('/me/retention-consent',{method:'POST',
   cookie:members[0].cookie,json:{consent:true}});
  assert.equal(consent.status,200);
  assert.equal(countSql('SELECT count(*) AS n FROM beta_retention_consents'),1);
  assert.equal(countSql('SELECT count(*) AS n FROM beta_retention_days'),1);
  const unconsented=await request('/me/retention-consent',{cookie:members[1].cookie});
  assert.equal(unconsented.status,200);
  assert.equal(countSql('SELECT count(*) AS n FROM beta_retention_consents WHERE user_id=?',members[1].id),0);
  const metrics=await request('/me/onboarding',{cookie:members[0].cookie});
  assert.equal(metrics.status,200);
  assert.equal(metrics.data.retentionD7,null);
  assert.equal(metrics.data.production,false);

  // Private exports cannot contain someone else's drafts, reports or tokens.
  let exported=await request('/account/export',{cookie:members[0].cookie});
  assert.equal(exported.status,200);
  assert.equal(exported.data.user.email,members[0].email);
  assert.equal(exported.data.posts.length,2);
  const serialized=JSON.stringify(exported.data);
  assert.doesNotMatch(serialized,new RegExp('PRIVATE DRAFT from '+members[1].username));
  assert.doesNotMatch(serialized,/password_hash|token_hash|refresh_token|service_role/);
  assert.equal((await request('/account/export')).status,401);
  // Twenty-four actual concurrent GETs on the same initialized SQLite:
  // real HTTP results, no invented production p95 or external traffic.
  const burst=await Promise.all(Array.from({length:24},(_,i)=>
   request('/worlds',{cookie:members[i%members.length].cookie})));
  assert.equal(burst.length,24);
  assert.ok(burst.every(x=>x.status===200&&Array.isArray(x.data.items)));
  assert.ok(burst.every(x=>x.data.items.length<=30));
  
  // Persist actual data to disk and recover into a fresh server process.
  assert.deepEqual(lab.db.prepare('PRAGMA foreign_key_check').all(),[]);
  await lab.close();lab=null;
  await boot();
  assert.equal(countSql('SELECT count(*) AS n FROM users'),12);
  assert.equal(countSql('SELECT count(*) AS n FROM posts'),24);
  assert.equal(countSql('SELECT count(*) AS n FROM world_follows'),11);
  assert.equal(countSql('SELECT count(*) AS n FROM beta_retention_consents'),1);
  assert.equal((await request('/auth/me',{cookie:members[0].cookie})).status,200,
   'Existing valid session must survive app restart on the persistent DB');

  // Ownership-controlled irreversible deletion must cascade all data for
  // the target without damaging the other accounts or their signed sessions.
  x=await request('/account',{method:'DELETE',cookie:members[11].cookie,
   json:{confirm:'DELETE',password}});
  assert.equal(x.status,200);
  assert.equal((await request('/auth/me',{cookie:members[11].cookie})).status,401);
  assert.equal(countSql('SELECT count(*) AS n FROM users'),11);
  assert.equal(countSql('SELECT count(*) AS n FROM worlds'),11);
  assert.equal(countSql('SELECT count(*) AS n FROM posts'),22);
  assert.equal((await request('/auth/me',{cookie:members[0].cookie})).status,200);
  assert.deepEqual(lab.db.prepare('PRAGMA foreign_key_check').all(),[]);

  // Consent revocation deletes retained sign-in history, not just a UI flag.
  x=await request('/me/retention-consent',{method:'DELETE',cookie:members[0].cookie,json:{}});
  assert.equal(x.status,200);
  assert.equal(countSql('SELECT count(*) AS n FROM beta_retention_consents'),0);
  assert.equal(countSql('SELECT count(*) AS n FROM beta_retention_days'),0);
  assert.deepEqual(lab.db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.ok(requests>140,'Must execute a genuinely multi-user HTTP write workload');
  // DO NOT call these values real beta cohort or production latency.
  const proof={format:'marcosa-r76-disposable-tenancy-write-proof/v1',
   production:false,externalUsers:0,actualIndependentBetaParticipants:0,
   syntheticTestAccounts:12,measuredProductionLatency:false,reportedD7:null,
   reportedD30:null,realHttpRequests:requests,
   persistenceAfterRestart:true,foreignKeysOk:true,
   crossTenantWritesBlocked:true,voluntaryRetentionOnly:true,
   eraseAndConsentRevocationVerified:true};
  assert.equal(proof.reportedD7,null);
  assert.equal(proof.actualIndependentBetaParticipants,0);
  writeFileSync(join(folder,'proof.json'),JSON.stringify(proof,null,2));
  assert.deepEqual(JSON.parse(readFileSync(join(folder,'proof.json'),'utf8')),proof);
 }finally{
  if(lab)await lab.close().catch(()=>{});
  rmSync(folder,{recursive:true,force:true,maxRetries:15,retryDelay:100});
 }
});
