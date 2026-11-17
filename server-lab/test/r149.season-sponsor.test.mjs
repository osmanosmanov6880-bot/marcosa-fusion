import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('season sponsor requires real approvals, counts deliberate visits and idempotent confirmations, revokes immediately',async()=>{
 const inviteCode='season-sponsor-local-invite';
 const app=createApp({inviteCode});
 await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+app.server.address().port;
 async function request(path,actor,data){
  const headers={};
  if(actor)headers.Cookie=actor.cookie;
  if(data){headers.Origin=base;headers['Content-Type']='application/json'}
  const res=await fetch(base+'/api'+path,{method:data?'POST':'GET',headers,body:data?JSON.stringify(data):undefined});
  return {status:res.status,json:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 }
 async function member(username){
  const password='season-sponsor-strong-password',email=username+'@example.org';
  assert.equal((await request('/auth/register',null,{email,username,password,inviteCode})).status,201);
  const actor=await request('/auth/login',null,{email,password});
  const me=await request('/auth/me',actor);
  return {...actor,id:me.json.user.id,world:me.json.worlds[0].id};
 }
 try{
  const author=await member('seasoncreator'),brand=await member('seasonbrand'),mod=await member('seasonmod'),reader=await member('seasonreader');
  app.db.prepare("UPDATE users SET role='moderator' WHERE id=?").run(mod.id);
  const series=await request('/series',author,{worldId:author.world,slug:'pilot-season',title:'Pilot season'});
  assert.equal(series.status,201,JSON.stringify(series.json));
  const proposal=await request('/sponsors/proposals',brand,{worldId:author.world,brandName:'Studio',headline:'Studio screening',landingUrl:'https://example.org/screening'});
  assert.equal(proposal.status,201);
  const proposalId=proposal.json.id;
  const path='/series/pilot-season/sponsor';
  assert.equal((await request(path+'/attach',author,{proposalId})).status,400);
  assert.equal((await request('/sponsors/'+proposalId+'/creator-decision',author,{decision:'accept'})).status,200);
  assert.equal((await request('/mod/sponsors/'+proposalId+'/review',mod,{decision:'approved'})).status,200);
  assert.equal((await request(path+'/attach',brand,{proposalId})).status,403);
  assert.equal((await request(path+'/attach',author,{proposalId})).status,200);
  const publicData=(await request(path)).json;
  const placementId=publicData.placement.id, record={placementId,reference:'booking-01'};
  assert.equal(publicData.paid,false);assert.equal(publicData.report,null);
  for(let n=0;n<2;n++)assert.equal((await request(path+'/click',reader,{placementId})).json.url,'https://example.org/screening');
  assert.equal((await request(path+'/outcome',reader,record)).status,403);
  for(let n=0;n<2;n++)assert.equal((await request(path+'/outcome',brand,record)).status,200);
  assert.equal((await request(path+'/cancel',brand,record)).status,200);
  assert.deepEqual((await request(path,author)).json.report,{uniqueMembers:1,confirmed:1,cancelled:1,netConfirmed:0});
  assert.equal((await request('/sponsors/'+proposalId+'/withdraw',brand,{})).status,200);
  assert.equal((await request(path)).json.placement,null);
  assert.equal((await request(path+'/click',reader,{placementId})).status,404);
  assert.equal((await request(path+'/detach',author,{placementId})).status,200);
 }finally{await app.close()}
});
