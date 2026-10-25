import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('R88: five consenting invited users yield measured D7/D30, four are fully suppressed after opt-out',async()=>{
 const DAY=86400000;
 let clock=Date.parse('2026-02-01T12:00:00Z');
 const app=createApp({inviteCode:'r88-synthetic-cohort-only',now:()=>clock});
 await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+app.server.address().port;
 const password='r88-local-strong-test-password';
 async function request(path,{method='GET',cookie,data}={}){
  const headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=base;headers['Content-Type']='application/json';}
  const response=await fetch(base+'/api'+path,{method,headers,
   ...(data===undefined?{}:{body:JSON.stringify(data)})});
  return{status:response.status,data:await response.json(),
   cookie:response.headers.get('set-cookie')?.split(';')[0]||null};
 }
 async function register(username){
  const email=username+'@example.net';
  const created=await request('/auth/register',{method:'POST',data:{
   username,email,password,inviteCode:'r88-synthetic-cohort-only'}});
  assert.equal(created.status,201,'Register '+username);
  const id=app.db.prepare('SELECT id FROM users WHERE username=?').get(username).id;
  return{username,email,id};
 }
 async function login(user){
  const result=await request('/auth/login',{method:'POST',data:{email:user.email,password}});
  assert.equal(result.status,200,'Login '+user.username);
  return result.cookie;
 }
 try{
  const mod=await register('moderator88');
  app.db.prepare("UPDATE users SET role='moderator' WHERE id=?").run(mod.id);
  const people=[];
  for(let i=0;i<5;i++){
   const person=await register('founder88'+String.fromCharCode(97+i));
   app.db.prepare("INSERT INTO pilot_invites(id,code_hash,creator_id,label,created_at,expires_at,used_by,used_at) VALUES(?,?,?,?,?,?,?,?)")
    .run('r88-local-invite-'+i,('f'.repeat(63))+i,mod.id,
     'Synthetic test cohort '+i,clock-100000,clock+DAY,person.id,clock-1000);
   const cookie=await login(person);
   const accepted=await request('/me/retention-consent',{cookie,method:'POST',data:{consent:true}});
   assert.equal(accepted.status,200);
   people.push({...person,cookie});
  }
  let modCookie=await login(mod);
  let result=await request('/mod/pilot-metrics',{cookie:modCookie});
  assert.equal(result.status,200);
  assert.equal(result.data.production,false);
  assert.equal(result.data.retentionEvidence.minimumDisclosureEligible,5);
  assert.equal(result.data.retentionEvidence.consentingInvited,5);
  assert.equal(result.data.retentionEvidence.consentCountSuppressed,false);
  assert.deepEqual(result.data.retentionEvidence.d7,
   {eligible:0,returned:0,rate:null,suppressed:false},'Unmatured does not mean 0%');
  assert.equal(result.data.retentionD7,null);
  assert.equal(result.data.retentionD30,null);
  clock+=6*DAY;
  people[0].cookie=await login(people[0]); // Day +6 is NOT a Day +7 return
  clock+=DAY;
  people[1].cookie=await login(people[1]);
  people[2].cookie=await login(people[2]);
  modCookie=await login(mod);
  result=await request('/mod/pilot-metrics',{cookie:modCookie});
  assert.equal(result.status,200);
  assert.deepEqual(result.data.retentionEvidence.d7,
   {eligible:5,returned:2,rate:0.4,suppressed:false});
  assert.equal(result.data.retentionD7,0.4);
  assert.equal(result.data.retentionD30,null,'No fictional D30 before 30 days');
  clock+=23*DAY;
  people[2].cookie=await login(people[2]); // Only one returns exactly at +30
  modCookie=await login(mod);
  result=await request('/mod/pilot-metrics',{cookie:modCookie});
  assert.equal(result.status,200);
  assert.deepEqual(result.data.retentionEvidence.d30,
   {eligible:5,returned:1,rate:0.2,suppressed:false});
  assert.equal(result.data.retentionD30,0.2);
  assert.equal(result.data.retentionD7,0.4);
  assert.doesNotMatch(JSON.stringify(result.data),/@example|founder88|r88-local-invite/);
  const stranger=await request('/mod/pilot-metrics',{cookie:people[2].cookie});
  assert.equal(stranger.status,403);
  const anonymous=await request('/mod/pilot-metrics');
  assert.equal(anonymous.status,401);

  // The cohort drops from k=5 to k=4. Hide eligible and returned counts,
  // plus the opt-in count itself, so a moderator cannot infer their activity.
  const optedOut=await request('/me/retention-consent',
   {method:'DELETE',cookie:people[2].cookie,data:{}});
  assert.equal(optedOut.status,200);
  assert.equal(optedOut.data.pastActivityDeleted,true);
  result=await request('/mod/pilot-metrics',{cookie:modCookie});
  assert.equal(result.status,200);
  assert.equal(result.data.retentionEvidence.minimumDisclosureEligible,5);
  assert.equal(result.data.retentionEvidence.consentingInvited,null);
  assert.equal(result.data.retentionEvidence.consentCountSuppressed,true);
  assert.deepEqual(result.data.retentionEvidence.d7,
   {eligible:null,returned:null,rate:null,suppressed:true});
  assert.deepEqual(result.data.retentionEvidence.d30,
   {eligible:null,returned:null,rate:null,suppressed:true});
  assert.equal(result.data.retentionD7,null);
  assert.equal(result.data.retentionD30,null);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM beta_retention_days WHERE user_id=?').get(people[2].id).n,0);
  const exported=await request('/account/export',{cookie:people[2].cookie});
  assert.equal(exported.status,200);
  assert.equal(exported.data.retentionConsent,null);
  assert.deepEqual(exported.data.retentionDays,[]);
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();}
});
