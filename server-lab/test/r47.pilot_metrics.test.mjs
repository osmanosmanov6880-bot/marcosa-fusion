import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('R47: actual creator cohort stats require moderator, track real events, and never invent D7/ads',async()=>{
 const lab=createApp({inviteCode:'r47-local-pilot-invite-token'});
 await new Promise(done=>lab.server.listen(0,'127.0.0.1',done));
 const base='http://127.0.0.1:'+lab.server.address().port,password='r47-safe-user-password';
 async function api(path,{method='GET',cookie,json}={}){
  const headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=base;headers['Content-Type']='application/json';}
  const r=await fetch(base+'/api'+path,{method,headers,...(json===undefined?{}:{body:JSON.stringify(json)})});
  return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};
 }
 async function member(username,inviteCode='r47-local-pilot-invite-token'){
  let r=await api('/auth/register',{method:'POST',json:{username,email:username+'@example.net',password,inviteCode}});
  assert.equal(r.status,201);
  r=await api('/auth/login',{method:'POST',json:{email:username+'@example.net',password}});
  assert.equal(r.status,200);
  const cookie=r.cookie.split(';')[0];
  r=await api('/auth/me',{cookie});assert.equal(r.status,200);
  return{cookie,world:r.data.worlds[0],id:r.data.user.id};
 }
 try{
  const mod=await member('staff47');
  lab.db.prepare("UPDATE users SET role='moderator' WHERE username='staff47'").run();
  const alice=await member('alice47'),bob=await member('bob47');
  let r=await api('/mod/pilot-metrics');assert.equal(r.status,401);
  r=await api('/mod/pilot-metrics',{cookie:alice.cookie});assert.equal(r.status,403);
  r=await api('/mod/pilot-metrics',{cookie:mod.cookie});
  assert.equal(r.status,200);
  assert.equal(r.data.members,2);
  assert.equal(r.data.invitedMembers,0);
  assert.equal(r.data.invitedCreatorActivationRate,null);
  assert.equal(r.data.retentionD7,null);assert.equal(r.data.retentionD30,null);
  assert.equal(r.data.verifiedAdImpressions,null);assert.equal(r.data.paidRevenue,null);
  const ticket=await api('/mod/invites',{cookie:mod.cookie,method:'POST',json:{label:'Founders cohort',expiresHours:24}});
  assert.equal(ticket.status,201);
  const guest=await member('founder47',ticket.data.code);
  r=await api('/mod/pilot-metrics',{cookie:mod.cookie});
  assert.equal(r.data.members,3);
  assert.equal(r.data.invitedMembers,1);
  assert.equal(r.data.invitations.redeemed,1);
  assert.equal(r.data.invitations.issued,1);
  assert.equal(r.data.creatorActivationRate,0);
  assert.equal(r.data.invitedCreatorActivationRate,0);
  let p=await api('/posts',{cookie:guest.cookie,method:'POST',json:{worldId:guest.world.id,body:'Real invited creator publication',status:'published'}});
  assert.equal(p.status,201);
  const fromGuest=p.data.id;
  p=await api('/posts',{cookie:bob.cookie,method:'POST',json:{worldId:bob.world.id,body:'A second creator shares an idea',status:'published'}});
  assert.equal(p.status,201);
  const bobPost=p.data.id;
  r=await api('/worlds/'+bob.world.slug+'/follow',{cookie:guest.cookie,method:'POST',json:{}});
  assert.equal(r.status,201);
  r=await api('/posts/'+bobPost+'/comments',{cookie:guest.cookie,method:'POST',json:{body:'Interesting, I will try this method'}});
  assert.equal(r.status,201);
  r=await api('/posts/'+bobPost+'/save',{cookie:guest.cookie,method:'POST',json:{}});
  assert.equal(r.status,201);
  r=await api('/mod/pilot-metrics',{cookie:mod.cookie});
  assert.equal(r.status,200);
  assert.equal(r.data.source,'verified-local-sqlite');
  assert.equal(r.data.members,3);
  assert.equal(r.data.invitedMembers,1);
  assert.equal(r.data.publishedCreators,2);
  assert.equal(r.data.invitedCreatorsPublished,1);
  assert.equal(r.data.creatorActivationRate,2/3);
  assert.equal(r.data.invitedCreatorActivationRate,1);
  assert.equal(r.data.publicWorlds,2);
  assert.equal(r.data.repliesToOtherAuthors,1);
  assert.equal(r.data.followEdges,1);
  assert.equal(r.data.savedReferences,1);
  assert.equal(r.data.production,false);
  assert.doesNotMatch(JSON.stringify(r.data),/@example|password|salt|token_hash|code_hash|founder47/);
  const hidden=await api('/mod/posts/'+bobPost+'/hide',{cookie:mod.cookie,method:'POST',json:{}});
  assert.equal(hidden.status,200);
  r=await api('/mod/pilot-metrics',{cookie:mod.cookie});
  assert.equal(r.data.publishedCreators,1);
  assert.equal(r.data.publicWorlds,1);
  assert.equal(r.data.repliesToOtherAuthors,0);
  assert.equal(r.data.savedReferences,1,'bookmarks still exist but hidden ones are not displayed');
  const removed=await api('/account',{cookie:guest.cookie,method:'DELETE',json:{confirm:'DELETE',password}});
  assert.equal(removed.status,200);
  r=await api('/mod/pilot-metrics',{cookie:mod.cookie});
  assert.equal(r.data.members,2);
  assert.equal(r.data.invitedMembers,0);
  assert.equal(r.data.invitedCreatorsPublished,0);
  assert.equal(r.data.invitedCreatorActivationRate,null);
  assert.equal(r.data.invitations.redeemed,1,'historical redemption stays after account deletion');
  assert.equal(r.data.savedReferences,0);
  assert.equal(r.data.followEdges,0);
  assert.equal(r.data.retentionD7,null);
  assert.deepEqual(lab.db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.ok(fromGuest>0);
 }finally{await lab.close();}
});
