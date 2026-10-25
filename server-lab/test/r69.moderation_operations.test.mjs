import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {createApp} from '../server.mjs';
import {measureModerationQueues} from '../ops/moderation-queue-health.mjs';

const HOUR=3600000;
function crc(b){let v=0xffffffff;for(const x of b){v^=x;for(let i=0;i<8;i++)v=(v&1)?(v>>>1)^0xedb88320:(v>>>1);}return(v^0xffffffff)>>>0;}
function chunk(k,b){const x=Buffer.alloc(12+b.length);x.writeUInt32BE(b.length,0);x.write(k,4,'ascii');b.copy(x,8);x.writeUInt32BE(crc(x.subarray(4,x.length-4)),x.length-4);return x;}
function png(){const h=Buffer.alloc(13);h.writeUInt32BE(2,0);h.writeUInt32BE(2,4);h[8]=8;h[9]=6;const r=Buffer.from([0,34,43,63,255,45,62,70,255]);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.concat([r,r]))),chunk('IEND',Buffer.alloc(0))]);}

test('R69 real queue metrics: 7 open cohorts, real aging, no PII, owner-only moderator access and revocation',async()=>{
 const time=Date.parse('2026-10-20T12:00:00.000Z');
 const lab=createApp({inviteCode:'r69-local-queue-lab',now:()=>time});
 await new Promise(resolve=>lab.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+lab.server.address().port;
 const password='very-long-local-password-69';
 async function req(path,{method='GET',cookie,data}={}){
  const headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=base;headers['Content-Type']='application/json';}
  const response=await fetch(base+'/api'+path,{method,headers,...(data===undefined?{}:{body:JSON.stringify(data)})});
  return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 async function member(username){
  const email=username+'@example.net';
  let r=await req('/auth/register',{method:'POST',data:{username,email,password,inviteCode:'r69-local-queue-lab'}});
  assert.equal(r.status,201,'register '+username);
  r=await req('/auth/login',{method:'POST',data:{email,password}});
  assert.equal(r.status,200,'login '+username);
  return{cookie:r.cookie,id:lab.db.prepare('SELECT id FROM users WHERE username=?').get(username).id,
   worldId:lab.db.prepare('SELECT id FROM worlds WHERE owner_id=(SELECT id FROM users WHERE username=?)').get(username).id};
 }
 try{
  const owner=await member('owner69'),reporter=await member('reporter69'),moderator=await member('mod69');
  lab.db.prepare("UPDATE users SET role='moderator' WHERE id=?").run(moderator.id);
  let r=await req('/mod/queue-health');
  assert.equal(r.status,401);
  r=await req('/mod/queue-health',{cookie:reporter.cookie});
  assert.equal(r.status,403);
  r=await req('/mod/queue-health',{cookie:moderator.cookie});
  assert.equal(r.status,200);assert.equal(r.data.production,false);
  assert.equal(r.data.pendingTotal,0);assert.equal(r.data.overdueTotal,0);
  assert.equal(r.data.overdueRate,null);
  assert.equal(r.data.queues.length,7);
  assert.ok(r.data.queues.every(x=>x.oldestAgeHours===null&&x.pending===0&&x.overdue===0));
  assert.equal(r.data.source,'verified-local-sqlite');

  const cover=png();
  lab.db.prepare('INSERT INTO world_covers(world_id,png,width,height,byte_size,updated_at,review_status) VALUES(?,?,?,?,?,?,?)')
   .run(owner.worldId,cover,2,2,cover.length,time-12*HOUR,'pending');
  const post=lab.db.prepare('INSERT INTO posts(world_id,author_id,body,status,created_at,updated_at) VALUES(?,?,?,?,?,?)')
   .run(owner.worldId,owner.id,'A public post for local queue acceptance','published',time-90*HOUR,time-90*HOUR).lastInsertRowid;
  const comment=lab.db.prepare('INSERT INTO comments(post_id,author_id,body,status,created_at) VALUES(?,?,?,?,?)')
   .run(post,owner.id,'Actual user comment','published',time-89*HOUR).lastInsertRowid;
  lab.db.prepare('INSERT INTO world_cover_reports(world_id,reporter_id,cover_sha256,reason,detail,status,created_at) VALUES(?,?,?,?,?,?,?)')
   .run(owner.worldId,reporter.id,'a'.repeat(64),'privacy','An independent privacy complaint','open',time-27*HOUR);
  lab.db.prepare('INSERT INTO world_cover_appeals(world_id,owner_id,cover_sha256,reason,status,created_at) VALUES(?,?,?,?,?,?)')
   .run(owner.worldId,owner.id,'a'.repeat(64),'I request independent review','open',time-10*HOUR);
  lab.db.prepare('INSERT INTO reports(post_id,reporter_id,reason,detail,status,created_at) VALUES(?,?,?,?,?,?)')
   .run(post,reporter.id,'spam','Repeated misleading content','open',time-25*HOUR);
  lab.db.prepare('INSERT INTO comment_reports(comment_id,reporter_id,reason,status,created_at) VALUES(?,?,?,?,?)')
   .run(comment,reporter.id,'abuse','open',time-2*HOUR);
  lab.db.prepare('INSERT INTO moderation_appeals(appellant_id,post_id,reason,status,created_at) VALUES(?,?,?,?,?)')
   .run(owner.id,post,'Please reconsider an earlier action','open',time-73*HOUR);
  lab.db.prepare('INSERT INTO sponsor_proposals(owner_id,world_id,brand_name,headline,landing_url,status,created_at) VALUES(?,?,?,?,?,?,?)')
   .run(reporter.id,owner.worldId,'Valid Brand','A real proposal awaiting review','https://example.org','pending_review',time-80*HOUR);

  r=await req('/mod/queue-health',{cookie:moderator.cookie});
  assert.equal(r.status,200);
  const result=r.data;
  assert.equal(result.pendingTotal,7);assert.equal(result.overdueTotal,4);
  assert.equal(result.overdueRate,4/7);
  assert.equal(result.queues.length,7);
  const map=Object.fromEntries(result.queues.map(entry=>[entry.id,entry]));
  assert.deepEqual(Object.keys(map).sort(),[
   'comment_reports','content_appeals','cover_appeals','cover_public_reports',
   'cover_uploads','post_reports','sponsor_reviews'
  ]);
  for(const item of result.queues){
   assert.equal(item.pending,1);
   assert.equal(typeof item.targetHours,'number');
  }
  assert.equal(map.cover_uploads.oldestAgeHours,12);
  assert.equal(map.cover_public_reports.overdue,1);
  assert.equal(map.cover_appeals.overdue,0);
  assert.equal(map.post_reports.overdue,1);
  assert.equal(map.comment_reports.overdue,0);
  assert.equal(map.content_appeals.overdue,1);
  assert.equal(map.sponsor_reviews.overdue,1);
  assert.equal(map.sponsor_reviews.oldestAgeHours,80);
  assert.doesNotMatch(JSON.stringify(result),/owner69|reporter69|example\.net|misleading|privacy complaint|my-password|Actual user comment/);
  assert.equal(result.generatedAt,new Date(time).toISOString());
  assert.equal(result.targets.includes('not legal'),true);

  lab.db.prepare("UPDATE world_covers SET review_status='approved',reviewed_by=?,reviewed_at=? WHERE world_id=?")
   .run(moderator.id,time,owner.worldId);
  lab.db.prepare("UPDATE world_cover_reports SET status='dismissed',reviewed_by=?,decided_at=?").run(moderator.id,time);
  lab.db.prepare("UPDATE world_cover_appeals SET status='upheld',decided_by=?,decided_at=?").run(moderator.id,time);
  lab.db.prepare("UPDATE reports SET status='reviewed'").run();
  lab.db.prepare("UPDATE comment_reports SET status='reviewed'").run();
  lab.db.prepare("UPDATE moderation_appeals SET status='upheld',decided_by=?,decided_at=?").run(moderator.id,time);
  lab.db.prepare("UPDATE sponsor_proposals SET status='approved',reviewer_id=?,reviewed_at=?").run(moderator.id,time);
  r=await req('/mod/queue-health',{cookie:moderator.cookie});
  assert.equal(r.data.pendingTotal,0);assert.equal(r.data.overdueTotal,0);
  assert.equal(r.data.overdueRate,null);

  lab.db.prepare("UPDATE users SET role='member' WHERE id=?").run(moderator.id);
  r=await req('/mod/queue-health',{cookie:moderator.cookie});
  assert.equal(r.status,403,'role demotion revokes private operations view with existing session');
  assert.deepEqual(lab.db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.throws(()=>measureModerationQueues(lab.db,NaN),/safe/);
  assert.throws(()=>measureModerationQueues(lab.db,-1),/safe/);
 }finally{await lab.close();}
});
