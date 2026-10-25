import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('R62/R88: opt-in UTC D7/D30 with under-five suppression, erasure and owner isolation',async()=>{
 let clock=Date.parse('2026-01-01T11:00:00Z');
 const DAY=86400000,lab=createApp({inviteCode:'r62-safe-local-invite-2026',now:()=>clock});
 await new Promise(ok=>lab.server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+lab.server.address().port;
 const password='r62-long-safe-local-password';
 async function req(path,{method='GET',cookie,data,origin=base}={}){
  const headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=origin;headers['Content-Type']='application/json';}
  const response=await fetch(base+'/api'+path,{method,headers,
   ...(data===undefined?{}:{body:JSON.stringify(data)})});
  return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]||null};
 }
 async function member(username){
  let x=await req('/auth/register',{method:'POST',data:{username,email:username+'@example.net',password,inviteCode:'r62-safe-local-invite-2026'}});
  assert.equal(x.status,201,username+' register');
  return{id:lab.db.prepare('SELECT id FROM users WHERE username=?').get(username).id,username};
 }
 async function login(account){
  const response=await req('/auth/login',{method:'POST',data:{email:account.username+'@example.net',password}});
  assert.equal(response.status,200,account.username+' login');
  return response.cookie;
 }
 try{
  const mod=await member('reviewer62'),invited=await member('creator62'),plain=await member('normal62');
  lab.db.prepare("UPDATE users SET role='moderator' WHERE id=?").run(mod.id);
  // Simulated redeemed pilot code: only the referenced invited user may
  // enter the aggregate, while ordinary legacy invite accounts are excluded.
  lab.db.prepare("INSERT INTO pilot_invites(id,code_hash,creator_id,label,created_at,expires_at,used_by,used_at) VALUES(?,?,?,?,?,?,?,?)")
   .run('r62-invite-id','f'.repeat(64),mod.id,'fixture-only',clock-60000,clock+86400000,invited.id,clock-1000);
  let modCookie=await login(mod),memberCookie=await login(invited),plainCookie=await login(plain);
  let out=await req('/me/retention-consent');
  assert.equal(out.status,401);
  out=await req('/me/retention-consent',{cookie:memberCookie});
  assert.equal(out.status,200);assert.equal(out.data.consented,false);
  assert.equal(lab.db.prepare('SELECT count(*) AS n FROM beta_retention_days').get().n,0,'no events before consent');
  out=await req('/mod/pilot-metrics',{cookie:memberCookie});assert.equal(out.status,403);
  out=await req('/me/retention-consent',{method:'POST',cookie:memberCookie,data:{consent:false}});
  assert.equal(out.status,400);
  out=await req('/me/retention-consent',{method:'POST',cookie:memberCookie,data:{consent:true,actor:mod.id}});
  assert.equal(out.status,400);
  out=await req('/me/retention-consent',{method:'POST',cookie:memberCookie,
   origin:'https://outside.example',data:{consent:true}});assert.equal(out.status,403);
  out=await req('/me/retention-consent',{method:'POST',cookie:memberCookie,data:{consent:true}});
  assert.equal(out.status,200);assert.equal(out.data.changed,true);
  out=await req('/me/retention-consent',{method:'POST',cookie:memberCookie,data:{consent:true}});
  assert.equal(out.status,200);assert.equal(out.data.changed,false,'repeat does not reset cohort');
  const day0=Math.floor(clock/DAY);
  assert.deepEqual(lab.db.prepare('SELECT day_utc,source FROM beta_retention_days WHERE user_id=?').all(invited.id)
    .map(({day_utc,source})=>({day_utc,source})),[{day_utc:day0,source:'consent'}]);
  out=await req('/me/retention-consent',{method:'POST',cookie:plainCookie,data:{consent:true}});
  assert.equal(out.status,200,'noninvited also controls their private data');
  out=await req('/mod/pilot-metrics',{cookie:modCookie});
  assert.equal(out.status,200);assert.equal(out.data.retentionD7,null);assert.equal(out.data.retentionD30,null);
  assert.equal(out.data.retentionEvidence.consentingInvited,null,'single participant opted-in state is private');
  assert.equal(out.data.retentionEvidence.consentCountSuppressed,true);
  assert.equal(out.data.retentionEvidence.minimumDisclosureEligible,5);
  assert.equal(out.data.production,false);assert.equal(out.data.paidRevenue,null);

  clock+=6*DAY;
  memberCookie=await login(invited);
  assert.equal(lab.db.prepare('SELECT count(*) AS n FROM beta_retention_days WHERE user_id=?').get(invited.id).n,2);
  clock+=DAY;
  memberCookie=await login(invited);
  plainCookie=await login(plain);
  modCookie=await login(mod);
  out=await req('/mod/pilot-metrics',{cookie:modCookie});
  assert.equal(out.status,200);assert.equal(out.data.retentionD7,null);
  assert.deepEqual(out.data.retentionEvidence.d7,{eligible:null,returned:null,rate:null,suppressed:true});
  assert.equal(out.data.retentionD30,null,'an immature cohort is unmeasured, not zero');

  clock+=23*DAY;
  modCookie=await login(mod);
  out=await req('/mod/pilot-metrics',{cookie:modCookie});
  assert.equal(out.data.retentionD30,null,'one eligible member is suppressed, never reported as zero');
  assert.deepEqual(out.data.retentionEvidence.d30,{eligible:null,returned:null,rate:null,suppressed:true});
  memberCookie=await login(invited);
  out=await req('/mod/pilot-metrics',{cookie:modCookie});
  assert.equal(out.data.retentionD30,null);
  assert.equal(out.data.retentionEvidence.d30.suppressed,true);
  const exported=await req('/account/export',{cookie:memberCookie});
  assert.ok(exported.data.retentionConsent);
  assert.deepEqual(exported.data.retentionDays.map(x=>x.dayUtc),[day0,day0+6,day0+7,day0+30]);
  assert.doesNotMatch(JSON.stringify(out.data),/creator62|normal62|example.net|r62-invite-id/);

  out=await req('/me/retention-consent',{cookie:memberCookie,method:'DELETE',data:{unexpected:true}});
  assert.equal(out.status,400);
  out=await req('/me/retention-consent',{cookie:memberCookie,method:'DELETE',data:{}});
  assert.equal(out.status,200);assert.equal(out.data.pastActivityDeleted,true);
  assert.equal(lab.db.prepare('SELECT count(*) AS n FROM beta_retention_days WHERE user_id=?').get(invited.id).n,0);
  out=await req('/account/export',{cookie:memberCookie});
  assert.equal(out.data.retentionConsent,null);assert.deepEqual(out.data.retentionDays,[]);
  out=await req('/mod/pilot-metrics',{cookie:modCookie});
  assert.equal(out.data.retentionEvidence.consentingInvited,0);
  assert.equal(out.data.retentionD7,null,'withdrawn subjects not silently counted');
  assert.equal(out.data.retentionD30,null);
  plainCookie=await login(plain);
  out=await req('/account',{method:'DELETE',cookie:plainCookie,data:{confirm:'DELETE',password}});
  assert.equal(out.status,200);
  assert.equal(lab.db.prepare('SELECT count(*) AS n FROM beta_retention_consents').get().n,0);
  assert.deepEqual(lab.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await lab.close();}
});
