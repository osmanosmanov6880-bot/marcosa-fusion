import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

const INVITE='r30-invite-validated-for-test-only';
const PASSWORD='world-creator-password-2026';
test('R30: real cross-account community + safely reviewed unpaid sponsor pilot',async t=>{
 const app=createApp({inviteCode:INVITE});
 await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+app.server.address().port;
 async function req(path,{method='GET',json,session,origin}={}){
  const headers={};
  if(method!=='GET'){headers['Content-Type']='application/json';headers.Origin=origin||base;}
  if(session)headers.Cookie=session;
  const r=await fetch(base+'/api'+path,{method,headers,...(json!==undefined?{body:JSON.stringify(json)}:{})});
  return{status:r.status,data:await r.json(),headers:r.headers};
 }
 async function account(name){
  const email=name+'@example.net';
  let r=await req('/auth/register',{method:'POST',json:{email,username:name,password:PASSWORD,inviteCode:INVITE}});
  assert.equal(r.status,201,'register '+name);
  r=await req('/auth/login',{method:'POST',json:{email,password:PASSWORD}});
  assert.equal(r.status,200);
  const session=r.headers.get('set-cookie').split(';')[0];
  r=await req('/auth/me',{session});
  assert.equal(r.status,200);
  return{session,name,id:r.data.user.id,world:r.data.worlds[0].id,slug:r.data.worlds[0].slug};
 }
 let alice,bob,carol,post,comment,appId;
 try{
  await t.test('register 3 different members and create one publicly readable real post',async()=>{
   alice=await account('alice30');bob=await account('bob30');carol=await account('carol30');
   const p=await req('/posts',{method:'POST',session:alice.session,json:{worldId:alice.world,body:'Original work in the creator World',status:'published'}});
   assert.equal(p.status,201);post=p.data.id;
   const draft=await req('/posts',{method:'POST',session:alice.session,json:{worldId:alice.world,body:'Private alpha roadmap',status:'draft'}});
   assert.equal(draft.status,201);
   const feed=await req('/posts');
   assert.equal(feed.data.items.length,1);
   assert.equal(feed.data.items[0].comments_count,0);
  });
  await t.test('real follows are unique, removable, owner-restricted, origin protected',async()=>{
   const path='/worlds/'+alice.slug+'/follow';
   let r=await req('/worlds/'+alice.slug+'/followers');
   assert.deepEqual({count:r.data.count,followed:r.data.followed},{count:0,followed:false});
   r=await req(path,{method:'POST',session:alice.session,json:{}});assert.equal(r.status,403);
   r=await req(path,{method:'POST',session:bob.session,origin:'https://evil.example',json:{}});assert.equal(r.status,403);
   r=await req(path,{method:'POST',session:bob.session,json:{}});assert.equal(r.status,201);
   r=await req(path,{method:'POST',session:bob.session,json:{}});assert.equal(r.status,200);
   r=await req('/worlds/'+alice.slug+'/followers',{session:bob.session});
   assert.equal(r.data.count,1);assert.equal(r.data.followed,true);
   r=await req('/worlds');assert.equal(r.data.items.find(x=>x.slug===alice.slug).followers_count,1);
   r=await req(path,{method:'DELETE',session:bob.session,json:{}});assert.equal(r.status,200);
   r=await req('/worlds/'+alice.slug+'/followers');
   assert.equal(r.data.count,0);
   r=await req(path,{method:'POST',session:bob.session,json:{}});assert.equal(r.status,201);
  });
  await t.test('comment is real, published-only, cannot be edited/deleted by other user',async()=>{
   let r=await req('/posts/'+post+'/comments');
   assert.equal(r.status,200);assert.equal(r.data.items.length,0);
   r=await req('/posts/'+post+'/comments',{method:'POST',session:bob.session,json:{body:'I can collaborate on this World.'}});
   assert.equal(r.status,201);comment=r.data.id;
   r=await req('/posts/'+post+'/comments');
   assert.equal(r.status,200);assert.equal(r.data.items[0].username,'bob30');
   assert.equal(r.data.items[0].body,'I can collaborate on this World.');
   r=await req('/posts');assert.equal(r.data.items[0].comments_count,1);
   const d=await req('/me/posts',{session:alice.session});
   const draftId=d.data.items.find(x=>x.status==='draft').id;
   r=await req('/posts/'+draftId+'/comments');
   assert.equal(r.status,404);
   r=await req('/posts/'+draftId+'/comments',{method:'POST',session:bob.session,json:{body:'Do not leak'}});assert.equal(r.status,404);
   r=await req('/posts/'+post+'/comments',{method:'POST',session:bob.session,json:{body:'x'.repeat(801)}});assert.equal(r.status,400);
   r=await req('/comments/'+comment,{method:'DELETE',session:alice.session,json:{}});assert.equal(r.status,404);
   r=await req('/comments/'+comment+'/report',{method:'POST',session:bob.session,json:{reason:'spam'}});assert.equal(r.status,403);
   r=await req('/comments/'+comment+'/report',{method:'POST',session:alice.session,json:{reason:'abuse'}});assert.equal(r.status,201);
   r=await req('/comments/'+comment+'/report',{method:'POST',session:alice.session,json:{reason:'abuse'}});assert.equal(r.status,409);
  });
  await t.test('paid advertising is NOT live: proposals pending, no public display, HTTPS-only',async()=>{
   const form={worldId:alice.world,brandName:'Imaginary Studio Lab',headline:'A transparent pilot for story creators',landingUrl:'https://studio.example.org/work'};
   let r=await req('/sponsors/approved');
   assert.equal(r.status,200);assert.equal(r.data.paid,false);assert.equal(r.data.items.length,0);
   for(const malicious of ['javascript:alert(1)','http://studio.example.org/','https://127.0.0.1/','https://localhost/','https://bad.local/','https://user:pass@studio.example.org/']){
    r=await req('/sponsors/proposals',{method:'POST',session:bob.session,json:{...form,landingUrl:malicious}});
    assert.equal(r.status,400,'reject unsafe URL '+malicious);
   }
   // The advertiser (Bob) requests placement in creator Alice's World.
   // The owner cannot buy "advertising" from herself; the two sides remain distinct.
   r=await req('/sponsors/proposals',{method:'POST',session:alice.session,json:form});assert.equal(r.status,403);
   r=await req('/sponsors/proposals',{method:'POST',session:bob.session,json:form});
   assert.equal(r.status,201);assert.equal(r.data.status,'pending_creator');assert.equal(r.data.paid,false);appId=r.data.id;
   r=await req('/sponsors/approved');assert.equal(r.data.items.length,0);
   r=await req('/me/received-sponsors',{session:alice.session});
   assert.equal(r.status,200);assert.equal(r.data.items.length,1);
   assert.equal(r.data.items[0].applicant,'bob30');
   r=await req('/me/received-sponsors',{session:bob.session});
   assert.equal(r.data.items.length,0);
   r=await req('/mod/sponsors',{session:alice.session});assert.equal(r.status,403);
   r=await req('/mod/sponsors/'+appId+'/review',{method:'POST',session:alice.session,json:{decision:'approved'}});assert.equal(r.status,403);
   r=await req('/sponsors/'+appId+'/creator-decision',{method:'POST',session:bob.session,json:{decision:'accept'}});assert.equal(r.status,403);
   r=await req('/sponsors/'+appId+'/creator-decision',{method:'POST',session:alice.session,json:{decision:'accept'}});
   assert.equal(r.status,200);assert.equal(r.data.status,'pending_review');
   r=await req('/sponsors/approved');assert.equal(r.data.items.length,0);
   r=await req('/me/sponsors',{session:bob.session});
   assert.equal(r.status,200);assert.equal(r.data.items.length,1);
   assert.equal(r.data.items[0].status,'pending_review');
   assert.equal(Object.hasOwn(r.data.items[0],'landing_url'),false);
  });
  await t.test('only moderator can process comments reports and third-party sponsorship',async()=>{
   app.db.prepare("UPDATE users SET role='moderator' WHERE id=?").run(carol.id);
   let r=await req('/mod/comment-reports',{session:carol.session});
   assert.equal(r.status,200);assert.equal(r.data.items.length,1);
   r=await req('/mod/comments/'+comment+'/hide',{method:'POST',session:carol.session,json:{}});
   assert.equal(r.status,200);
   r=await req('/posts/'+post+'/comments');assert.equal(r.data.items.length,0);
   r=await req('/posts');assert.equal(r.data.items[0].comments_count,0);
   r=await req('/mod/comment-reports',{session:carol.session});assert.equal(r.data.items.length,0);
   r=await req('/mod/sponsors',{session:carol.session});
   assert.equal(r.status,200);assert.equal(r.data.items.length,1);
   r=await req('/mod/sponsors/'+appId+'/review',{method:'POST',session:carol.session,json:{decision:'approved'}});
   assert.equal(r.status,200);assert.equal(r.data.paid,false);
   r=await req('/mod/sponsors/'+appId+'/review',{method:'POST',session:carol.session,json:{decision:'approved'}});
   assert.equal(r.status,404);
   r=await req('/sponsors/approved');
   assert.equal(r.status,200);assert.equal(r.data.items.length,1);
   assert.match(r.data.items[0].disclosure,/НЕ ОПЛАЧЕНО/);
   assert.equal(r.data.items[0].landing_url,'https://studio.example.org/work');
  });
  await t.test('account portability and deletion cascade real follows, comments and proposals',async()=>{
   let r=await req('/account/export',{session:alice.session});assert.equal(r.status,200);
   assert.equal(r.data.sponsorProposals.length,0);
   r=await req('/account/export',{session:bob.session});
   assert.deepEqual(r.data.follows,[{slug:alice.slug}]);
   assert.equal(r.data.comments.length,1);
   assert.equal(r.data.sponsorProposals.length,1);
   assert.equal(r.data.sponsorProposals[0].status,'approved');
   r=await req('/account/export',{session:carol.session});
   assert.equal(r.data.sponsorProposals.length,0);
   r=await req('/account',{method:'DELETE',session:alice.session,json:{confirm:'DELETE',password:PASSWORD}});
   assert.equal(r.status,200);
   r=await req('/sponsors/approved');assert.equal(r.data.items.length,0);
   r=await req('/worlds/'+alice.slug+'/followers');assert.equal(r.status,404);
   r=await req('/posts');assert.equal(r.data.items.length,0);
  });
 }finally{await app.close();}
});
